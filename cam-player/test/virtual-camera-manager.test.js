"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { executablePath, filterPath, normalizeOrientation } = require("../lib/virtual-camera-manager");

test("resolves development virtual camera components together", () => {
  const app = { isPackaged: false };
  assert.equal(path.dirname(executablePath(app)), path.dirname(filterPath(app)));
  assert.match(executablePath(app), /native[\\/]bin[\\/]x64[\\/]CamPlayerVirtualCameraControl\.exe$/);
  assert.match(filterPath(app), /native[\\/]bin[\\/]x64[\\/]CamPlayerVirtualCamera\.dll$/);
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
