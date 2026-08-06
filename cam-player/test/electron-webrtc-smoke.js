"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
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
  const productionRenderer = fs.readFileSync(
    path.join(__dirname, "..", "renderer", "renderer.js"),
    "utf8",
  );
  const vertexSource = productionRenderer.match(/const vertexSource = `([\s\S]*?)`;/)?.[1];
  const fragmentSource = productionRenderer.match(/const fragmentSource = `([\s\S]*?)`;/)?.[1];
  if (!vertexSource || !fragmentSource) throw new Error("Production shaders were not found");
  await window.webContents.executeJavaScript(`(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) throw new Error("WebGL 2 is unavailable");
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
      }
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, ${JSON.stringify(vertexSource)}));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, ${JSON.stringify(fragmentSource)}));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    return true;
  })()`);
  process.stdout.write("Electron WebRTC smoke: production shaders compiled\n");
}).catch((error) => {
  clearTimeout(timeout);
  process.stderr.write(`Electron shader smoke failed: ${error.stack || error}\n`);
  app.exit(1);
});
