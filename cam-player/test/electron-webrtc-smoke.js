"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const os = require("os");
const path = require("path");

app.setPath("userData", path.join(os.tmpdir(), `camexch-electron-smoke-${process.pid}`));
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("use-angle", "swiftshader");

const timeout = setTimeout(() => {
  process.stderr.write("Electron WebRTC smoke test timed out\n");
  app.exit(1);
}, 120_000);

ipcMain.once("smoke-result", (_event, result) => {
  clearTimeout(timeout);
  if (result?.ok) {
    process.stdout.write(`Electron WebRTC smoke OK ${JSON.stringify(result.cycles)}\n`);
    app.exit(0);
    return;
  }
  process.stderr.write(`Electron WebRTC smoke failed: ${result?.error || "unknown"}\n`);
  app.exit(1);
});
ipcMain.on("smoke-progress", (_event, message) => {
  process.stdout.write(`Electron WebRTC smoke: ${message}\n`);
});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: true,
    width: 800,
    height: 700,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: false,
      nodeIntegration: true,
    },
  });
  window.webContents.on("console-message", (_event, level, message) => {
    process.stdout.write(`Electron renderer console level=${level}: ${message}\n`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    clearTimeout(timeout);
    process.stderr.write(`Electron renderer exited: ${JSON.stringify(details)}\n`);
    app.exit(1);
  });
  await window.loadFile(path.join(__dirname, "electron-webrtc-smoke.html"));
});
