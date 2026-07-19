package com.camexch.source;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;

import org.junit.Test;

public class H264SampleStoreTest {
    private static final class Sample {
        final int width;
        final int height;

        Sample(int width, int height) {
            this.width = width;
            this.height = height;
        }
    }

    @Test
    public void findsFrameWhenWebRtcRoundsTimestamp() {
        H264SampleStore<Sample> store = new H264SampleStore<>(4);
        Sample keyFrame = new Sample(704, 1248);
        Sample deltaFrame = new Sample(704, 1248);
        store.add(1_000_000L, keyFrame, true);
        store.add(34_333_333L, deltaFrame, false);

        assertSame(keyFrame, store.findClosest(1_000_417L));
        assertSame(deltaFrame, store.findClosest(34_332_900L));
    }

    @Test
    public void recoversOnlyKeyFrameProducedAfterEncoderStarted() {
        H264SampleStore<Sample> store = new H264SampleStore<>(8);
        Sample oldKeyFrame = new Sample(1920, 1080);
        Sample currentKeyFrame = new Sample(1920, 1080);
        store.add(1_000L, oldKeyFrame, true);

        assertNull(store.findKeyFrameAtOrAfter(2_000L));

        store.add(3_000L, currentKeyFrame, true);
        assertSame(currentKeyFrame, store.findKeyFrameAtOrAfter(2_000L));
    }

    @Test
    public void clearingFormatDropsOldGopAndPreservesNewSourceDimensions() {
        H264SampleStore<Sample> store = new H264SampleStore<>(8);
        store.add(1_000L, new Sample(704, 1248), true);
        store.clear();

        assertNull(store.findClosest(1_000L));
        assertNull(store.findKeyFrameAtOrAfter(0L));

        Sample landscape = new Sample(1280, 720);
        store.add(2_000L, landscape, true);
        Sample result = store.findClosest(2_000L);
        assertEquals(1280, result.width);
        assertEquals(720, result.height);
    }

    @Test
    public void evictsOldFramesWithoutLosingLatestKeyFrameRecovery() {
        H264SampleStore<String> store = new H264SampleStore<>(2);
        store.add(1L, "key", true);
        store.add(2L, "delta-1", false);
        store.add(3L, "delta-2", false);

        assertEquals("delta-1", store.findClosest(1L));
        assertEquals("key", store.findKeyFrameAtOrAfter(0L));
    }
}
