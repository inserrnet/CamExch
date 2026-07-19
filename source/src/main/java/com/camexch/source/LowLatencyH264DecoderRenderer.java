package com.camexch.source;

import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.os.Build;
import android.view.Surface;

import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.decoder.DecoderInputBuffer;
import androidx.media3.exoplayer.BaseRenderer;
import androidx.media3.exoplayer.ExoPlaybackException;
import androidx.media3.exoplayer.FormatHolder;
import androidx.media3.exoplayer.RendererCapabilities;

import java.nio.ByteBuffer;
import java.util.LinkedHashMap;
import java.util.Map;

@UnstableApi
final class LowLatencyH264DecoderRenderer extends BaseRenderer {
    interface Listener {
        void onVideoSize(int width, int height);
    }

    private static final int MAX_WORK_PER_RENDER = 32;
    private static final int MAX_TIMESTAMP_ENTRIES = 512;
    private static final long METRICS_INTERVAL_NS = 1_000_000_000L;

    private final Context context;
    private final Surface outputSurface;
    private final Listener listener;
    private final DecoderInputBuffer inputBuffer = new DecoderInputBuffer(
            DecoderInputBuffer.BUFFER_REPLACEMENT_MODE_DIRECT
    );
    private final MediaCodec.BufferInfo outputInfo = new MediaCodec.BufferInfo();
    private final Map<Long, Long> inputArrivalNs = new LinkedHashMap<>();
    private final LowLatencyFramePolicy framePolicy = new LowLatencyFramePolicy(
            VideoPipelinePolicy.MAX_DECODED_AGE_MS
    );

    private MediaCodec codec;
    private Format currentFormat;
    private boolean hasPendingInput;
    private boolean inputEnded;
    private boolean outputEnded;
    private long lastCodecPtsUs;
    private long inputCount;
    private long decodedCount;
    private long renderedCount;
    private long skippedCount;
    private long lastMetricsNs;

    LowLatencyH264DecoderRenderer(Context context, Surface outputSurface, Listener listener) {
        super(C.TRACK_TYPE_VIDEO);
        this.context = context.getApplicationContext();
        this.outputSurface = outputSurface;
        this.listener = listener;
    }

    @Override
    public String getName() {
        return "CamExchLowLatencyH264Decoder";
    }

    @Override
    public @Capabilities int supportsFormat(Format format) {
        return RendererCapabilities.create(MimeTypes.VIDEO_H264.equals(format.sampleMimeType)
                ? C.FORMAT_HANDLED
                : C.FORMAT_UNSUPPORTED_SUBTYPE);
    }

    @Override
    public void render(long positionUs, long elapsedRealtimeUs) throws ExoPlaybackException {
        try {
            for (int i = 0; i < MAX_WORK_PER_RENDER; i++) {
                boolean drained = drainOutput();
                boolean fed = feedInput();
                if (!drained && !fed) {
                    break;
                }
            }
        } catch (Throwable throwable) {
            throw createRendererException(
                    throwable,
                    currentFormat,
                    PlaybackException.ERROR_CODE_DECODING_FAILED
            );
        }
    }

    @Override
    public boolean isEnded() {
        return outputEnded;
    }

    @Override
    public boolean isReady() {
        return true;
    }

    @Override
    protected void onPositionReset(long positionUs, boolean joining) {
        hasPendingInput = false;
        inputEnded = false;
        outputEnded = false;
        inputArrivalNs.clear();
        if (codec != null) {
            codec.flush();
        }
    }

    @Override
    protected void onDisabled() {
        releaseCodec();
        currentFormat = null;
        hasPendingInput = false;
        inputEnded = false;
        outputEnded = false;
        inputArrivalNs.clear();
    }

