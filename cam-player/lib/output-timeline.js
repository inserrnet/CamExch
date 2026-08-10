(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.CamOutputTimeline = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class Timeline {
    constructor() {
      this.lastTimestampUs = -1;
      this.lastDurationUs = 33333;
      this.sourceAnchorSeconds = null;
      this.transportAnchorUs = 0;
      this.lastSourceSeconds = null;
      this.generation = 0;
    }

    beginGeneration(sourceSeconds = null) {
      this.generation += 1;
      this.sourceAnchorSeconds = Number.isFinite(Number(sourceSeconds))
        ? Number(sourceSeconds)
        : null;
      this.transportAnchorUs = this.lastTimestampUs < 0
        ? 0
        : this.lastTimestampUs + this.lastDurationUs;
      this.lastSourceSeconds = null;
      return this.generation;
    }

    nextVideo(sourceSeconds, durationUs) {
      const source = Number(sourceSeconds);
      const duration = Math.max(1, Math.round(Number(durationUs) || this.lastDurationUs));
      if (!Number.isFinite(source)) return this.nextStatic(duration);
      if (this.sourceAnchorSeconds == null
          || (this.lastSourceSeconds != null && source < this.lastSourceSeconds)) {
        this.beginGeneration(source);
      }
      let timestampUs = this.transportAnchorUs
        + Math.max(0, Math.round((source - this.sourceAnchorSeconds) * 1_000_000));
      if (timestampUs <= this.lastTimestampUs) {
        timestampUs = this.lastTimestampUs + duration;
      }
      this.lastTimestampUs = timestampUs;
      this.lastDurationUs = duration;
      this.lastSourceSeconds = source;
      return { timestampUs, durationUs: duration, generation: this.generation };
    }

    nextStatic(durationUs) {
      const duration = Math.max(1, Math.round(Number(durationUs) || this.lastDurationUs));
      const timestampUs = this.lastTimestampUs < 0 ? 0 : this.lastTimestampUs + duration;
      this.lastTimestampUs = timestampUs;
      this.lastDurationUs = duration;
      return { timestampUs, durationUs: duration, generation: this.generation };
    }
  }

  return { Timeline };
}));
