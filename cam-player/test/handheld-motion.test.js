"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Controller,
  relativeEuler,
  remapForDisplay,
  sensorToDisplayRotation,
  modePolicy,
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

test("keeps preview-only motion out of the outgoing composition", () => {
  assert.deepEqual(modePolicy("preview"), {
    controllerEnabled: true,
    outputEnabled: false,
    previewOnly: true,
  });
  assert.equal(modePolicy("live").outputEnabled, true);
  assert.equal(modePolicy("recorded").outputEnabled, true);
  assert.equal(modePolicy("off").controllerEnabled, false);
});

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

function arPose(position, quaternion = [1, 0, 0, 0], sensorToDisplayRotation = 0) {
  return {
    trackingSource: "arcore",
    position,
    quaternion,
    displayRotation: 0,
    sensorToDisplayRotation,
  };
}

test("live motion follows direct ARCore translation instead of phone tilt", () => {
  const controller = new Controller();
  controller.configure({ enabled: true, liveTranslation: true, motion: 100, stabilization: 0 });
  controller.ingest(arPose([0, 0, 0]), 0);
  controller.ingest(arPose([0.08, 0, 0]), 100);
  const moved = controller.output(1080, 1920);
  assert.ok(moved.translationX > 0.01);
  assert.ok(moved.panX > 10);

  const upward = new Controller();
  upward.configure({ enabled: true, liveTranslation: true, motion: 100, stabilization: 0 });
  upward.ingest(arPose([0, 0, 0]), 0);
  upward.ingest(arPose([0, 0.08, 0]), 100);
  assert.ok(upward.output(1080, 1920).translationY > 0.01);
  assert.ok(upward.output(1080, 1920).panY < -10);

  const tiltOnly = new Controller();
  tiltOnly.configure({ enabled: true, liveTranslation: true, motion: 100, stabilization: 0 });
  tiltOnly.ingest(arPose([0, 0, 0]), 0);
  tiltOnly.ingest(arPose([0, 0, 0], axisAngle([0, 1, 0], 0.16)), 100);
  assert.ok(Math.abs(tiltOnly.output(1080, 1920).panX) < 1e-9);
});

test("maps a portrait rear-camera sensor axis onto screen axes", () => {
  const horizontal = new Controller();
  horizontal.configure({ enabled: true, liveTranslation: true, motion: 100, stabilization: 0 });
  horizontal.ingest(arPose([0, 0, 0], [1, 0, 0, 0], 1), 0);
  horizontal.ingest(arPose([0, 0.08, 0], [1, 0, 0, 0], 1), 100);
  assert.ok(horizontal.output(1080, 1920).panX > 10);
  assert.ok(Math.abs(horizontal.output(1080, 1920).panY) < 1e-9);

  const vertical = new Controller();
  vertical.configure({ enabled: true, liveTranslation: true, motion: 100, stabilization: 0 });
  vertical.ingest(arPose([0, 0, 0], [1, 0, 0, 0], 1), 0);
  vertical.ingest(arPose([0.08, 0, 0], [1, 0, 0, 0], 1), 100);
  assert.ok(Math.abs(vertical.output(1080, 1920).panX) < 1e-9);
  assert.ok(vertical.output(1080, 1920).panY > 10);
});

test("uses the standard 90 degree rear-camera orientation with older Source builds", () => {
  assert.equal(sensorToDisplayRotation({ displayRotation: 0 }), 1);
  assert.equal(sensorToDisplayRotation({ displayRotation: 1 }), 0);
  assert.equal(sensorToDisplayRotation({ displayRotation: 0, sensorToDisplayRotation: 3 }), 3);
});

test("live forward translation changes scale and remains bounded", () => {
  const controller = new Controller();
  controller.configure({ enabled: true, liveTranslation: true, motion: 100, stabilization: 0 });
  controller.ingest(arPose([0, 0, 0]), 0);
  controller.ingest(arPose([0, 0, -0.2]), 100);
  const output = controller.output(1080, 1920);
  assert.ok(output.translationZ < -0.01);
  assert.ok(output.depthScale > 1.01);
  assert.ok(output.depthScale <= 1.35);
  assert.ok(output.scale <= 1.35 * 1.04);
});

test("recorded motion ignores acceleration translation for backwards compatibility", () => {
  const controller = new Controller();
  controller.configure({ enabled: true, liveTranslation: false, motion: 100, stabilization: 0 });
  for (let index = 0; index <= 30; index += 1) {
    controller.ingest({
      quaternion: [1, 0, 0, 0],
      acceleration: [4, 0, -4],
      gyro: [0, 0, 0],
      displayRotation: 0,
    }, index * 33);
  }
  const output = controller.output(1080, 1920);
  assert.equal(output.depthScale, 1);
  assert.equal(output.translationX, 0);
  assert.equal(output.translationZ, 0);
});

test("recenter clears accumulated live translation and depth", () => {
  const controller = new Controller();
  controller.configure({ enabled: true, liveTranslation: true, motion: 100, stabilization: 0 });
  controller.ingest(arPose([0, 0, 0]), 0);
  controller.ingest(arPose([0.1, 0, -0.1]), 100);
  assert.notEqual(controller.output(720, 1280).translationX, 0);
  assert.notEqual(controller.output(720, 1280).depthScale, 1);
  controller.recenter();
  const centered = controller.output(720, 1280);
  assert.equal(centered.translationX, 0);
  assert.equal(centered.translationY, 0);
  assert.equal(centered.translationZ, 0);
  assert.equal(centered.depthScale, 1);
});

test("live mode ignores accelerometer-only samples", () => {
  const controller = new Controller();
  controller.configure({ enabled: true, liveTranslation: true, motion: 100, stabilization: 0 });
  for (let index = 0; index < 300; index += 1) {
    controller.ingest({
      quaternion: [1, 0, 0, 0],
      acceleration: [-0.03, 0.02, 0.08],
      gyro: [0, 0, 0],
      displayRotation: 0,
    }, index * 33);
  }
  const output = controller.output(1080, 1920);
  assert.ok(Math.abs(output.depthScale - 1) < 1e-6);
  assert.ok(Math.abs(output.panX) < 1e-6);
  assert.ok(Math.abs(output.panY) < 1e-6);
  assert.equal(output.translationTracked, false);
});

test("live mode falls back to rotation while ARCore position is unavailable", () => {
  const controller = new Controller();
  controller.configure({ enabled: true, liveTranslation: true, motion: 100, stabilization: 0 });
  controller.ingest({ quaternion: [1, 0, 0, 0], trackingSource: "sensors" }, 0);
  for (let index = 1; index <= 8; index += 1) {
    controller.ingest({
      quaternion: axisAngle([0, 1, 0], 0.12),
      trackingSource: "sensors",
    }, index * 33);
  }
  const output = controller.output(1080, 1920);
  assert.equal(output.translationTracked, false);
  assert.ok(Math.abs(output.panX) > 5);
});

test("a stationary ARCore pose never accumulates drift", () => {
  const controller = new Controller();
  controller.configure({ enabled: true, liveTranslation: true, motion: 100, stabilization: 0 });
  for (let index = 0; index < 900; index += 1) {
    controller.ingest(arPose([0.02, -0.01, 0.03]), index * 47);
  }
  const output = controller.output(1080, 1920);
  assert.ok(Math.hypot(output.panX, output.panY) < 1e-9);
  assert.ok(Math.abs(output.depthScale - 1) < 1e-9);
});
