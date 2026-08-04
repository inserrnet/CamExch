"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizedSelection,
  cropForNormalized,
  bgraToRgba,
  adaptiveThresholds,
  thresholdRgba,
} = require("../lib/qr-selection");

test("normalizes a selection drawn in either direction", () => {
  assert.deepEqual(
    normalizedSelection(
      { x: 600, y: 500 },
      { x: 200, y: 100 },
      { width: 800, height: 600 },
    ),
    { x: 0.25, y: 1 / 6, width: 0.5, height: 2 / 3 },
  );
});

test("maps display-independent selection coordinates to a high DPI screenshot", () => {
  const selection = normalizedSelection(
    { x: 100, y: 50 },
    { x: 500, y: 350 },
    { width: 1920, height: 1080 },
  );
  assert.deepEqual(
    cropForNormalized(selection, { width: 3840, height: 2160 }),
    { x: 200, y: 100, width: 800, height: 600 },
  );
});

test("clamps selections to the captured monitor", () => {
  assert.deepEqual(
    cropForNormalized(
      { x: -0.2, y: 0.8, width: 1.5, height: 0.5 },
      { width: 1000, height: 800 },
    ),
    { x: 0, y: 640, width: 1000, height: 160 },
  );
});

test("converts Electron BGRA bitmap bytes for jsQR", () => {
  assert.deepEqual(
    Array.from(bgraToRgba(Buffer.from([10, 20, 30, 255, 1, 2, 3, 4]))),
    [30, 20, 10, 255, 3, 2, 1, 4],
  );
});

test("creates lower-biased thresholds for colored JPEG QR modules", () => {
  const rgba = new Uint8ClampedArray(100 * 4);
  for (let pixel = 0; pixel < 100; pixel += 1) {
    const offset = pixel * 4;
    const value = pixel < 50 ? [0, 76, 46] : [250, 249, 245];
    rgba.set([...value, 255], offset);
  }
  const thresholds = adaptiveThresholds(rgba);
  assert.equal(thresholds.length, 3);
  assert.ok(thresholds[0] < thresholds[1]);
  assert.ok(thresholds[1] < thresholds[2]);
  const binary = thresholdRgba(rgba, thresholds[1]);
  assert.deepEqual(Array.from(binary.slice(0, 4)), [0, 0, 0, 255]);
  assert.deepEqual(Array.from(binary.slice(-4)), [255, 255, 255, 255]);
});
