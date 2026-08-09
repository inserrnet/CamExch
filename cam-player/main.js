"use strict";

const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  shell,
} = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { Bonjour } = require("bonjour-service");
const { execFile, spawn } = require("child_process");
const ffmpegStaticPath = require("ffmpeg-static");
const { decodeQrImage } = require("./lib/qr-decoder");
const { cropForNormalized } = require("./lib/qr-selection");
const { validateProfile } = require("./lib/motion-profile");

app.commandLine.appendSwitch("disable-features", "WebRtcHideLocalIpsWithMdns");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const PORT = 8791;
const VERSION = app.getVersion();
const APP_SESSION_ID = crypto.randomUUID();
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_LOG_BYTES = 10 * 1024 * 1024;
let mainWindow;
let server;
let bonjour;
let publication;
let state = {
  outputWidth: 720,
  outputHeight: 1280,
  fps: 60,
  file: "",
  playing: false,
  peerCount: 0,
};
const pendingOffers = new Map();
const pendingConfigurations = new Map();
const interfaceDescriptions = new Map();
let pendingLogLines = [];
let logFlushTimer = null;
let activeQrScan = null;
let pendingMotionSample = null;
let motionDispatchScheduled = false;
let liveMotionRequested = false;
let motionCaptureRequested = false;
let sourceOwner = null;

function sourceDeviceId(request) {
  return String(request.headers["x-camexch-device"] || "").trim();
}

function requireSourceOwner(request, response) {
  const deviceId = sourceDeviceId(request);
  if (!deviceId || !sourceOwner || sourceOwner.deviceId !== deviceId) {
    sendJson(response, 409, { error: "Cam Player is owned by another Source; press Start to claim it" });
    return false;
  }
  sourceOwner.lastSeenAt = Date.now();
  return true;
}

function dispatchLatestMotionSample(sample) {
  pendingMotionSample = sample;
  if (motionDispatchScheduled) return;
  motionDispatchScheduled = true;
  setImmediate(() => {
    motionDispatchScheduled = false;
    const latest = pendingMotionSample;
    pendingMotionSample = null;
    if (latest && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("handheld-motion", latest);
    }
  });
}

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

function writeJsonAtomic(name, value) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  const destination = userFile(name);
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.rmSync(destination, { force: true });
  fs.renameSync(temporary, destination);
}

function motionProfiles() {
  const stored = readJson("motion-profiles.json", { version: 1, profiles: [] });
  const profiles = Array.isArray(stored?.profiles) ? stored.profiles : [];
  return profiles.filter(validateProfile);
}

function saveMotionProfiles(profiles) {
  writeJsonAtomic("motion-profiles.json", { version: 1, profiles });
}

function profileSummary(profile) {
  return {
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    durationMs: profile.durationMs,
    sampleRateHz: profile.sampleRateHz,
    motion: profile.motion,
    stabilization: profile.stabilization,
    sampleCount: profile.samples.length,
  };
}

function log(message) {
  const line = `${new Date().toISOString()} session=${APP_SESSION_ID} ${message}`;
  pendingLogLines.push(`${line}\n`);
  if (!logFlushTimer) logFlushTimer = setTimeout(flushLog, 100);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app-log", line);
  }
}

function flushLog(sync = false) {
  clearTimeout(logFlushTimer);
  logFlushTimer = null;
  if (!pendingLogLines.length) return;
  const payload = pendingLogLines.join("");
  pendingLogLines = [];
  const logPath = userFile("cam-player.log");
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > MAX_LOG_BYTES) {
      fs.rmSync(`${logPath}.1`, { force: true });
      fs.renameSync(logPath, `${logPath}.1`);
    }
    if (sync) {
      fs.appendFileSync(logPath, payload);
    } else {
      fs.appendFile(logPath, payload, () => {});
    }
  } catch (_) {
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
          virtual: /(virtualbox|vmware|hyper-v|host-only|vethernet|loopback)/i
            .test(`${name} ${description}`),
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

function probeVideoFrameRate(filePath) {
  if (!/\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(filePath)) {
    return Promise.resolve(0);
  }
  return new Promise((resolve) => {
    const child = spawn(executableFfmpegPath(), ["-hide_banner", "-i", filePath], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorText = "";
    child.stderr.on("data", (chunk) => {
      errorText = `${errorText}${chunk}`.slice(-32_000);
    });
    const finish = () => {
      const videoLine = errorText.split(/\r?\n/).find((line) => /Video:/i.test(line)) || "";
      const match = /(?:,|\s)(\d+(?:\.\d+)?)\s+fps(?:,|\s)/i.exec(videoLine);
      const fps = match ? Number(match[1]) : 0;
      const normalized = Number.isFinite(fps) && fps >= 1 && fps <= 240 ? fps : 0;
      log(`Media frame rate probe fps=${normalized || "unknown"} path=${filePath}`);
      resolve(normalized);
    };
    child.on("error", () => resolve(0));
    child.on("exit", finish);
  });
}

async function preparedMediaDescriptor(originalPath) {
  const playablePath = await prepareMedia(originalPath);
  const fps = await probeVideoFrameRate(playablePath);
  return {
    path: originalPath,
    playablePath,
    url: pathToFileURL(playablePath).href,
    fps,
  };
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

async function forwardOffer(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("Cam Player window is unavailable");
  }
  const id = crypto.randomUUID();
  for (const [pendingId, pending] of pendingOffers.entries()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(`Superseded by offer ${id}`));
    pendingOffers.delete(pendingId);
    mainWindow.webContents.send("webrtc-cancel", {
      id: pendingId,
      reason: `superseded by offer ${id}`,
    });
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingOffers.delete(id);
      reject(new Error("Cam Player WebRTC answer timed out"));
    }, 15000);
    pendingOffers.set(id, { resolve, reject, timeout });
    mainWindow.webContents.send("webrtc-offer", { id, ...payload });
  });
}

