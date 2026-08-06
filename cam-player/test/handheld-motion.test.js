"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Controller,
  relativeEuler,
  remapForDisplay,
} = require("../lib/handheld-motion");

function axisAngle(axis, radians) {
  const half = radians / 2;
  const sine = Math.sin(half);
  return [
    Math.cos(half),
    axis[0] * sine,
    axis[1] * sine,
    axis[2] * sine,
  ];
}

test("finds phone rotation relative to the recentered quaternion", () => {
  const euler = relativeEuler([1, 0, 0, 0], axisAngle([1, 0, 0], 0.05));
  assert.ok(Math.abs(euler.x - 0.05) < 1e-6);
  assert.ok(Math.abs(euler.y) < 1e-6);
  assert.ok(Math.abs(euler.z) < 1e-6);
});

test("remaps phone tilt when Android rotates to landscape", () => {
  assert.deepEqual(
    remapForDisplay({ x: 0.1, y: 0.2, z: 0.3 }, 1),
    { x: 0.2, y: -0.1, z: 0.3 },
  );
});

test("recenter makes the current phone pose motionless", () => {
  const controller = new Controller();
  controller.configure({ enabled: true, motion: 50, stabilization: 0 });
  controller.ingest({ quaternion: [1, 0, 0, 0], displayRotation: 0 }, 0);
  for (let index = 1; index <= 8; index += 1) {
    controller.ingest({
      quaternion: axisAngle([0, 1, 0], 0.06),
      displayRotation: 0,
    }, index * 33);
  }
  assert.ok(Math.abs(controller.output(720, 1280).panX) > 5);
  controller.recenter();
  const centered = controller.output(720, 1280);
  assert.ok(Math.abs(centered.panX) < 1e-12);
  assert.ok(Math.abs(centered.panY) < 1e-12);
  assert.ok(Math.abs(centered.roll) < 1e-12);
  assert.equal("perspectiveX" in centered, false);
  assert.equal("perspectiveY" in centered, false);
  assert.equal(centered.scale, 1.025);
});

test("stabilization reduces and slows the same phone movement", () => {
  const low = new Controller();
  const high = new Controller();
  low.configure({ enabled: true, motion: 50, stabilization: 0 });
  high.configure({ enabled: true, motion: 50, stabilization: 100 });
  for (const controller of [low, high]) {
    controller.ingest({ quaternion: [1, 0, 0, 0], displayRotation: 0 }, 0);
    controller.ingest({
      quaternion: axisAngle([1, 0, 0], 0.08),
      displayRotation: 0,
    }, 33);
  }
  assert.ok(Math.abs(low.output(720, 1280).panY)
    > Math.abs(high.output(720, 1280).panY) * 10);
});

test("phone tilt translates without exposing perspective controls", () => {
  const controller = new Controller();
  controller.configure({ enabled: true, motion: 100, stabilization: 0 });
  controller.ingest({ quaternion: [1, 0, 0, 0], displayRotation: 0 }, 0);
  for (let index = 1; index <= 8; index += 1) {
    controller.ingest({
      quaternion: axisAngle([0, 1, 0], 0.16),
      displayRotation: 0,
    }, index * 33);
  }
  const output = controller.output(720, 1280);
  assert.ok(Math.abs(output.panX) > 5);
  assert.equal("perspectiveX" in output, false);
  assert.equal("perspectiveY" in output, false);
});

test("live depth acceleration changes scale and remains bounded", () => {
  const controller = new Controller();
  controller.configure({ enabled: true, liveDepth: true, motion: 100, stabilization: 0 });
  for (let index = 0; index < 10; index += 1) {
    controller.ingest({
      quaternion: [1, 0, 0, 0],
      acceleration: [0, 0, 0],
      displayRotation: 0,
    }, index * 33);
  }
  for (let index = 10; index <= 40; index += 1) {
    controller.ingest({
      quaternion: [1, 0, 0, 0],
      acceleration: [0, 0, -2],
      displayRotation: 0,
    }, index * 33);
  }
  const output = controller.output(1080, 1920);
  assert.ok(output.depthScale > 1.01);
  assert.ok(output.depthScale <= 1.14);
  assert.ok(output.scale <= 1.14 * 1.04);
});

test("recorded motion ignores acceleration depth for backwards compatibility", () => {
  const controller = new Controller();
  controller.configure({ enabled: true, liveDepth: false, motion: 100, stabilization: 0 });
  for (let index = 0; index <= 30; index += 1) {
    controller.ingest({
      quaternion: [1, 0, 0, 0],
      acceleration: [0, 0, -4],
      displayRotation: 0,
    }, index * 33);
  }
  assert.equal(controller.output(1080, 1920).depthScale, 1);
});

test("recenter clears accumulated live depth", () => {
  const controller = new Controller();
  controller.configure({ enabled: true, liveDepth: true, motion: 100, stabilization: 0 });
  for (let index = 0; index < 10; index += 1) {
    controller.ingest({
      quaternion: [1, 0, 0, 0],
      acceleration: [0, 0, 0],
      displayRotation: 0,
    }, index * 33);
  }
  for (let index = 10; index <= 30; index += 1) {
    controller.ingest({
      quaternion: [1, 0, 0, 0],
      acceleration: [0, 0, -2],
      displayRotation: 0,
    }, index * 33);
  }
  assert.notEqual(controller.output(720, 1280).depthScale, 1);
  controller.recenter();
  assert.equal(controller.output(720, 1280).depthScale, 1);
});

test("live depth calibrates and rejects a constant accelerometer bias", () => {
  const controller = new Controller();
  controller.configure({ enabled: true, liveDepth: true, motion: 100, stabilization: 0 });
  for (let index = 0; index < 300; index += 1) {
    controller.ingest({
      quaternion: [1, 0, 0, 0],
      acceleration: [0, 0, 0.08],
      displayRotation: 0,
    }, index * 33);
  }
  assert.ok(Math.abs(controller.output(1080, 1920).depthScale - 1) < 1e-6);
});
