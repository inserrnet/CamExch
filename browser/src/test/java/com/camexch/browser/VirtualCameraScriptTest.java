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
                "openPrimaryRear(nativeConstraints,authorize,'NATIVE')"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "native passthrough resolved physicalId="));
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
    public void nativeInventoryFindsPrimaryRearBeforeReturningNativeDevices() {
        int mapped = VirtualCameraScript.SCRIPT.indexOf("const mapped=list.map");
        int nativeReturn = VirtualCameraScript.SCRIPT.indexOf("visibleList=native");
        assertTrue(mapped >= 0);
        assertTrue(nativeReturn > mapped);
        assertTrue(VirtualCameraScript.SCRIPT.contains("primaryBackId='+(primaryBackId||'unresolved')"));
    }

    @Test
    public void staleIdsAreRemovedAndRearRequestsShareOnePhysicalCamera() {
        assertTrue(VirtualCameraScript.SCRIPT.contains("stale camera deviceId removed"));
        assertTrue(VirtualCameraScript.SCRIPT.contains("primary rear lease reused"));
        assertTrue(VirtualCameraScript.SCRIPT.contains("primary rear lease clone"));
        assertTrue(VirtualCameraScript.SCRIPT.contains("rear autofocus delayed verify"));
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
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "Selected Cam Player route has no matching ICE candidate"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "localCandidatesPreserved='+routedOffer.kept"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "strictRoute='+routedAnswer.strict"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "if(localSide)return {sdp:sdp"));
    }

    @Test
    public void sourceSessionIsClosedOnRemoteEndAndPageHide() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "resetSharedRtc('remote track ended',pc)"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "resetSharedRtc('pagehide')"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "activeBridgeRequestId||sharedRtcSessionId"));
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
    public void sourcePreservesTheNativeRemoteTrackForSiteCompatibility() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "if(route==='SOURCE')return createSourceDirectProxy(initialStream)"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "source direct track enabled; Canvas proxy bypassed"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "route==='NATIVE'||route==='SOURCE'||isHighResolutionRear"));
        assertFalse(VirtualCameraScript.SCRIPT.contains(
                "if(route==='SOURCE')return createStableProxy(initialStream)"));
    }

    @Test
    public void mediaConsumerDiagnosticsReportInstallationAndAssignments() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "camera media consumer tracking installed"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "camera media consumer tracking unavailable srcObject descriptor missing"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "streamId='+(value.id||'')+' managed="));
    }

    @Test
    public void sourceTrackRejectsImplausibleWebViewFrameRates() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "nativeFps>=1&&nativeFps<=60"));
    }

    @Test
    public void sourceCameraExposesTheNativeFrontCameraLabel() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "let nativeFrontLabel='Front Camera'"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "nativeFrontLabel=label"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "getCameraInventory"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "if(controller.route==='SOURCE')return sourceIdentity(controller).label"));
        assertFalse(VirtualCameraScript.SCRIPT.contains(
                "d.label==='Front Camera 4'"));
    }

    @Test
    public void forcedSourceIdentityFollowsTheSitesRequestedCamera() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "function sourceIdentity(controller)"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "constraintHas(v.facingMode,'environment')"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "result.facingMode=identity.facingMode"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "result.deviceId=identity.deviceId"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "label:nativeRearLabel||'Back Camera'"));
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

    @Test
    public void sourceSessionUsesAnIdleGracePeriod() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "SOURCE_IDLE_GRACE_MS=6000"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "shared source release scheduled"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "cancelSharedRtcRelease"));
    }

    @Test
    public void sourcePreflightRunsOncePerSharedConnection() {
        assertTrue(VirtualCameraScript.SCRIPT.contains("source preflight reused id="));
        assertTrue(VirtualCameraScript.SCRIPT.contains("sharedRtcPreflightPromise=null"));
    }

    @Test
    public void reusedSourceSessionWaitsForRequestedGeometry() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "waitForSourceGeometry"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "Source geometry confirmed"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "Source geometry retained"));
    }

    @Test
    public void sourceGeometryFingerprintIncludesAspectRatioAndFrameRate() {
        assertTrue(VirtualCameraScript.SCRIPT.contains("aspectRatio:sourceConstraintKey(video.aspectRatio)"));
        assertTrue(VirtualCameraScript.SCRIPT.contains("frameRate:sourceConstraintKey(video.frameRate)"));
        assertTrue(VirtualCameraScript.SCRIPT.contains("resizeMode:video.resizeMode||''"));
    }

    @Test
    public void lateCameraRequestsCannotCrossRouteGenerations() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "stale camera operation discarded"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "actualRoute="));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "camera request id='+requestId+' retry="));
    }

    @Test
    public void invalidConstraintsKeepNativeErrorSemantics() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "invalid getUserMedia constraints delegated to native semantics"));
        assertFalse(VirtualCameraScript.SCRIPT.contains(
                "mode=SOURCE constraints=undefined route=physical"));
    }

    @Test
    public void sourceConfigurationRemovesPhysicalIdentityAndReadsAdvancedGeometry() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "removed physical deviceId from Cam Player configuration"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "sourceRequestedPair"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "Source switch preserved requested geometry="));
    }

    @Test
    public void cameraPauseDiagnosticsIncludeTheCallSite() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "camera media pause called visibility="));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "new Error().stack"));
    }

    @Test
    public void javascriptLogsRedactUrlQueries() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "function sanitizeLogText"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "?<redacted>"));
    }

    @Test
    public void discardedSessionsCannotBeResolvedFromStaleWeakMaps() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "mapped&&managedStreams.has(mapped)"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "direct&&managedStreams.has(direct)"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "managedTrackEntries.delete(track)"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "managedStreamEntries.delete(entry.stream)"));
    }

    @Test
    public void detachedConsumersOnlySurviveBriefDomRemounts() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "DETACHED_CONSUMER_GRACE_MS=1500"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "function managedEntryUsage(entry)"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "detachedRecent"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "detachedStale"));
        assertFalse(VirtualCameraScript.SCRIPT.contains(
                "detachedRetained"));
    }

    @Test
    public void sourceModeWaitsForANewRequestInsteadOfRevivingStaleConsumers() {
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "inactive before route switch"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "usageByEntry.get(entry).retainable>0"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "waiting-for-getUserMedia"));
        assertTrue(VirtualCameraScript.SCRIPT.contains(
                "camera route switch completed"));
    }
}