async function forwardConfiguration(config) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("Cam Player window is unavailable");
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingConfigurations.delete(id);
      reject(new Error("Cam Player configuration timed out"));
    }, 5000);
    pendingConfigurations.set(id, { resolve, reject, timeout });
    mainWindow.webContents.send("source-config", { id, config });
  });
}

async function handleRequest(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && requestUrl.pathname === "/status") {
      sendJson(response, 200, {
        name: "Cam Player",
        version: VERSION,
        addresses: localAddresses(),
        interfaces: localInterfaces(),
        port: PORT,
        ...state,
      });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/claim") {
      const body = await readBody(request);
      const deviceId = String(body.deviceId || sourceDeviceId(request)).trim();
      if (!deviceId) {
        sendJson(response, 400, { error: "Source device id is missing" });
        return;
      }
      const previous = sourceOwner?.deviceId || "";
      sourceOwner = {
        deviceId,
        deviceName: String(body.deviceName || "CamExch Source").slice(0, 120),
        claimedAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      if (previous && previous !== deviceId) {
        mainWindow?.webContents.send("source-close", {
          sessionId: "",
          reason: "Cam Player claimed by another Source",
        });
      }
      log(`Source ownership claimed device=${sourceOwner.deviceName} id=${deviceId} replaced=${previous || "none"}`);
      sendJson(response, 200, { ok: true, replaced: previous && previous !== deviceId });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/release") {
      const deviceId = sourceDeviceId(request);
      const released = Boolean(sourceOwner && sourceOwner.deviceId === deviceId);
      if (released) sourceOwner = null;
      log(`Source ownership release id=${deviceId || "missing"} released=${released}`);
      sendJson(response, 200, { ok: true, released });
      return;
    }
    if (!requireSourceOwner(request, response)) return;
    if (request.method === "GET" && requestUrl.pathname === "/motion-config") {
      sendJson(response, 200, {
        liveMotion: liveMotionRequested,
        captureMotion: motionCaptureRequested,
        streamMotion: liveMotionRequested || motionCaptureRequested,
        sampleIntervalMs: liveMotionRequested || motionCaptureRequested ? 33 : 500,
        tracking: "arcore",
      });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/motion-stream") {
      let buffer = "";
      let samples = 0;
      let discarded = 0;
      let latestSequence = -1;
      const startedAt = Date.now();
      let finished = false;
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.length > 64 * 1024) {
          request.destroy(new Error("Motion stream buffer exceeded"));
          return;
        }
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const sample = JSON.parse(line);
            if (!Array.isArray(sample.quaternion) || sample.quaternion.length < 4) continue;
            const sequence = Number(sample.sequence);
            if (Number.isFinite(sequence) && sequence <= latestSequence) {
              discarded += 1;
              continue;
            }
            if (Number.isFinite(sequence)) latestSequence = sequence;
            dispatchLatestMotionSample(sample);
            samples += 1;
          } catch (error) {
            log(`Motion sample rejected ${error.message}`);
          }
        }
      });
      const finish = () => {
        if (finished) return;
        finished = true;
        if (!response.writableEnded && !response.destroyed) {
          sendJson(response, 200, { ok: true });
        }
        const elapsed = Math.max(1, Date.now() - startedAt);
        log(`Motion stream closed samples=${samples} discarded=${discarded} `
          + `averageHz=${(samples * 1000 / elapsed).toFixed(1)}`);
      };
      request.once("end", finish);
      request.once("close", finish);
      request.once("error", finish);
      log("Motion stream connected");
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/offer") {
      const body = await readBody(request);
      if (!body.sdp || typeof body.sdp !== "string") {
        sendJson(response, 400, { error: "WebRTC offer is missing" });
        return;
      }
      log(`Offer received requestId=${body.requestId || "none"} `
        + `sessionId=${body.sessionId || "none"} bytes=${body.sdp.length} `
        + `orientation=${body.orientation || "unknown"} `
        + `preferredRoute=${body.preferredRoute || "automatic"} `
        + `strictRoute=${Boolean(body.preferredRoute)}`);
      const answer = await forwardOffer(body);
      sendJson(response, 200, { sdp: answer });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/close") {
      const body = await readBody(request);
      mainWindow?.webContents.send("source-close", {
        sessionId: String(body.sessionId || ""),
        reason: String(body.reason || "Source requested close"),
      });
      log(`Close received sessionId=${body.sessionId || "all"} `
        + `reason=${body.reason || "unspecified"}`);
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/configure") {
      const body = await readBody(request);
      const applied = await forwardConfiguration(body);
      log(`Configuration received orientation=${body.orientation || "unknown"} `
        + `preferredRoute=${body.preferredRoute || "unchanged"} `
        + `applied=${applied.width || 0}x${applied.height || 0}`);
      sendJson(response, 200, { ok: true, ...applied });
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

