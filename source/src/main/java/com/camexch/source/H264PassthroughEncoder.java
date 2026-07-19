package com.camexch.source;

import org.webrtc.EncodedImage;
import org.webrtc.VideoCodecStatus;
import org.webrtc.VideoEncoder;
import org.webrtc.VideoFrame;

final class H264PassthroughEncoder implements VideoEncoder {
    private final H264FrameBridge bridge;
    private Callback callback;
    private boolean keyFrameSeen;
    private long lastSourceTimestampNs = Long.MIN_VALUE;

    H264PassthroughEncoder(H264FrameBridge bridge) {
        this.bridge = bridge;
    }

    @Override
    public VideoCodecStatus initEncode(Settings settings, Callback encodeCallback) {
        callback = encodeCallback;
        keyFrameSeen = false;
        lastSourceTimestampNs = Long.MIN_VALUE;
        return VideoCodecStatus.OK;
    }

    @Override
    public VideoCodecStatus release() {
        callback = null;
        return VideoCodecStatus.OK;
    }

    @Override
    public VideoCodecStatus encode(VideoFrame frame, EncodeInfo info) {
        Callback activeCallback = callback;
        if (activeCallback == null) {
            return VideoCodecStatus.UNINITIALIZED;
        }
        long timestampNs = frame.getTimestampNs();
        H264FrameBridge.Sample sample = bridge.findSample(timestampNs);
        if (sample == null) {
            return VideoCodecStatus.NO_OUTPUT;
        }
        if (sample.sourceTimestampNs == lastSourceTimestampNs) {
            return VideoCodecStatus.NO_OUTPUT;
        }
        if (!keyFrameSeen && !sample.keyFrame) {
            return VideoCodecStatus.NO_OUTPUT;
        }
        keyFrameSeen |= sample.keyFrame;
        lastSourceTimestampNs = sample.sourceTimestampNs;

        EncodedImage image = EncodedImage.builder()
                .setBuffer(sample.data.duplicate(), null)
                .setEncodedWidth(sample.width)
                .setEncodedHeight(sample.height)
                .setCaptureTimeNs(timestampNs)
                .setFrameType(sample.keyFrame
                        ? EncodedImage.FrameType.VideoFrameKey
                        : EncodedImage.FrameType.VideoFrameDelta)
                .setRotation(0)
                .createEncodedImage();
        try {
            activeCallback.onEncodedFrame(image, new CodecSpecificInfo());
        } finally {
            image.release();
        }
        return VideoCodecStatus.OK;
    }

    @Override
    public VideoCodecStatus setRateAllocation(BitrateAllocation allocation, int framerate) {
        return VideoCodecStatus.OK;
    }

    @Override
    public ScalingSettings getScalingSettings() {
        return ScalingSettings.OFF;
    }

    @Override
    public String getImplementationName() {
        return "CamExch H264 passthrough";
    }
}
