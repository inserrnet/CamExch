package com.camexch.source;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SourcePlaybackPolicyTest {
    @Test
    public void fileVideoStartsPausedButRtspStartsPlaying() {
        assertFalse(SourcePlaybackPolicy.shouldAutoPlay("Video"));
        assertTrue(SourcePlaybackPolicy.shouldAutoPlay("RTSP"));
    }
}
