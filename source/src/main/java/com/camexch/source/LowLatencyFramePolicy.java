package com.camexch.source;

final class LowLatencyFramePolicy {
    private final long maxDecodedAgeNs;

    LowLatencyFramePolicy(long maxDecodedAgeMs) {
        if (maxDecodedAgeMs < 0) {
            throw new IllegalArgumentException("maxDecodedAgeMs must not be negative");
        }
        maxDecodedAgeNs = maxDecodedAgeMs * 1_000_000L;
    }

    boolean shouldRender(boolean newestInBatch, long decodedAgeNs) {
        return newestInBatch && (decodedAgeNs < 0 || decodedAgeNs <= maxDecodedAgeNs);
    }
}
