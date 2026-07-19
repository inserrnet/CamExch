package com.camexch.source;

import java.util.LinkedHashMap;
import java.util.Map;

final class FrameTimestampTracker {
    private final int capacity;
    private final Map<Long, Long> arrivalsNs = new LinkedHashMap<>();

    FrameTimestampTracker(int capacity) {
        if (capacity < 1) {
            throw new IllegalArgumentException("capacity must be positive");
        }
        this.capacity = capacity;
    }

    void record(long presentationTimeUs, long arrivalNs) {
        arrivalsNs.put(presentationTimeUs, arrivalNs);
        while (arrivalsNs.size() > capacity) {
            Long oldest = arrivalsNs.keySet().iterator().next();
            arrivalsNs.remove(oldest);
        }
    }

    long removeAndGetAgeNs(long presentationTimeUs, long nowNs) {
        Long arrivalNs = arrivalsNs.remove(presentationTimeUs);
        return arrivalNs == null ? -1 : Math.max(0, nowNs - arrivalNs);
    }

    void remove(long presentationTimeUs) {
        arrivalsNs.remove(presentationTimeUs);
    }

    int size() {
        return arrivalsNs.size();
    }

    void clear() {
        arrivalsNs.clear();
    }
}
