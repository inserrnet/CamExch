package com.camexch.source;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class FrameTimestampTrackerTest {
    @Test
    public void measuresDecoderAgeAndRemovesCompletedFrame() {
        FrameTimestampTracker tracker = new FrameTimestampTracker(4);
        tracker.record(100L, 1_000L);

        assertEquals(500L, tracker.removeAndGetAgeNs(100L, 1_500L));
        assertEquals(-1L, tracker.removeAndGetAgeNs(100L, 2_000L));
    }

    @Test
    public void boundsMetadataWithoutChangingFrameOrder() {
        FrameTimestampTracker tracker = new FrameTimestampTracker(2);
        tracker.record(1L, 100L);
        tracker.record(2L, 200L);
        tracker.record(3L, 300L);

        assertEquals(2, tracker.size());
        assertEquals(-1L, tracker.removeAndGetAgeNs(1L, 400L));
        assertEquals(200L, tracker.removeAndGetAgeNs(2L, 400L));
    }
}
