"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = fs.readFileSync(
  path.join(__dirname, "..", "renderer", "renderer.js"),
  "utf8",
);

test("uses stable trilinear minification for downscaling", () => {
  assert.match(renderer, /gl\.LINEAR_MIPMAP_LINEAR/);
  assert.match(renderer, /gl\.generateMipmap\(gl\.TEXTURE_2D\)/);
  assert.match(renderer, /sourceToOutputScale < 0\.95/);
  assert.match(renderer, /uniform float u_lod_bias/);
  assert.match(renderer, /gl\.uniform1f\(uniforms\.lodBias, 0\)/);
});

test("re-renders the paused frame so a late encoder always receives pixels", () => {
  assert.match(
    renderer,
    /pausedFrameTimer = setInterval\(\(\) => renderFrame\(true\), 250\)/,
  );
  assert.match(renderer, /!canvasTrack \|\| peers\.size === 0/);
  assert.match(
    renderer,
    /const sender = pc\.addTrack[\s\S]*updatePausedFrameHeartbeat\(\)/,
  );
  assert.match(renderer, /function renderFrame\(force/);
  assert.match(
    renderer,
    /waitForFirstEncodedFrame[\s\S]*renderFrame\(true\)/,
  );
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
  assert.match(renderer, /u_source_pass == 1[\s\S]*rotateUv\(vec2\(bounded\.x, 1\.0 - bounded\.y\)\)/);
  assert.match(renderer, /gl\.uniform1i\(blurUniforms\.sourcePass, 2\)/);
  assert.doesNotMatch(renderer, /backgroundSourceTexture/);
});

test("keeps the rendering color space explicit and avoids sharpening bias", () => {
  assert.match(renderer, /drawingBufferColorSpace" in gl/);
  assert.match(renderer, /unpackColorSpace" in gl/);
  assert.match(renderer, /gl\.uniform1f\(uniforms\.lodBias, 0\)/);
});

test("uses content-aware sender profiles and requests keyframes", () => {
  assert.match(renderer, /sourceKind === "video" && playing \? "motion" : "detail"/);
  assert.match(renderer, /Math\.min\(4, configuredFps\)/);
  assert.match(renderer, /sender\.generateKeyFrame/);
  assert.match(renderer, /emitBootstrapFrames\(`keyframe fallback \$\{reason\}`/);
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
  assert.match(renderer, /sourceKind === "photo" && photoCpuReleased/);
});

test("coalesces source interaction rendering and preference writes", () => {
  assert.match(renderer, /function scheduleInteractiveRender\(\)/);
  assert.match(renderer, /interactiveRenderFrameId = requestAnimationFrame/);
  assert.match(renderer, /function schedulePreferencesSave\(delayMs = 180\)/);
  assert.match(renderer, /scheduleInteractiveRender\(\);[\s\S]*schedulePreferencesSave\(\)/);
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

test("keeps manual, active, and last working output states separate", () => {
  assert.match(renderer, /let manualOutput =/);
  assert.match(renderer, /let activeOutputOrigin = "manual"/);
  assert.match(renderer, /manualOutput = \{ width: w, height: h \}/);
  assert.match(renderer, /\{ origin: "site" \}/);
  assert.match(renderer, /width: manualOutput\.width/);
  assert.match(renderer, /height: manualOutput\.height/);
});

test("recovers a stalled encoder at the same resolution before fallback", () => {
  assert.match(renderer, /restartCaptureTrackAtCurrentResolution/);
  assert.match(renderer, /Encoder restart superseded after replacement/);
  assert.match(renderer, /restartCaptureTrackAtCurrentResolution\(`offer \$\{id\}`, id\)/);
  assert.match(renderer, /Encoder same-resolution restart/);
  assert.match(renderer, /encoderFailures\.set/);
  assert.match(renderer, /for \(const \[failedOutput, failure\] of encoderFailures\.entries\(\)\)/);
  assert.match(renderer, /Encoder codec retry/);
  assert.match(renderer, /fallbackResolutionToggle\.checked/);
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
