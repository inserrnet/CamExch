(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.CamFrameCadence = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function effectiveFrameRate(sourceFps, maximumFps, fallbackFps = 30) {
    const maximum = Math.max(1, Math.min(60, Number(maximumFps) || fallbackFps));
    const source = Number(sourceFps);
    return Number.isFinite(source) && source > 0 ? Math.min(maximum, source) : maximum;
  }

  function nextDeadline(previousDeadline, now, framesPerSecond) {
    const current = Number(now) || 0;
    const fps = Math.max(1, Math.min(60, Number(framesPerSecond) || 30));
    const interval = 1000 / fps;
    const previous = Number(previousDeadline);
    const base = Number.isFinite(previous)
        && previous > 0
        && current - previous <= interval
      ? previous
      : current;
    const deadline = base + interval;
    return {
      deadline,
      delay: Math.max(0, deadline - current),
      interval,
    };
  }

  return { effectiveFrameRate, nextDeadline };
}));
