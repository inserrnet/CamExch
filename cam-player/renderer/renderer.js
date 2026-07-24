"use strict";

const canvas = document.getElementById("outputCanvas");
const preview = document.getElementById("preview");
const emptyState = document.getElementById("emptyState");
const video = document.getElementById("videoSource");
const image = document.getElementById("imageSource");
const widthInput = document.getElementById("widthInput");
const heightInput = document.getElementById("heightInput");
const fpsInput = document.getElementById("fpsInput");
const blurInput = document.getElementById("blurInput");
const followSiteToggle = document.getElementById("followSiteToggle");
const timeline = document.getElementById("timeline");
const timeLabel = document.getElementById("timeLabel");
const recentFiles = document.getElementById("recentFiles");
const logOutput = document.getElementById("logOutput");
const connectionStatus = document.getElementById("connectionStatus");

const gl = canvas.getContext("webgl2", {
  alpha: false,
  antialias: false,
  desynchronized: true,
  preserveDrawingBuffer: false,
});
if (!gl) throw new Error("WebGL 2 is required");

const vertexSource = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform vec2 u_output;
uniform vec2 u_source;
uniform float u_scale;
uniform vec2 u_pan;
uniform float u_blur;
uniform int u_rotation;
in vec2 v_uv;
out vec4 outColor;

vec2 rotateUv(vec2 uv) {
  if (u_rotation == 1) return vec2(uv.y, 1.0 - uv.x);
  if (u_rotation == 2) return vec2(1.0 - uv.x, 1.0 - uv.y);
  if (u_rotation == 3) return vec2(1.0 - uv.y, uv.x);
  return uv;
}

vec4 sampleSource(vec2 uv) {
  return texture(u_texture, rotateUv(vec2(uv.x, 1.0 - uv.y)));
}

vec2 coverUv(vec2 pixel) {
  float cover = max(u_output.x / u_source.x, u_output.y / u_source.y);
  vec2 displayed = u_source * cover;
  return (pixel - (u_output - displayed) * 0.5) / displayed;
}

vec4 blurredBackground(vec2 uv) {
  vec2 stepSize = vec2(u_blur) / max(u_source, vec2(1.0));
  vec4 color = sampleSource(uv) * 0.20;
  color += sampleSource(uv + vec2(stepSize.x, 0.0)) * 0.12;
  color += sampleSource(uv - vec2(stepSize.x, 0.0)) * 0.12;
  color += sampleSource(uv + vec2(0.0, stepSize.y)) * 0.12;
  color += sampleSource(uv - vec2(0.0, stepSize.y)) * 0.12;
  color += sampleSource(uv + stepSize) * 0.08;
  color += sampleSource(uv - stepSize) * 0.08;
  color += sampleSource(uv + vec2(stepSize.x, -stepSize.y)) * 0.08;
  color += sampleSource(uv + vec2(-stepSize.x, stepSize.y)) * 0.08;
  return color;
}

