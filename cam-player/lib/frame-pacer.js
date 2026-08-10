(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.CamFramePacer = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class Pacer {
    constructor(options = {}) {
      this.now = options.now || (() => performance.now());
      this.setTimer = options.setTimer || ((callback, delay) => setTimeout(callback, delay));
      this.clearTimer = options.clearTimer || ((timer) => clearTimeout(timer));
      this.onTick = options.onTick || (() => {});
      this.active = false;
      this.fps = 1;
      this.intervalMs = 1000;
      this.deadlineMs = null;
      this.timer = null;
      this.reason = "idle";
      this.sequence = 0;
    }

    configure(options = {}) {
      const active = Boolean(options.active);
      const fps = Math.max(1, Math.min(60, Number(options.fps) || 1));
      const changed = active !== this.active || Math.abs(fps - this.fps) > 0.01;
      this.active = active;
      this.fps = fps;
      this.intervalMs = 1000 / fps;
      this.reason = options.reason || this.reason;
      if (!active) {
        this.stop();
        return;
      }
      if (changed) {
        this.cancelTimer();
        this.deadlineMs = this.now() + (options.immediate ? 0 : this.intervalMs);
      } else if (this.deadlineMs == null) {
        this.deadlineMs = this.now() + (options.immediate ? 0 : this.intervalMs);
      }
      this.schedule();
    }

    wake(reason = "update") {
      this.reason = reason;
      if (!this.active) return;
      if (this.deadlineMs == null) this.deadlineMs = this.now();
      this.schedule();
    }

    cancelTimer() {
      if (this.timer == null) return;
      this.clearTimer(this.timer);
      this.timer = null;
    }

    stop() {
      this.cancelTimer();
      this.deadlineMs = null;
    }

    schedule() {
      if (!this.active || this.timer != null || this.deadlineMs == null) return;
      const delay = Math.max(0, this.deadlineMs - this.now());
      this.timer = this.setTimer(() => this.tick(), delay);
    }

    tick() {
      this.timer = null;
      if (!this.active || this.deadlineMs == null) return;
      const now = this.now();
      let skipped = 0;
      if (now > this.deadlineMs + this.intervalMs) {
        skipped = Math.floor((now - this.deadlineMs) / this.intervalMs);
      }
      const scheduledAt = this.deadlineMs + skipped * this.intervalMs;
      this.sequence += 1;
      this.onTick({
        sequence: this.sequence,
        now,
        scheduledAt,
        driftMs: now - scheduledAt,
        skipped,
        fps: this.fps,
        intervalMs: this.intervalMs,
        reason: this.reason,
      });
      // Never emit catch-up ticks. A late callback advances to the next future
      // deadline and the renderer supplies only its latest composition.
      this.deadlineMs = scheduledAt + this.intervalMs;
      if (this.deadlineMs <= now) this.deadlineMs = now + this.intervalMs;
      this.schedule();
    }
  }

  return { Pacer };
}));
