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

test("advances from the monotonic deadline instead of accumulating timer drift", () => {
  const first = cadence.advanceDeadline(1_000, 1_044, 24);
  assert.equal(first.lateSlots, 1);
  assert.ok(Math.abs(first.nextDeadlineMs - 1_083.3333333333333) < 0.001);

  const second = cadence.advanceDeadline(first.nextDeadlineMs, 1_085, 24);
  assert.equal(second.lateSlots, 0);
  assert.ok(Math.abs(second.nextDeadlineMs - 1_125) < 0.001);
});
