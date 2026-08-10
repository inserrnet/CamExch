"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Timeline } = require("../lib/output-timeline");

test("preserves media spacing while keeping transport timestamps monotonic", () => {
  const timeline = new Timeline();
  timeline.beginGeneration(0);
  const first = timeline.nextVideo(0, 41667);
  const second = timeline.nextVideo(1 / 24, 41667);
  const third = timeline.nextVideo(2 / 24, 41667);
  assert.deepEqual(
    [first.timestampUs, second.timestampUs, third.timestampUs],
    [0, 41667, 83333],
  );
});

test("seek starts a new source epoch without moving transport time backwards", () => {
  const timeline = new Timeline();
  timeline.beginGeneration(10);
  const beforeSeek = timeline.nextVideo(10.5, 41667);
  timeline.beginGeneration(0);
  const afterSeek = timeline.nextVideo(0, 41667);
  assert.ok(afterSeek.timestampUs > beforeSeek.timestampUs);
});

test("static frames continue from the current transport timestamp", () => {
  const timeline = new Timeline();
  timeline.beginGeneration(0);
  const video = timeline.nextVideo(0, 33333);
  const paused = timeline.nextStatic(500000);
  assert.equal(paused.timestampUs, video.timestampUs + 500000);
});
