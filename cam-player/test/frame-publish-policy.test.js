"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../lib/frame-publish-policy");

test("playing video accepts decoded frames and rejects timer repeats", () => {
  const state = { sourceKind: "video", playing: true };
  assert.equal(policy.ownerFor(state), "decoded");
  assert.equal(policy.accepts("decoded", state), true);
  assert.equal(policy.accepts("pacer", state), false);
});

test("paused video and photos use only the static pacer", () => {
  for (const state of [
    { sourceKind: "video", playing: false },
    { sourceKind: "photo", playing: false },
  ]) {
    assert.equal(policy.ownerFor(state), "pacer");
    assert.equal(policy.accepts("pacer", state), true);
    assert.equal(policy.accepts("decoded", state), false);
  }
});
