package com.camexch.browser;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class VirtualCameraScriptTest {
    @Test
    public void nativeRearRouteSelectsPrimaryCameraBeforeFocusing() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "native passthrough replacing secondary rear"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "nativeConstraints=constraintsForPrimaryRear(c)"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "native passthrough resolved primary="));
    }

    @Test
    public void rearAutofocusUsesContinuousModeWithoutSingleShotTransition() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "focusMode:'continuous'"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "rear autofocus continuous refreshed"));
        assertFalse(VirtualCameraScript.SCRIPT.contains(
                "focusMode:'single-shot'"));
    }

    @Test
    public void sourceStatsExposeBitrateAndStalls() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "decodedFps="));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "stalledReports="));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "freezes="));
    }
}
