package com.camexch.source;

import org.webrtc.EncodedImage;
import org.webrtc.VideoCodecStatus;
import org.webrtc.VideoEncoder;
import org.webrtc.VideoFrame;

final class H264PassthroughEncoder implements VideoEncoder {
    private final H264FrameBridge bridge;
    private Callback callback;
    private boolean keyFrameSeen;
    private boolean missingSampleLogged;
    private boolean waitingForKeyLogged;
    private boolean firstOutputLogged;
    private boolean initialized;
    private long initializedAtNs;
    private long lastSourceTimestampNs = Long.MIN_VALUE;

    H264PassthroughEncoder(H264FrameBridge bridge) {
        this.bridge = bridge;
    }

    @Override
    public VideoCodecStatus initEncode(Settings settings, Callback encodeCallback) {
        callback = encodeCallback;
        if (!initialized) {
            initialized = true;
            initializedAtNs = System.nanoTime();
            keyFrameSeen = false;
            missingSampleLogged = false;
            waitingForKeyLogged = false;
            firstOutputLogged = false;
            lastSourceTimestampNs = Long.MIN_VALUE;
        }
        int sourceWidth = bridge.getWidth();
        int sourceHeight = bridge.getHeight();
        bridge.log("Direct encoder initialized requested=" + settings.width + "x" + settings.height
                + " source=" + sourceWidth + "x" + sourceHeight
                + " preserveSourceResolution=true fps=" + settings.maxFramerate);
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
            bridge.recordMissingSampleDrop();
            if (!missingSampleLogged) {
                missingSampleLogged = true;
                bridge.log("Direct encoder is waiting for a matching H264 access unit");
            }
            return VideoCodecStatus.NO_OUTPUT;
        }
        if (sample.sourceTimestampNs == lastSourceTimestampNs) {
            bridge.recordDuplicateDrop();
            return VideoCodecStatus.NO_OUTPUT;
        }
        if (!keyFrameSeen && !sample.keyFrame) {
            H264FrameBridge.Sample recoveredKeyFrame = bridge.findKeyFrameAtOrAfter(initializedAtNs);
            if (recoveredKeyFrame != null) {
                sample = recoveredKeyFrame;
                bridge.log("Direct encoder recovered the first H264 key frame after timestamp remap");
            }
        }
        if (!keyFrameSeen && !sample.keyFrame) {
            bridge.recordWaitingKeyDrop();
            if (!waitingForKeyLogged) {
                waitingForKeyLogged = true;
                bridge.log("Direct encoder is waiting for the next H264 key frame");
            }
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
            bridge.recordEncodedFrame();
            if (!firstOutputLogged) {
                firstOutputLogged = true;
                bridge.log("Direct encoder sent first H264 frame bytes=" + sample.data.remaining()
                        + " keyFrame=" + sample.keyFrame);
            }
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
