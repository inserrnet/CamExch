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
const fallbackResolutionToggle = document.getElementById("fallbackResolutionToggle");
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
uniform sampler2D u_background;
uniform vec2 u_output;
uniform vec2 u_source;
uniform float u_scale;
uniform vec2 u_pan;
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

void main() {
  vec2 pixel = v_uv * u_output;
  vec4 background = texture(u_background, v_uv);
  float fit = min(u_output.x / u_source.x, u_output.y / u_source.y);
  vec2 displayed = u_source * fit * u_scale;
  vec2 center = u_output * 0.5 + u_pan;
  vec2 fgUv = (pixel - (center - displayed * 0.5)) / displayed;
  bool inside = fgUv.x >= 0.0 && fgUv.x <= 1.0 && fgUv.y >= 0.0 && fgUv.y <= 1.0;
  outColor = inside ? sampleSource(fgUv) : background;
}`;

const blurFragmentSource = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform vec2 u_direction;
uniform vec2 u_output;
uniform vec2 u_source;
uniform float u_radius;
uniform int u_source_pass;
uniform int u_rotation;
in vec2 v_uv;
out vec4 outColor;

vec2 rotateUv(vec2 uv) {
  if (u_rotation == 1) return vec2(uv.y, 1.0 - uv.x);
  if (u_rotation == 2) return vec2(1.0 - uv.x, 1.0 - uv.y);
  if (u_rotation == 3) return vec2(1.0 - uv.y, uv.x);
  return uv;
}

vec4 sampleInput(vec2 uv) {
  vec2 bounded = clamp(uv, vec2(0.0), vec2(1.0));
  if (u_source_pass == 1) {
    vec2 orientedSource = (u_rotation == 1 || u_rotation == 3)
      ? u_source.yx
      : u_source;
    float cover = max(u_output.x / orientedSource.x, u_output.y / orientedSource.y);
    vec2 displayed = orientedSource * cover;
    bounded = (bounded * u_output - (u_output - displayed) * 0.5) / displayed;
    bounded = rotateUv(vec2(bounded.x, 1.0 - bounded.y));
  }
  return texture(u_texture, bounded);
}

void main() {
  if (u_radius < 0.01) {
    outColor = sampleInput(v_uv);
    return;
  }
  vec2 offset1 = u_direction * u_radius * 1.3846153846;
  vec2 offset2 = u_direction * u_radius * 3.2307692308;
  vec4 color = sampleInput(v_uv) * 0.2270270270;
  color += sampleInput(v_uv + offset1) * 0.3162162162;
  color += sampleInput(v_uv - offset1) * 0.3162162162;
  color += sampleInput(v_uv + offset2) * 0.0702702703;
  color += sampleInput(v_uv - offset2) * 0.0702702703;
  outColor = color;
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

function createProgram(fragment) {
  const created = gl.createProgram();
  gl.attachShader(created, compileShader(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(created, compileShader(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(created);
  if (!gl.getProgramParameter(created, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(created));
  }
  return created;
}

const program = createProgram(fragmentSource);
const blurProgram = createProgram(blurFragmentSource);
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

function bindQuad(activeProgram) {
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  const location = gl.getAttribLocation(activeProgram, "a_position");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
}

function createLinearTexture() {
  const created = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, created);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return created;
}

const texture = createLinearTexture();
const backgroundSourceTexture = createLinearTexture();
const backgroundPassTexture = createLinearTexture();
const backgroundTexture = createLinearTexture();
const backgroundFramebuffer = gl.createFramebuffer();
gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
gl.texImage2D(
  gl.TEXTURE_2D,
  0,
  gl.RGBA,
  1,
  1,
  0,
  gl.RGBA,
  gl.UNSIGNED_BYTE,
  new Uint8Array([0, 0, 0, 255]),
);

const uniforms = {
  texture: gl.getUniformLocation(program, "u_texture"),
  background: gl.getUniformLocation(program, "u_background"),
  output: gl.getUniformLocation(program, "u_output"),
  source: gl.getUniformLocation(program, "u_source"),
  scale: gl.getUniformLocation(program, "u_scale"),
  pan: gl.getUniformLocation(program, "u_pan"),
  rotation: gl.getUniformLocation(program, "u_rotation"),
};
const blurUniforms = {
  texture: gl.getUniformLocation(blurProgram, "u_texture"),
  direction: gl.getUniformLocation(blurProgram, "u_direction"),
  output: gl.getUniformLocation(blurProgram, "u_output"),
  source: gl.getUniformLocation(blurProgram, "u_source"),
  radius: gl.getUniformLocation(blurProgram, "u_radius"),
  sourcePass: gl.getUniformLocation(blurProgram, "u_source_pass"),
  rotation: gl.getUniformLocation(blurProgram, "u_rotation"),
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
let lastRenderedMediaTime = null;
let uploadedTextureWidth = 0;
let uploadedTextureHeight = 0;
let videoFrameCallbackId = null;
let pausedFrameTimer = null;
let timelineTimer = null;
let cadenceStartedAt = 0;
let cadenceDecodedFrames = 0;
let cadenceRenderedFrames = 0;
let cadenceSkippedFrames = 0;
let cadenceRenderTimeMs = 0;
let cadenceMaxRenderTimeMs = 0;
let backgroundSnapshotReady = false;
let backgroundBlurTimer = null;
let mediaGeneration = 0;
let stream = null;
let canvasTrack = null;
let peers = new Map();
let readyPeers = new Set();
const peerMaintenance = new Map();
let lastWorkingOutput = { width: canvas.width, height: canvas.height };
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

function allocateRenderTexture(target, width, height) {
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
}

function ensureFramebufferComplete(label) {
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`${label} framebuffer incomplete status=0x${status.toString(16)}`);
  }
}

function captureBackgroundSnapshot(reason = "first frame") {
  if (!sourceElement || !sourceWidth || !sourceHeight) return;
  try {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, backgroundSourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      sourceElement,
    );
    backgroundSnapshotReady = true;
    regenerateBackground(reason);
    log(`Background snapshot captured size=${sourceWidth}x${sourceHeight}`);
  } catch (error) {
    backgroundSnapshotReady = false;
    log(`Background snapshot failed ${error.stack || error}`);
  }
}

function regenerateBackground(reason) {
  if (!backgroundSnapshotReady) return;
  const maximumCacheDimension = 768;
  const cacheScale = Math.min(
    1,
    maximumCacheDimension / Math.max(canvas.width, canvas.height),
  );
  const cacheWidth = Math.max(2, Math.round(canvas.width * cacheScale));
  const cacheHeight = Math.max(2, Math.round(canvas.height * cacheScale));
  const strength = Math.max(0, Math.min(100, Number(blurInput.value) || 0));
  const radius = (strength / 100) * 96;

  try {
    allocateRenderTexture(backgroundPassTexture, cacheWidth, cacheHeight);
    allocateRenderTexture(backgroundTexture, cacheWidth, cacheHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, backgroundFramebuffer);
    gl.viewport(0, 0, cacheWidth, cacheHeight);
    gl.useProgram(blurProgram);
    bindQuad(blurProgram);
    gl.uniform1i(blurUniforms.texture, 0);
    gl.uniform1f(blurUniforms.radius, radius);
    gl.uniform2f(blurUniforms.output, cacheWidth, cacheHeight);
    gl.uniform2f(blurUniforms.source, sourceWidth, sourceHeight);

    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      backgroundPassTexture,
      0,
    );
    ensureFramebufferComplete("horizontal blur");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, backgroundSourceTexture);
    gl.uniform2f(blurUniforms.direction, 1 / cacheWidth, 0);
    gl.uniform1i(blurUniforms.sourcePass, 1);
    gl.uniform1i(blurUniforms.rotation, sourceRotation);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      backgroundTexture,
      0,
    );
    ensureFramebufferComplete("vertical blur");
    gl.bindTexture(gl.TEXTURE_2D, backgroundPassTexture);
    gl.uniform2f(blurUniforms.direction, 0, 1 / cacheHeight);
    gl.uniform1i(blurUniforms.sourcePass, 0);
    gl.uniform1i(blurUniforms.rotation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      throw new Error(`WebGL blur error=0x${error.toString(16)}`);
    }
    log(`Static background rendered cache=${cacheWidth}x${cacheHeight} `
      + `blur=${strength} radius=${radius.toFixed(1)} reason=${reason}`);
  } catch (error) {
    log(`Static background failed reason=${reason} ${error.stack || error}`);
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  renderFrame(true);
}

function scheduleBackgroundRegeneration(reason) {
  clearTimeout(backgroundBlurTimer);
  backgroundBlurTimer = setTimeout(() => regenerateBackground(reason), 80);
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
  if (backgroundSnapshotReady) {
    regenerateBackground(`output ${reason}`);
  } else {
    renderFrame(true);
  }
  savePreferences();
}

function uploadSource() {
  if (!sourceElement || !sourceWidth || !sourceHeight) return false;
  try {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (uploadedTextureWidth !== sourceWidth || uploadedTextureHeight !== sourceHeight) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        sourceWidth,
        sourceHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      uploadedTextureWidth = sourceWidth;
      uploadedTextureHeight = sourceHeight;
      log(`Source texture allocated size=${sourceWidth}x${sourceHeight}`);
    }
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      sourceElement,
    );
    return true;
  } catch (error) {
    log(`Texture upload failed ${error}`);
    return false;
  }
}

function renderFrame(force, frameMetadata = null) {
  if (!sourceElement) return false;
  const now = performance.now();
  const fps = Math.max(1, Math.min(60, Number(fpsInput.value) || 30));
  const activeFps = playing ? fps : Math.min(10, fps);
  const mediaTime = Number(frameMetadata?.mediaTime);
  if (!force) {
    if (Number.isFinite(mediaTime)) {
      if (!CamGeometry.shouldRenderMediaFrame(lastRenderedMediaTime, mediaTime, activeFps)) {
        return false;
      }
    } else {
      const minimumFrameIntervalMs = (1000 / activeFps) * 0.9;
      if (now - lastRenderAt < minimumFrameIntervalMs) return false;
    }
  }
  const renderStartedAt = performance.now();
  if (!uploadSource()) return false;
  const size = sourceDimensions();
  const t = transform();
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(program);
  bindQuad(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(uniforms.texture, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
  gl.uniform1i(uniforms.background, 1);
  gl.uniform2f(uniforms.output, canvas.width, canvas.height);
  gl.uniform2f(uniforms.source, size.width, size.height);
  gl.uniform1f(uniforms.scale, t.scale);
  gl.uniform2f(uniforms.pan, t.panX, t.panY);
  gl.uniform1i(uniforms.rotation, sourceRotation);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  if (canvasTrack && typeof canvasTrack.requestFrame === "function") {
    canvasTrack.requestFrame();
  }
  const renderTimeMs = performance.now() - renderStartedAt;
  cadenceRenderTimeMs += renderTimeMs;
  cadenceMaxRenderTimeMs = Math.max(cadenceMaxRenderTimeMs, renderTimeMs);
  lastRenderAt = now;
  if (Number.isFinite(mediaTime)) {
    lastRenderedMediaTime = mediaTime;
  }
  return true;
}

function resetPlaybackCadence() {
  cadenceStartedAt = performance.now();
  cadenceDecodedFrames = 0;
  cadenceRenderedFrames = 0;
  cadenceSkippedFrames = 0;
  cadenceRenderTimeMs = 0;
  cadenceMaxRenderTimeMs = 0;
}

function reportPlaybackCadence() {
  const now = performance.now();
  const elapsedMs = now - cadenceStartedAt;
  if (elapsedMs < 5000) return;
  const elapsedSeconds = Math.max(0.001, elapsedMs / 1000);
  const averageRenderMs = cadenceRenderedFrames
    ? cadenceRenderTimeMs / cadenceRenderedFrames
    : 0;
  log(
    `Playback cadence decodedFps=${(cadenceDecodedFrames / elapsedSeconds).toFixed(1)} `
      + `renderedFps=${(cadenceRenderedFrames / elapsedSeconds).toFixed(1)} `
      + `skipped=${cadenceSkippedFrames} `
      + `renderAvgMs=${averageRenderMs.toFixed(2)} `
      + `renderMaxMs=${cadenceMaxRenderTimeMs.toFixed(2)} `
      + `output=${canvas.width}x${canvas.height}`,
  );
  resetPlaybackCadence();
}

function stopVideoFrameLoop() {
  if (videoFrameCallbackId == null) return;
  if (typeof video.cancelVideoFrameCallback === "function") {
    video.cancelVideoFrameCallback(videoFrameCallbackId);
  } else {
    clearTimeout(videoFrameCallbackId);
  }
  videoFrameCallbackId = null;
}

function scheduleVideoFrame() {
  stopVideoFrameLoop();
  if (!playing || sourceKind !== "video") return;
  const callback = (_now, metadata) => {
    videoFrameCallbackId = null;
    if (!playing) return;
    cadenceDecodedFrames += 1;
    if (renderFrame(false, metadata)) {
      cadenceRenderedFrames += 1;
    } else {
      cadenceSkippedFrames += 1;
    }
    reportPlaybackCadence();
    scheduleVideoFrame();
  };
  if (typeof video.requestVideoFrameCallback === "function") {
    videoFrameCallbackId = video.requestVideoFrameCallback(callback);
  } else {
    const fps = Math.max(1, Math.min(60, Number(fpsInput.value) || 30));
    videoFrameCallbackId = setTimeout(callback, 1000 / fps);
  }
}

function stopPausedFrameHeartbeat() {
  clearInterval(pausedFrameTimer);
  pausedFrameTimer = null;
}

function updatePausedFrameHeartbeat() {
  stopPausedFrameHeartbeat();
  if (playing || !sourceElement || peers.size === 0) return;
  renderFrame(true);
  pausedFrameTimer = setInterval(() => renderFrame(true), 500);
}

function ensureStream() {
  if (stream) return stream;
  stream = canvas.captureStream(0);
  canvasTrack = stream.getVideoTracks()[0];
  canvasTrack.contentHint = "detail";
  return stream;
}

function selectedCandidatePair(report) {
  let pair = null;
  report.forEach((entry) => {
    if (entry.type === "transport" && entry.selectedCandidatePairId) {
      pair = report.get(entry.selectedCandidatePairId);
    }
  });
  if (!pair) {
    report.forEach((entry) => {
      if (entry.type === "candidate-pair"
          && entry.state === "succeeded"
          && (entry.nominated || entry.selected)) {
        pair = entry;
      }
    });
  }
  if (!pair) return null;
  const local = report.get(pair.localCandidateId);
  const remote = report.get(pair.remoteCandidateId);
  const describe = (candidate) => candidate
    ? `${candidate.address || candidate.ip || "?"}:${candidate.port || "?"}`
      + `/${candidate.protocol || "?"}/${candidate.candidateType || "?"}`
    : "unknown";
  return `${describe(local)} -> ${describe(remote)}`;
}

async function waitForFirstEncodedFrame(pc, id, expected, timeoutMs) {
  const startedAt = performance.now();
  let lastRoute = "";
  let lastEncodedSize = "0x0";
  let lastCodec = "unknown";
  while (performance.now() - startedAt < timeoutMs) {
    const report = await pc.getStats();
    const route = selectedCandidatePair(report);
    if (route && route !== lastRoute) {
      lastRoute = route;
      log(`WebRTC route id=${id} ${route}`);
    }
    let encoded = 0;
    let encodedWidth = 0;
    let encodedHeight = 0;
    report.forEach((entry) => {
      if (entry.type === "outbound-rtp"
          && (entry.kind || entry.mediaType) === "video") {
        encoded = Math.max(encoded, Number(entry.framesEncoded) || 0);
        if (Number(entry.framesEncoded) > 0) {
          encodedWidth = Number(entry.frameWidth) || 0;
          encodedHeight = Number(entry.frameHeight) || 0;
          const codec = entry.codecId ? report.get(entry.codecId) : null;
          lastCodec = codec?.mimeType || "unknown";
        }
      }
    });
    lastEncodedSize = `${encodedWidth}x${encodedHeight}`;
    if (encoded > 0
        && encodedWidth === expected.width
        && encodedHeight === expected.height) {
      return {
        encoded,
        route,
        width: encodedWidth,
        height: encodedHeight,
        codec: lastCodec,
      };
    }
    renderFrame(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`encoder did not produce exact ${expected.width}x${expected.height} `
    + `in ${timeoutMs}ms; lastEncodedSize=${lastEncodedSize}; lastCodec=${lastCodec}`);
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
    const generation = ++mediaGeneration;
    stopVideoFrameLoop();
    stopPausedFrameHeartbeat();
    video.pause();
    playing = false;
    lastRenderedMediaTime = null;
    uploadedTextureWidth = 0;
    uploadedTextureHeight = 0;
    backgroundSnapshotReady = false;
    currentFile = file;
    let firstFramePresented = true;
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
      let decodedFrameResolve;
      const decodedFrame = new Promise((resolve) => {
        decodedFrameResolve = resolve;
      });
      if (typeof video.requestVideoFrameCallback === "function") {
        video.requestVideoFrameCallback(() => decodedFrameResolve(true));
      } else {
        video.addEventListener("timeupdate", () => decodedFrameResolve(true), { once: true });
      }
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
      firstFramePresented = await Promise.race([
        decodedFrame,
        new Promise((resolve) => setTimeout(() => resolve(false), 4000)),
      ]);
      if (generation !== mediaGeneration) return;
      log(`First decoded video frame ready=${firstFramePresented}`);
    }
    sourceRotation = 0;
    transforms = {
      portrait: { scale: 1, panX: 0, panY: 0 },
      landscape: { scale: 1, panX: 0, panY: 0 },
    };
    emptyState.hidden = true;
    updateRecent(file);
    updateOutputLabel();
    if (firstFramePresented) {
      captureBackgroundSnapshot("presented first frame");
    } else {
      renderFrame(true);
      if (typeof video.requestVideoFrameCallback === "function") {
        video.requestVideoFrameCallback(() => {
          if (generation === mediaGeneration) {
            captureBackgroundSnapshot("delayed presented frame");
          }
        });
      }
      log("Background snapshot deferred until a decoded frame is presented");
    }
    updatePausedFrameHeartbeat();
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
    lastRenderAt = 0;
    lastRenderedMediaTime = null;
    resetPlaybackCadence();
    stopPausedFrameHeartbeat();
    scheduleVideoFrame();
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
  stopVideoFrameLoop();
  updateOutputLabel();
  renderFrame(true);
  updatePausedFrameHeartbeat();
  log(`Playback paused positionMs=${Math.round(video.currentTime * 1000)}`);
}

function savePreferences() {
  window.camPlayer.writePreferences({
    width: canvas.width,
    height: canvas.height,
    fps: Number(fpsInput.value),
    blur: Number(blurInput.value),
    followSite: followSiteToggle.checked,
    fallbackResolution: fallbackResolutionToggle.checked,
    loop: document.getElementById("loopToggle").checked,
    lastWorkingOutput,
    recent,
  });
}

async function lockSenderQuality(sender, width, height) {
  const maximumFps = Math.max(1, Math.min(60, Number(fpsInput.value) || 30));
  const targetBitrate = CamGeometry.targetVideoBitrate(width, height, maximumFps);
  try {
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) {
      log("Sender quality lock deferred: negotiated encoding is unavailable");
      return false;
    }
    const encoding = parameters.encodings[0];
    encoding.scaleResolutionDownBy = 1;
    encoding.maxFramerate = maximumFps;
    encoding.maxBitrate = targetBitrate;
    encoding.priority = "high";
    encoding.networkPriority = "high";
    parameters.degradationPreference = "maintain-resolution";
    await sender.setParameters(parameters);
    const applied = sender.getParameters();
    const active = applied.encodings?.[0] || {};
    log(`Sender quality lock applied scale=${active.scaleResolutionDownBy || 1} `
      + `maxFps=${active.maxFramerate || "default"} `
      + `targetMbps=${(targetBitrate / 1_000_000).toFixed(2)} `
      + `maxBitrate=${active.maxBitrate || "default"} `
      + `degradation=${applied.degradationPreference || "unknown"}`);
    return targetBitrate;
  } catch (error) {
    log(`Sender quality lock unavailable ${error}`);
    return 0;
  }
}

function describeTransceivers(pc) {
  return pc.getTransceivers().map((transceiver, index) => {
    const track = transceiver.sender?.track;
    return `#${index}{mid=${transceiver.mid ?? "null"},direction=${transceiver.direction},`
      + `current=${transceiver.currentDirection || "null"},sender=`
      + `${track ? `${track.kind}/${track.readyState}/${track.id}` : "none"}}`;
  }).join(" ");
}

