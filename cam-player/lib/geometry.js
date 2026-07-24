(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.CamGeometry = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function positiveInteger(value, label) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${label} must be a positive integer`);
    }
    if (parsed % 2 !== 0) {
      throw new Error(`${label} must be even for H.264 encoding`);
    }
    return parsed;
  }

  function constraintValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return { value, strength: "plain" };
    }
    if (!value || typeof value !== "object") {
      return null;
    }
    for (const strength of ["exact", "ideal", "min", "max"]) {
      const candidate = Number(value[strength]);
      if (Number.isFinite(candidate) && candidate > 0) {
        return { value: candidate, strength };
      }
    }
    return null;
  }

  function orientSize(width, height, orientation) {
    if (!width || !height) {
      return { width, height };
    }
    const portrait = orientation === "portrait";
    const landscape = orientation === "landscape";
    if ((portrait && width > height) || (landscape && height > width)) {
      return { width: height, height: width };
    }
    return { width, height };
  }

  function resolveRequestedSize(constraints, orientation, fallback) {
    const video = constraints && constraints.video && constraints.video !== true
      ? constraints.video
      : {};
    const widthConstraint = constraintValue(video.width);
    const heightConstraint = constraintValue(video.height);
    if (!widthConstraint || !heightConstraint) {
      return {
        width: fallback.width,
        height: fallback.height,
        applied: false,
        reason: "site did not request both dimensions",
      };
    }
    const oriented = orientSize(
      Math.round(widthConstraint.value),
      Math.round(heightConstraint.value),
      orientation,
    );
    return {
      width: oriented.width,
      height: oriented.height,
      applied: true,
      reason: `${widthConstraint.strength}/${heightConstraint.strength} ${orientation}`,
    };
  }

  function fitTransform(outputWidth, outputHeight, sourceWidth, sourceHeight) {
    if (![outputWidth, outputHeight, sourceWidth, sourceHeight].every((v) => v > 0)) {
      return { scale: 1, panX: 0, panY: 0 };
    }
    return { scale: 1, panX: 0, panY: 0 };
  }

  return {
    positiveInteger,
    constraintValue,
    orientSize,
    resolveRequestedSize,
    fitTransform,
  };
}));
