(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.CamMotionProfile = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROFILE_VERSION = 1;
  const RECORDING_DURATION_MS = 30_000;
  const SAMPLE_INTERVAL_MS = 1000 / 30;
  const MIN_PROFILE_DURATION_MS = 25_000;
  const MIN_PROFILE_SAMPLES = 300;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
  }

  function normalizeQuaternion(value) {
    if (!Array.isArray(value) || value.length < 4) return null;
    const quaternion = value.slice(0, 4).map(Number);
    if (!quaternion.every(Number.isFinite)) return null;
    const length = Math.hypot(...quaternion);
    if (length < 1e-8) return null;
    return quaternion.map((component) => component / length);
  }

  function normalizeVector(value) {
    if (!Array.isArray(value) || value.length < 3) return [0, 0, 0];
    return value.slice(0, 3).map((component) => (
      Number.isFinite(Number(component)) ? Number(component) : 0
    ));
  }

  function interpolateQuaternion(leftValue, rightValue, amount) {
    const left = normalizeQuaternion(leftValue) || [1, 0, 0, 0];
    let right = normalizeQuaternion(rightValue) || left;
    const dot = left.reduce((sum, component, index) => sum + component * right[index], 0);
    if (dot < 0) right = right.map((component) => -component);
    return normalizeQuaternion(left.map((component, index) => (
      component + (right[index] - component) * amount
    ))) || left;
  }

  function interpolateVector(left, right, amount) {
    return left.map((component, index) => component + (right[index] - component) * amount);
  }

  function cleanSamples(rawSamples) {
    const cleaned = [];
    let previousTime = -1;
    for (const raw of Array.isArray(rawSamples) ? rawSamples : []) {
      const time = Number(raw?.t);
      const quaternion = normalizeQuaternion(raw?.quaternion);
      if (!Number.isFinite(time) || time < 0 || !quaternion || time <= previousTime) continue;
      cleaned.push({
        t: time,
        quaternion,
        gyro: normalizeVector(raw.gyro),
        acceleration: normalizeVector(raw.acceleration),
        displayRotation: Math.round(clamp(raw.displayRotation, 0, 3)),
      });
      previousTime = time;
    }
    return cleaned;
  }

  function sampleBetween(left, right, time) {
    const span = Math.max(1e-6, right.t - left.t);
    const amount = clamp((time - left.t) / span, 0, 1);
    return {
      t: Math.round(time),
      quaternion: interpolateQuaternion(left.quaternion, right.quaternion, amount),
      gyro: interpolateVector(left.gyro, right.gyro, amount),
      acceleration: interpolateVector(left.acceleration, right.acceleration, amount),
      displayRotation: amount < 0.5 ? left.displayRotation : right.displayRotation,
    };
  }

  function roundSample(sample) {
    const round = (value) => Number(value.toFixed(6));
    return {
      t: Math.round(sample.t),
      quaternion: sample.quaternion.map(round),
      gyro: sample.gyro.map(round),
      acceleration: sample.acceleration.map(round),
      displayRotation: sample.displayRotation,
    };
  }

  function resample(cleaned, durationMs = RECORDING_DURATION_MS) {
    const result = [];
    let rightIndex = 1;
    const firstTime = cleaned[0].t;
    const finalTime = Math.min(cleaned[cleaned.length - 1].t, firstTime + durationMs);
    for (let absoluteTime = firstTime; absoluteTime <= finalTime; absoluteTime += SAMPLE_INTERVAL_MS) {
      while (rightIndex < cleaned.length - 1 && cleaned[rightIndex].t < absoluteTime) {
        rightIndex += 1;
      }
      const left = cleaned[Math.max(0, rightIndex - 1)];
      const right = cleaned[rightIndex] || left;
      const sample = sampleBetween(left, right, absoluteTime);
      sample.t = absoluteTime - firstTime;
      result.push(sample);
    }
    return result;
  }

  function closeLoop(samples) {
    if (samples.length < 2) return samples;
    const duration = samples[samples.length - 1].t;
    const blendDuration = Math.min(1500, duration * 0.08);
    const first = samples[0];
    return samples.map((sample) => {
      if (sample.t < duration - blendDuration) return roundSample(sample);
      const amount = clamp((sample.t - (duration - blendDuration)) / blendDuration, 0, 1);
      const eased = amount * amount * (3 - 2 * amount);
      return roundSample({
        ...sample,
        quaternion: interpolateQuaternion(sample.quaternion, first.quaternion, eased),
        gyro: interpolateVector(sample.gyro, first.gyro, eased),
        acceleration: interpolateVector(sample.acceleration, first.acceleration, eased),
        displayRotation: eased < 0.5 ? sample.displayRotation : first.displayRotation,
      });
    });
  }

  function prepareProfile(rawSamples, options = {}) {
    const cleaned = cleanSamples(rawSamples);
    if (cleaned.length < MIN_PROFILE_SAMPLES) {
      throw new Error(`Not enough sensor samples (${cleaned.length}/${MIN_PROFILE_SAMPLES})`);
    }
    const coverageMs = cleaned[cleaned.length - 1].t - cleaned[0].t;
    if (coverageMs < MIN_PROFILE_DURATION_MS) {
      throw new Error(`Sensor recording is too short (${Math.round(coverageMs / 1000)}s)`);
    }
    const samples = closeLoop(resample(cleaned));
    const durationMs = samples[samples.length - 1]?.t || 0;
    return {
      version: PROFILE_VERSION,
      id: String(options.id || ""),
      name: String(options.name || "Motion profile").trim().slice(0, 80) || "Motion profile",
      createdAt: String(options.createdAt || new Date().toISOString()),
      updatedAt: new Date().toISOString(),
      durationMs,
      sampleRateHz: Number((samples.length * 1000 / Math.max(1, durationMs)).toFixed(2)),
      motion: clamp(options.motion ?? 35, 0, 100),
      stabilization: clamp(options.stabilization ?? 55, 0, 100),
      samples,
    };
  }

  function validateProfile(profile) {
    if (!profile || Number(profile.version) !== PROFILE_VERSION) return false;
    if (!Array.isArray(profile.samples) || profile.samples.length < MIN_PROFILE_SAMPLES) return false;
    if (!Number.isFinite(Number(profile.durationMs)) || Number(profile.durationMs) < MIN_PROFILE_DURATION_MS) {
      return false;
    }
    return cleanSamples(profile.samples).length === profile.samples.length;
  }

  class Player {
    constructor(profile) {
      if (!validateProfile(profile)) throw new Error("Motion profile is invalid");
      this.profile = profile;
      this.startedAtMs = null;
    }

    restart(nowMs = 0) {
      this.startedAtMs = Number(nowMs) || 0;
    }

    sampleAt(nowMs) {
      if (this.startedAtMs == null) this.restart(nowMs);
      const samples = this.profile.samples;
      const duration = Math.max(1, Number(this.profile.durationMs));
      const elapsed = ((Number(nowMs) - this.startedAtMs) % duration + duration) % duration;
      const approximateIndex = Math.floor(elapsed / SAMPLE_INTERVAL_MS);
      const left = samples[Math.min(samples.length - 1, Math.max(0, approximateIndex))];
      const right = samples[Math.min(samples.length - 1, approximateIndex + 1)] || left;
      return sampleBetween(left, right, elapsed);
    }
  }

  return {
    MIN_PROFILE_DURATION_MS,
    MIN_PROFILE_SAMPLES,
    PROFILE_VERSION,
    RECORDING_DURATION_MS,
    SAMPLE_INTERVAL_MS,
    Player,
    cleanSamples,
    interpolateQuaternion,
    prepareProfile,
    validateProfile,
  };
}));
