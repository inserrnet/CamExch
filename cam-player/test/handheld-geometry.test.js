"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function rotatePixelPoint(point, width, height, radians) {
  const x = (point.x - 0.5) * width;
  const y = (point.y - 0.5) * height;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: (cosine * x + sine * y) / width + 0.5,
    y: (-sine * x + cosine * y) / height + 0.5,
  };
}

function toPixels(point, width, height) {
  return { x: point.x * width, y: point.y * height };
}

function vector(left, right) {
  return { x: right.x - left.x, y: right.y - left.y };
}

function length(value) {
  return Math.hypot(value.x, value.y);
}

function dot(left, right) {
  return left.x * right.x + left.y * right.y;
}

for (const [width, height] of [
  [720, 1280],
  [1080, 1920],
  [1440, 1440],
  [2400, 3200],
  [1920, 1080],
]) {
  test(`aspect-correct rotation preserves ${width}x${height} rectangle geometry`, () => {
    const radians = 7 * Math.PI / 180;
    const corners = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ].map((point) => toPixels(rotatePixelPoint(point, width, height, radians), width, height));
    const top = vector(corners[0], corners[1]);
    const right = vector(corners[1], corners[2]);
    const bottom = vector(corners[3], corners[2]);
    const left = vector(corners[0], corners[3]);
    assert.ok(Math.abs(length(top) - width) < 1e-8);
    assert.ok(Math.abs(length(bottom) - width) < 1e-8);
    assert.ok(Math.abs(length(left) - height) < 1e-8);
    assert.ok(Math.abs(length(right) - height) < 1e-8);
    assert.ok(Math.abs(dot(top, right)) < 1e-8);
  });
}

test("the recorded user profile roll fits inside the existing four percent overscan", () => {
  const width = 1080;
  const height = 1920;
  const maximumRecordedRoll = 0.7622 * Math.PI / 180;
  const cosine = Math.abs(Math.cos(maximumRecordedRoll));
  const sine = Math.abs(Math.sin(maximumRecordedRoll));
  const requiredScale = Math.max(
    cosine + (height / width) * sine,
    cosine + (width / height) * sine,
  );
  assert.ok(requiredScale < 1.04, `required overscan was ${requiredScale}`);
});
