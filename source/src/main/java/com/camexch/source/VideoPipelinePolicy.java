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
    static final long RTSP_STARTUP_GRACE_MS = 12_000;
    static final long RTSP_FRAME_STALL_MS = 4_000;
    static final long RTSP_RECOVERY_COOLDOWN_MS = 15_000;
    static final long PIPELINE_LOCK_TIMEOUT_MS = 10 * 60 * 1_000L;

    private VideoPipelinePolicy() {
    }

    static int maxBitrateForSize(int width, int height) {
        if (width <= 0 || height <= 0) {
            return 4_000_000;
        }
        long calculated = (long) width * height * TARGET_FPS / 4;
        return (int) Math.max(4_000_000L, Math.min(MAX_BITRATE_BPS, calculated));
    }

    static boolean shouldRecoverRtsp(long nowMs, long pipelineStartedMs,
                                     long lastFrameMs, long recoveryNotBeforeMs) {
        if (nowMs < recoveryNotBeforeMs
                || nowMs - pipelineStartedMs < RTSP_STARTUP_GRACE_MS) {
            return false;
        }
        long frameReferenceMs = Math.max(pipelineStartedMs, lastFrameMs);
        return nowMs - frameReferenceMs >= RTSP_FRAME_STALL_MS;
    }

    static long normalizedBufferedDurationMs(long rawBufferedMs) {
        return rawBufferedMs < 0 || rawBufferedMs > 60_000 ? -1 : rawBufferedMs;
    }
}
