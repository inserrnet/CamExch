"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Player,
  RECORDING_DURATION_MS,
  prepareProfile,
  validateProfile,
} = require("../lib/motion-profile");

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

function recordedSamples(durationMs = RECORDING_DURATION_MS, fps = 30) {
  const samples = [];
  const interval = 1000 / fps;
  for (let time = 0; time <= durationMs; time += interval) {
    const wave = Math.sin(time / 830) * 0.025;
    samples.push({
      t: time,
      quaternion: axisAngle([0, 1, 0], wave),
      gyro: [0, wave, 0],
      acceleration: [0.01, 0, 0],
      displayRotation: 0,
    });
  }
  return samples;
}

test("prepares a compact valid 30 second motion profile", () => {
  const profile = prepareProfile(recordedSamples(), { name: "Document steady" });
  assert.equal(profile.version, 1);
  assert.equal(profile.name, "Document steady");
  assert.ok(profile.durationMs >= 29_900);
  assert.ok(profile.samples.length >= 890 && profile.samples.length <= 910);
  assert.ok(validateProfile(profile));
});

test("rejects an incomplete sensor recording", () => {
  assert.throws(
    () => prepareProfile(recordedSamples(5000)),
    /Not enough sensor samples|too short/,
  );
});

test("closes the profile loop without a pose jump", () => {
  const profile = prepareProfile(recordedSamples());
  const first = profile.samples[0].quaternion;
  const last = profile.samples.at(-1).quaternion;
  const difference = first.reduce((sum, value, index) => sum + Math.abs(value - last[index]), 0);
  assert.ok(difference < 1e-5);
});

test("recorded player loops using the current clock without accumulating delay", () => {
  const profile = prepareProfile(recordedSamples());
  const player = new Player(profile);
  player.restart(1000);
  const firstLoop = player.sampleAt(1500);
  const nextLoop = player.sampleAt(1500 + profile.durationMs);
  const difference = firstLoop.quaternion.reduce(
    (sum, value, index) => sum + Math.abs(value - nextLoop.quaternion[index]),
    0,
  );
  assert.ok(difference < 1e-6);
});