void main() {
  vec2 pixel = v_uv * u_output;
  vec2 bgUv = clamp(coverUv(pixel), vec2(0.0), vec2(1.0));
  vec4 background = blurredBackground(bgUv);
  float fit = min(u_output.x / u_source.x, u_output.y / u_source.y);
  vec2 displayed = u_source * fit * u_scale;
  vec2 center = u_output * 0.5 + u_pan;
  vec2 fgUv = (pixel - (center - displayed * 0.5)) / displayed;
  bool inside = fgUv.x >= 0.0 && fgUv.x <= 1.0 && fgUv.y >= 0.0 && fgUv.y <= 1.0;
  outColor = inside ? sampleSource(fgUv) : background;
}`;

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

const program = gl.createProgram();
gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexSource));
gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentSource));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(program));
}
gl.useProgram(program);

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
const positionLocation = gl.getAttribLocation(program, "a_position");
gl.enableVertexAttribArray(positionLocation);
gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

const uniforms = {
  output: gl.getUniformLocation(program, "u_output"),
  source: gl.getUniformLocation(program, "u_source"),
  scale: gl.getUniformLocation(program, "u_scale"),
  pan: gl.getUniformLocation(program, "u_pan"),
  blur: gl.getUniformLocation(program, "u_blur"),
  rotation: gl.getUniformLocation(program, "u_rotation"),
};

let sourceElement = null;
let sourceWidth = 0;
let sourceHeight = 0;
let sourceKind = "";
let sourceRotation = 0;
let currentFile = null;
let playing = false;
let previewZoom = 1;
let previewPanX = 0;
let previewPanY = 0;
let spacePressed = false;
let dragMode = "";
let dragX = 0;
let dragY = 0;
let lastRenderAt = 0;
let renderTimer = null;
let stream = null;
let canvasTrack = null;
let peers = new Map();
let recent = [];
let currentServerInfo = null;
let transforms = {
  portrait: { scale: 1, panX: 0, panY: 0 },
  landscape: { scale: 1, panX: 0, panY: 0 },
};

function log(message) {
  window.camPlayer.log(message);
}

function appendLog(line) {
  const lines = `${logOutput.textContent}${line}\n`.split("\n");
  logOutput.textContent = lines.slice(-250).join("\n");
  logOutput.scrollTop = logOutput.scrollHeight;
}

function orientationForSize(width = canvas.width, height = canvas.height) {
  return height >= width ? "portrait" : "landscape";
}

function transform() {
  return transforms[orientationForSize()];
}

function sourceDimensions() {
  return sourceRotation % 2 === 0
    ? { width: sourceWidth, height: sourceHeight }
    : { width: sourceHeight, height: sourceWidth };
}

function maxTextureSize() {
  return gl.getParameter(gl.MAX_TEXTURE_SIZE);
}

function updateOutputLabel() {
  document.getElementById("outputValue").textContent =
    `${canvas.width}\u00d7${canvas.height} @ ${fpsInput.value}`;
  window.camPlayer.updateState({
    outputWidth: canvas.width,
    outputHeight: canvas.height,
    fps: Number(fpsInput.value),
    file: currentFile?.path || "",
    playing,
    peerCount: peers.size,
  });
}

function applyPreviewTransform() {
  const availableWidth = preview.clientWidth;
  const availableHeight = preview.clientHeight;
  const fit = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
  const scale = Math.max(0.0001, fit * previewZoom);
  canvas.style.transform =
    `translate(calc(-50% + ${previewPanX}px), calc(-50% + ${previewPanY}px)) scale(${scale})`;
}

function showFullFrame() {
  previewZoom = 1;
  previewPanX = 0;
  previewPanY = 0;
  applyPreviewTransform();
}

function applyOutputSize(width, height, reason) {
  const w = CamGeometry.positiveInteger(width, "Width");
  const h = CamGeometry.positiveInteger(height, "Height");
  const maximum = maxTextureSize();
  if (w > maximum || h > maximum) {
    throw new Error(`Requested ${w}\u00d7${h} exceeds GPU texture limit ${maximum}`);
  }
  canvas.width = w;
  canvas.height = h;
  widthInput.value = String(w);
  heightInput.value = String(h);
  gl.viewport(0, 0, w, h);
  showFullFrame();
  updateOutputLabel();
  log(`Output size=${w}x${h} reason=${reason}`);
  renderFrame(true);
  savePreferences();
}

function uploadSource() {
  if (!sourceElement || !sourceWidth || !sourceHeight) return false;
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceElement);
    return true;
  } catch (error) {
    log(`Texture upload failed ${error}`);
    return false;
  }
}

function renderFrame(force) {
  if (!sourceElement || !uploadSource()) return;
  const now = performance.now();
  const fps = Math.max(1, Math.min(60, Number(fpsInput.value) || 30));
  const activeFps = playing ? fps : Math.min(10, fps);
  if (!force && now - lastRenderAt < 1000 / activeFps) return;
  lastRenderAt = now;
  const size = sourceDimensions();
  const t = transform();
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(program);
  gl.uniform2f(uniforms.output, canvas.width, canvas.height);
  gl.uniform2f(uniforms.source, size.width, size.height);
  gl.uniform1f(uniforms.scale, t.scale);
  gl.uniform2f(uniforms.pan, t.panX, t.panY);
  gl.uniform1f(uniforms.blur, Number(blurInput.value));
  gl.uniform1i(uniforms.rotation, sourceRotation);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  if (canvasTrack && typeof canvasTrack.requestFrame === "function") {
    canvasTrack.requestFrame();
  }
}

function scheduleRenderLoop() {
  clearInterval(renderTimer);
  renderTimer = setInterval(() => {
    renderFrame(false);
    updateTimeline();
  }, 16);
}

function ensureStream() {
  if (stream) return stream;
  const captureFps = Math.max(1, Math.min(60, Number(fpsInput.value) || 30));
  stream = canvas.captureStream(captureFps);
  canvasTrack = stream.getVideoTracks()[0];
  canvasTrack.contentHint = "detail";
  return stream;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "00:00";
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function updateTimeline() {
  if (sourceKind !== "video" || !Number.isFinite(video.duration) || video.duration <= 0) {
    timeline.value = "0";
    timeLabel.textContent = "00:00 / 00:00";
    return;
  }
  if (!timeline.matches(":active")) {
    timeline.value = String(Math.round((video.currentTime / video.duration) * 1000));
  }
  timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
}

function updateRecent(file) {
  recent = [file, ...recent.filter((item) => item.path !== file.path)].slice(0, 12);
  renderRecent();
  savePreferences();
}

function renderRecent() {
  recentFiles.replaceChildren(new Option("Recent files", ""));
  for (const item of recent) {
    recentFiles.add(new Option(item.path.split(/[\\/]/).pop(), item.path));
  }
}

function isImagePath(filePath) {
  return /\.(jpe?g|png|bmp|webp)$/i.test(filePath);
}

async function loadMedia(file) {
  if (!file?.path || !file?.url) return;
  try {
    video.pause();
    playing = false;
    currentFile = file;
    if (isImagePath(file.path)) {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Unable to load image"));
        image.src = file.url;
      });
      sourceElement = image;
      sourceWidth = image.naturalWidth;
      sourceHeight = image.naturalHeight;
      sourceKind = "photo";
    } else {
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(new Error(video.error?.message || "Unable to load video"));
        video.src = file.url;
        video.load();
      });
      video.currentTime = 0;
      video.loop = document.getElementById("loopToggle").checked;
      sourceElement = video;
      sourceWidth = video.videoWidth;
      sourceHeight = video.videoHeight;
      sourceKind = "video";
    }
    sourceRotation = 0;
    transforms = {
      portrait: { scale: 1, panX: 0, panY: 0 },
      landscape: { scale: 1, panX: 0, panY: 0 },
    };
    emptyState.hidden = true;
    updateRecent(file);
    updateOutputLabel();
    renderFrame(true);
    log(`Media loaded kind=${sourceKind} size=${sourceWidth}x${sourceHeight} path=${file.path}`);
  } catch (error) {
    log(`Media load failed ${error.stack || error}`);
    alert(error.message || String(error));
  }
}

async function play() {
  if (sourceKind !== "video") return;
  try {
    await video.play();
    playing = true;
    updateOutputLabel();
    log("Playback started");
  } catch (error) {
    log(`Playback failed ${error}`);
  }
}

function pause() {
  if (sourceKind !== "video") return;
  video.pause();
  playing = false;
  updateOutputLabel();
  renderFrame(true);
  log(`Playback paused positionMs=${Math.round(video.currentTime * 1000)}`);
}

function savePreferences() {
  window.camPlayer.writePreferences({
    width: canvas.width,
    height: canvas.height,
    fps: Number(fpsInput.value),
    blur: Number(blurInput.value),
    followSite: followSiteToggle.checked,
    loop: document.getElementById("loopToggle").checked,
    recent,
  });
}

async function handleOffer(payload) {
  const { id, sdp, constraints, orientation } = payload;
  try {
    applySiteConfiguration({ constraints, orientation }, "offer");
    const pc = new RTCPeerConnection({ iceServers: [] });
    peers.set(id, pc);
    updateConnectionState();
    let disconnectTimer = null;
    pc.onconnectionstatechange = () => {
      log(`Peer id=${id} state=${pc.connectionState}`);
      if (pc.connectionState === "disconnected") {
        clearTimeout(disconnectTimer);
        disconnectTimer = setTimeout(() => {
          if (pc.connectionState === "disconnected") {
            peers.delete(id);
            pc.close();
            updateConnectionState();
          }
        }, 5000);
      } else {
        clearTimeout(disconnectTimer);
      }
      if (["closed", "failed"].includes(pc.connectionState)) {
        peers.delete(id);
        try {
          pc.close();
        } catch (_) {
        }
        updateConnectionState();
      }
    };
    await pc.setRemoteDescription({ type: "offer", sdp });
    const localStream = ensureStream();
    const sender = pc.addTrack(localStream.getVideoTracks()[0], localStream);
    const transceiver = pc.getTransceivers().find((item) => item.sender === sender);
    const capabilities = RTCRtpSender.getCapabilities?.("video");
    const h264 = capabilities?.codecs?.filter(
      (codec) => String(codec.mimeType).toLowerCase() === "video/h264",
    ) || [];
    if (transceiver && h264.length && transceiver.setCodecPreferences) {
      transceiver.setCodecPreferences(h264);
    }
    try {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) parameters.encodings = [{}];
      parameters.encodings[0].scaleResolutionDownBy = 1;
      parameters.encodings[0].maxFramerate = Math.max(
        1,
        Math.min(60, Number(fpsInput.value) || 30),
      );
      parameters.degradationPreference = "maintain-resolution";
      await sender.setParameters(parameters);
    } catch (error) {
      log(`Sender quality lock unavailable ${error}`);
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIce(pc, 3500);
    log(`Answer ready id=${id} bytes=${pc.localDescription.sdp.length} h264Variants=${h264.length}`);
    window.camPlayer.answerOffer({ id, sdp: pc.localDescription.sdp });
    renderFrame(true);
    const statsTimer = setInterval(async () => {
      if (pc.connectionState === "closed") {
        clearInterval(statsTimer);
        return;
      }
      try {
        const report = await pc.getStats();
        report.forEach((entry) => {
          if (entry.type !== "outbound-rtp" || (entry.kind || entry.mediaType) !== "video") return;
          const codec = entry.codecId ? report.get(entry.codecId) : null;
          log(`WebRTC outbound id=${id} codec=${codec?.mimeType || "unknown"} `
            + `size=${entry.frameWidth || 0}x${entry.frameHeight || 0} `
            + `fps=${entry.framesPerSecond || 0} encoded=${entry.framesEncoded || 0} `
            + `bytes=${entry.bytesSent || 0} quality=${entry.qualityLimitationReason || "none"}`);
        });
      } catch (error) {
        log(`WebRTC stats failed id=${id} ${error}`);
      }
    }, 5000);
  } catch (error) {
    peers.get(id)?.close();
    peers.delete(id);
    updateConnectionState();
    log(`Offer failed id=${id} ${error.stack || error}`);
    window.camPlayer.answerOffer({ id, error: error.message || String(error) });
  }
}

function waitForIce(pc, timeoutMs) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", changed);
      resolve();
    }
    function changed() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", changed);
  });
}

function applySiteConfiguration(config, reason) {
  if (!followSiteToggle.checked || !config) return;
  const fallback = { width: canvas.width, height: canvas.height };
  const resolved = CamGeometry.resolveRequestedSize(
    config.constraints,
    config.orientation,
    fallback,
  );
  if (!resolved.applied) {
    log(`Site size unchanged reason=${resolved.reason}`);
    return;
  }
  applyOutputSize(resolved.width, resolved.height, `site ${reason} ${resolved.reason}`);
}

function updateConnectionState() {
  const count = peers.size;
  connectionStatus.textContent = count
    ? "Browser connected"
    : currentServerInfo?.pairedDevices?.length
      ? "Source paired; waiting for Browser"
      : "Waiting for Source pairing";
  connectionStatus.classList.toggle("connected", count > 0);
  document.getElementById("peerValue").textContent = String(count);
  updateOutputLabel();
}

function clientToOutput(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

preview.addEventListener("wheel", (event) => {
  event.preventDefault();
  const factor = Math.exp(-event.deltaY * 0.0015);
  if (spacePressed) {
    previewZoom = Math.max(0.05, Math.min(40, previewZoom * factor));
    applyPreviewTransform();
    return;
  }
  if (!sourceElement) return;
  const point = clientToOutput(event);
  const t = transform();
  const centerX = canvas.width / 2 + t.panX;
  const centerY = canvas.height / 2 + t.panY;
  const nextScale = Math.max(0.05, Math.min(20, t.scale * factor));
  const ratio = nextScale / t.scale;
  t.panX = point.x - canvas.width / 2 - (point.x - centerX) * ratio;
  t.panY = point.y - canvas.height / 2 - (point.y - centerY) * ratio;
  t.scale = nextScale;
  renderFrame(true);
  savePreferences();
}, { passive: false });

preview.addEventListener("pointerdown", (event) => {
  dragMode = spacePressed ? "preview" : "source";
  dragX = event.clientX;
  dragY = event.clientY;
  preview.setPointerCapture(event.pointerId);
});

preview.addEventListener("pointermove", (event) => {
  if (!dragMode) return;
  const dx = event.clientX - dragX;
  const dy = event.clientY - dragY;
  dragX = event.clientX;
  dragY = event.clientY;
  if (dragMode === "preview") {
    previewPanX += dx;
    previewPanY += dy;
    applyPreviewTransform();
  } else if (sourceElement) {
    const rect = canvas.getBoundingClientRect();
    const t = transform();
    t.panX += (dx / rect.width) * canvas.width;
    t.panY += (dy / rect.height) * canvas.height;
    renderFrame(true);
  }
});

preview.addEventListener("pointerup", () => {
  dragMode = "";
  savePreferences();
});
preview.addEventListener("pointercancel", () => {
  dragMode = "";
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !event.repeat) {
    spacePressed = true;
    preview.style.cursor = "grab";
  }
});
window.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    spacePressed = false;
    preview.style.cursor = "";
  }
});
window.addEventListener("blur", () => {
  spacePressed = false;
  dragMode = "";
});
window.addEventListener("resize", applyPreviewTransform);

document.getElementById("openButton").addEventListener("click", async () => {
  const file = await window.camPlayer.openMedia();
  if (file) loadMedia(file);
});
document.getElementById("playButton").addEventListener("click", play);
document.getElementById("pauseButton").addEventListener("click", pause);
document.getElementById("applySizeButton").addEventListener("click", () => {
  try {
    applyOutputSize(widthInput.value, heightInput.value, "manual");
  } catch (error) {
    alert(error.message || String(error));
  }
});
document.getElementById("resetSourceButton").addEventListener("click", () => {
  transforms[orientationForSize()] = { scale: 1, panX: 0, panY: 0 };
  renderFrame(true);
  savePreferences();
});
document.getElementById("fitPreviewButton").addEventListener("click", showFullFrame);
document.getElementById("rotateButton").addEventListener("click", () => {
  sourceRotation = (sourceRotation + 1) % 4;
  renderFrame(true);
  savePreferences();
});
document.getElementById("loopToggle").addEventListener("change", (event) => {
  video.loop = event.target.checked;
  savePreferences();
});
timeline.addEventListener("input", () => {
  if (sourceKind === "video" && Number.isFinite(video.duration)) {
    video.currentTime = (Number(timeline.value) / 1000) * video.duration;
    renderFrame(true);
  }
});
recentFiles.addEventListener("change", () => {
  const selected = recent.find((item) => item.path === recentFiles.value);
  if (selected) {
    window.camPlayer.prepareMedia(selected.path)
      .then(loadMedia)
      .catch((error) => {
        log(`Recent media unavailable ${error}`);
        alert(error.message || String(error));
      });
  }
  recentFiles.value = "";
});
for (const input of [fpsInput, blurInput, followSiteToggle]) {
  input.addEventListener("change", () => {
    if (input === fpsInput && peers.size === 0 && stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
      canvasTrack = null;
    }
    updateOutputLabel();
    renderFrame(true);
    savePreferences();
  });
}
document.getElementById("copyLogButton").addEventListener("click", async () => {
  await window.camPlayer.copyText(await window.camPlayer.readLog());
});
document.getElementById("clearLogButton").addEventListener("click", async () => {
  await window.camPlayer.clearLog();
  logOutput.textContent = "";
});

window.camPlayer.onOffer(handleOffer);
window.camPlayer.onConfig((config) => applySiteConfiguration(config, "orientation"));
function applyServerInfo(info) {
  currentServerInfo = info;
  const address = info.addresses?.length
    ? info.addresses.map((value) => `${value}:${info.port}`).join(", ")
    : `port ${info.port}`;
  document.getElementById("addressValue").textContent = address;
  document.getElementById("pairingCodeValue").textContent = info.pairingCode;
  updateConnectionState();
}
window.camPlayer.onServerInfo(applyServerInfo);
window.camPlayer.onLog(appendLog);

async function initialize() {
  const preferences = await window.camPlayer.readPreferences();
  applyServerInfo(await window.camPlayer.getServerInfo());
  recent = Array.isArray(preferences.recent) ? preferences.recent : [];
  renderRecent();
  fpsInput.value = String(preferences.fps || 30);
  blurInput.value = String(preferences.blur ?? 16);
  followSiteToggle.checked = !!preferences.followSite;
  document.getElementById("loopToggle").checked = preferences.loop !== false;
  try {
    applyOutputSize(preferences.width || 720, preferences.height || 1280, "startup");
  } catch (error) {
    applyOutputSize(720, 1280, "startup fallback");
    log(`Stored output size rejected ${error}`);
  }
  scheduleRenderLoop();
  applyPreviewTransform();
  logOutput.textContent = await window.camPlayer.readLog();
  updateConnectionState();
}

initialize();
