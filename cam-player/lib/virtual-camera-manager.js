"use strict";

const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");

const PACKET_MAGIC = 0x4d415243;
const ORIENTATIONS = new Set(["portrait", "landscape", "follow"]);

function normalizeOrientation(value) {
  return ORIENTATIONS.has(value) ? value : "portrait";
}

function executablePath(app) {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "native", "bin", "x64")
    : path.join(__dirname, "..", "native", "bin", "x64");
  return path.join(root, "CamPlayerVirtualCameraControl.exe");
}

function filterPath(app) {
  return path.join(path.dirname(executablePath(app)), "CamPlayerVirtualCamera.dll");
}

function run(executable, args) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message || error).trim()));
        return;
      }
      resolve(String(stdout || ""));
    });
  });
}

class VirtualCameraManager {
  constructor(app, logger = () => {}) {
    this.app = app;
    this.log = logger;
    this.process = null;
    this.pendingAcknowledgement = null;
  }

  available() {
    return process.platform === "win32"
      && fs.existsSync(executablePath(this.app))
      && fs.existsSync(filterPath(this.app));
  }

  async status() {
    if (!this.available()) {
      return {
        available: false,
        installed: false,
        running: false,
        name: "Cam Player Camera",
        consumers: 0,
        width: 0,
        height: 0,
      };
    }
    try {
      const output = await run(executablePath(this.app), ["status"]);
      return { available: true, ...JSON.parse(output.trim()), running: this.running() };
    } catch (error) {
      this.log(`Virtual camera status failed ${error}`);
      return { available: true, installed: false, running: this.running(), error: error.message };
    }
  }

  async install(name) {
    this.stop("install requested");
    await run(executablePath(this.app), ["install", filterPath(this.app), String(name || "Cam Player Camera")]);
    this.log(`Virtual camera installed name=${String(name || "Cam Player Camera")}`);
    return this.status();
  }

  async rename(name) {
    this.stop("rename requested");
    await run(executablePath(this.app), ["rename", String(name || "Cam Player Camera")]);
    this.log(`Virtual camera renamed name=${String(name || "Cam Player Camera")}`);
    return this.status();
  }

  async uninstall() {
    this.stop("uninstall requested");
    await run(executablePath(this.app), ["uninstall"]);
    this.log("Virtual camera uninstalled");
    return this.status();
  }

  start(orientation = "portrait") {
    if (this.running()) return true;
    if (!this.available()) throw new Error("Virtual camera components are not included in this build");
    const normalizedOrientation = normalizeOrientation(orientation);
    const child = spawn(executablePath(this.app), ["serve", normalizedOrientation], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    child.stdout.on("data", (data) => {
      for (let index = 0; index < data.length; index += 1) {
        const acknowledgement = this.pendingAcknowledgement;
        this.pendingAcknowledgement = null;
        acknowledgement?.resolve(true);
      }
    });
    child.stderr.on("data", (data) => this.log(`Virtual camera native ${String(data).trim()}`));
    child.on("exit", (code, signal) => {
      if (this.process === child) this.process = null;
      const acknowledgement = this.pendingAcknowledgement;
      this.pendingAcknowledgement = null;
      acknowledgement?.reject(new Error("Virtual camera frame process stopped"));
      this.log(`Virtual camera stopped code=${code ?? "none"} signal=${signal || "none"}`);
    });
    child.on("error", (error) => this.log(`Virtual camera process failed ${error}`));
    this.log(`Virtual camera started orientation=${normalizedOrientation}`);
    return true;
  }

  running() {
    return Boolean(this.process && !this.process.killed && this.process.exitCode == null);
  }

  stop(reason = "stopped") {
    const child = this.process;
    this.process = null;
    const acknowledgement = this.pendingAcknowledgement;
    this.pendingAcknowledgement = null;
    acknowledgement?.reject(new Error("Virtual camera stopped"));
    if (child && !child.killed) child.kill();
    if (child) this.log(`Virtual camera stop requested reason=${reason}`);
  }

  sendFrame(value) {
    if (!this.running()) return Promise.resolve(false);
    if (this.pendingAcknowledgement) return Promise.resolve(false);
    const pixels = Buffer.from(value?.pixels || []);
    const width = Number(value?.width) >>> 0;
    const height = Number(value?.height) >>> 0;
    const stride = width * 4;
    if (!width || !height || pixels.length !== stride * height) {
      return Promise.reject(new Error("Virtual camera frame has invalid dimensions"));
    }
    const header = Buffer.allocUnsafe(32);
    header.writeUInt32LE(PACKET_MAGIC, 0);
    header.writeUInt32LE(width, 4);
    header.writeUInt32LE(height, 8);
    header.writeUInt32LE(stride, 12);
    header.writeUInt32LE(Math.max(1000, Math.round(Number(value.fps) * 1000) || 30000), 16);
    header.writeUInt32LE(pixels.length, 20);
    header.writeBigUInt64LE(BigInt(Math.max(0, Math.round(Number(value.timestampUs) || 0))), 24);
    return new Promise((resolve, reject) => {
      this.pendingAcknowledgement = { resolve, reject };
      this.process.stdin.write(header, (headerError) => {
        if (headerError) {
          this.pendingAcknowledgement = null;
          reject(headerError);
          return;
        }
        this.process.stdin.write(pixels, (pixelsError) => {
          if (!pixelsError) return;
          this.pendingAcknowledgement = null;
          reject(pixelsError);
        });
      });
    });
  }
}

module.exports = { VirtualCameraManager, executablePath, filterPath, normalizeOrientation };
