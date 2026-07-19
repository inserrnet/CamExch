package com.camexch.source;

final class VideoPipelinePolicy {
    static final int MIN_BUFFER_MS = 0;
    static final int MAX_BUFFER_MS = 250;
    static final int PLAYBACK_BUFFER_MS = 0;
    static final int REBUFFER_MS = 0;
    static final int MIN_BITRATE_BPS = 4_000_000;
    static final int MAX_BITRATE_BPS = 20_000_000;
    static final double RESOLUTION_SCALE = 1.0;

    private VideoPipelinePolicy() {
    }
}
