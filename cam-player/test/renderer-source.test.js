"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = fs.readFileSync(
  path.join(__dirname, "..", "renderer", "renderer.js"),
  "utf8",
);
const indexHtml = fs.readFileSync(
  path.join(__dirname, "..", "renderer", "index.html"),
  "utf8",
);
const preload = fs.readFileSync(
  path.join(__dirname, "..", "preload.js"),
  "utf8",
);

test("uses stable trilinear minification for downscaling", () => {
  assert.match(renderer, /gl\.LINEAR_MIPMAP_LINEAR/);
  assert.match(renderer, /gl\.generateMipmap\(gl\.TEXTURE_2D\)/);
  assert.match(renderer, /sourceToOutputScale < 0\.95/);
  assert.match(renderer, /uniform float u_lod_bias/);
  assert.match(renderer, /gl\.uniform1f\(uniforms\.lodBias, 0\)/);
});

test("keeps stable photo and video heartbeats so sites see a live camera", () => {
  assert.match(
    renderer,
    /pausedFrameTimer = setInterval\(\(\) => renderFrame\(true\), 1000 \/ idleFps\)/,
  );
  assert.doesNotMatch(renderer, /function emitCurrentFrame\(\)/);
  assert.match(renderer, /function requestCanvasFrame\(force = false\)/);
  assert.match(renderer, /!force && now - lastCanvasFrameRequestAt < \(1000 \/ requestedFps\) \* 0\.85/);
  assert.match(renderer, /function startVideoTransportScheduler\(\)/);
  assert.match(renderer, /CamFrameCadence\.advanceDeadline/);
  assert.match(renderer, /requestCanvasFrame\(true\)/);
  assert.match(renderer, /CamGeometry\.adaptiveFrameRate\([\s\S]*"idle"/);
  assert.match(renderer, /!canvasTrack \|\| peers\.size === 0/);
  assert.match(
    renderer,
    /const sender = pc\.addTrack[\s\S]*updatePausedFrameHeartbeat\(\)/,
  );
  assert.match(renderer, /function renderFrame\(force/);
  assert.match(renderer, /decodedIntervalMs=/);
  assert.match(renderer, /requestIntervalMs=/);
  assert.match(
    renderer,
    /waitForFirstEncodedFrame[\s\S]*renderFrame\(true\)/,
  );
});

test("mirrors the transmitted source and cached background on the GPU", () => {
  assert.match(renderer, /uniform int u_mirrored/);
  assert.match(renderer, /oriented\.x = 1\.0 - oriented\.x/);
  assert.match(renderer, /gl\.uniform1i\(uniforms\.mirrored, sourceMirrored \? 1 : 0\)/);
  assert.match(renderer, /snapshotMirrored = sourceMirrored !== backgroundSnapshotMirrored/);
  assert.match(renderer, /Source horizontal mirror=/);
});

test("composes live and recorded phone motion without changing manual transforms", () => {
  assert.match(renderer, /uniform float u_handheld_roll/);
  assert.doesNotMatch(renderer, /u_handheld_perspective/);
  assert.match(renderer, /centeredPixels = \(uv - 0\.5\) \* safeDisplayed/);
  assert.match(renderer, /rotatedPixels \/ safeDisplayed \+ 0\.5/);
  assert.match(renderer, /applyHandheld\(fgUv, displayed\)/);
  assert.doesNotMatch(renderer, /float depth =/);
  assert.match(renderer, /t\.scale \* handheld\.scale/);
  assert.match(renderer, /t\.panX \+ handheld\.panX/);
  assert.match(renderer, /window\.camPlayer\.onHandheldMotion/);
  assert.match(renderer, /new CamMotionProfile\.Player/);
  assert.match(renderer, /Recording 00:\$\{String\(elapsedSeconds\)/);
  assert.match(indexHtml, /id="motionMode"/);
  assert.match(indexHtml, /id="liveMotionToggle"/);
  assert.match(indexHtml, /id="motionProfileSelect"/);
  assert.match(indexHtml, /id="recordMotionButton"/);
  assert.doesNotMatch(indexHtml, /id="handheldToggle"/);
  assert.match(renderer, /liveTranslation: motionMode\.value === "live"/);
  assert.match(renderer, /depthScale=\$\{motion\.depthScale\.toFixed\(4\)\}/);
  assert.match(renderer, /trackingSource=\$\{motion\.trackingSource/);
  assert.match(renderer, /setLiveMotionRequested/);
});

test("coalesces phone motion before renderer IPC delivery", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(main, /function dispatchLatestMotionSample\(sample\)/);
  assert.match(main, /pendingMotionSample = sample/);
  assert.match(main, /setImmediate\(\(\) =>/);
  assert.match(main, /sequence <= latestSequence/);
});

test("throttles idle phone motion while preserving full-rate live and recording modes", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(main, /streamMotion: liveMotionRequested \|\| motionCaptureRequested/);
  assert.match(main, /sampleIntervalMs: liveMotionRequested \|\| motionCaptureRequested \? 33 : 500/);
  assert.match(main, /set-motion-capture-requested/);
  assert.match(preload, /setMotionCaptureRequested/);
  assert.match(renderer, /setMotionCaptureRequested\(true\)/);
  assert.match(renderer, /setMotionCaptureRequested\(false\)/);
});

test("opens dropped media through the same preparation pipeline", () => {
  assert.match(preload, /webUtils\.getPathForFile\(file\)/);
  assert.match(renderer, /prepareAndLoadMediaPath\(filePath, "drop"\)/);
  assert.match(renderer, /window\.camPlayer\.prepareMedia\(filePath\)/);
  assert.match(renderer, /event\.dataTransfer\.dropEffect = "copy"/);
});

test("clears only the recent file history", () => {
  assert.match(indexHtml, /id="clearRecentButton"/);
  assert.match(renderer, /recent = \[\];[\s\S]*renderRecent\(\);[\s\S]*savePreferences\(\)/);
  assert.match(renderer, /clearRecentButton\.disabled = recent\.length === 0/);
});

test("uploads an unchanged source only when its texture is dirty", () => {
  assert.match(renderer, /if \(sourceTextureDirty\) \{/);
  assert.match(renderer, /sourceTextureDirty = false/);
  assert.match(renderer, /sourceMipmapsValid = false/);
  assert.match(renderer, /needsMipmaps && !sourceMipmapsValid/);
});

test("stores the background snapshot in a bounded texture", () => {
  assert.match(renderer, /const maximumSnapshotDimension = 768/);
  assert.match(renderer, /backgroundSnapshotTexture/);
  assert.match(renderer, /u_source_pass == 1[\s\S]*orientUv\(vec2\(bounded\.x, 1\.0 - bounded\.y\)\)/);
  assert.match(renderer, /gl\.uniform1i\(blurUniforms\.sourcePass, 2\)/);
  assert.doesNotMatch(renderer, /backgroundSourceTexture/);
});

test("keeps the rendering color space explicit and avoids sharpening bias", () => {
  assert.match(renderer, /drawingBufferColorSpace" in gl/);
  assert.match(renderer, /unpackColorSpace" in gl/);
  assert.match(renderer, /gl\.uniform1f\(uniforms\.lodBias, 0\)/);
});

test("uses content-aware adaptive sender profiles and bounded keyframes", () => {
  assert.match(renderer, /sourceKind === "video" \? "motion" : "detail"/);
  assert.match(renderer, /CamGeometry\.adaptiveFrameRate/);
  assert.match(renderer, /sourceInteractionActive/);
  assert.match(renderer, /sender\.generateKeyFrame/);
  assert.match(renderer, /fallbackAllowed/);
  assert.match(renderer, /keyframe fallback \$\{reason\}`, 1/);
  assert.doesNotMatch(renderer, /scheduleKeyFrame\("source zoom"\)/);
  assert.doesNotMatch(renderer, /scheduleKeyFrame\("source drag complete"\)/);
  assert.match(renderer, /replacementStream = canvas\.captureStream\(0\)/);
});

test("allows only one active WebRTC encoder", () => {
  assert.match(renderer, /const MAX_ACTIVE_PEERS = 1/);
  assert.match(renderer, /closePeer\(existingId, `superseded by offer \$\{id\}`\)/);
  assert.doesNotMatch(renderer, /MAX_HANDOFF_PEERS/);
  assert.match(renderer, /sender\.replaceTrack\(null\)/);
});

test("reuses the healthy canvas capture track between short browser probes", () => {
  assert.match(renderer, /const localStream = ensureStream\(\)/);
  assert.doesNotMatch(renderer, /freshWhenIdle/);
  assert.match(renderer, /emitBootstrapFrames\(`offer \$\{id\} answered`/);
});

test("releases a decoded photo after preserving its full GPU texture", () => {
  assert.match(renderer, /Decoded photo CPU buffer released after GPU upload/);
  assert.match(renderer, /image\.removeAttribute\("src"\)/);
  assert.match(renderer, /image\.src = "data:image\/gif;base64/);
  assert.match(renderer, /sourceKind === "photo" && photoCpuReleased/);
});

test("replaces the capture track when a live site request changes output geometry", () => {
  assert.match(renderer, /function scheduleCaptureTrackRestart\(reason\)/);
  assert.match(renderer, /scheduleCaptureTrackRestart\(`output \$\{reason\}`\)/);
  assert.match(renderer, /expectedSender\.replaceTrack\(replacementTrack\)/);
  assert.match(renderer, /if \(captureTrackRestartPending[\s\S]*return false/);
  assert.match(renderer, /maintenance\.unexpectedCodecReports = 0/);
});

test("recovers from an unexpected software VP9 fallback", () => {
  assert.match(renderer, /preferredCodec === "H264"/);
  assert.match(renderer, /actualCodec\.toLowerCase\(\)\.includes\("vp9"\)/);
  assert.match(renderer, /Unexpected software VP9 fallback detected/);
  assert.match(renderer, /Working output not persisted because preferred=H264/);
});

test("coalesces source interaction rendering and preference writes", () => {
  assert.match(renderer, /function scheduleInteractiveRender\(\)/);
  assert.match(renderer, /interactiveRenderFrameId = requestAnimationFrame/);
  assert.match(renderer, /function schedulePreferencesSave\(delayMs = 180\)/);
  assert.match(renderer, /scheduleInteractiveRender\(\);[\s\S]*schedulePreferencesSave\(\)/);
  assert.match(renderer, /Source interaction started sequence=/);
  assert.match(renderer, /Source interaction completed sequence=/);
  assert.match(renderer, /finishWheelInteraction/);
});

test("refreshes active WebRTC sender parameters after live output changes", () => {
  assert.match(renderer, /scheduleSenderQualityRefresh\(`output \$\{reason\}`\)/);
  assert.match(renderer, /maintenance\?\.sender/);
  assert.match(renderer, /degradationPreference = "maintain-resolution"/);
});

test("coalesces bursts of live site configuration updates", () => {
  assert.match(renderer, /function scheduleSiteConfiguration/);
  assert.match(renderer, /}, 120\)/);
  assert.match(renderer, /Site size already active=/);
});

test("keeps manual and active output states separate", () => {
  assert.match(renderer, /let manualOutput =/);
  assert.match(renderer, /let activeOutputOrigin = "manual"/);
  assert.match(renderer, /manualOutput = \{ width: w, height: h \}/);
  assert.match(renderer, /\{ origin: "site" \}/);
  assert.match(renderer, /width: manualOutput\.width/);
  assert.match(renderer, /height: manualOutput\.height/);
  assert.doesNotMatch(renderer, /lastWorkingOutput/);
});

test("recovers a stalled encoder at the same resolution", () => {
  assert.match(renderer, /restartCaptureTrackAtCurrentResolution/);
  assert.match(renderer, /Encoder restart superseded after replacement/);
  assert.match(renderer, /restartCaptureTrackAtCurrentResolution\(`offer \$\{id\}`, id\)/);
  assert.match(renderer, /Encoder same-resolution restart/);
  assert.match(renderer, /Encoder output stalled id=/);
  assert.match(renderer, /maintenance\.encoderStallReports >= 2/);
  assert.match(renderer, /encoderFailures\.set/);
  assert.match(renderer, /for \(const \[failedOutput, failure\] of encoderFailures\.entries\(\)\)/);
  assert.match(renderer, /Encoder codec retry/);
  assert.match(renderer, /sameResolutionRecovery=true/);
  assert.doesNotMatch(renderer, /fallbackResolutionToggle/);
});

test("isolates media transitions and keeps motion frames active while paused", () => {
  assert.match(renderer, /let mediaLoading = false/);
  assert.match(renderer, /if \(mediaLoading \|\| !sourceElement\) return false/);
  assert.match(renderer, /motionMode\.value !== "off"/);
  assert.match(renderer, /motionMode\.value === "off" \? "idle" : "motion"/);
});

test("reloads the renderer after WebGL context loss", () => {
  assert.match(renderer, /webglcontextlost/);
  assert.match(renderer, /sessionStorage\.setItem\("camexchRestoreMedia"/);
  assert.match(renderer, /sessionStorage\.removeItem\("camexchRestoreMedia"\)/);
  assert.match(renderer, /location\.reload\(\)/);
});

test("migrates the output ceiling to 60 FPS without duplicating media frames", () => {
  assert.match(renderer, /preferencesVersion: 2/);
  assert.match(renderer, /preferences\.preferencesVersion\) >= 2 \? preferences\.fps \|\| 60 : 60/);
});

test("keeps one sender FPS ceiling while requestFrame controls cadence", () => {
  assert.match(renderer, /const configuredFps = configuredMaximumFps\(\)/);
  assert.match(renderer, /const contentFps = sourceKind === "video" \? effectiveMediaFps\(\) : configuredFps/);
  assert.match(renderer, /CamGeometry\.senderFrameRateLimit/);
  assert.match(renderer, /delete encoding\.maxFramerate/);
  assert.doesNotMatch(renderer, /const configuredFps = effectiveMediaFps\(\)/);
  assert.doesNotMatch(renderer, /scheduleSenderQualityRefresh\(`interaction/);
  assert.doesNotMatch(renderer, /scheduleSenderQualityRefresh\("playback/);
});