    private boolean feedInput() throws Exception {
        if (inputEnded) {
            return false;
        }
        if (!hasPendingInput) {
            inputBuffer.clear();
            FormatHolder holder = getFormatHolder();
            int result = readSource(holder, inputBuffer, 0);
            if (result == C.RESULT_FORMAT_READ) {
                if (holder.format != null) {
                    configureCodec(holder.format);
                }
                return true;
            }
            if (result != C.RESULT_BUFFER_READ) {
                return false;
            }
            inputBuffer.flip();
            hasPendingInput = true;
        }
        if (codec == null) {
            return false;
        }
        int inputIndex = codec.dequeueInputBuffer(0);
        if (inputIndex < 0) {
            return false;
        }
        if (inputBuffer.isEndOfStream()) {
            codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
            inputEnded = true;
            hasPendingInput = false;
            return true;
        }
        ByteBuffer codecInput = codec.getInputBuffer(inputIndex);
        ByteBuffer source = inputBuffer.data;
        if (codecInput == null || source == null) {
            throw new IllegalStateException("H264 decoder input buffer unavailable");
        }
        codecInput.clear();
        ByteBuffer payload = source.duplicate();
        if (codecInput.remaining() < payload.remaining()) {
            throw new IllegalStateException("H264 access unit exceeds decoder input capacity");
        }
        int payloadSize = payload.remaining();
        codecInput.put(payload);
        long nowNs = System.nanoTime();
        long codecPtsUs = Math.max(nowNs / 1_000L, lastCodecPtsUs + 1);
        lastCodecPtsUs = codecPtsUs;
        inputArrivalNs.put(codecPtsUs, nowNs);
        trimTimestampMap();
        codec.queueInputBuffer(inputIndex, 0, payloadSize, codecPtsUs, 0);
        inputCount++;
        hasPendingInput = false;
        return true;
    }

    private boolean drainOutput() {
        if (codec == null || outputEnded) {
            return false;
        }
        int newestIndex = -1;
        long newestPtsUs = 0;
        int newestFlags = 0;
        boolean madeProgress = false;
        for (int i = 0; i < MAX_WORK_PER_RENDER; i++) {
            int outputIndex = codec.dequeueOutputBuffer(outputInfo, 0);
            if (outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER) {
                break;
            }
            if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                logOutputFormat(codec.getOutputFormat());
                madeProgress = true;
                continue;
            }
            if (outputIndex < 0) {
                continue;
            }
            madeProgress = true;
            decodedCount++;
            if (newestIndex >= 0) {
                releaseDecodedOutput(newestIndex, newestPtsUs, newestFlags, false);
            }
            newestIndex = outputIndex;
            newestPtsUs = outputInfo.presentationTimeUs;
            newestFlags = outputInfo.flags;
        }
        if (newestIndex >= 0) {
            Long arrivalNs = inputArrivalNs.get(newestPtsUs);
            long ageNs = arrivalNs == null ? -1 : System.nanoTime() - arrivalNs;
            boolean endOfStream = (newestFlags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
            boolean render = !endOfStream && framePolicy.shouldRender(true, ageNs);
            releaseDecodedOutput(newestIndex, newestPtsUs, newestFlags, render);
            if (endOfStream) {
                outputEnded = true;
            }
            logMetrics(ageNs);
        }
        return madeProgress;
    }

    private void releaseDecodedOutput(int index, long ptsUs, int flags, boolean render) {
        codec.releaseOutputBuffer(index, render);
        inputArrivalNs.remove(ptsUs);
        if ((flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) == 0) {
            if (render) {
                renderedCount++;
            } else {
                skippedCount++;
            }
        }
    }

