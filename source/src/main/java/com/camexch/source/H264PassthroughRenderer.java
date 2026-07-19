package com.camexch.source;

import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.decoder.DecoderInputBuffer;
import androidx.media3.exoplayer.BaseRenderer;
import androidx.media3.exoplayer.FormatHolder;
import androidx.media3.exoplayer.RendererCapabilities;

import java.nio.ByteBuffer;

@OptIn(markerClass = UnstableApi.class)
final class H264PassthroughRenderer extends BaseRenderer {
    private final DecoderInputBuffer buffer = new DecoderInputBuffer(
            DecoderInputBuffer.BUFFER_REPLACEMENT_MODE_DIRECT
    );
    private final H264FrameBridge bridge;

    H264PassthroughRenderer(H264FrameBridge bridge) {
        super(C.TRACK_TYPE_VIDEO);
        this.bridge = bridge;
    }

    @Override
    public String getName() {
        return "CamExchH264Passthrough";
    }

    @Override
    public @Capabilities int supportsFormat(Format format) {
        return RendererCapabilities.create(MimeTypes.VIDEO_H264.equals(format.sampleMimeType)
                ? C.FORMAT_HANDLED
                : C.FORMAT_UNSUPPORTED_SUBTYPE);
    }

    @Override
    public void render(long positionUs, long elapsedRealtimeUs) {
        while (!hasReadStreamToEnd()) {
            buffer.clear();
            FormatHolder holder = getFormatHolder();
            int result = readSource(holder, buffer, 0);
            if (result == C.RESULT_FORMAT_READ) {
                if (holder.format != null) {
                    bridge.onFormat(holder.format);
                }
                continue;
            }
            if (result != C.RESULT_BUFFER_READ || buffer.isEndOfStream()) {
                return;
            }
            buffer.flip();
            ByteBuffer data = buffer.data;
            if (data != null) {
                bridge.onSample(data, buffer.timeUs, buffer.isKeyFrame());
            }
        }
    }

    @Override
    public boolean isEnded() {
        return hasReadStreamToEnd();
    }

    @Override
    public boolean isReady() {
        return true;
    }
}
