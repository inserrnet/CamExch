package com.camexch.source;

import org.webrtc.VideoCodecInfo;
import org.webrtc.VideoEncoder;
import org.webrtc.VideoEncoderFactory;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

final class H264PassthroughEncoderFactory implements VideoEncoderFactory {
    private final H264FrameBridge bridge;
    private final VideoCodecInfo codecInfo;

    H264PassthroughEncoderFactory(H264FrameBridge bridge) {
        this.bridge = bridge;
        Map<String, String> parameters = new HashMap<>();
        parameters.put(VideoCodecInfo.H264_FMTP_PROFILE_LEVEL_ID, normalizedProfile(bridge.getCodecs()));
        parameters.put(VideoCodecInfo.H264_FMTP_LEVEL_ASYMMETRY_ALLOWED, "1");
        parameters.put(VideoCodecInfo.H264_FMTP_PACKETIZATION_MODE, "1");
        codecInfo = new VideoCodecInfo("H264", parameters, Collections.emptyList());
    }

    @Override
    public VideoEncoder createEncoder(VideoCodecInfo info) {
        return "H264".equalsIgnoreCase(info.name) ? new H264PassthroughEncoder(bridge) : null;
    }

    @Override
    public VideoCodecInfo[] getSupportedCodecs() {
        return new VideoCodecInfo[]{codecInfo};
    }

    private static String normalizedProfile(String codecs) {
        if (codecs != null) {
            String lower = codecs.toLowerCase();
            if (lower.contains("640c") || lower.contains("avc1.64")) {
                return VideoCodecInfo.H264_CONSTRAINED_HIGH_3_1;
            }
        }
        return VideoCodecInfo.H264_CONSTRAINED_BASELINE_3_1;
    }
}
