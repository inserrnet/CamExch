package com.camexch.source;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
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

    @Test
    public void forcesReliableTransportOnlyForRtsp() {
        assertTrue(VideoPipelinePolicy.shouldForceRtspTcp("RTSP"));
        assertFalse(VideoPipelinePolicy.shouldForceRtspTcp("Video"));
        assertFalse(VideoPipelinePolicy.shouldForceRtspTcp("Photo"));
        assertFalse(VideoPipelinePolicy.shouldForceRtspTcp(null));
    }

    @Test
    public void rtspWatchdogWaitsForStartupThenRecoversMissingFrames() {
        long started = 1_000;
        assertFalse(VideoPipelinePolicy.shouldRecoverRtsp(
                started + 11_999, started, 0, 0));
        assertTrue(VideoPipelinePolicy.shouldRecoverRtsp(
                started + 12_000, started, 0, 0));
    }

    @Test
    public void rtspWatchdogUsesLatestFrameAndRecoveryCooldown() {
        long started = 1_000;
        long frame = 20_000;
        assertFalse(VideoPipelinePolicy.shouldRecoverRtsp(
                frame + 3_999, started, frame, 0));
        assertTrue(VideoPipelinePolicy.shouldRecoverRtsp(
                frame + 4_000, started, frame, 0));
        assertFalse(VideoPipelinePolicy.shouldRecoverRtsp(
                frame + 10_000, started, frame, frame + 15_000));
    }

    @Test
    public void invalidLiveBufferSentinelsAreNotReportedAsRealLatency() {
        assertEquals(250L, VideoPipelinePolicy.normalizedBufferedDurationMs(250));
        assertEquals(-1L, VideoPipelinePolicy.normalizedBufferedDurationMs(-1));
        assertEquals(-1L, VideoPipelinePolicy.normalizedBufferedDurationMs(Long.MAX_VALUE));
    }
}
