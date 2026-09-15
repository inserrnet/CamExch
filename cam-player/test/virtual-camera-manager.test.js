"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  VirtualCameraManager,
  executablePath,
  filterPath,
  pnpPackagePath,
  normalizeOrientation,
} = require("../lib/virtual-camera-manager");
const { scriptPath } = require("../lib/emulator-camera-mode-manager");

test("resolves development virtual camera components together", () => {
  const app = { isPackaged: false };
  assert.equal(path.dirname(executablePath(app)), path.dirname(filterPath(app)));
  assert.match(executablePath(app), /native[\\/]bin[\\/]x64[\\/]CamPlayerVirtualCameraControl\.exe$/);
  assert.match(filterPath(app), /native[\\/]bin[\\/]x64[\\/]CamPlayerVirtualCamera\.dll$/);
  assert.match(pnpPackagePath(app),
    /native[\\/]bin[\\/]x64[\\/]pnp[\\/]CamPlayerPnpCamera\.inf$/);
});

test("resolves packaged components outside the asar archive", () => {
  const previous = process.resourcesPath;
  Object.defineProperty(process, "resourcesPath", { value: "C:\\Program Files\\Cam Player\\resources", configurable: true });
  try {
    assert.match(executablePath({ isPackaged: true }), /app\.asar\.unpacked/);
  } finally {
    Object.defineProperty(process, "resourcesPath", { value: previous, configurable: true });
  }
});

test("normalizes virtual camera orientation", () => {
  assert.equal(normalizeOrientation("portrait"), "portrait");
  assert.equal(normalizeOrientation("landscape"), "landscape");
  assert.equal(normalizeOrientation("follow"), "follow");
  assert.equal(normalizeOrientation("unexpected"), "portrait");
});

test("resolves the emulator camera mode helper outside the packaged asar", () => {
  const previous = process.resourcesPath;
  Object.defineProperty(process, "resourcesPath", { value: "C:\\Program Files\\Cam Player\\resources", configurable: true });
  try {
    assert.match(scriptPath({ isPackaged: true }), /app\.asar\.unpacked[\\/]native[\\/]scripts[\\/]emulator-camera-mode\.ps1$/);
  } finally {
    Object.defineProperty(process, "resourcesPath", { value: previous, configurable: true });
  }
});

test("stopping between frame header and pixels does not access a cleared process", async () => {
  const callbacks = [];
  const child = {
    killed: false,
    exitCode: null,
    stdin: {
      destroyed: false,
      writableEnded: false,
      write(_value, callback) { callbacks.push(callback); },
    },
    kill() { this.killed = true; },
  };
  const manager = new VirtualCameraManager({ isPackaged: false });
  manager.process = child;
  const pending = manager.sendFrame({
    width: 1,
    height: 1,
    fps: 30,
    timestampUs: 1,
    pixels: Buffer.alloc(4),
  });
  manager.stop("test");
  await assert.rejects(pending, /Virtual camera stopped/);
  assert.doesNotThrow(() => callbacks[0]());
  assert.equal(callbacks.length, 1);
});
