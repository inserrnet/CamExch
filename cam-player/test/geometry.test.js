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

test("keeps the output point under the cursor while zooming", () => {
  const before = { scale: 1.25, panX: 110, panY: -75 };
  const point = { x: 620, y: 900 };
  const output = { width: 720, height: 1280 };
  const after = geometry.zoomAroundPoint(before, point, output, 2.5);

  const sourcePointBefore = {
    x: (point.x - (output.width / 2 + before.panX)) / before.scale,
    y: (point.y - (output.height / 2 + before.panY)) / before.scale,
  };
  const sourcePointAfter = {
    x: (point.x - (output.width / 2 + after.panX)) / after.scale,
    y: (point.y - (output.height / 2 + after.panY)) / after.scale,
  };
  assert.deepEqual(sourcePointAfter, sourcePointBefore);
});

test("moves the source down when the pointer moves down", () => {
  const next = geometry.dragInOutputCoordinates(
    { scale: 1, panX: 0, panY: 0 },
    { x: 25, y: 30 },
    { width: 360, height: 640 },
    { width: 720, height: 1280 },
  );
  assert.deepEqual(next, { scale: 1, panX: 50, panY: -60 });
});

test("uses half the former source wheel sensitivity", () => {
  const oldFactor = geometry.wheelFactor(-120, 0.0015);
  const nextFactor = geometry.wheelFactor(-120, 0.00075);
  assert.ok(nextFactor > 1);
  assert.ok(nextFactor < oldFactor);
  assert.ok(Math.abs(Math.log(nextFactor) * 2 - Math.log(oldFactor)) < 1e-12);
});

test("prefers H264 normally and HEVC for high resolution", () => {
  const codecs = [
    { mimeType: "video/H264" },
    { mimeType: "video/H265" },
  ];
  assert.equal(geometry.preferredVideoCodecs(codecs, 1080, 1920).name, "H264");
  assert.equal(geometry.preferredVideoCodecs(codecs, 2400, 3200).name, "HEVC");
});

test("high resolution falls back to H264 when HEVC is unavailable", () => {
  const result = geometry.preferredVideoCodecs(
    [{ mimeType: "video/H264" }],
    3072,
    4080,
  );
  assert.equal(result.name, "H264");
  assert.equal(result.hevcAvailable, false);
});