    private void configureCodec(Format format) throws Exception {
        if (!MimeTypes.VIDEO_H264.equals(format.sampleMimeType)) {
            throw new IllegalArgumentException("Low-latency RTSP requires H264, received "
                    + format.sampleMimeType);
        }
        if (format.width <= 0 || format.height <= 0) {
            throw new IllegalArgumentException("RTSP H264 dimensions are unavailable");
        }
        if (currentFormat != null
                && codec != null
                && currentFormat.width == format.width
                && currentFormat.height == format.height
                && currentFormat.initializationData.equals(format.initializationData)) {
            currentFormat = format;
            return;
        }
        releaseCodec();
        currentFormat = format;
        listener.onVideoSize(format.width, format.height);
        MediaFormat mediaFormat = MediaFormat.createVideoFormat(
                MimeTypes.VIDEO_H264,
                format.width,
                format.height
        );
        for (int i = 0; i < format.initializationData.size(); i++) {
            mediaFormat.setByteBuffer("csd-" + i, ByteBuffer.wrap(format.initializationData.get(i)));
        }
        float frameRate = format.frameRate > 0 ? format.frameRate : VideoPipelinePolicy.TARGET_FPS;
        mediaFormat.setFloat(MediaFormat.KEY_FRAME_RATE, frameRate);
        MediaCodecList codecList = new MediaCodecList(MediaCodecList.ALL_CODECS);
        String codecName = codecList.findDecoderForFormat(mediaFormat);
        if (codecName == null) {
            throw new IllegalStateException("No H264 decoder supports " + format.width + "x" + format.height);
        }
        mediaFormat.setInteger(MediaFormat.KEY_PRIORITY, 0);
        mediaFormat.setFloat(MediaFormat.KEY_OPERATING_RATE, Math.max(frameRate, VideoPipelinePolicy.TARGET_FPS));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            mediaFormat.setInteger(MediaFormat.KEY_LOW_LATENCY, 1);
        }
        MediaCodecInfo codecInfo = findCodecInfo(codecList, codecName);
        codec = MediaCodec.createByCodecName(codecName);
        codec.configure(mediaFormat, outputSurface, null, 0);
        codec.start();
        AppLog.info(context, "LowLatency decoder started name=" + codecName
                + " hardware=" + (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                || (codecInfo != null && codecInfo.isHardwareAccelerated()))
                + " size=" + format.width + "x" + format.height
                + " fps=" + frameRate + " lowLatency=" + (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R));
    }

    private MediaCodecInfo findCodecInfo(MediaCodecList codecList, String codecName) {
        for (MediaCodecInfo info : codecList.getCodecInfos()) {
            if (info.getName().equals(codecName)) {
                return info;
            }
        }
        return null;
    }

    private void logOutputFormat(MediaFormat outputFormat) {
        int width = outputFormat.containsKey(MediaFormat.KEY_WIDTH)
                ? outputFormat.getInteger(MediaFormat.KEY_WIDTH)
                : currentFormat.width;
        int height = outputFormat.containsKey(MediaFormat.KEY_HEIGHT)
                ? outputFormat.getInteger(MediaFormat.KEY_HEIGHT)
                : currentFormat.height;
        listener.onVideoSize(width, height);
        AppLog.info(context, "LowLatency decoder output size=" + width + "x" + height);
    }

    private void logMetrics(long newestAgeNs) {
        long nowNs = System.nanoTime();
        if (nowNs - lastMetricsNs < METRICS_INTERVAL_NS) {
            return;
        }
        lastMetricsNs = nowNs;
        AppLog.info(context, "LowLatency metrics input=" + inputCount
                + " decoded=" + decodedCount
                + " rendered=" + renderedCount
                + " skipped=" + skippedCount
                + " decoderAgeMs=" + (newestAgeNs < 0 ? -1 : newestAgeNs / 1_000_000)
                + " timestampQueue=" + inputArrivalNs.size());
    }

    private void trimTimestampMap() {
        while (inputArrivalNs.size() > MAX_TIMESTAMP_ENTRIES) {
            Long oldest = inputArrivalNs.keySet().iterator().next();
            inputArrivalNs.remove(oldest);
        }
    }

    private void releaseCodec() {
        MediaCodec activeCodec = codec;
        codec = null;
        if (activeCodec != null) {
            try {
                activeCodec.stop();
            } catch (Throwable ignored) {
            }
            try {
                activeCodec.release();
            } catch (Throwable ignored) {
            }
        }
        inputArrivalNs.clear();
    }
}
