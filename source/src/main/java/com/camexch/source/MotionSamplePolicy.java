package com.camexch.source;

final class MotionSamplePolicy {
    static final long ARCORE_FRESHNESS_MS = 500L;

    private MotionSamplePolicy() {
    }

    static boolean useArCore(boolean requested, boolean sampleAvailable,
                             long sampleAtMs, long nowMs) {
        return requested
                && sampleAvailable
                && sampleAtMs > 0L
                && nowMs >= sampleAtMs
                && nowMs - sampleAtMs <= ARCORE_FRESHNESS_MS;
    }
}
