(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.CamHandheld = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
  }

  function normalizeQuaternion(value) {
    const source = Array.isArray(value) ? value : [1, 0, 0, 0];
    const length = Math.hypot(...source) || 1;
    return source.slice(0, 4).map((component) => component / length);
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
    const pitchValue = clamp(2 * (w * y - z * x), -1, 1);
    const pitch = Math.asin(pitchValue);
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

  function newTranslationState() {
    return {
      acceleration: [0, 0, 0],
      velocity: [0, 0, 0],
      position: [0, 0, 0],
      bias: [0, 0, 0],
      calibrationSum: [0, 0, 0],
      calibrationSamples: 0,
      stationarySeconds: 0,
    };
  }

  class Controller {
    constructor() {
      this.enabled = false;
      this.liveTranslation = false;
      this.motion = 35;
      this.stabilization = 55;
      this.latest = null;
      this.baseline = null;
      this.smoothed = { x: 0, y: 0, z: 0 };
      this.translation = newTranslationState();
      this.lastTimestampMs = null;
    }

    configure({ enabled, liveTranslation = false, motion, stabilization }) {
      const wasEnabled = this.enabled;
      this.enabled = !!enabled;
      this.liveTranslation = !!liveTranslation;
      this.motion = clamp(motion, 0, 100);
      this.stabilization = clamp(stabilization, 0, 100);
      if (this.enabled && !wasEnabled) this.recenter();
      if (!this.enabled) this.resetSmoothing();
    }

    ingest(sample, timestampMs) {
      if (!sample || !Array.isArray(sample.quaternion) || sample.quaternion.length < 4) {
        return this.output();
      }
      this.latest = sample;
      if (!this.baseline) this.recenter();
      if (!this.enabled) return this.output();
      const relative = remapForDisplay(
        relativeEuler(this.baseline, sample.quaternion),
        Number(sample.displayRotation) || 0,
      );
      const target = {
        x: clamp(relative.x, -0.18, 0.18),
        y: clamp(relative.y, -0.18, 0.18),
        z: clamp(relative.z, -0.14, 0.14),
      };
      const now = Number(timestampMs);
      const deltaSeconds = this.lastTimestampMs == null || !Number.isFinite(now)
        ? 1 / 30
        : clamp((now - this.lastTimestampMs) / 1000, 1 / 240, 0.2);
      this.lastTimestampMs = Number.isFinite(now) ? now : null;
      const stabilization = this.stabilization / 100;
      const timeConstant = 0.012 + stabilization * 0.32;
      const alpha = 1 - Math.exp(-deltaSeconds / timeConstant);
      for (const axis of ["x", "y", "z"]) {
        this.smoothed[axis] += (target[axis] - this.smoothed[axis]) * alpha;
      }
      const relativeRotation = relativeQuaternion(this.baseline, sample.quaternion);
      const acceleration = remapVectorForDisplay(
        rotateVector(relativeRotation, Array.from(sample.acceleration || [0, 0, 0])),
        Number(sample.displayRotation) || 0,
      );
      this.updateTranslation(acceleration, sample.gyro, deltaSeconds);
      return this.output();
    }

    updateTranslation(acceleration, gyro, deltaSeconds) {
      if (!this.liveTranslation || !Array.isArray(acceleration) || acceleration.length < 3) {
        this.translation = newTranslationState();
        return;
      }
      const measured = acceleration.slice(0, 3).map(Number);
      if (measured.some((value) => !Number.isFinite(value))) return;
      if (this.translation.calibrationSamples < 12) {
        for (let axis = 0; axis < 3; axis += 1) {
          this.translation.calibrationSum[axis] += measured[axis];
        }
        this.translation.calibrationSamples += 1;
        if (this.translation.calibrationSamples === 12) {
          this.translation.bias = this.translation.calibrationSum.map(
            (sum) => sum / this.translation.calibrationSamples,
          );
        }
        return;
      }
      const sensorAlpha = 1 - Math.exp(-deltaSeconds / 0.055);
      for (let axis = 0; axis < 3; axis += 1) {
        const corrected = measured[axis] - this.translation.bias[axis];
        this.translation.acceleration[axis] += (
          corrected - this.translation.acceleration[axis]
        ) * sensorAlpha;
      }

      const accelerationMagnitude = Math.hypot(...this.translation.acceleration);
      const gyroMagnitude = Array.isArray(gyro) ? Math.hypot(...gyro.map(Number)) : 0;
      const stationary = accelerationMagnitude < 0.22 && gyroMagnitude < 0.08;
      this.translation.stationarySeconds = stationary
        ? this.translation.stationarySeconds + deltaSeconds
        : 0;

      if (this.translation.stationarySeconds > 0.12) {
        const biasAlpha = 1 - Math.exp(-deltaSeconds / 3.0);
        for (let axis = 0; axis < 3; axis += 1) {
          this.translation.bias[axis] += (
            measured[axis] - this.translation.bias[axis]
          ) * biasAlpha;
          this.translation.velocity[axis] *= Math.exp(-deltaSeconds * 20);
          if (this.translation.stationarySeconds > 0.3) {
            this.translation.velocity[axis] = 0;
          }
        }
      } else {
        const deadZone = 0.12;
        for (let axis = 0; axis < 3; axis += 1) {
          const filtered = this.translation.acceleration[axis];
          const active = Math.abs(filtered) <= deadZone
            ? 0
            : filtered - Math.sign(filtered) * deadZone;
          this.translation.velocity[axis] = clamp(
            (this.translation.velocity[axis] + active * deltaSeconds)
              * Math.exp(-deltaSeconds * 0.6),
            -1.5,
            1.5,
          );
        }
      }
      for (let axis = 0; axis < 3; axis += 1) {
        this.translation.position[axis] += this.translation.velocity[axis] * deltaSeconds;
      }
      this.translation.position[0] = clamp(this.translation.position[0], -0.22, 0.22);
      this.translation.position[1] = clamp(this.translation.position[1], -0.22, 0.22);
      this.translation.position[2] = clamp(this.translation.position[2], -0.20, 0.20);
    }

    recenter() {
      if (this.latest?.quaternion) {
        this.baseline = normalizeQuaternion(this.latest.quaternion);
      }
      this.resetSmoothing();
    }

    resetSmoothing() {
      this.smoothed = { x: 0, y: 0, z: 0 };
      this.translation = newTranslationState();
      this.lastTimestampMs = null;
    }

    output(width = 1, height = 1) {
      if (!this.enabled || !this.baseline || this.motion <= 0) {
        return {
          panX: 0,
          panY: 0,
          roll: 0,
          scale: 1,
          depthScale: 1,
          translationX: 0,
          translationY: 0,
          translationZ: 0,
          translationCalibrated: false,
          translationStationary: true,
        };
      }
      const gain = this.motion / 50;
      const stabilization = this.stabilization / 100;
      const residual = 1 - stabilization * 0.85;
      const x = this.smoothed.x * gain * residual;
      const y = this.smoothed.y * gain * residual;
      const z = this.smoothed.z * gain * residual;
      const overscan = 1 + Math.min(0.04, 0.025 * gain);
      const translationResidual = 1 - stabilization * 0.7;
      const [translationX, translationY, translationZ] = this.translation.position;
      const depthScale = this.liveTranslation
        ? clamp(Math.exp(-translationZ * 0.6 * gain * translationResidual), 0.85, 1.20)
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
        translationCalibrated: this.translation.calibrationSamples >= 12,
        translationStationary: this.translation.stationarySeconds > 0.12,
      };
    }
  }

  return {
    Controller,
    normalizeQuaternion,
    multiply,
    relativeQuaternion,
    rotateVector,
    relativeEuler,
    remapForDisplay,
    remapVectorForDisplay,
  };
}));
