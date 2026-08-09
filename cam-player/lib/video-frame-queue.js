(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.CamVideoFrameQueue = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function closeEntry(entry) {
    try {
      entry?.frame?.close?.();
    } catch (_error) {
      // A frame may already have been released during renderer shutdown.
    }
  }

  class Queue {
    constructor({ maximum = 3, prime = 2 } = {}) {
      this.maximum = Math.max(1, Math.trunc(maximum));
      this.prime = Math.max(1, Math.min(this.maximum, Math.trunc(prime)));
      this.entries = [];
      this.primed = false;
      this.lastTimestampUs = null;
      this.dropped = 0;
      this.duplicates = 0;
      this.regressions = 0;
      this.maximumDepth = 0;
    }

    get size() {
      return this.entries.length;
    }

    get ready() {
      if (!this.primed && this.entries.length >= this.prime) this.primed = true;
      return this.primed && this.entries.length > 0;
    }

    enqueue(entry) {
      const timestampUs = Number(entry?.timestampUs);
      if (!entry?.frame || !Number.isFinite(timestampUs)) {
        closeEntry(entry);
        return { accepted: false, reason: "invalid", dropped: 0, regression: false };
      }
      if (this.lastTimestampUs != null && timestampUs === this.lastTimestampUs) {
        this.duplicates += 1;
        closeEntry(entry);
        return { accepted: false, reason: "duplicate", dropped: 0, regression: false };
      }
      let regression = false;
      if (this.lastTimestampUs != null && timestampUs < this.lastTimestampUs) {
        this.clear();
        this.regressions += 1;
        regression = true;
      }
      this.lastTimestampUs = timestampUs;
      this.entries.push(entry);
      let dropped = 0;
      while (this.entries.length > this.maximum) {
        closeEntry(this.entries.shift());
        this.dropped += 1;
        dropped += 1;
      }
      this.maximumDepth = Math.max(this.maximumDepth, this.entries.length);
      return { accepted: true, reason: "queued", dropped, regression };
    }

    dequeue(force = false) {
      if (force && this.entries.length > 0) this.primed = true;
      if (!this.ready) return null;
      const entry = this.entries.shift() || null;
      if (this.entries.length === 0) this.primed = false;
      return entry;
    }

    clear() {
      for (const entry of this.entries.splice(0)) closeEntry(entry);
      this.primed = false;
      this.lastTimestampUs = null;
    }

    resetMetrics() {
      this.dropped = 0;
      this.duplicates = 0;
      this.regressions = 0;
      this.maximumDepth = this.entries.length;
    }
  }

  return { Queue };
}));
