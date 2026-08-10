"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Pacer } = require("../lib/frame-pacer");

function harness() {
  let now = 0;
  let callback = null;
  const ticks = [];
  const pacer = new Pacer({
    now: () => now,
    setTimer: (next) => {
      callback = next;
      return 1;
    },
    clearTimer: () => {
      callback = null;
    },
    onTick: (tick) => ticks.push(tick),
  });
  return {
    pacer,
    ticks,
    advance(milliseconds) {
      now += milliseconds;
      const next = callback;
      callback = null;
      next?.();
    },
  };
}

test("uses one stable 24 FPS deadline sequence", () => {
  const clock = harness();
  clock.pacer.configure({ active: true, fps: 24, immediate: true, reason: "play" });
  clock.advance(0);
  clock.advance(1000 / 24);
  clock.advance(1000 / 24);
  assert.equal(clock.ticks.length, 3);
  assert.deepEqual(clock.ticks.map((tick) => tick.sequence), [1, 2, 3]);
  assert.ok(clock.ticks.every((tick) => Math.abs(tick.intervalMs - 1000 / 24) < 0.001));
});

test("skips missed deadlines instead of emitting catch-up ticks", () => {
  const clock = harness();
  clock.pacer.configure({ active: true, fps: 24, immediate: true, reason: "play" });
  clock.advance(0);
  clock.advance(200);
  assert.equal(clock.ticks.length, 2);
  assert.equal(clock.ticks[1].skipped, 3);
  clock.advance(1000 / 24);
  assert.equal(clock.ticks.length, 3);
});

test("changing from motion to video replaces the clock without a second owner", () => {
  const clock = harness();
  clock.pacer.configure({ active: true, fps: 30, immediate: true, reason: "motion" });
  clock.advance(0);
  clock.pacer.configure({ active: true, fps: 24, immediate: true, reason: "play" });
  clock.advance(0);
  clock.advance(1000 / 24);
  assert.deepEqual(clock.ticks.map((tick) => tick.reason), ["motion", "play", "play"]);
  assert.equal(clock.ticks.length, 3);
});
