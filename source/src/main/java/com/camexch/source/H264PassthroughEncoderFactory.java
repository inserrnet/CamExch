package com.camexch.source;

import org.webrtc.VideoCodecInfo;
import org.webrtc.VideoEncoder;
import org.webrtc.VideoEncoderFactory;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

final class H264PassthroughEncoderFactory implements VideoEncoderFactory {
    private final H264FrameBridge bridge;
    private final VideoCodecInfo[] codecInfos;

    H264PassthroughEncoderFactory(H264FrameBridge bridge) {
        this.bridge = bridge;
        String sourceProfile = normalizedProfile(bridge.getCodecs());
        VideoCodecInfo preferred = codec(sourceProfile);
        VideoCodecInfo baseline = codec(VideoCodecInfo.H264_CONSTRAINED_BASELINE_3_1);
        codecInfos = sourceProfile.equals(VideoCodecInfo.H264_CONSTRAINED_BASELINE_3_1)
                ? new VideoCodecInfo[]{baseline}
                : new VideoCodecInfo[]{preferred, baseline};
    }

    @Override
    public VideoEncoder createEncoder(VideoCodecInfo info) {
        if (!"H264".equalsIgnoreCase(info.name)) {
            return null;
        }
        bridge.log("Direct encoder selected WebRTC codec=" + info);
        return new H264PassthroughEncoder(bridge);
    }

    @Override
    public VideoCodecInfo[] getSupportedCodecs() {
        return codecInfos.clone();
    }

    private static VideoCodecInfo codec(String profile) {
        Map<String, String> parameters = new HashMap<>();
        parameters.put(VideoCodecInfo.H264_FMTP_PROFILE_LEVEL_ID, profile);
        parameters.put(VideoCodecInfo.H264_FMTP_LEVEL_ASYMMETRY_ALLOWED, "1");
        parameters.put(VideoCodecInfo.H264_FMTP_PACKETIZATION_MODE, "1");
        return new VideoCodecInfo("H264", parameters, Collections.emptyList());
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
