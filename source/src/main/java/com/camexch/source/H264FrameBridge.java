package com.camexch.source;

import android.content.Context;

import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;

import org.webrtc.CapturerObserver;
import org.webrtc.JavaI420Buffer;
import org.webrtc.VideoFrame;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

final class H264FrameBridge {
    private static final int MAX_SAMPLES = 120;

    static final class Sample {
        final ByteBuffer data;
        final boolean keyFrame;
        final int width;
        final int height;
        final long sourceTimestampNs;

        Sample(ByteBuffer data, boolean keyFrame, int width, int height, long sourceTimestampNs) {
            this.data = data;
            this.keyFrame = keyFrame;
            this.width = width;
            this.height = height;
            this.sourceTimestampNs = sourceTimestampNs;
        }
    }

    private final Context context;
    private final Object lock = new Object();
    private final Map<Long, Sample> samples = new HashMap<>();
    private final ArrayDeque<Long> sampleOrder = new ArrayDeque<>();

    private volatile CapturerObserver observer;
    private JavaI420Buffer frameBuffer;
    private byte[] codecConfig = new byte[0];
    private int width;
    private int height;
    private String codecs = "";
    private volatile boolean firstSampleLogged;
    private long lastKeyFrameAtNs;

    H264FrameBridge(Context context) {
        this.context = context.getApplicationContext();
        WebRtcRuntime.initialize(this.context);
    }

    void onFormat(Format format) {
        if (!MimeTypes.VIDEO_H264.equals(format.sampleMimeType)) {
            throw new IllegalArgumentException("Direct mode requires H.264, received " + format.sampleMimeType);
        }
        int nextWidth = format.width > 0 ? format.width : 640;
        int nextHeight = format.height > 0 ? format.height : 480;
        byte[] nextConfig = joinCodecConfig(format.initializationData);
        synchronized (lock) {
            width = nextWidth;
            height = nextHeight;
            codecs = format.codecs == null ? "" : format.codecs;
            codecConfig = nextConfig;
            if (frameBuffer != null) {
                frameBuffer.release();
            }
            frameBuffer = JavaI420Buffer.allocate(width, height);
        }
        AppLog.info(context, "Direct H264 format codecs=" + codecs + " size=" + width + "x" + height
                + " csdBytes=" + nextConfig.length);
    }

    void onSample(ByteBuffer source, long presentationTimeUs, boolean keyFrame) {
        byte[] accessUnit = toAnnexB(source);
        if (accessUnit.length == 0) {
            return;
        }
        int sampleWidth;
        int sampleHeight;
        JavaI420Buffer buffer;
        byte[] config;
        synchronized (lock) {
            if (frameBuffer == null) {
                return;
            }
            sampleWidth = width;
            sampleHeight = height;
            buffer = frameBuffer;
            buffer.retain();
            config = codecConfig;
        }

        byte[] payload = keyFrame && config.length > 0 ? concatenate(config, accessUnit) : accessUnit;
        ByteBuffer encoded = ByteBuffer.allocateDirect(payload.length);
        encoded.put(payload).flip();
        long timestampNs = System.nanoTime();
        if (keyFrame) {
            if (lastKeyFrameAtNs != 0) {
                AppLog.info(context, "Direct H264 keyframe intervalMs="
                        + ((timestampNs - lastKeyFrameAtNs) / 1_000_000));
            }
            lastKeyFrameAtNs = timestampNs;
        }
        Sample sample = new Sample(encoded.asReadOnlyBuffer(), keyFrame, sampleWidth, sampleHeight, timestampNs);
        synchronized (lock) {
            samples.put(timestampNs, sample);
            sampleOrder.addLast(timestampNs);
            while (sampleOrder.size() > MAX_SAMPLES) {
                Long expired = sampleOrder.removeFirst();
                samples.remove(expired);
            }
        }

        if (!firstSampleLogged) {
            firstSampleLogged = true;
            AppLog.info(context, "Direct H264 first access unit bytes=" + payload.length
                    + " keyFrame=" + keyFrame + " sourcePtsUs=" + presentationTimeUs);
        }
        CapturerObserver activeObserver = observer;
        if (activeObserver != null) {
            VideoFrame frame = new VideoFrame(buffer, 0, timestampNs);
            try {
                activeObserver.onFrameCaptured(frame);
            } finally {
                frame.release();
            }
        } else {
            buffer.release();
        }
    }

    Sample findSample(long timestampNs) {
        synchronized (lock) {
            Sample exact = samples.get(timestampNs);
            return exact != null || sampleOrder.isEmpty() ? exact : samples.get(sampleOrder.peekLast());
        }
    }

    void attach(CapturerObserver capturerObserver) {
        observer = capturerObserver;
        capturerObserver.onCapturerStarted(true);
    }

    void detach(CapturerObserver capturerObserver) {
        if (observer == capturerObserver) {
            observer = null;
            capturerObserver.onCapturerStopped();
        }
    }

    boolean isReady() {
        synchronized (lock) {
            return frameBuffer != null && firstSampleLogged;
        }
    }

    String getCodecs() {
        synchronized (lock) {
            return codecs;
        }
    }

    int getWidth() {
        synchronized (lock) {
            return width;
        }
    }

    int getHeight() {
        synchronized (lock) {
            return height;
        }
    }

    void log(String message) {
        AppLog.info(context, message);
    }

    void release() {
        synchronized (lock) {
            samples.clear();
            sampleOrder.clear();
            if (frameBuffer != null) {
                frameBuffer.release();
                frameBuffer = null;
            }
        }
        observer = null;
    }

    private static byte[] joinCodecConfig(List<byte[]> entries) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        for (byte[] entry : entries) {
            byte[] normalized = toAnnexB(ByteBuffer.wrap(entry));
            output.write(normalized, 0, normalized.length);
        }
        return output.toByteArray();
    }

    private static byte[] toAnnexB(ByteBuffer source) {
        ByteBuffer input = source.duplicate();
        byte[] bytes = new byte[input.remaining()];
        input.get(bytes);
        if (hasStartCode(bytes)) {
            return bytes;
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream(bytes.length + 16);
        int offset = 0;
        while (offset + 4 <= bytes.length) {
            int length = ((bytes[offset] & 0xff) << 24)
                    | ((bytes[offset + 1] & 0xff) << 16)
                    | ((bytes[offset + 2] & 0xff) << 8)
                    | (bytes[offset + 3] & 0xff);
            offset += 4;
            if (length <= 0 || offset + length > bytes.length) {
                return bytes;
            }
            output.write(0);
            output.write(0);
            output.write(0);
            output.write(1);
            output.write(bytes, offset, length);
            offset += length;
        }
        return offset == bytes.length ? output.toByteArray() : bytes;
    }

    private static boolean hasStartCode(byte[] bytes) {
        return bytes.length >= 4 && bytes[0] == 0 && bytes[1] == 0
                && (bytes[2] == 1 || (bytes[2] == 0 && bytes[3] == 1));
    }

    private static byte[] concatenate(byte[] first, byte[] second) {
        byte[] result = new byte[first.length + second.length];
        System.arraycopy(first, 0, result, 0, first.length);
        System.arraycopy(second, 0, result, first.length, second.length);
        return result;
    }
}
