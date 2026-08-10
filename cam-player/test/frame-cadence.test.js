"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cadence = require("../lib/frame-cadence");

test("uses the source cadence up to the configured maximum", () => {
  assert.equal(cadence.effectiveFrameRate(24, 60), 24);
  assert.equal(cadence.effectiveFrameRate(30, 60), 30);
  assert.equal(cadence.effectiveFrameRate(60, 60), 60);
  assert.equal(cadence.effectiveFrameRate(60, 24), 24);
  assert.equal(cadence.effectiveFrameRate(0, 30), 30);
});

test("does not manufacture frames when the source is slower than the ceiling", () => {
  for (const sourceFps of [24, 30, 60]) {
    const maximumFps = 60;
    assert.equal(cadence.effectiveFrameRate(sourceFps, maximumFps), sourceFps);
  }
});
