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
  assert.match(renderer, /Keyframe fallback replaced canvas track/);
});

test("supersedes old peers before creating a replacement encoder", () => {
  assert.match(renderer, /const existingPeerIds = Array\.from\(peers\.keys\(\)\)/);
  assert.match(renderer, /`superseded by offer \$\{id\}`/);
  assert.match(renderer, /sender\.replaceTrack\(null\)/);
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
