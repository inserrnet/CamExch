"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizedSelection,
  cropForNormalized,
  bgraToRgba,
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
