package com.camexch.source;

final class VideoPipelinePolicy {
    static final int MIN_BUFFER_MS = 0;
    static final int MAX_BUFFER_MS = 250;
    static final int MAX_DECODED_AGE_MS = 250;
    static final int RTSP_TIMEOUT_MS = 1_000;
    static final int TARGET_FPS = 30;
    static final int PLAYBACK_BUFFER_MS = 0;
    static final int REBUFFER_MS = 0;
    static final int MAX_BITRATE_BPS = 20_000_000;
    static final double RESOLUTION_SCALE = 1.0;

    private VideoPipelinePolicy() {
    }

    static int maxBitrateForSize(int width, int height) {
        if (width <= 0 || height <= 0) {
            return 4_000_000;
        }
        long calculated = (long) width * height * TARGET_FPS / 4;
        return (int) Math.max(4_000_000L, Math.min(MAX_BITRATE_BPS, calculated));
    }
}
