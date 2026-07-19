package com.camexch.source;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class VideoPipelinePolicyTest {
    @Test
    public void keepsNativeResolutionAndBoundsLiveBuffer() {
        assertEquals(1.0, VideoPipelinePolicy.RESOLUTION_SCALE, 0.0);
        assertEquals(0, VideoPipelinePolicy.MIN_BUFFER_MS);
        assertTrue(VideoPipelinePolicy.MAX_BUFFER_MS <= 250);
        assertEquals(0, VideoPipelinePolicy.PLAYBACK_BUFFER_MS);
        assertEquals(0, VideoPipelinePolicy.REBUFFER_MS);
    }

    @Test
    public void reservesHighQualityLocalWebRtcBitrate() {
        assertEquals(6_589_440, VideoPipelinePolicy.maxBitrateForSize(704, 1248));
        assertTrue(VideoPipelinePolicy.maxBitrateForSize(1920, 1080) > 10_000_000);
        assertTrue(VideoPipelinePolicy.maxBitrateForSize(7680, 4320)
                <= VideoPipelinePolicy.MAX_BITRATE_BPS);
    }
}
