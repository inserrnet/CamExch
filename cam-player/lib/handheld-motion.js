(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CamHandheld = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
  }

  function normalizeQuaternion(value) {
    const source = Array.isArray(value) ? value.slice(0, 4) : [1, 0, 0, 0];
    const length = Math.hypot(...source) || 1;
    return source.map((component) => component / length);
  }

  function conjugate([w, x, y, z]) {
    return [w, -x, -y, -z];
  }

  function multiply([aw, ax, ay, az], [bw, bx, by, bz]) {
    return [
      aw * bw - ax * bx - ay * by - az * bz,
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
    ];
  }

  function relativeQuaternion(baseline, current) {
    return normalizeQuaternion(multiply(
      conjugate(normalizeQuaternion(baseline)),
      normalizeQuaternion(current),
    ));
  }

  function rotateVector([w, x, y, z], [vx, vy, vz]) {
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    return [
      vx + w * tx + (y * tz - z * ty),
      vy + w * ty + (z * tx - x * tz),
      vz + w * tz + (x * ty - y * tx),
    ];
  }

  function relativeEuler(baseline, current) {
    const [w, x, y, z] = relativeQuaternion(baseline, current);
    const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    const pitch = Math.asin(clamp(2 * (w * y - z * x), -1, 1));
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    return { x: roll, y: pitch, z: yaw };
  }

  function remapForDisplay(euler, displayRotation) {
    if (displayRotation === 1) return { x: euler.y, y: -euler.x, z: euler.z };
    if (displayRotation === 2) return { x: -euler.x, y: -euler.y, z: euler.z };
    if (displayRotation === 3) return { x: -euler.y, y: euler.x, z: euler.z };
    return euler;
  }

  function remapVectorForDisplay([x, y, z], displayRotation) {
    if (displayRotation === 1) return [y, -x, z];
    if (displayRotation === 2) return [-x, -y, z];
    if (displayRotation === 3) return [-y, x, z];
    return [x, y, z];
  }

  function validPosition(sample) {
    return sample?.trackingSource === "arcore"
      && Array.isArray(sample.position)
      && sample.position.length >= 3
      && sample.position.slice(0, 3).every((value) => Number.isFinite(Number(value)));
  }

  function sensorToDisplayRotation(sample) {
    const explicit = Number(sample?.sensorToDisplayRotation);
    if (Number.isInteger(explicit) && explicit >= 0 && explicit <= 3) return explicit;
    const display = Math.round(clamp(sample?.displayRotation, 0, 3));
    return (1 - display + 4) % 4;
  }

  class Controller {
    constructor() {
      this.enabled = false;
      this.liveTranslation = false;
      this.motion = 35;
      this.stabilization = 55;
      this.latest = null;
      this.baseline = null;
      this.baselinePosition = null;
      this.smoothed = { x: 0, y: 0, z: 0 };
      this.smoothedPosition = [0, 0, 0];
      this.translationTracked = false;
      this.lastTimestampMs = null;
    }

    configure({ enabled, liveTranslation = false, motion, stabilization }) {
      const wasEnabled = this.enabled;
      this.enabled = Boolean(enabled);
      this.liveTranslation = Boolean(liveTranslation);
      this.motion = clamp(motion, 0, 100);
      this.stabilization = clamp(stabilization, 0, 100);
      if (this.enabled && !wasEnabled) this.recenter();
      if (!this.enabled) this.resetSmoothing();
    }

    ingest(sample, timestampMs) {
      if (!sample || !Array.isArray(sample.quaternion) || sample.quaternion.length < 4) {
        return this.output();
      }
      if (this.liveTranslation && !validPosition(sample)) {
        return this.output();
      }
      this.latest = sample;
      if (!this.baseline || (this.liveTranslation && !this.baselinePosition)) this.recenter();
      if (!this.enabled) return this.output();

      const now = Number(timestampMs);
      const deltaSeconds = this.lastTimestampMs == null || !Number.isFinite(now)
        ? 1 / 30
        : clamp((now - this.lastTimestampMs) / 1000, 1 / 240, 0.2);
      this.lastTimestampMs = Number.isFinite(now) ? now : null;
      const stabilization = this.stabilization / 100;
      const alpha = 1 - Math.exp(-deltaSeconds / (0.012 + stabilization * 0.32));

      const relative = remapForDisplay(
        relativeEuler(this.baseline, sample.quaternion),
        Number(sample.displayRotation) || 0,
      );
      const rotationTarget = {
        x: clamp(relative.x, -0.18, 0.18),
        y: clamp(relative.y, -0.18, 0.18),
        z: clamp(relative.z, -0.14, 0.14),
      };
      for (const axis of ["x", "y", "z"]) {
        this.smoothed[axis] += (rotationTarget[axis] - this.smoothed[axis]) * alpha;
      }

      if (this.liveTranslation) {
        const worldDelta = sample.position.slice(0, 3).map(
          (value, index) => Number(value) - this.baselinePosition[index],
        );
        const cameraDelta = remapVectorForDisplay(
          rotateVector(conjugate(this.baseline), worldDelta),
          sensorToDisplayRotation(sample),
        );
        for (let axis = 0; axis < 3; axis += 1) {
          const target = clamp(cameraDelta[axis], -0.5, 0.5);
          this.smoothedPosition[axis] += (target - this.smoothedPosition[axis]) * alpha;
        }
        this.translationTracked = true;
      }
      return this.output();
    }

    recenter() {
      if (this.latest?.quaternion) this.baseline = normalizeQuaternion(this.latest.quaternion);
      this.baselinePosition = validPosition(this.latest)
        ? this.latest.position.slice(0, 3).map(Number)
        : null;
      this.resetSmoothing();
    }

    resetSmoothing() {
      this.smoothed = { x: 0, y: 0, z: 0 };
      this.smoothedPosition = [0, 0, 0];
      this.translationTracked = Boolean(this.liveTranslation && this.baselinePosition);
      this.lastTimestampMs = null;
    }

    output(width = 1, height = 1) {
      const idle = {
        panX: 0, panY: 0, roll: 0, scale: 1, depthScale: 1,
        translationX: 0, translationY: 0, translationZ: 0,
        translationTracked: false, trackingSource: "none",
      };
      if (!this.enabled || !this.baseline || this.motion <= 0) return idle;

      const gain = this.motion / 50;
      const stabilization = this.stabilization / 100;
      const residual = 1 - stabilization * 0.85;
      const x = this.smoothed.x * gain * residual;
      const y = this.smoothed.y * gain * residual;
      const z = this.smoothed.z * gain * residual;
      const overscan = 1 + Math.min(0.04, 0.025 * gain);
      const translationResidual = 1 - stabilization * 0.7;
      const [translationX, translationY, translationZ] = this.smoothedPosition;
      const depthScale = this.liveTranslation && this.translationTracked
        ? clamp(Math.exp(-translationZ * 0.6 * gain * translationResidual), 0.75, 1.35)
        : 1;
      const translationGain = Math.min(width, height) * 1.2 * gain * translationResidual;
      return {
        panX: this.liveTranslation ? translationX * translationGain : -y * Math.max(1, width) * 0.7,
        panY: this.liveTranslation ? -translationY * translationGain : x * Math.max(1, height) * 0.7,
        roll: -z * 0.9,
        scale: overscan * depthScale,
        depthScale,
        translationX,
        translationY,
        translationZ,
        translationTracked: this.liveTranslation && this.translationTracked,
        trackingSource: this.liveTranslation && this.translationTracked ? "arcore" : "sensors",
      };
    }
  }

  return {
    Controller, normalizeQuaternion, multiply, relativeQuaternion,
    rotateVector, relativeEuler, remapForDisplay, remapVectorForDisplay,
    sensorToDisplayRotation,
  };
}));
