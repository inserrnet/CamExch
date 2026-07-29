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

test("keeps a paused camera track alive without re-rendering the static source", () => {
  assert.match(
    renderer,
    /pausedFrameTimer = setInterval\(emitCurrentFrame, 250\)/,
  );
  assert.match(renderer, /!canvasTrack \|\| peers\.size === 0/);
  assert.match(
    renderer,
    /const sender = pc\.addTrack[\s\S]*updatePausedFrameHeartbeat\(\)/,
  );
  assert.match(renderer, /function emitCurrentFrame\(\)/);
  assert.doesNotMatch(renderer, /setInterval\(\(\) => renderFrame\(true\)/);
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
  assert.doesNotMatch(renderer, /replacementStream = canvas\.captureStream/);
});

test("keeps one old peer until the replacement encoder produces a frame", () => {
  assert.match(renderer, /const MAX_HANDOFF_PEERS = 2/);
  assert.match(renderer, /const handoffPeerIds = existingPeerIds\.slice\(\)/);
  assert.match(
    renderer,
    /First encoded frame[\s\S]*for \(const previousId of handoffPeerIds\)/,
  );
  assert.match(renderer, /`handoff completed by offer \$\{id\}`/);
  assert.match(renderer, /sender\.replaceTrack\(null\)/);
});

test("recreates an idle canvas capture track for each new browser session", () => {
  assert.match(renderer, /freshWhenIdle && stream/);
  assert.match(renderer, /discardCaptureStream\("new idle WebRTC session"\)/);
  assert.match(renderer, /ensureStream\(\{ freshWhenIdle: handoffPeerIds\.length === 0 \}\)/);
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

test("migrates the output ceiling to 60 FPS without duplicating media frames", () => {
  assert.match(renderer, /preferencesVersion: 2/);
  assert.match(renderer, /preferences\.preferencesVersion\) >= 2 \? preferences\.fps \|\| 60 : 60/);
});
