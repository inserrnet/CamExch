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

test("keeps transport deadlines stable for native 24, 30, and 60 FPS", () => {
  for (const fps of [24, 30, 60]) {
    let deadline = 1000;
    const intervals = [];
    for (let index = 0; index < fps; index += 1) {
      const timing = cadence.nextDeadline(deadline, deadline, fps);
      intervals.push(timing.deadline - deadline);
      deadline = timing.deadline;
    }
    const expected = 1000 / fps;
    assert.ok(intervals.every((interval) => Math.abs(interval - expected) < 0.001));
  }
});

test("drops missed deadlines instead of replaying accumulated transport ticks", () => {
  const timing = cadence.nextDeadline(1000, 1200, 24);
  assert.ok(Math.abs(timing.deadline - (1200 + 1000 / 24)) < 0.001);
  assert.ok(Math.abs(timing.delay - 1000 / 24) < 0.001);
});
