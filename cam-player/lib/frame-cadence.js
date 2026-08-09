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

  function advanceDeadline(deadlineMs, nowMs, fps) {
    const intervalMs = 1000 / Math.max(1, Number(fps) || 30);
    const currentDeadline = Number.isFinite(deadlineMs) && deadlineMs > 0
      ? deadlineMs
      : nowMs;
    const lateSlots = Math.max(0, Math.floor((nowMs - currentDeadline) / intervalMs));
    return {
      intervalMs,
      lateSlots,
      nextDeadlineMs: currentDeadline + ((lateSlots + 1) * intervalMs),
    };
  }

  return { effectiveFrameRate, advanceDeadline };
}));
