package com.camexch.source;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class LowLatencyFramePolicyTest {
    private final LowLatencyFramePolicy policy = new LowLatencyFramePolicy(250);

    @Test
    public void rendersOnlyNewestDecodedFrameInBatch() {
        assertFalse(policy.shouldRender(false, 10_000_000L));
        assertTrue(policy.shouldRender(true, 10_000_000L));
    }

    @Test
    public void skipsPresentationAfterLatencyBudgetWithoutDroppingDecoderInput() {
        assertTrue(policy.shouldRender(true, 250_000_000L));
        assertFalse(policy.shouldRender(true, 250_000_001L));
    }

    @Test
    public void rendersWhenTimestampMappingIsUnavailable() {
        assertTrue(policy.shouldRender(true, -1L));
    }
}
