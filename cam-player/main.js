"use strict";

const { app, BrowserWindow, clipboard, dialog, ipcMain } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { Bonjour } = require("bonjour-service");
const { execFile, spawn } = require("child_process");
const ffmpegStaticPath = require("ffmpeg-static");

app.commandLine.appendSwitch("disable-features", "WebRtcHideLocalIpsWithMdns");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const PORT = 8791;
const VERSION = "0.2.3";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
let mainWindow;
let server;
let bonjour;
let publication;
let pairingCode = String(crypto.randomInt(100000, 1000000));
let state = {
  outputWidth: 720,
  outputHeight: 1280,
  fps: 30,
  file: "",
  playing: false,
  peerCount: 0,
};
const pendingOffers = new Map();
const interfaceDescriptions = new Map();

function userFile(name) {
  return path.join(app.getPath("userData"), name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(userFile(name), "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(name, value) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(userFile(name), JSON.stringify(value, null, 2));
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  try {
    fs.appendFileSync(userFile("cam-player.log"), `${line}\n`);
  } catch (_) {
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app-log", line);
  }
}

function routeType(name, description = "") {
  const identity = `${name} ${description}`;
  if (/(rndis|usb|mobile|tether)/i.test(identity)) return "USB";
  if (/(wi-?fi|wireless|wlan)/i.test(identity)) return "Wi-Fi";
  return "Ethernet";
}

function localInterfaces() {
  const interfaces = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        const description = interfaceDescriptions.get(name) || "";
        interfaces.push({
          name,
          description,
          address: entry.address,
          route: routeType(name, description),
        });
      }
    }
  }
  return interfaces;
}

function localAddresses() {
  return localInterfaces().map((entry) => entry.address);
}

function refreshNetworkInterfaceDescriptions() {
  if (process.platform !== "win32") return;
  execFile(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-NetAdapter | Select-Object Name,InterfaceDescription | ConvertTo-Json -Compress",
    ],
    { windowsHide: true, timeout: 5000 },
    (error, stdout) => {
      if (error) {
        log(`Network adapter descriptions unavailable ${error.message}`);
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        for (const adapter of Array.isArray(parsed) ? parsed : [parsed]) {
          interfaceDescriptions.set(adapter.Name, adapter.InterfaceDescription || "");
        }
        log(`Network adapters classified interfaces=${localInterfaces()
          .map((entry) => `${entry.route}:${entry.name}:${entry.address}`)
          .join(",")}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("server-info", serverInfo());
        }
      } catch (parseError) {
        log(`Network adapter descriptions invalid ${parseError.message}`);
      }
    },
  );
}

function executableFfmpegPath() {
  return ffmpegStaticPath.replace("app.asar", "app.asar.unpacked");
}

function mediaCachePath(filePath) {
  const stat = fs.statSync(filePath);
  const key = crypto.createHash("sha256")
    .update(`${filePath}|${stat.size}|${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 24);
  const directory = path.join(app.getPath("userData"), "media-cache");
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, `${key}.mp4`);
}

function runFfmpeg(args, label) {
  return new Promise((resolve, reject) => {
    log(`FFmpeg ${label} started`);
    const child = spawn(executableFfmpegPath(), args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorText = "";
    child.stderr.on("data", (chunk) => {
      errorText = `${errorText}${chunk}`.slice(-16_000);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        log(`FFmpeg ${label} completed`);
        resolve();
      } else {
        reject(new Error(`FFmpeg ${label} failed code=${code}: ${errorText.slice(-1500)}`));
      }
    });
  });
}

async function prepareMedia(filePath) {
  if (/\.(jpe?g|png|bmp|webp|mp4|m4v|mov|webm)$/i.test(filePath)) {
    return filePath;
  }
  const output = mediaCachePath(filePath);
  if (fs.existsSync(output) && fs.statSync(output).size > 0) {
    log(`Using cached compatible media path=${output}`);
    return output;
  }
  const temporary = `${output}.tmp.mp4`;
  try {
    await runFfmpeg([
      "-hide_banner", "-loglevel", "warning", "-y", "-i", filePath,
      "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy",
      "-movflags", "+faststart", temporary,
    ], "remux");
  } catch (remuxError) {
    log(`FFmpeg remux unavailable; using compatibility transcode reason=${remuxError.message}`);
    try {
      fs.rmSync(temporary, { force: true });
    } catch (_) {
    }
    await runFfmpeg([
      "-hide_banner", "-loglevel", "warning", "-y", "-i", filePath,
      "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264",
      "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", temporary,
    ], "compatibility transcode");
  }
  fs.renameSync(temporary, output);
  return output;
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on("data", (chunk) => {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });
    request.on("error", reject);
  });
}

function bearerToken(request) {
  const value = request.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function pairedTokens() {
  return readJson("paired-devices.json", {});
}

function tokenIsValid(token) {
  if (!token) return false;
  return Object.values(pairedTokens()).some((entry) => entry.token === token);
}

async function forwardOffer(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("Cam Player window is unavailable");
  }
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingOffers.delete(id);
      reject(new Error("Cam Player WebRTC answer timed out"));
    }, 15000);
    pendingOffers.set(id, { resolve, reject, timeout });
    mainWindow.webContents.send("webrtc-offer", { id, ...payload });
  });
}

