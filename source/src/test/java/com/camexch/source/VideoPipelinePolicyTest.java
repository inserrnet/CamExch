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
        assertTrue(VideoPipelinePolicy.MIN_BITRATE_BPS >= 4_000_000);
        assertTrue(VideoPipelinePolicy.MAX_BITRATE_BPS >= VideoPipelinePolicy.MIN_BITRATE_BPS);
    }
}
