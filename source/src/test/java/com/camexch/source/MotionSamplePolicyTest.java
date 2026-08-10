package com.camexch.source;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class MotionSamplePolicyTest {
    @Test
    public void usesFreshArCoreSampleWhenRequested() {
        assertTrue(MotionSamplePolicy.useArCore(true, true, 1_000L, 1_500L));
    }

    @Test
    public void rejectsStaleArCoreSampleSoSensorsCanContinue() {
        assertFalse(MotionSamplePolicy.useArCore(true, true, 1_000L, 1_501L));
    }

    @Test
    public void rejectsArCoreWhenNotRequestedOrUnavailable() {
        assertFalse(MotionSamplePolicy.useArCore(false, true, 1_000L, 1_100L));
        assertFalse(MotionSamplePolicy.useArCore(true, false, 0L, 1_100L));
    }
}
