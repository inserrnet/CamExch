package com.camexch.source;

final class SourcePlaybackPolicy {
    private SourcePlaybackPolicy() {
    }

    static boolean shouldAutoPlay(String mode) {
        return !"Video".equals(mode);
    }
}
