"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = fs.readFileSync(
  path.join(__dirname, "..", "renderer", "renderer.js"),
  "utf8",
);

test("uses detail-biased trilinear minification for downscaling", () => {
  assert.match(renderer, /gl\.LINEAR_MIPMAP_LINEAR/);
  assert.match(renderer, /gl\.generateMipmap\(gl\.TEXTURE_2D\)/);
  assert.match(renderer, /sourceToOutputScale < 0\.95/);
  assert.match(renderer, /uniform float u_lod_bias/);
  assert.match(renderer, /detailMinificationEnabled \? -0\.55 : 0/);
});

test("keeps a paused camera track alive at ten frames per second", () => {
  assert.match(
    renderer,
    /pausedFrameTimer = setInterval\(\(\) => renderFrame\(true\), 100\)/,
  );
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
