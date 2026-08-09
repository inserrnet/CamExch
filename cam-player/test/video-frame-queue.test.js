"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Queue } = require("../lib/video-frame-queue");

function entry(timestampUs) {
  const frame = { closed: false, close() { this.closed = true; } };
  return { frame, timestampUs, mediaTime: timestampUs / 1_000_000 };
}

test("primes with two frames and preserves timestamp order", () => {
  const queue = new Queue();
  const first = entry(0);
  const second = entry(41_667);
  queue.enqueue(first);
  assert.equal(queue.dequeue(), null);
  queue.enqueue(second);
  assert.equal(queue.dequeue(), first);
  assert.equal(queue.dequeue(), second);
});

test("keeps at most three frames and releases the oldest frame", () => {
  const queue = new Queue();
  const frames = [0, 1, 2, 3].map((value) => entry(value * 41_667));
  for (const frame of frames) queue.enqueue(frame);
  assert.equal(queue.size, 3);
  assert.equal(queue.dropped, 1);
  assert.equal(frames[0].frame.closed, true);
  assert.equal(queue.dequeue(), frames[1]);
});

test("rejects duplicate timestamps and resets safely after a seek or loop", () => {
  const queue = new Queue();
  const first = entry(1_000_000);
  const duplicate = entry(1_000_000);
  const beforeSeek = entry(1_041_667);
  const afterSeek = entry(0);
  queue.enqueue(first);
  assert.equal(queue.enqueue(duplicate).accepted, false);
  assert.equal(duplicate.frame.closed, true);
  queue.enqueue(beforeSeek);
  const result = queue.enqueue(afterSeek);
  assert.equal(result.regression, true);
  assert.equal(first.frame.closed, true);
  assert.equal(beforeSeek.frame.closed, true);
  assert.equal(queue.size, 1);
});

test("clear releases every retained VideoFrame", () => {
  const queue = new Queue();
  const frames = [entry(0), entry(41_667), entry(83_334)];
  for (const frame of frames) queue.enqueue(frame);
  queue.clear();
  assert.equal(queue.size, 0);
  assert.ok(frames.every((item) => item.frame.closed));
});

test("can start with one frame after the bounded priming timeout", () => {
  const queue = new Queue();
  const first = entry(0);
  queue.enqueue(first);
  assert.equal(queue.dequeue(), null);
  assert.equal(queue.dequeue(true), first);
});

test("keeps unique monotonic output through bursty 24, 30, and 60 FPS input", () => {
  for (const fps of [24, 30, 60]) {
    const queue = new Queue();
    const output = [];
    let sourceIndex = 0;
    for (let tick = 0; tick < fps; tick += 1) {
      const arrivals = tick % 6 === 0 ? 2 : tick % 6 === 1 ? 0 : 1;
      for (let index = 0; index < arrivals; index += 1) {
        queue.enqueue(entry(Math.round(sourceIndex * 1_000_000 / fps)));
        sourceIndex += 1;
      }
      const next = queue.dequeue(tick > 2);
      if (next) {
        output.push(next.timestampUs);
        next.frame.close();
      }
      assert.ok(queue.size <= 3);
    }
    assert.equal(new Set(output).size, output.length);
    assert.ok(output.every((value, index) => index === 0 || value > output[index - 1]));
    queue.clear();
  }
});
