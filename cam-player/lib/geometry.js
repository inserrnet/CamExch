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

  function isUltraHighResolution(width, height) {
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    return w * h > 3840 * 2160;
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
    const vp9 = available.filter(
      (codec) => String(codec.mimeType).toLowerCase() === "video/vp9",
    );
    const selected = isUltraHighResolution(width, height) && vp9.length
      ? vp9
      : isHighResolution(width, height) && hevc.length
        ? hevc
        : h264;
    return {
      codecs: selected,
      name: selected === vp9 && vp9.length
        ? "VP9"
        : selected === hevc && hevc.length
          ? "HEVC"
          : h264.length
            ? "H264"
            : "default",
      hevcAvailable: hevc.length > 0,
      h264Available: h264.length > 0,
      vp9Available: vp9.length > 0,
    };
  }

  function negotiatedVideoCodec(sdp) {
    const lines = String(sdp || "").split(/\r?\n/);
    const videoLine = lines.find((line) => line.startsWith("m=video "));
    if (!videoLine) return "unknown";
    const payloads = videoLine.trim().split(/\s+/).slice(3);
    const codecs = new Map();
    for (const line of lines) {
      const match = /^a=rtpmap:(\d+)\s+([^/\s]+)/i.exec(line);
      if (match) codecs.set(match[1], match[2].toUpperCase());
    }
    for (const payload of payloads) {
      const codec = codecs.get(payload);
      if (codec && codec !== "RTX" && codec !== "RED" && codec !== "ULPFEC") {
        return codec;
      }
    }
    return "unknown";
  }

  function prioritizeVideoCodec(sdp, preferredCodec) {
    const separator = String(sdp || "").includes("\r\n") ? "\r\n" : "\n";
    const lines = String(sdp || "").split(/\r?\n/);
    const videoIndex = lines.findIndex((line) => line.startsWith("m=video "));
    if (videoIndex < 0) return String(sdp || "");

    const parts = lines[videoIndex].trim().split(/\s+/);
    const payloads = parts.slice(3);
    const codecByPayload = new Map();
    const rtxByPrimary = new Map();
    for (const line of lines) {
      const rtpmap = /^a=rtpmap:(\d+)\s+([^/\s]+)/i.exec(line);
      if (rtpmap) codecByPayload.set(rtpmap[1], rtpmap[2].toUpperCase());
      const fmtp = /^a=fmtp:(\d+)\s+(.+)/i.exec(line);
      const apt = fmtp && /(?:^|[;\s])apt=(\d+)(?:[;\s]|$)/i.exec(fmtp[2]);
      if (fmtp && apt) {
        const list = rtxByPrimary.get(apt[1]) || [];
        list.push(fmtp[1]);
        rtxByPrimary.set(apt[1], list);
      }
    }

    const preferredNames = String(preferredCodec || "").toUpperCase() === "HEVC"
      ? new Set(["H265", "HEVC"])
      : new Set([String(preferredCodec || "").toUpperCase()]);
    const preferred = payloads.filter(
      (payload) => preferredNames.has(codecByPayload.get(payload)),
    );
    if (!preferred.length) return String(sdp || "");

    const ordered = [];
    for (const primary of preferred) {
      ordered.push(primary);
      for (const rtx of rtxByPrimary.get(primary) || []) {
        if (payloads.includes(rtx)) ordered.push(rtx);
      }
    }
    for (const payload of payloads) {
      if (!ordered.includes(payload)) ordered.push(payload);
    }
    lines[videoIndex] = [...parts.slice(0, 3), ...ordered].join(" ");
    return lines.join(separator);
  }

  function formatNetworkInterfaces(interfaces, port) {
    const seen = new Set();
    return (Array.isArray(interfaces) ? interfaces : [])
      .filter((item) => item && item.address)
      .map((item) => {
        const route = item.route || item.name || "Network";
        return `${route}: ${item.address}:${port}`;
      })
      .filter((line) => {
        if (seen.has(line)) return false;
        seen.add(line);
        return true;
      })
      .join("\n");
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
    isUltraHighResolution,
    preferredVideoCodecs,
    negotiatedVideoCodec,
    prioritizeVideoCodec,
    formatNetworkInterfaces,
  };
}));