async function handleRequest(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && requestUrl.pathname === "/status") {
      sendJson(response, 200, {
        name: "Cam Player",
        version: VERSION,
        pairingRequired: true,
        addresses: localAddresses(),
        interfaces: localInterfaces(),
        port: PORT,
        ...state,
      });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/pair") {
      const body = await readBody(request);
      if (String(body.code || "") !== pairingCode) {
        sendJson(response, 403, { error: "Invalid pairing code" });
        return;
      }
      const device = String(body.device || "CamExch Source").slice(0, 120);
      const token = crypto.randomBytes(32).toString("hex");
      const devices = pairedTokens();
      devices[device] = { token, pairedAt: new Date().toISOString() };
      writeJson("paired-devices.json", devices);
      pairingCode = String(crypto.randomInt(100000, 1000000));
      log(`Paired device=${device}`);
      sendJson(response, 200, { token });
      mainWindow?.webContents.send("server-info", serverInfo());
      return;
    }
    if (!tokenIsValid(bearerToken(request))) {
      sendJson(response, 401, { error: "Cam Player pairing is required" });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/offer") {
      const body = await readBody(request);
      if (!body.sdp || typeof body.sdp !== "string") {
        sendJson(response, 400, { error: "WebRTC offer is missing" });
        return;
      }
      log(`Offer received bytes=${body.sdp.length} orientation=${body.orientation || "unknown"}`);
      const answer = await forwardOffer(body);
      sendJson(response, 200, { sdp: answer });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/configure") {
      const body = await readBody(request);
      mainWindow?.webContents.send("source-config", body);
      log(`Configuration received orientation=${body.orientation || "unknown"}`);
      sendJson(response, 200, { ok: true });
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    log(`HTTP error ${error.stack || error}`);
    if (!response.headersSent) {
      sendJson(response, 500, { error: error.message || String(error) });
    } else {
      response.end();
    }
  }
}

function serverInfo() {
  return {
    port: PORT,
    addresses: localAddresses(),
    interfaces: localInterfaces(),
    pairingCode,
    pairedDevices: Object.keys(pairedTokens()),
  };
}

function createServer() {
  refreshNetworkInterfaceDescriptions();
  server = http.createServer((request, response) => {
    handleRequest(request, response);
  });
  server.listen(PORT, "0.0.0.0", () => {
    log(`LAN server listening port=${PORT} interfaces=${localInterfaces()
      .map((entry) => `${entry.route}:${entry.name}:${entry.address}`)
      .join(",")}`);
    mainWindow?.webContents.send("server-info", serverInfo());
  });
  server.on("error", (error) => log(`LAN server failed ${error.stack || error}`));

  bonjour = new Bonjour();
  publication = bonjour.publish({
    name: `Cam Player ${os.hostname()}`,
    type: "camexch",
    protocol: "tcp",
    port: PORT,
    txt: { version: VERSION },
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: "#17191c",
    title: "Cam Player",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      log(`Renderer console level=${level} line=${line} source=${sourceId} message=${message}`);
    }
  });
  mainWindow.webContents.on("unresponsive", () => log("Renderer became unresponsive"));
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log(`Renderer exited reason=${details.reason} code=${details.exitCode}`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    log(`Renderer load failed code=${code} description=${description} url=${url}`);
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow.webContents.send("server-info", serverInfo());
  });
}

ipcMain.handle("open-media", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      {
        name: "Media",
        extensions: ["mp4", "mkv", "mov", "avi", "webm", "m4v", "jpg", "jpeg", "png", "bmp", "webp"],
      },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const playablePath = await prepareMedia(filePath);
  return {
    path: filePath,
    playablePath,
    url: pathToFileURL(playablePath).href,
  };
});

ipcMain.handle("read-preferences", () => readJson("preferences.json", {}));
ipcMain.handle("prepare-media", async (_event, filePath) => {
  const originalPath = String(filePath || "");
  if (!originalPath || !fs.existsSync(originalPath)) {
    throw new Error("Media file is unavailable");
  }
  const playablePath = await prepareMedia(originalPath);
  return {
    path: originalPath,
    playablePath,
    url: pathToFileURL(playablePath).href,
  };
});
ipcMain.handle("get-server-info", () => serverInfo());
ipcMain.handle("write-preferences", (_event, value) => {
  writeJson("preferences.json", value || {});
  return true;
});
ipcMain.handle("read-log", () => {
  try {
    return fs.readFileSync(userFile("cam-player.log"), "utf8");
  } catch (_) {
    return "";
  }
});
ipcMain.handle("clear-log", () => {
  try {
    fs.writeFileSync(userFile("cam-player.log"), "");
  } catch (_) {
  }
  return true;
});
ipcMain.handle("copy-text", (_event, value) => {
  clipboard.writeText(String(value || ""));
  return true;
});
ipcMain.on("renderer-log", (_event, message) => log(`Renderer ${message}`));
ipcMain.on("player-state", (_event, value) => {
  state = { ...state, ...(value || {}) };
});
ipcMain.on("webrtc-answer", (_event, { id, sdp, error }) => {
  const pending = pendingOffers.get(id);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingOffers.delete(id);
  if (error) pending.reject(new Error(error));
  else pending.resolve(sdp);
});

app.whenReady().then(() => {
  createWindow();
  createServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  for (const pending of pendingOffers.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("Cam Player is closing"));
  }
  pendingOffers.clear();
  try {
    publication?.stop();
    bonjour?.destroy();
    server?.close();
  } catch (_) {
  }
});
