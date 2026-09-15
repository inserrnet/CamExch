"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

function scriptPath(app) {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "native", "scripts")
    : path.join(__dirname, "..", "native", "scripts");
  return path.join(root, "emulator-camera-mode.ps1");
}

function runPowerShell(script, action) {
  return new Promise((resolve, reject) => {
    const resultPath = path.join(os.tmpdir(), `cam-player-emulator-mode-${process.pid}-${Date.now()}.json`);
    const args = [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", script, "-Action", action, "-ResultPath", resultPath,
    ];
    execFile("powershell.exe", args, { windowsHide: true, timeout: 120000 }, (error, stdout, stderr) => {
      let result;
      try {
        const text = fs.existsSync(resultPath) ? fs.readFileSync(resultPath, "utf8") : String(stdout || "");
        result = JSON.parse(text.trim());
      } catch (parseError) {
        fs.rmSync(resultPath, { force: true });
        reject(new Error(String(stderr || error?.message || parseError.message).trim()));
        return;
      }
      fs.rmSync(resultPath, { force: true });
      if (error && !result) {
        reject(new Error(String(stderr || error.message || error).trim()));
        return;
      }
      resolve(result);
    });
  });
}

class EmulatorCameraModeManager {
  constructor(app, logger = () => {}) {
    this.app = app;
    this.log = logger;
  }

  available() {
    return process.platform === "win32" && fs.existsSync(scriptPath(this.app));
  }

  async execute(action) {
    if (!this.available()) {
      return { available: false, state: "off", message: "Emulator camera mode is unavailable" };
    }
    try {
      const result = await runPowerShell(scriptPath(this.app), action);
      this.log(`Emulator camera mode action=${action} state=${result.state} message=${result.message || "none"}`);
      return { available: true, ...result };
    } catch (error) {
      this.log(`Emulator camera mode action=${action} failed ${error.stack || error}`);
      return { available: true, state: "incomplete", message: error.message || String(error), consumers: [] };
    }
  }

  status() {
    return this.execute("status");
  }

  activate() {
    return this.execute("preflight").then((result) => (
      result.state === "ready" ? this.execute("activate") : result
    ));
  }

  deactivate() {
    return this.execute("preflight-deactivate").then((result) => (
      result.state === "ready" ? this.execute("deactivate") : result
    ));
  }
}

module.exports = { EmulatorCameraModeManager, scriptPath };