function closePeer(id, reason) {
  const pc = peers.get(id);
  const maintenance = peerMaintenance.get(id);
  clearTimeout(maintenance?.disconnectTimer);
  clearInterval(maintenance?.statsTimer);
  peerMaintenance.delete(id);
  peers.delete(id);
  readyPeers.delete(id);
  if (pc) {
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch (_) {
    }
  }
  log(`Peer closed id=${id} reason=${reason}`);
  updateConnectionState();
  updatePausedFrameHeartbeat();
}

async function handleOffer(payload) {
  const { id, sdp, constraints, orientation } = payload;
  const outputBeforeOffer = { ...lastWorkingOutput };
  const activeOutputBeforeOffer = { width: canvas.width, height: canvas.height };
  try {
    applySiteConfiguration({ constraints, orientation }, "offer");
    const expectedOutput = { width: canvas.width, height: canvas.height };
    if (activeOutputBeforeOffer.width !== expectedOutput.width
        || activeOutputBeforeOffer.height !== expectedOutput.height) {
      const existingPeerIds = Array.from(peers.keys());
      log(`Output geometry changed ${activeOutputBeforeOffer.width}x`
        + `${activeOutputBeforeOffer.height} -> ${expectedOutput.width}x`
        + `${expectedOutput.height}; superseding peers=${existingPeerIds.length}`);
      for (const existingId of existingPeerIds) {
        closePeer(
          existingId,
          `superseded by output ${expectedOutput.width}x${expectedOutput.height}`,
        );
      }
    }
    const pc = new RTCPeerConnection({ iceServers: [] });
    peers.set(id, pc);
    peerMaintenance.set(id, {
      disconnectTimer: null,
      statsTimer: null,
      lastOutboundBytes: 0,
      lastOutboundTimestamp: 0,
    });
    updateConnectionState();
    updatePausedFrameHeartbeat();
    pc.onconnectionstatechange = () => {
      log(`Peer id=${id} state=${pc.connectionState}`);
      const maintenance = peerMaintenance.get(id);
      if (!maintenance) return;
      if (pc.connectionState === "disconnected") {
        clearTimeout(maintenance.disconnectTimer);
        maintenance.disconnectTimer = setTimeout(() => {
          if (pc.connectionState === "disconnected") {
            closePeer(id, "disconnected timeout");
          }
        }, 5000);
      } else {
        clearTimeout(maintenance.disconnectTimer);
        maintenance.disconnectTimer = null;
      }
      if (["closed", "failed"].includes(pc.connectionState)) {
        closePeer(id, `connection ${pc.connectionState}`);
      }
    };
    const capabilities = RTCRtpSender.getCapabilities?.("video");
    const remoteOffersHevc = /a=rtpmap:\d+\s+(?:H265|HEVC)\/90000/i.test(sdp);
    const remoteOffersH264 = /a=rtpmap:\d+\s+H264\/90000/i.test(sdp);
    const remoteOffersVp9 = /a=rtpmap:\d+\s+VP9\/90000/i.test(sdp);
    const mutuallyAvailableCodecs = (capabilities?.codecs || []).filter((codec) => {
      const mime = String(codec.mimeType).toLowerCase();
      if (mime === "video/h265" || mime === "video/hevc") return remoteOffersHevc;
      if (mime === "video/h264") return remoteOffersH264;
      if (mime === "video/vp9") return remoteOffersVp9;
      return false;
    });
    const codecChoice = CamGeometry.preferredVideoCodecs(
      mutuallyAvailableCodecs,
      canvas.width,
      canvas.height,
    );
    const effectiveOfferSdp = codecChoice.name === "default"
      ? sdp
      : CamGeometry.prioritizeVideoCodec(sdp, codecChoice.name);
    log(`Remote offer codec order id=${id} originalFirst=`
      + `${CamGeometry.negotiatedVideoCodec(sdp)} effectiveFirst=`
      + `${CamGeometry.negotiatedVideoCodec(effectiveOfferSdp)} selected=${codecChoice.name}`);
    await pc.setRemoteDescription({ type: "offer", sdp: effectiveOfferSdp });
    log(`Remote offer applied id=${id} transceivers=${describeTransceivers(pc)}`);
    const localStream = ensureStream();
    const sender = pc.addTrack(localStream.getVideoTracks()[0], localStream);
    const transceiver = pc.getTransceivers().find((item) => item.sender === sender);
    if (!transceiver) throw new Error("Video sender is not attached to an offered transceiver");
    log(`Video sender attached id=${id} transceivers=${describeTransceivers(pc)}`);
    if (transceiver && codecChoice.codecs.length && transceiver.setCodecPreferences) {
      transceiver.setCodecPreferences(codecChoice.codecs);
    }
    log(`Encoder preference id=${id} selected=${codecChoice.name} `
      + `output=${canvas.width}x${canvas.height} highResolution=`
      + `${CamGeometry.isHighResolution(canvas.width, canvas.height)} `
      + `h264=${codecChoice.h264Available} hevc=${codecChoice.hevcAvailable} `
      + `vp9=${codecChoice.vp9Available} remoteH264=${remoteOffersH264} `
      + `remoteHevc=${remoteOffersHevc} remoteVp9=${remoteOffersVp9}`);
    const answer = await pc.createAnswer();
    const orderedSdp = codecChoice.name === "default"
      ? answer.sdp
      : CamGeometry.prioritizeVideoCodec(answer.sdp, codecChoice.name);
    await pc.setLocalDescription({ type: "answer", sdp: orderedSdp });
    const targetBitrate = await lockSenderQuality(
      sender,
      expectedOutput.width,
      expectedOutput.height,
    );
    await waitForIce(pc, 3500);
    const answerFirstCodec = CamGeometry.negotiatedVideoCodec(pc.localDescription.sdp);
    log(`Answer ready id=${id} bytes=${pc.localDescription.sdp.length} `
      + `preferredCodec=${codecChoice.name} answerFirstCodec=${answerFirstCodec} `
      + `transceivers=${describeTransceivers(pc)}`);
    if (codecChoice.name !== "default"
        && codecChoice.name !== answerFirstCodec
        && !(codecChoice.name === "HEVC" && ["H265", "HEVC"].includes(answerFirstCodec))) {
      throw new Error(`Codec negotiation mismatch preferred=${codecChoice.name} `
        + `answerFirst=${answerFirstCodec}`);
    }
    window.camPlayer.answerOffer({ id, sdp: pc.localDescription.sdp });
    renderFrame(true);
    waitForFirstEncodedFrame(pc, id, expectedOutput, 8000).then((result) => {
      if (!peers.has(id)) return;
      readyPeers.add(id);
      lastWorkingOutput = { ...expectedOutput };
      savePreferences();
      log(`First encoded frame id=${id} frames=${result.encoded} `
        + `output=${result.width}x${result.height} actualCodec=${result.codec} `
        + `route=${result.route || "pending"}`);
      updateConnectionState();
    }).catch((error) => {
      log(`Encoder readiness failed id=${id} output=${canvas.width}x${canvas.height} `
        + `preferredCodec=${codecChoice.name} reason=${error.message}`);
      if (fallbackResolutionToggle.checked
          && (canvas.width !== outputBeforeOffer.width
              || canvas.height !== outputBeforeOffer.height)) {
        log(`Restoring last working output=${outputBeforeOffer.width}x${outputBeforeOffer.height} `
          + `after explicit encoder failure fallbackEnabled=true`);
        applyOutputSize(
          outputBeforeOffer.width,
          outputBeforeOffer.height,
          "last working fallback after encoder failure",
        );
      } else {
        log(`Output preserved=${canvas.width}x${canvas.height} fallbackEnabled=false`);
      }
      closePeer(id, `encoder readiness failed: ${error.message}`);
    });
    let lastRoute = "";
    const statsTimer = setInterval(async () => {
      if (pc.connectionState === "closed") {
        clearInterval(statsTimer);
        return;
      }
      try {
        const report = await pc.getStats();
        const route = selectedCandidatePair(report);
        if (route && route !== lastRoute) {
          lastRoute = route;
          log(`WebRTC route id=${id} ${route}`);
        }
        report.forEach((entry) => {
          if (entry.type !== "outbound-rtp" || (entry.kind || entry.mediaType) !== "video") return;
          if (entry.framesEncoded == null) return;
          const codec = entry.codecId ? report.get(entry.codecId) : null;
          const maintenance = peerMaintenance.get(id);
          const bytes = Number(entry.bytesSent) || 0;
          const timestamp = Number(entry.timestamp) || performance.now();
          let bitrateMbps = 0;
          if (maintenance?.lastOutboundTimestamp > 0
              && timestamp > maintenance.lastOutboundTimestamp
              && bytes >= maintenance.lastOutboundBytes) {
            bitrateMbps = ((bytes - maintenance.lastOutboundBytes) * 8)
              / ((timestamp - maintenance.lastOutboundTimestamp) / 1000)
              / 1_000_000;
          }
          if (maintenance) {
            maintenance.lastOutboundBytes = bytes;
            maintenance.lastOutboundTimestamp = timestamp;
          }
          const encodedFrames = Number(entry.framesEncoded) || 0;
          const averageQp = encodedFrames > 0 && Number.isFinite(Number(entry.qpSum))
            ? Number(entry.qpSum) / encodedFrames
            : 0;
          const averageEncodeMs = encodedFrames > 0
              && Number.isFinite(Number(entry.totalEncodeTime))
            ? (Number(entry.totalEncodeTime) * 1000) / encodedFrames
            : 0;
          log(`WebRTC outbound id=${id} codec=${codec?.mimeType || "unknown"} `
            + `size=${entry.frameWidth || 0}x${entry.frameHeight || 0} `
            + `fps=${entry.framesPerSecond || 0} encoded=${entry.framesEncoded || 0} `
            + `bytes=${bytes} bitrateMbps=${bitrateMbps.toFixed(2)} `
            + `targetMbps=${(targetBitrate / 1_000_000).toFixed(2)} `
            + `avgQp=${averageQp.toFixed(1)} avgEncodeMs=${averageEncodeMs.toFixed(2)} `
            + `quality=${entry.qualityLimitationReason || "none"}`);
        });
      } catch (error) {
        log(`WebRTC stats failed id=${id} ${error}`);
      }
    }, 5000);
    const maintenance = peerMaintenance.get(id);
    if (maintenance) maintenance.statsTimer = statsTimer;
  } catch (error) {
    closePeer(id, `offer failed: ${error.message || error}`);
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
    ? readyPeers.size
      ? "Browser streaming"
      : "Browser connected; waiting for first frame"
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
    y: (1 - (event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

preview.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (spacePressed) {
    const factor = CamGeometry.wheelFactor(event.deltaY, 0.0015);
    previewZoom = Math.max(0.05, Math.min(40, previewZoom * factor));
    applyPreviewTransform();
    return;
  }
  if (!sourceElement) return;
  const factor = CamGeometry.wheelFactor(event.deltaY, 0.00075);
  const point = clientToOutput(event);
  const t = transform();
  const nextScale = Math.max(0.05, Math.min(20, t.scale * factor));
  Object.assign(t, CamGeometry.zoomAroundPoint(
    t,
    point,
    { width: canvas.width, height: canvas.height },
    nextScale,
  ));
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
    Object.assign(t, CamGeometry.dragInOutputCoordinates(
      t,
      { x: dx, y: dy },
      { width: rect.width, height: rect.height },
      { width: canvas.width, height: canvas.height },
    ));
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
document.getElementById("fitPreviewButton").addEventListener("click", (event) => {
  showFullFrame();
  event.currentTarget.blur();
});
document.getElementById("rotateButton").addEventListener("click", () => {
  sourceRotation = (sourceRotation + 1) % 4;
  regenerateBackground("source rotation");
  savePreferences();
});
document.getElementById("loopToggle").addEventListener("change", (event) => {
  video.loop = event.target.checked;
  savePreferences();
});
timeline.addEventListener("input", () => {
  if (sourceKind === "video" && Number.isFinite(video.duration)) {
    video.currentTime = (Number(timeline.value) / 1000) * video.duration;
  }
});
video.addEventListener("seeked", () => renderFrame(true));
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
for (const input of [fpsInput, followSiteToggle]) {
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
fallbackResolutionToggle.addEventListener("change", savePreferences);
document.addEventListener("click", (event) => {
  if (event.target instanceof HTMLButtonElement) {
    setTimeout(() => event.target.blur(), 0);
  }
});
blurInput.addEventListener("input", () => {
  scheduleBackgroundRegeneration("blur control");
});
blurInput.addEventListener("change", () => {
  regenerateBackground("blur committed");
  savePreferences();
});
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
  document.getElementById("networkValue").textContent =
    CamGeometry.formatNetworkInterfaces(info.interfaces, info.port) || `Port: ${info.port}`;
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
  blurInput.value = String(preferences.blur ?? 40);
  followSiteToggle.checked = !!preferences.followSite;
  fallbackResolutionToggle.checked = preferences.fallbackResolution === true;
  document.getElementById("loopToggle").checked = preferences.loop !== false;
  if (preferences.lastWorkingOutput?.width && preferences.lastWorkingOutput?.height) {
    lastWorkingOutput = {
      width: Number(preferences.lastWorkingOutput.width),
      height: Number(preferences.lastWorkingOutput.height),
    };
  }
  try {
    applyOutputSize(preferences.width || 720, preferences.height || 1280, "startup");
  } catch (error) {
    applyOutputSize(720, 1280, "startup fallback");
    log(`Stored output size rejected ${error}`);
  }
  clearInterval(timelineTimer);
  timelineTimer = setInterval(updateTimeline, 200);
  applyPreviewTransform();
  logOutput.textContent = await window.camPlayer.readLog();
  updateConnectionState();
}

window.addEventListener("beforeunload", () => {
  stopVideoFrameLoop();
  stopPausedFrameHeartbeat();
  clearInterval(timelineTimer);
  clearTimeout(backgroundBlurTimer);
  for (const id of Array.from(peers.keys())) closePeer(id, "renderer unload");
  stream?.getTracks().forEach((track) => track.stop());
});

initialize();
