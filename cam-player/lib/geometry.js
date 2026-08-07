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

  function constraintSpec(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return { plain: value };
    }
    if (!value || typeof value !== "object") return null;
    const result = {};
    for (const name of ["exact", "ideal", "min", "max"]) {
      const candidate = Number(value[name]);
      if (Number.isFinite(candidate) && candidate > 0) result[name] = candidate;
    }
    return Object.keys(result).length ? result : null;
  }

  function constraintStrength(spec) {
    if (!spec) return "none";
    for (const name of ["exact", "plain", "ideal", "range"]) {
      if (name === "range" ? spec.min !== undefined || spec.max !== undefined : spec[name] !== undefined) {
        return name;
      }
    }
    return "none";
  }

  function resolveConstraintDimension(spec, fallback) {
    let value = spec.exact ?? spec.plain ?? spec.ideal ?? fallback;
    if (spec.min !== undefined) value = Math.max(value, spec.min);
    if (spec.max !== undefined) value = Math.min(value, spec.max);
    return value;
  }

  function constraintBounds(spec) {
    return {
      min: spec.exact ?? spec.plain ?? spec.min ?? 2,
      max: spec.exact ?? spec.plain ?? spec.max ?? Number.POSITIVE_INFINITY,
    };
  }

  function resolveAspectSize(width, height, widthSpec, heightSpec, aspectSpec, orientation) {
    if (!aspectSpec) return { width, height, applied: false };
    let ratio = aspectSpec.exact ?? aspectSpec.plain ?? aspectSpec.ideal;
    if (!Number.isFinite(ratio) || ratio <= 0) return { width, height, applied: false };
    if (orientation === "portrait" && ratio > 1) ratio = 1 / ratio;
    if (orientation === "landscape" && ratio < 1) ratio = 1 / ratio;
    const wb = constraintBounds(widthSpec);
    const hb = constraintBounds(heightSpec);
    const candidates = [
      { width, height: width / ratio },
      { width: height * ratio, height },
    ].filter((candidate) => (
      candidate.width >= wb.min && candidate.width <= wb.max
      && candidate.height >= hb.min && candidate.height <= hb.max
    ));
    if (!candidates.length) {
      return { width, height, applied: false, unsupported: aspectSpec.exact !== undefined };
    }
    candidates.sort((left, right) => (
      Math.abs(left.width - width) + Math.abs(left.height - height)
      - Math.abs(right.width - width) - Math.abs(right.height - height)
    ));
    return { ...candidates[0], applied: true, ratio };
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

  function requestedConstraintPair(video) {
    const directWidth = constraintSpec(video.width);
    const directHeight = constraintSpec(video.height);
    if (directWidth && directHeight) {
      return { width: directWidth, height: directHeight, source: "direct" };
    }
    const advanced = Array.isArray(video.advanced) ? video.advanced : [];
    for (let index = 0; index < advanced.length; index += 1) {
      const candidate = advanced[index];
      if (!candidate || typeof candidate !== "object") continue;
      const width = constraintSpec(candidate.width);
      const height = constraintSpec(candidate.height);
      if (width && height) {
        return { width, height, source: `advanced[${index}]` };
      }
    }
    return null;
  }

  const SAFE_SITE_MAX_WIDTH = 1920;
  const SAFE_SITE_MAX_HEIGHT = 1920;
  const SAFE_SITE_MAX_SHORT_EDGE = 1440;
  const SAFE_SITE_MAX_PIXELS = 1920 * 1440;

  function isMandatoryConstraint(pair) {
    return [pair.width, pair.height]
      .some((constraint) => constraint.exact !== undefined || constraint.min !== undefined);
  }

  function fitOptionalSiteSize(width, height) {
    const landscape = width >= height;
    const widthLimit = landscape ? SAFE_SITE_MAX_WIDTH : SAFE_SITE_MAX_SHORT_EDGE;
    const heightLimit = landscape ? SAFE_SITE_MAX_SHORT_EDGE : SAFE_SITE_MAX_HEIGHT;
    const scale = Math.min(
      1,
      widthLimit / width,
      heightLimit / height,
      Math.sqrt(SAFE_SITE_MAX_PIXELS / (width * height)),
    );
    if (scale >= 1) return { width, height, clamped: false };
    return {
      width: Math.max(2, Math.floor((width * scale) / 2) * 2),
      height: Math.max(2, Math.floor((height * scale) / 2) * 2),
      clamped: true,
    };
  }

  function resolveRequestedSize(constraints, orientation, fallback) {
    const video = constraints && constraints.video && constraints.video !== true
      ? constraints.video
      : {};
    const pair = requestedConstraintPair(video);
    if (!pair) {
      return {
        width: fallback.width,
        height: fallback.height,
        applied: false,
        reason: "site did not request both dimensions",
      };
    }
    const widthConstraint = pair.width;
    const heightConstraint = pair.height;
    const aspectConstraint = constraintSpec(video.aspectRatio);
    const initialWidth = resolveConstraintDimension(widthConstraint, fallback.width);
    const initialHeight = resolveConstraintDimension(heightConstraint, fallback.height);
    const aspect = resolveAspectSize(
      initialWidth,
      initialHeight,
      widthConstraint,
      heightConstraint,
      aspectConstraint,
      orientation,
    );
    if (aspect.unsupported) {
      return {
        width: fallback.width,
        height: fallback.height,
        applied: false,
        unsupported: true,
        requestedWidth: initialWidth,
        requestedHeight: initialHeight,
        reason: `exact aspectRatio cannot be satisfied within requested dimensions`,
      };
    }
    const requestedWidth = Math.max(2, Math.round(aspect.width / 2) * 2);
    const requestedHeight = Math.max(2, Math.round(aspect.height / 2) * 2);
    const oriented = orientSize(
      requestedWidth,
      requestedHeight,
      orientation,
    );
    const rawWidth = aspect.width;
    const rawHeight = aspect.height;
    const normalized = requestedWidth !== Math.round(rawWidth)
      || requestedHeight !== Math.round(rawHeight);
    const widthStrength = constraintStrength(widthConstraint);
    const heightStrength = constraintStrength(heightConstraint);
    const baseReason = `${pair.source === "direct" ? "" : `${pair.source} `}`
      + `${widthStrength}/${heightStrength} ${orientation}`
      + (aspect.applied ? ` aspect=${aspect.ratio.toFixed(4)}` : "")
      + (normalized ? " H264-even" : "");
    if (isMandatoryConstraint(pair) && isUltraHighResolution(oriented.width, oriented.height)) {
      return {
        width: fallback.width,
        height: fallback.height,
        applied: false,
        unsupported: true,
        requestedWidth: oriented.width,
        requestedHeight: oriented.height,
        reason: `${baseReason} exceeds stable mandatory encoder limit`,
      };
    }
    const safe = isMandatoryConstraint(pair)
      ? { ...oriented, clamped: false }
      : fitOptionalSiteSize(oriented.width, oriented.height);
    if (safe.clamped) {
      return {
        width: safe.width,
        height: safe.height,
        applied: true,
        clamped: true,
        requestedWidth: oriented.width,
        requestedHeight: oriented.height,
        reason: `${baseReason} capped for stable H264 streaming`,
      };
    }
    return {
      width: safe.width,
      height: safe.height,
      applied: true,
      reason: baseReason,
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

  function rescaleOutputTransform(transform, before, after) {
    const source = transform || { scale: 1, panX: 0, panY: 0 };
    const beforeWidth = Math.max(1, Number(before && before.width) || 1);
    const beforeHeight = Math.max(1, Number(before && before.height) || 1);
    const afterWidth = Math.max(1, Number(after && after.width) || 1);
    const afterHeight = Math.max(1, Number(after && after.height) || 1);
    return {
      scale: Number(source.scale) || 1,
      panX: (Number(source.panX) || 0) * afterWidth / beforeWidth,
      panY: (Number(source.panY) || 0) * afterHeight / beforeHeight,
    };
  }

  function wheelFactor(deltaY, sensitivity) {
    return Math.exp(-Number(deltaY) * Number(sensitivity));
  }

  function shouldRenderMediaFrame(previousMediaTime, currentMediaTime, maximumFps) {
    const current = Number(currentMediaTime);
    const previous = previousMediaTime == null ? Number.NaN : Number(previousMediaTime);
    const fps = Math.max(1, Math.min(60, Number(maximumFps) || 30));
    if (!Number.isFinite(current)
        || !Number.isFinite(previous)
        || current <= previous) {
      return true;
    }
    return current - previous >= (1 / fps) * 0.9;
  }

  function targetVideoBitrate(width, height, framesPerSecond) {
    const w = Math.max(2, Number(width) || 0);
    const h = Math.max(2, Number(height) || 0);
    const fps = Math.max(1, Math.min(60, Number(framesPerSecond) || 30));
    const calculated = Math.round(w * h * fps * 0.4);
    return Math.max(4_000_000, Math.min(50_000_000, calculated));
  }

  function videoBitrateProfile(width, height, framesPerSecond) {
    const maximum = targetVideoBitrate(width, height, framesPerSecond);
    return {
      minimum: Math.min(maximum, Math.max(2_000_000, Math.round(maximum * 0.3))),
      start: Math.min(maximum, Math.max(3_000_000, Math.round(maximum * 0.6))),
      maximum,
    };
  }

  function adaptiveFrameRate(width, height, configuredFps, state) {
    const configured = Math.max(1, Math.min(60, Number(configuredFps) || 30));
    if (state === "motion") return configured;
    const pixels = Math.max(1, Number(width) || 0) * Math.max(1, Number(height) || 0);
    if (state !== "interaction") {
      if (pixels >= 7_000_000) return Math.min(configured, 5);
      if (pixels >= 3_000_000) return Math.min(configured, 8);
      return Math.min(configured, 15);
    }
    if (pixels >= 7_000_000) return Math.min(configured, 10);
    if (pixels >= 3_000_000) return Math.min(configured, 15);
    return Math.min(configured, 20);
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
    // Android WebView currently advertises HEVC in some offers but completes the
    // connection with H264. Prefer the codec that is actually interoperable and
    // hardware accelerated on both ends; retain the others as fallbacks.
    const selected = h264.length
      ? h264
      : hevc.length
        ? hevc
        : vp9;
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

  function applyVideoBitrateHints(sdp, preferredCodec, profile) {
    const source = String(sdp || "");
    const separator = source.includes("\r\n") ? "\r\n" : "\n";
    const lines = source.split(/\r?\n/);
    const videoIndex = lines.findIndex((line) => line.startsWith("m=video "));
    if (videoIndex < 0) return source;
    const sectionEndOffset = lines.slice(videoIndex + 1)
      .findIndex((line) => line.startsWith("m="));
    const sectionEnd = sectionEndOffset < 0
      ? lines.length
      : videoIndex + 1 + sectionEndOffset;
    const names = String(preferredCodec || "").toUpperCase() === "HEVC"
      ? new Set(["H265", "HEVC"])
      : new Set([String(preferredCodec || "").toUpperCase()]);
    const payloads = new Set();
    for (let index = videoIndex + 1; index < sectionEnd; index += 1) {
      const match = /^a=rtpmap:(\d+)\s+([^/\s]+)/i.exec(lines[index]);
      if (match && names.has(match[2].toUpperCase())) payloads.add(match[1]);
    }
    if (!payloads.size) return source;

    const minimumKbps = Math.max(1, Math.round(Number(profile?.minimum) / 1000));
    const startKbps = Math.max(minimumKbps, Math.round(Number(profile?.start) / 1000));
    const maximumKbps = Math.max(startKbps, Math.round(Number(profile?.maximum) / 1000));
    if (![minimumKbps, startKbps, maximumKbps].every(Number.isFinite)) return source;
    const hints = [
      `x-google-min-bitrate=${minimumKbps}`,
      `x-google-start-bitrate=${startKbps}`,
      `x-google-max-bitrate=${maximumKbps}`,
    ];

    for (const payload of payloads) {
      const fmtpIndex = lines.findIndex((line, index) => (
        index > videoIndex
        && index < sectionEnd
        && new RegExp(`^a=fmtp:${payload}\\s+`, "i").test(line)
      ));
      if (fmtpIndex >= 0) {
        const prefix = `a=fmtp:${payload} `;
        const parameters = lines[fmtpIndex].slice(prefix.length)
          .split(";")
          .map((item) => item.trim())
          .filter((item) => item && !/^x-google-(?:min|start|max)-bitrate=/i.test(item));
        lines[fmtpIndex] = prefix + [...parameters, ...hints].join(";");
      } else {
        lines.splice(sectionEnd, 0, `a=fmtp:${payload} ${hints.join(";")}`);
      }
    }

    const updatedSectionEnd = sectionEnd + Math.max(0, lines.length - source.split(/\r?\n/).length);
    const bandwidthIndex = lines.findIndex((line, index) => (
      index > videoIndex
      && index < updatedSectionEnd
      && /^b=AS:/i.test(line)
    ));
    if (bandwidthIndex >= 0) {
      lines[bandwidthIndex] = `b=AS:${maximumKbps}`;
    } else {
      lines.splice(videoIndex + 1, 0, `b=AS:${maximumKbps}`);
    }
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
    constraintSpec,
    orientSize,
    resolveRequestedSize,
    fitTransform,
    zoomAroundPoint,
    dragInOutputCoordinates,
    rescaleOutputTransform,
    wheelFactor,
    shouldRenderMediaFrame,
    targetVideoBitrate,
    videoBitrateProfile,
    adaptiveFrameRate,
    isHighResolution,
    isUltraHighResolution,
    preferredVideoCodecs,
    negotiatedVideoCodec,
    prioritizeVideoCodec,
    applyVideoBitrateHints,
    formatNetworkInterfaces,
  };
}));
