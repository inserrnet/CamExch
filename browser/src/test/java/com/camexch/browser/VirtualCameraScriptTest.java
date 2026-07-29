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
                "rear autofocus mode=continuous applied"));
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
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "avgDecodeMs="));
    }

    @Test
    public void sourceNegotiationIsAsynchronousAndRouteAware() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "beginAnswerOffer"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "pollAnswerOffer"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "closeCamPlayerSession"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "preferIceRoute"));
    }

    @Test
    public void rearProxyTransfersVideoFramesBeforeFallingBackToCanvas() {
        int generator = VirtualCameraScript.SCRIPT.indexOf(
                "return createGeneratorProxy(initialStream)");
        int canvas = VirtualCameraScript.SCRIPT.indexOf(
                "return createCanvasProxy(initialStream)");
        assertTrue(generator >= 0);
        assertTrue(canvas > generator);
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "Camera source produced no VideoFrame within 1200ms"));
    }

    @Test
    public void sourceTrackRejectsImplausibleWebViewFrameRates() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "nativeFps>=1&&nativeFps<=60"));
    }

    @Test
    public void staticSourceCloneKeepsTheHealthySharedConnection() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "waitForLiveSourceTrack(track,2000,true)"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "Source clone geometry still pending; retaining healthy shared track"));
        assertFalse(VirtualCameraScript.SCRIPT.contains(
                "resetSharedRtc('cloned track geometry failed"));
    }
}
