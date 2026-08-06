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

  function relativeEuler(baseline, current) {
    const [w, x, y, z] = normalizeQuaternion(multiply(
      conjugate(normalizeQuaternion(baseline)),
      normalizeQuaternion(current),
    ));
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

  function newDepthState(acceleration) {
    const z = Number(acceleration?.[2]);
    return {
      acceleration: 0,
      velocity: 0,
      position: 0,
      bias: null,
      calibrationSum: Number.isFinite(z) ? z : 0,
      calibrationSamples: Number.isFinite(z) ? 1 : 0,
    };
  }

  class Controller {
    constructor() {
      this.enabled = false;
      this.liveDepth = false;
      this.motion = 35;
      this.stabilization = 55;
      this.latest = null;
      this.baseline = null;
      this.smoothed = { x: 0, y: 0, z: 0 };
      this.depth = newDepthState();
      this.lastTimestampMs = null;
    }

    configure({ enabled, liveDepth = false, motion, stabilization }) {
      const wasEnabled = this.enabled;
      this.enabled = !!enabled;
      this.liveDepth = !!liveDepth;
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
      this.updateDepth(sample.acceleration, deltaSeconds);
      return this.output();
    }

    updateDepth(acceleration, deltaSeconds) {
      if (!this.liveDepth || !Array.isArray(acceleration) || acceleration.length < 3) {
        this.depth = newDepthState();
        return;
      }
      const accelerationZ = Number(acceleration[2]);
      if (!Number.isFinite(accelerationZ)) return;
      if (this.depth.calibrationSamples < 10) {
        this.depth.calibrationSum += accelerationZ;
        this.depth.calibrationSamples += 1;
        if (this.depth.calibrationSamples === 10) {
          this.depth.bias = this.depth.calibrationSum / this.depth.calibrationSamples;
        }
        return;
      }
      if (!Number.isFinite(this.depth.bias)) this.depth.bias = accelerationZ;
      const biasDelta = accelerationZ - this.depth.bias;
      if (Math.abs(biasDelta) < 0.24) {
        const biasAlpha = 1 - Math.exp(-deltaSeconds / 2.5);
        this.depth.bias += biasDelta * biasAlpha;
      }
      const rawTowardSource = clamp(-(accelerationZ - this.depth.bias), -5, 5);
      const sensorAlpha = 1 - Math.exp(-deltaSeconds / 0.055);
      this.depth.acceleration += (rawTowardSource - this.depth.acceleration) * sensorAlpha;
      const deadZone = 0.10;
      const activeAcceleration = Math.abs(this.depth.acceleration) <= deadZone
        ? 0
        : this.depth.acceleration - Math.sign(this.depth.acceleration) * deadZone;
      this.depth.velocity += activeAcceleration * deltaSeconds;
      this.depth.velocity *= Math.exp(-deltaSeconds * 3.5);
      this.depth.position += this.depth.velocity * deltaSeconds;
      this.depth.position *= Math.exp(-deltaSeconds * 0.12);
      this.depth.position = clamp(this.depth.position, -0.16, 0.16);
      if (activeAcceleration === 0 && Math.abs(this.depth.velocity) < 0.001) {
        this.depth.velocity = 0;
      }
    }

    recenter() {
      if (this.latest?.quaternion) {
        this.baseline = normalizeQuaternion(this.latest.quaternion);
      }
      this.resetSmoothing();
    }

    resetSmoothing() {
      this.smoothed = { x: 0, y: 0, z: 0 };
      this.depth = newDepthState(this.latest?.acceleration);
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
        };
      }
      const gain = this.motion / 50;
      const stabilization = this.stabilization / 100;
      const residual = 1 - stabilization * 0.85;
      const x = this.smoothed.x * gain * residual;
      const y = this.smoothed.y * gain * residual;
      const z = this.smoothed.z * gain * residual;
      const overscan = 1 + Math.min(0.04, 0.025 * gain);
      const depthResidual = 1 - stabilization * 0.65;
      const depthScale = this.liveDepth
        ? clamp(Math.exp(this.depth.position * 0.75 * gain * depthResidual), 0.90, 1.14)
        : 1;
      return {
        panX: -y * Math.max(1, width) * 0.7,
        panY: x * Math.max(1, height) * 0.7,
        roll: -z * 0.9,
        scale: overscan * depthScale,
        depthScale,
      };
    }
  }

  return {
    Controller,
    normalizeQuaternion,
    multiply,
    relativeEuler,
    remapForDisplay,
  };
}));
