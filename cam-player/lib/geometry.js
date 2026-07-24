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

  function zoomAroundPoint(transform, point, output, nextScale) {
    const previousScale = Math.max(0.0001, Number(transform.scale) || 1);
    const ratio = nextScale / previousScale;
    const centerX = output.width / 2 + transform.panX;
    const centerY = output.height / 2 + transform.panY;
    return {
      scale: nextScale,
      panX: point.x - output.width / 2 - (point.x - centerX) * ratio,
      panY: point.y - output.height / 2 - (point.y - centerY) * ratio,
    };
  }

  function dragInOutputCoordinates(transform, delta, previewSize, output) {
    return {
      ...transform,
      panX: transform.panX + (delta.x / previewSize.width) * output.width,
      // Pointer Y grows downwards, while the WebGL output coordinate grows upwards.
      panY: transform.panY - (delta.y / previewSize.height) * output.height,
    };
  }

  function wheelFactor(deltaY, sensitivity) {
    return Math.exp(-Number(deltaY) * Number(sensitivity));
  }

  function isHighResolution(width, height) {
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    return w * h > 3840 * 2160 || Math.min(w, h) > 2160;
  }

  function preferredVideoCodecs(codecs, width, height) {
    const available = Array.isArray(codecs) ? codecs : [];
    const h264 = available.filter(
      (codec) => String(codec.mimeType).toLowerCase() === "video/h264",
    );
    const hevc = available.filter((codec) => {
      const mime = String(codec.mimeType).toLowerCase();
      return mime === "video/h265" || mime === "video/hevc";
    });
    const selected = isHighResolution(width, height) && hevc.length ? hevc : h264;
    return {
      codecs: selected,
      name: selected === hevc && hevc.length ? "HEVC" : h264.length ? "H264" : "default",
      hevcAvailable: hevc.length > 0,
      h264Available: h264.length > 0,
    };
  }

  return {
    positiveInteger,
    constraintValue,
    orientSize,
    resolveRequestedSize,
    fitTransform,
    zoomAroundPoint,
    dragInOutputCoordinates,
    wheelFactor,
    isHighResolution,
    preferredVideoCodecs,
  };
}));