function settleQrScan(result) {
  const active = activeQrScan;
  if (!active) return;
  activeQrScan = null;
  if (active.window && !active.window.isDestroyed()) active.window.destroy();
  active.resolve(result);
}

async function beginQrScan() {
  if (activeQrScan) throw new Error("QR selection is already active");
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const captureWidth = Math.max(1, Math.round(display.size.width * display.scaleFactor));
  const captureHeight = Math.max(1, Math.round(display.size.height * display.scaleFactor));
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: captureWidth, height: captureHeight },
    fetchWindowIcons: false,
  });
  const displayId = String(display.id);
  const source = sources.find((candidate) => String(candidate.display_id) === displayId)
    || (sources.length === 1 ? sources[0] : null);
  if (!source || source.thumbnail.isEmpty()) {
    log(`QR capture failed display=${displayId} sources=${sources.length}`);
    throw new Error("Unable to capture the selected monitor");
  }

  const screenshot = source.thumbnail;
  const screenshotSize = screenshot.getSize();
  const overlay = new BrowserWindow({
    ...display.bounds,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "qr-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");

  return new Promise((resolve) => {
    activeQrScan = { window: overlay, screenshot, screenshotSize, resolve };
    overlay.on("closed", () => {
      if (activeQrScan?.window === overlay) settleQrScan({ status: "cancelled" });
    });
    overlay.webContents.once("did-finish-load", () => {
      if (!activeQrScan || overlay.isDestroyed()) return;
      overlay.webContents.send("qr-selection-initialize", {
        image: screenshot.toDataURL(),
      });
      overlay.show();
      overlay.focus();
      log(`QR selection started display=${displayId} capture=${screenshotSize.width}x${screenshotSize.height} scaleFactor=${display.scaleFactor}`);
    });
    overlay.loadFile(path.join(__dirname, "qr-overlay", "index.html"));
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
  return preparedMediaDescriptor(filePath);
});

ipcMain.handle("read-preferences", () => readJson("preferences.json", {}));
ipcMain.handle("list-motion-profiles", () => motionProfiles().map(profileSummary));
ipcMain.handle("read-motion-profile", (_event, id) => (
  motionProfiles().find((profile) => profile.id === String(id || "")) || null
));
ipcMain.handle("save-motion-profile", (_event, value) => {
  const profile = { ...(value || {}) };
  profile.id = String(profile.id || crypto.randomUUID());
  profile.name = String(profile.name || "Motion profile").trim().slice(0, 80) || "Motion profile";
  profile.createdAt = String(profile.createdAt || new Date().toISOString());
  profile.updatedAt = new Date().toISOString();
  if (!validateProfile(profile)) throw new Error("Motion profile is invalid");
  const profiles = motionProfiles();
  const existingIndex = profiles.findIndex((candidate) => candidate.id === profile.id);
  if (existingIndex >= 0) profiles[existingIndex] = profile;
  else profiles.push(profile);
  saveMotionProfiles(profiles);
  log(`Motion profile saved id=${profile.id} name=${profile.name} samples=${profile.samples.length} `
    + `durationMs=${profile.durationMs} rateHz=${profile.sampleRateHz}`);
  return profileSummary(profile);
});
ipcMain.handle("delete-motion-profile", (_event, id) => {
  const profileId = String(id || "");
  const profiles = motionProfiles();
  const remaining = profiles.filter((candidate) => candidate.id !== profileId);
  if (remaining.length === profiles.length) return false;
  saveMotionProfiles(remaining);
  log(`Motion profile deleted id=${profileId}`);
  return true;
});
ipcMain.handle("open-profiles-folder", async () => {
  const folder = app.getPath("userData");
  fs.mkdirSync(folder, { recursive: true });
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
  return folder;
});
ipcMain.handle("prepare-media", async (_event, filePath) => {
  const originalPath = String(filePath || "");
  if (!originalPath || !fs.existsSync(originalPath)) {
    throw new Error("Media file is unavailable");
  }
  return preparedMediaDescriptor(originalPath);
});
ipcMain.handle("get-server-info", () => serverInfo());
ipcMain.handle("set-live-motion-requested", (_event, enabled) => {
  const requested = Boolean(enabled);
  if (requested !== liveMotionRequested) {
    liveMotionRequested = requested;
    log(`Live motion request=${requested} tracking=arcore`);
  }
  return liveMotionRequested;
});
ipcMain.handle("set-motion-capture-requested", (_event, enabled) => {
  motionCaptureRequested = enabled === true;
  return motionCaptureRequested;
});
ipcMain.handle("get-memory-info", () => {
  const metrics = app.getAppMetrics();
  const totals = metrics.reduce((result, metric) => {
    const memory = metric.memory || {};
    result.workingSetKb += Number(memory.workingSetSize) || 0;
    result.privateKb += Number(memory.privateBytes) || 0;
    return result;
  }, { workingSetKb: 0, privateKb: 0 });
  return {
    workingSetMb: Math.round(totals.workingSetKb / 1024),
    privateMb: Math.round(totals.privateKb / 1024),
    processes: metrics.length,
  };
});
ipcMain.handle("write-preferences", (_event, value) => {
  writeJson("preferences.json", value || {});
  return true;
});
ipcMain.handle("read-log", () => {
  flushLog(true);
  try {
    return fs.readFileSync(userFile("cam-player.log"), "utf8");
  } catch (_) {
    return "";
  }
});
ipcMain.handle("read-log-tail", () => {
  flushLog(true);
  try {
    const content = fs.readFileSync(userFile("cam-player.log"), "utf8");
    return content.slice(-512 * 1024).split(/\r?\n/).slice(-250).join("\n");
  } catch (_) {
    return "";
  }
});
ipcMain.handle("clear-log", () => {
  pendingLogLines = [];
  clearTimeout(logFlushTimer);
  logFlushTimer = null;
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
ipcMain.handle("scan-qr", () => beginQrScan());
ipcMain.on("qr-selection-cancel", (event) => {
  if (!activeQrScan || event.sender !== activeQrScan.window.webContents) return;
  log("QR selection cancelled");
  settleQrScan({ status: "cancelled" });
});
ipcMain.on("qr-selection-complete", (event, selection) => {
  const active = activeQrScan;
  if (!active || event.sender !== active.window.webContents) return;
  active.window.hide();
  try {
    const crop = cropForNormalized(selection, active.screenshotSize);
    const image = active.screenshot.crop(crop);
    const result = decodeQrImage(image);
    if (!result) {
      log(`QR not found crop=${crop.width}x${crop.height}`);
      settleQrScan({ status: "not-found" });
      return;
    }
    clipboard.writeText(result);
    log(`QR copied characters=${result.length} type=${/^https?:\/\//i.test(result) ? "url" : "text"} preprocessing=adaptive`);
    settleQrScan({ status: "copied" });
  } catch (error) {
    log(`QR decode failed ${error.stack || error}`);
    settleQrScan({ status: "not-found" });
  }
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
ipcMain.on("source-config-applied", (_event, { id, ...result }) => {
  const pending = pendingConfigurations.get(id);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingConfigurations.delete(id);
  pending.resolve(result);
});

app.whenReady().then(() => {
  createWindow();
  createServer();
  log(`Application started version=${VERSION} pid=${process.pid} `
    + `electron=${process.versions.electron} chromium=${process.versions.chrome}`);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  liveMotionRequested = false;
  motionCaptureRequested = false;
  if (activeQrScan) settleQrScan({ status: "cancelled" });
  for (const pending of pendingOffers.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("Cam Player is closing"));
  }
  pendingOffers.clear();
  for (const pending of pendingConfigurations.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("Cam Player is closing"));
  }
  pendingConfigurations.clear();
  flushLog(true);
  try {
    publication?.stop();
    bonjour?.destroy();
    server?.close();
  } catch (_) {
  }
});
