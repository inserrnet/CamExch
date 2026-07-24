"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const geometry = require("../lib/geometry");

test("validates arbitrary even H264 dimensions without presets", () => {
  assert.equal(geometry.positiveInteger("2400", "Width"), 2400);
  assert.equal(geometry.positiveInteger("704", "Width"), 704);
  assert.throws(() => geometry.positiveInteger("701", "Width"), /even/);
  assert.throws(() => geometry.positiveInteger("0", "Width"), /positive/);
});

test("rotates landscape site constraints into portrait output", () => {
  const resolved = geometry.resolveRequestedSize({
    video: {
      width: { ideal: 2000 },
      height: { ideal: 1500 },
    },
  }, "portrait", { width: 720, height: 1280 });
  assert.deepEqual(resolved, {
    width: 1500,
    height: 2000,
    applied: true,
    reason: "ideal/ideal portrait",
  });
});

test("returns landscape dimensions after phone rotation", () => {
  const resolved = geometry.resolveRequestedSize({
    video: {
      width: { exact: 2000 },
      height: { exact: 1500 },
    },
  }, "landscape", { width: 720, height: 1280 });
  assert.equal(resolved.width, 2000);
  assert.equal(resolved.height, 1500);
});

test("keeps manual size when site omits dimensions", () => {
  const resolved = geometry.resolveRequestedSize(
    { video: { facingMode: "user" } },
    "portrait",
    { width: 2400, height: 3200 },
  );
  assert.equal(resolved.applied, false);
  assert.equal(resolved.width, 2400);
  assert.equal(resolved.height, 3200);
});
