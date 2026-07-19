package com.camexch.source;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;

final class H264SampleStore<T> {
    private static final class Entry<T> {
        final long timestampNs;
        final T value;

        Entry(long timestampNs, T value) {
            this.timestampNs = timestampNs;
            this.value = value;
        }
    }

    private final int capacity;
    private final Map<Long, Entry<T>> entries = new HashMap<>();
    private final ArrayDeque<Long> order = new ArrayDeque<>();
    private Entry<T> latestKeyFrame;

    H264SampleStore(int capacity) {
        if (capacity < 1) {
            throw new IllegalArgumentException("capacity must be positive");
        }
        this.capacity = capacity;
    }

    void add(long timestampNs, T value, boolean keyFrame) {
        Entry<T> entry = new Entry<>(timestampNs, value);
        entries.put(timestampNs, entry);
        order.addLast(timestampNs);
        if (keyFrame) {
            latestKeyFrame = entry;
        }
        while (order.size() > capacity) {
            entries.remove(order.removeFirst());
        }
    }

    T findClosest(long timestampNs) {
        Entry<T> exact = entries.get(timestampNs);
        if (exact != null) {
            return exact.value;
        }
        Entry<T> closest = null;
        long closestDistanceNs = Long.MAX_VALUE;
        for (Entry<T> candidate : entries.values()) {
            long distanceNs = absoluteDistance(candidate.timestampNs, timestampNs);
            if (distanceNs < closestDistanceNs) {
                closest = candidate;
                closestDistanceNs = distanceNs;
            }
        }
        return closest == null ? null : closest.value;
    }

    T findKeyFrameAtOrAfter(long timestampNs) {
        return latestKeyFrame != null && latestKeyFrame.timestampNs >= timestampNs
                ? latestKeyFrame.value
                : null;
    }

    void clear() {
        entries.clear();
        order.clear();
        latestKeyFrame = null;
    }

    private static long absoluteDistance(long first, long second) {
        long distance = first - second;
        return distance == Long.MIN_VALUE ? Long.MAX_VALUE : Math.abs(distance);
    }
}
