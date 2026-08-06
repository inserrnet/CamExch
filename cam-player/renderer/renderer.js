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
const motionMode = document.getElementById("motionMode");
const motionProfileSelect = document.getElementById("motionProfileSelect");
const motionInput = document.getElementById("motionInput");
const stabilizationInput = document.getElementById("stabilizationInput");
const motionValue = document.getElementById("motionValue");
const stabilizationValue = document.getElementById("stabilizationValue");
const recenterButton = document.getElementById("recenterButton");
const recordMotionButton = document.getElementById("recordMotionButton");
const cancelMotionRecordingButton = document.getElementById("cancelMotionRecordingButton");
const renameMotionProfileButton = document.getElementById("renameMotionProfileButton");
const deleteMotionProfileButton = document.getElementById("deleteMotionProfileButton");
const rememberMotionStateToggle = document.getElementById("rememberMotionStateToggle");
const motionRecordingStatus = document.getElementById("motionRecordingStatus");
const handheldStatus = document.getElementById("handheldStatus");
const timeline = document.getElementById("timeline");
const timeLabel = document.getElementById("timeLabel");
const recentFiles = document.getElementById("recentFiles");
const clearRecentButton = document.getElementById("clearRecentButton");
const scanQrButton = document.getElementById("scanQrButton");
const logOutput = document.getElementById("logOutput");
const connectionStatus = document.getElementById("connectionStatus");
const toast = document.getElementById("toast");
let toastTimer = null;

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

const gl = canvas.getContext("webgl2", {
  alpha: false,
  antialias: false,
  desynchronized: true,
  preserveDrawingBuffer: false,
});
if (!gl) throw new Error("WebGL 2 is required");
if ("drawingBufferColorSpace" in gl) gl.drawingBufferColorSpace = "srgb";
if ("unpackColorSpace" in gl) gl.unpackColorSpace = "srgb";

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
uniform float u_lod_bias;
uniform vec2 u_pan;
uniform int u_rotation;
uniform int u_mirrored;
uniform float u_handheld_roll;
in vec2 v_uv;
out vec4 outColor;

vec2 rotateUv(vec2 uv) {
  if (u_rotation == 1) return vec2(uv.y, 1.0 - uv.x);
  if (u_rotation == 2) return vec2(1.0 - uv.x, 1.0 - uv.y);
  if (u_rotation == 3) return vec2(1.0 - uv.y, uv.x);
  return uv;
}

vec2 orientUv(vec2 uv) {
  vec2 oriented = rotateUv(uv);
  if (u_mirrored != 0) oriented.x = 1.0 - oriented.x;
  return oriented;
}

vec4 sampleSource(vec2 uv) {
  return texture(u_texture, orientUv(vec2(uv.x, 1.0 - uv.y)), u_lod_bias);
}

vec2 applyHandheld(vec2 uv, vec2 displayed) {
  vec2 safeDisplayed = max(displayed, vec2(1.0));
  vec2 centeredPixels = (uv - 0.5) * safeDisplayed;
  float cosine = cos(u_handheld_roll);
  float sine = sin(u_handheld_roll);
  vec2 rotatedPixels = mat2(cosine, -sine, sine, cosine) * centeredPixels;
  return rotatedPixels / safeDisplayed + 0.5;
}

void main() {
  vec2 pixel = v_uv * u_output;
  vec4 background = texture(u_background, v_uv);
  float fit = min(u_output.x / u_source.x, u_output.y / u_source.y);
  vec2 displayed = u_source * fit * u_scale;
  vec2 center = u_output * 0.5 + u_pan;
  vec2 fgUv = (pixel - (center - displayed * 0.5)) / displayed;
  vec2 handheldUv = applyHandheld(fgUv, displayed);
  bool inside = handheldUv.x >= 0.0 && handheldUv.x <= 1.0
    && handheldUv.y >= 0.0 && handheldUv.y <= 1.0;
  outColor = inside ? sampleSource(handheldUv) : background;
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
uniform int u_mirrored;
in vec2 v_uv;
out vec4 outColor;

vec2 rotateUv(vec2 uv) {
  if (u_rotation == 1) return vec2(uv.y, 1.0 - uv.x);
  if (u_rotation == 2) return vec2(1.0 - uv.x, 1.0 - uv.y);
  if (u_rotation == 3) return vec2(1.0 - uv.y, uv.x);
  return uv;
}

vec2 orientUv(vec2 uv) {
  vec2 oriented = rotateUv(uv);
  if (u_mirrored != 0) oriented.x = 1.0 - oriented.x;
  return oriented;
}

vec4 sampleInput(vec2 uv) {
  vec2 bounded = clamp(uv, vec2(0.0), vec2(1.0));
  if (u_source_pass != 0) {
    vec2 orientedSource = (u_rotation == 1 || u_rotation == 3)
      ? u_source.yx
      : u_source;
    float cover = max(u_output.x / orientedSource.x, u_output.y / orientedSource.y);
    vec2 displayed = orientedSource * cover;
    bounded = (bounded * u_output - (u_output - displayed) * 0.5) / displayed;
    bounded = u_source_pass == 1
      ? orientUv(vec2(bounded.x, 1.0 - bounded.y))
      : orientUv(bounded);
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

function createDetailTexture() {
  const created = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, created);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return created;
}

const texture = createDetailTexture();
const backgroundSnapshotTexture = createLinearTexture();
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
  lodBias: gl.getUniformLocation(program, "u_lod_bias"),
  pan: gl.getUniformLocation(program, "u_pan"),
  rotation: gl.getUniformLocation(program, "u_rotation"),
  mirrored: gl.getUniformLocation(program, "u_mirrored"),
  handheldRoll: gl.getUniformLocation(program, "u_handheld_roll"),
};
const blurUniforms = {
  texture: gl.getUniformLocation(blurProgram, "u_texture"),
  direction: gl.getUniformLocation(blurProgram, "u_direction"),
  output: gl.getUniformLocation(blurProgram, "u_output"),
  source: gl.getUniformLocation(blurProgram, "u_source"),
  radius: gl.getUniformLocation(blurProgram, "u_radius"),
  sourcePass: gl.getUniformLocation(blurProgram, "u_source_pass"),
  rotation: gl.getUniformLocation(blurProgram, "u_rotation"),
  mirrored: gl.getUniformLocation(blurProgram, "u_mirrored"),
};

let sourceElement = null;
let sourceWidth = 0;
let sourceHeight = 0;
let sourceKind = "";
let sourceRotation = 0;
let sourceMirrored = false;
let currentFile = null;
let memoryTimer = null;
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
let detailMinificationEnabled = null;
let sourceTextureDirty = true;
let sourceMipmapsValid = false;
let sourceUploadCount = 0;
let photoCpuReleased = false;
let backgroundSnapshotWidth = 0;
let backgroundSnapshotHeight = 0;
let backgroundSnapshotRotation = 0;
let backgroundSnapshotMirrored = false;
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
let senderQualityRefreshTimer = null;
let keyFrameTimer = null;
let siteConfigurationTimer = null;
let preferencesSaveTimer = null;
let interactiveRenderFrameId = null;
let interactionIdleTimer = null;
let sourceInteractionActive = false;
let interactionStartedAt = 0;
let interactionRenderedFrames = 0;
let interactionSequence = 0;
let pendingSiteConfiguration = null;
let mediaGeneration = 0;
let fileDragDepth = 0;
let droppedFileLoading = false;
let stream = null;
let canvasTrack = null;
let peers = new Map();
let readyPeers = new Set();
const peerMaintenance = new Map();
const encoderFailures = new Map();
const MAX_ACTIVE_PEERS = 1;
let manualOutput = { width: canvas.width, height: canvas.height };
let activeOutputOrigin = "manual";
let lastWorkingOutput = { width: canvas.width, height: canvas.height };
let recent = [];
let currentServerInfo = null;
let handheldController = new CamHandheld.Controller();
let handheldRenderFrameId = null;
let handheldLastRenderAt = 0;
let handheldSamples = 0;
let handheldMetricsStartedAt = performance.now();
let latestPhoneMotionAt = 0;
let latestPhoneSample = null;
let motionProfiles = [];
let activeMotionProfile = null;
let recordedMotionPlayer = null;
let recordedMotionTimer = null;
let motionRecordingTimer = null;
let motionRecording = null;
let motionProfileSaveTimer = null;
let liveMotionSettings = { motion: 35, stabilization: 55 };
let transforms = {
  portrait: { scale: 1, panX: 0, panY: 0 },
  landscape: { scale: 1, panX: 0, panY: 0 },
};

function log(message) {
  window.camPlayer.log(message);
}

async function logRuntimeMetrics() {
  try {
    const memory = await window.camPlayer.getMemoryInfo();
    log(`Runtime memory workingSetMb=${memory.workingSetMb} privateMb=${memory.privateMb} `
      + `processes=${memory.processes} peers=${peers.size} media=${currentFile?.kind || "none"} `
      + `output=${canvas.width}x${canvas.height} interaction=${sourceInteractionActive}`);
  } catch (error) {
    log(`Runtime memory unavailable ${error}`);
  }
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
    sourceTextureDirty = true;
    if (!uploadSource()) throw new Error("Source texture is unavailable");
    const oriented = sourceDimensions();
    const maximumSnapshotDimension = 768;
    const snapshotScale = Math.min(
      1,
      maximumSnapshotDimension / Math.max(oriented.width, oriented.height),
    );
    backgroundSnapshotWidth = Math.max(2, Math.round(oriented.width * snapshotScale));
    backgroundSnapshotHeight = Math.max(2, Math.round(oriented.height * snapshotScale));
    backgroundSnapshotRotation = sourceRotation;
    backgroundSnapshotMirrored = sourceMirrored;
    allocateRenderTexture(
      backgroundSnapshotTexture,
      backgroundSnapshotWidth,
      backgroundSnapshotHeight,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, backgroundFramebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      backgroundSnapshotTexture,
      0,
    );
    ensureFramebufferComplete("background snapshot");
    gl.viewport(0, 0, backgroundSnapshotWidth, backgroundSnapshotHeight);
    gl.useProgram(blurProgram);
    bindQuad(blurProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(blurUniforms.texture, 0);
    gl.uniform1f(blurUniforms.radius, 0);
    gl.uniform2f(
      blurUniforms.output,
      backgroundSnapshotWidth,
      backgroundSnapshotHeight,
    );
    gl.uniform2f(blurUniforms.source, sourceWidth, sourceHeight);
    gl.uniform2f(blurUniforms.direction, 0, 0);
    gl.uniform1i(blurUniforms.sourcePass, 1);
    gl.uniform1i(blurUniforms.rotation, sourceRotation);
    gl.uniform1i(blurUniforms.mirrored, sourceMirrored ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    backgroundSnapshotReady = true;
    regenerateBackground(reason);
    log(`Background snapshot captured source=${sourceWidth}x${sourceHeight} `
      + `cache=${backgroundSnapshotWidth}x${backgroundSnapshotHeight}`);
  } catch (error) {
    backgroundSnapshotReady = false;
    log(`Background snapshot failed ${error.stack || error}`);
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
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
  const snapshotRotation = (sourceRotation - backgroundSnapshotRotation + 4) % 4;
  const snapshotMirrored = sourceMirrored !== backgroundSnapshotMirrored;

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
    gl.uniform2f(
      blurUniforms.source,
      backgroundSnapshotWidth,
      backgroundSnapshotHeight,
    );

    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      backgroundPassTexture,
      0,
    );
    ensureFramebufferComplete("horizontal blur");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, backgroundSnapshotTexture);
    gl.uniform2f(blurUniforms.direction, 1 / cacheWidth, 0);
    gl.uniform1i(blurUniforms.sourcePass, 2);
    gl.uniform1i(blurUniforms.rotation, snapshotRotation);
    gl.uniform1i(blurUniforms.mirrored, snapshotMirrored ? 1 : 0);
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
    gl.uniform1i(blurUniforms.mirrored, 0);
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

function applyOutputSize(width, height, reason, options = {}) {
  const w = CamGeometry.positiveInteger(width, "Width");
  const h = CamGeometry.positiveInteger(height, "Height");
  const origin = options.origin || "manual";
  const persist = options.persist !== false;
  const previousOutput = { width: canvas.width, height: canvas.height };
  const previousOrientation = orientationForSize(previousOutput.width, previousOutput.height);
  const nextOrientation = orientationForSize(w, h);
  const maximum = maxTextureSize();
  if (w > maximum || h > maximum) {
    throw new Error(`Requested ${w}\u00d7${h} exceeds GPU texture limit ${maximum}`);
  }
  canvas.width = w;
  canvas.height = h;
  activeOutputOrigin = origin;
  if (origin === "manual") {
    manualOutput = { width: w, height: h };
  }
  if (previousOrientation === nextOrientation) {
    transforms[nextOrientation] = CamGeometry.rescaleOutputTransform(
      transforms[nextOrientation],
      previousOutput,
      { width: w, height: h },
    );
  }
  widthInput.value = String(w);
  heightInput.value = String(h);
  gl.viewport(0, 0, w, h);
  applyPreviewTransform();
  updateOutputLabel();
  log(`Output size=${w}x${h} origin=${origin} manual=`
    + `${manualOutput.width}x${manualOutput.height} reason=${reason}`);
  if (backgroundSnapshotReady) {
    regenerateBackground(`output ${reason}`);
  } else {
    renderFrame(true);
  }
  scheduleSenderQualityRefresh(`output ${reason}`);
  scheduleKeyFrame(`output ${reason}`, 0);
  if (persist) savePreferences();
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
      sourceTextureDirty = true;
      log(`Source texture allocated size=${sourceWidth}x${sourceHeight}`);
    }
    if (sourceTextureDirty) {
      if (sourceKind === "photo" && photoCpuReleased) {
        throw new Error("Decoded photo was released after its GPU upload");
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
      sourceTextureDirty = false;
      sourceMipmapsValid = false;
      sourceUploadCount += 1;
    }
    const oriented = sourceDimensions();
    const fit = Math.min(canvas.width / oriented.width, canvas.height / oriented.height);
    const sourceToOutputScale = fit * transform().scale;
    const needsMipmaps = sourceToOutputScale < 0.95;
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      needsMipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
    );
    if (needsMipmaps && !sourceMipmapsValid) {
      gl.generateMipmap(gl.TEXTURE_2D);
      sourceMipmapsValid = true;
    }
    if (detailMinificationEnabled !== needsMipmaps) {
      detailMinificationEnabled = needsMipmaps;
      log(`Detail minification mode=${needsMipmaps ? "stable-trilinear" : "linear-native"} `
        + `sourceToOutputScale=${sourceToOutputScale.toFixed(3)} `
        + `source=${oriented.width}x${oriented.height} output=${canvas.width}x${canvas.height}`);
    }
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
  const handheld = handheldController.output(canvas.width, canvas.height);
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
  gl.uniform1f(uniforms.scale, t.scale * handheld.scale);
  gl.uniform1f(uniforms.lodBias, 0);
  gl.uniform2f(uniforms.pan, t.panX + handheld.panX, t.panY + handheld.panY);
  gl.uniform1i(uniforms.rotation, sourceRotation);
  gl.uniform1i(uniforms.mirrored, sourceMirrored ? 1 : 0);
  gl.uniform1f(uniforms.handheldRoll, handheld.roll);
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

function emitCurrentFrame() {
  if (canvasTrack && typeof canvasTrack.requestFrame === "function") {
    canvasTrack.requestFrame();
    return true;
  }
  return false;
}

function emitBootstrapFrames(reason, count = 4, intervalMs = 80) {
  let remaining = Math.max(1, count);
  const emit = () => {
    if (!canvasTrack || peers.size === 0) return;
    renderFrame(true);
    remaining -= 1;
    if (remaining > 0) setTimeout(emit, intervalMs);
  };
  renderFrame(true);
  emit();
  log(`Canvas bootstrap frames scheduled count=${count} reason=${reason}`);
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
    sourceTextureDirty = true;
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
  if (playing || !sourceElement || !canvasTrack || peers.size === 0) return;
  const idleFps = CamGeometry.adaptiveFrameRate(
    canvas.width,
    canvas.height,
    Number(fpsInput.value) || 30,
    "idle",
  );
  renderFrame(true);
  pausedFrameTimer = setInterval(() => renderFrame(true), 1000 / idleFps);
  log(`Paused/photo camera heartbeat fps=${idleFps} output=${canvas.width}x${canvas.height}`);
}

function discardCaptureStream(reason) {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch (_) {
    }
  });
  stream = null;
  canvasTrack = null;
  log(`Canvas capture stream discarded reason=${reason}`);
}

function ensureStream() {
  if (stream) return stream;
  stream = canvas.captureStream(0);
  canvasTrack = stream.getVideoTracks()[0];
  updateTrackContentHint("stream created");
  return stream;
}

function desiredContentHint() {
  return sourceKind === "video" && playing ? "motion" : "detail";
}

function updateTrackContentHint(reason) {
  if (!canvasTrack) return;
  const desired = desiredContentHint();
  if (canvasTrack.contentHint === desired) return;
  try {
    canvasTrack.contentHint = desired;
    log(`Canvas contentHint=${canvasTrack.contentHint || "default"} reason=${reason}`);
  } catch (error) {
    log(`Canvas contentHint unavailable reason=${reason} ${error}`);
  }
}

function requestKeyFrames(reason) {
  let requested = 0;
  let unsupported = 0;
  for (const maintenance of peerMaintenance.values()) {
    const sender = maintenance?.sender;
    if (!sender) continue;
    if (typeof sender.generateKeyFrame === "function") {
      requested += 1;
      Promise.resolve(sender.generateKeyFrame()).catch((error) => {
        log(`Keyframe request failed reason=${reason} ${error}`);
      });
    } else {
      unsupported += 1;
    }
  }
  const fallbackAllowed = /^(output|media loaded|playback started|playback paused|video seek|source reset|source rotation)/.test(reason);
  if (unsupported && fallbackAllowed) {
    emitBootstrapFrames(`keyframe fallback ${reason}`, 1, 90);
  }
  if (requested || unsupported) {
    log(`Keyframe request reason=${reason} requested=${requested} unsupported=${unsupported}`);
  }
}

function scheduleKeyFrame(reason, delayMs = 180) {
  clearTimeout(keyFrameTimer);
  keyFrameTimer = setTimeout(() => requestKeyFrames(reason), delayMs);
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
  clearRecentButton.disabled = recent.length === 0;
}

async function prepareAndLoadMediaPath(filePath, origin) {
  if (!filePath || droppedFileLoading) return;
  droppedFileLoading = true;
  try {
    const selected = await window.camPlayer.prepareMedia(filePath);
    await loadMedia(selected);
    log(`Media opened origin=${origin} path=${filePath}`);
  } catch (error) {
    log(`Media open failed origin=${origin} ${error.stack || error}`);
    alert(error.message || String(error));
  } finally {
    droppedFileLoading = false;
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
    detailMinificationEnabled = null;
    sourceTextureDirty = true;
    sourceMipmapsValid = false;
    sourceUploadCount = 0;
    photoCpuReleased = false;
    backgroundSnapshotReady = false;
    backgroundSnapshotWidth = 0;
    backgroundSnapshotHeight = 0;
    backgroundSnapshotRotation = 0;
    backgroundSnapshotMirrored = false;
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
    if (sourceKind === "photo" && !sourceTextureDirty) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
      photoCpuReleased = true;
      log(`Decoded photo CPU buffer released after GPU upload size=${sourceWidth}x${sourceHeight}`);
    }
    updateTrackContentHint("media loaded");
    scheduleSenderQualityRefresh("media loaded");
    scheduleKeyFrame("media loaded", 0);
    updatePausedFrameHeartbeat();
    const decodedMiB = sourceWidth * sourceHeight * 4 / (1024 * 1024);
    log(`Media loaded kind=${sourceKind} size=${sourceWidth}x${sourceHeight} `
      + `decodedRgbaMiB=${decodedMiB.toFixed(1)} path=${file.path}`);
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
    updateTrackContentHint("playback started");
    scheduleSenderQualityRefresh("playback started");
    scheduleKeyFrame("playback started", 0);
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
  sourceTextureDirty = true;
  renderFrame(true);
  updateTrackContentHint("playback paused");
  scheduleSenderQualityRefresh("playback paused");
  scheduleKeyFrame("playback paused", 0);
  updatePausedFrameHeartbeat();
  log(`Playback paused positionMs=${Math.round(video.currentTime * 1000)}`);
}

function savePreferences() {
  window.camPlayer.writePreferences({
    preferencesVersion: 2,
    width: manualOutput.width,
    height: manualOutput.height,
    fps: Number(fpsInput.value),
    blur: Number(blurInput.value),
    followSite: followSiteToggle.checked,
    fallbackResolution: fallbackResolutionToggle.checked,
    loop: document.getElementById("loopToggle").checked,
    mirrored: sourceMirrored,
    motionMode: motionMode.value,
    selectedMotionProfileId: motionProfileSelect.value,
    rememberMotionEnabled: rememberMotionStateToggle.checked,
    liveMotion: liveMotionSettings.motion,
    liveStabilization: liveMotionSettings.stabilization,
    motion: Number(motionInput.value),
    stabilization: Number(stabilizationInput.value),
    lastWorkingOutput,
    recent,
  });
}

async function restartCaptureTrackAtCurrentResolution(reason, expectedPeerId) {
  const previousStream = stream;
  const previousTrack = canvasTrack;
  const expectedMaintenance = peerMaintenance.get(expectedPeerId);
  const expectedSender = expectedMaintenance?.sender;
  if (!expectedSender || !peers.has(expectedPeerId)) {
    throw new Error(`Encoder restart superseded before replacement id=${expectedPeerId}`);
  }
  const replacementStream = canvas.captureStream(0);
  const replacementTrack = replacementStream.getVideoTracks()[0];
  try {
    replacementTrack.contentHint = desiredContentHint();
  } catch (_) {
  }
  try {
    await expectedSender.replaceTrack(replacementTrack);
  } catch (error) {
    replacementTrack.stop();
    throw error;
  }
  if (!peers.has(expectedPeerId)
      || peerMaintenance.get(expectedPeerId)?.sender !== expectedSender) {
    replacementTrack.stop();
    throw new Error(`Encoder restart superseded after replacement id=${expectedPeerId}`);
  }
  stream = replacementStream;
  canvasTrack = replacementTrack;
  previousStream?.getTracks().forEach((track) => {
    if (track !== replacementTrack) {
      try {
        track.stop();
      } catch (_) {
      }
    }
  });
  renderFrame(true);
  emitBootstrapFrames(`same-resolution restart ${reason}`, 6, 100);
  updatePausedFrameHeartbeat();
  log(`Encoder same-resolution restart output=${canvas.width}x${canvas.height} `
    + `peer=${expectedPeerId} previousTrack=${previousTrack?.id || "none"} `
    + `nextTrack=${replacementTrack.id}`);
}

async function lockSenderQuality(sender, width, height) {
  const configuredFps = Math.max(1, Math.min(60, Number(fpsInput.value) || 30));
  const senderState = sourceKind === "video" && playing
    ? "motion"
    : sourceInteractionActive
      ? "interaction"
      : "idle";
  const maximumFps = CamGeometry.adaptiveFrameRate(
    width,
    height,
    configuredFps,
    senderState,
  );
  const bitrateProfile = CamGeometry.videoBitrateProfile(width, height, maximumFps);
  try {
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) {
      log("Sender quality lock deferred: negotiated encoding is unavailable");
      return false;
    }
    const encoding = parameters.encodings[0];
    encoding.scaleResolutionDownBy = 1;
    encoding.maxFramerate = maximumFps;
    encoding.maxBitrate = bitrateProfile.maximum;
    encoding.priority = "high";
    encoding.networkPriority = "high";
    parameters.degradationPreference = "maintain-resolution";
    await sender.setParameters(parameters);
    const applied = sender.getParameters();
    const active = applied.encodings?.[0] || {};
    log(`Sender quality lock applied scale=${active.scaleResolutionDownBy || 1} `
      + `maxFps=${active.maxFramerate || "default"} `
      + `state=${senderState} `
      + `minMbps=${(bitrateProfile.minimum / 1_000_000).toFixed(2)} `
      + `startMbps=${(bitrateProfile.start / 1_000_000).toFixed(2)} `
      + `targetMbps=${(bitrateProfile.maximum / 1_000_000).toFixed(2)} `
      + `maxBitrate=${active.maxBitrate || "default"} `
      + `degradation=${applied.degradationPreference || "unknown"}`);
    return bitrateProfile;
  } catch (error) {
    log(`Sender quality lock unavailable ${error}`);
    return bitrateProfile;
  }
}

function scheduleSenderQualityRefresh(reason) {
  clearTimeout(senderQualityRefreshTimer);
  senderQualityRefreshTimer = setTimeout(async () => {
    const active = [];
    for (const [id, maintenance] of peerMaintenance.entries()) {
      if (!maintenance?.sender || !peers.has(id)) continue;
      active.push(
        lockSenderQuality(maintenance.sender, canvas.width, canvas.height)
          .then(() => {
            maintenance.outputWidth = canvas.width;
            maintenance.outputHeight = canvas.height;
          }),
      );
    }
    if (active.length) {
      await Promise.allSettled(active);
      log(`Sender quality refreshed peers=${active.length} `
        + `output=${canvas.width}x${canvas.height} fps=${fpsInput.value} reason=${reason}`);
    }
  }, 80);
}

function describeTransceivers(pc) {
  return pc.getTransceivers().map((transceiver, index) => {
    const track = transceiver.sender?.track;
    return `#${index}{mid=${transceiver.mid ?? "null"},direction=${transceiver.direction},`
      + `current=${transceiver.currentDirection || "null"},sender=`
      + `${track ? `${track.kind}/${track.readyState}/${track.id}` : "none"}}`;
  }).join(" ");
}

function ensureOfferActive(id) {
  if (!peers.has(id)) throw new Error("Offer was canceled or superseded");
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
    for (const sender of pc.getSenders()) {
      if (sender.track) {
        Promise.resolve(sender.replaceTrack(null)).catch(() => {});
      }
    }
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
  const { id, sdp, constraints, orientation, sessionId = "" } = payload;
  const outputBeforeOffer = { ...lastWorkingOutput };
  const activeOutputBeforeOffer = { width: canvas.width, height: canvas.height };
  try {
    applySiteConfiguration({ constraints, orientation }, "offer");
    const expectedOutput = { width: canvas.width, height: canvas.height };
    const existingPeerIds = Array.from(peers.keys());
    for (const existingId of existingPeerIds) {
      closePeer(existingId, `superseded by offer ${id}`);
    }
    if (peers.size >= MAX_ACTIVE_PEERS) {
      throw new Error(`Active encoder limit exceeded (${MAX_ACTIVE_PEERS})`);
    }
    log(`Preparing single encoder ${activeOutputBeforeOffer.width}x`
      + `${activeOutputBeforeOffer.height} -> ${expectedOutput.width}x`
      + `${expectedOutput.height}; replacedPeers=${existingPeerIds.length}`);
    const localStream = ensureStream();
    const pc = new RTCPeerConnection({ iceServers: [] });
    peers.set(id, pc);
    peerMaintenance.set(id, {
      disconnectTimer: null,
      statsTimer: null,
      lastOutboundBytes: 0,
      lastOutboundTimestamp: 0,
      sender: null,
      sessionId,
      preferredCodec: "",
      actualCodec: "",
      outputWidth: expectedOutput.width,
      outputHeight: expectedOutput.height,
      createdAt: performance.now(),
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
        }, 1500);
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
    const outputKey = `${expectedOutput.width}x${expectedOutput.height}`;
    const failureNow = performance.now();
    for (const [failedOutput, failure] of encoderFailures.entries()) {
      if (failureNow - failure.at >= 60_000) encoderFailures.delete(failedOutput);
    }
    const recentFailure = encoderFailures.get(outputKey);
    const eligibleCodecs = recentFailure
        && performance.now() - recentFailure.at < 60_000
      ? mutuallyAvailableCodecs.filter(
        (codec) => String(codec.mimeType).toLowerCase() !== recentFailure.mime,
      )
      : mutuallyAvailableCodecs;
    if (recentFailure && eligibleCodecs.length !== mutuallyAvailableCodecs.length) {
      log(`Encoder codec retry output=${outputKey} excluded=${recentFailure.mime} `
        + `remaining=${eligibleCodecs.map((codec) => codec.mimeType).join(",")}`);
    }
    const codecChoice = CamGeometry.preferredVideoCodecs(
      eligibleCodecs.length ? eligibleCodecs : mutuallyAvailableCodecs,
      canvas.width,
      canvas.height,
    );
    const codecMaintenance = peerMaintenance.get(id);
    if (codecMaintenance) codecMaintenance.preferredCodec = codecChoice.name;
    const bitrateProfile = CamGeometry.videoBitrateProfile(
      expectedOutput.width,
      expectedOutput.height,
      Math.max(1, Math.min(60, Number(fpsInput.value) || 30)),
    );
    const prioritizedOfferSdp = codecChoice.name === "default"
      ? sdp
      : CamGeometry.prioritizeVideoCodec(sdp, codecChoice.name);
    const effectiveOfferSdp = codecChoice.name === "default"
      ? prioritizedOfferSdp
      : CamGeometry.applyVideoBitrateHints(
        prioritizedOfferSdp,
        codecChoice.name,
        bitrateProfile,
      );
    log(`Remote offer codec order id=${id} originalFirst=`
      + `${CamGeometry.negotiatedVideoCodec(sdp)} effectiveFirst=`
      + `${CamGeometry.negotiatedVideoCodec(effectiveOfferSdp)} selected=${codecChoice.name}`);
    await pc.setRemoteDescription({ type: "offer", sdp: effectiveOfferSdp });
    ensureOfferActive(id);
    log(`Remote offer applied id=${id} transceivers=${describeTransceivers(pc)}`);
    const sender = pc.addTrack(localStream.getVideoTracks()[0], localStream);
    const senderMaintenance = peerMaintenance.get(id);
    if (senderMaintenance) senderMaintenance.sender = sender;
    updatePausedFrameHeartbeat();
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
    ensureOfferActive(id);
    const prioritizedAnswerSdp = codecChoice.name === "default"
      ? answer.sdp
      : CamGeometry.prioritizeVideoCodec(answer.sdp, codecChoice.name);
    const orderedSdp = codecChoice.name === "default"
      ? prioritizedAnswerSdp
      : CamGeometry.applyVideoBitrateHints(
        prioritizedAnswerSdp,
        codecChoice.name,
        bitrateProfile,
      );
    await pc.setLocalDescription({ type: "answer", sdp: orderedSdp });
    ensureOfferActive(id);
    const appliedBitrateProfile = await lockSenderQuality(
      sender,
      expectedOutput.width,
      expectedOutput.height,
    );
    await waitForIce(pc, 3500);
    ensureOfferActive(id);
    const answerFirstCodec = CamGeometry.negotiatedVideoCodec(pc.localDescription.sdp);
    log(`Answer ready id=${id} bytes=${pc.localDescription.sdp.length} `
      + `preferredCodec=${codecChoice.name} answerFirstCodec=${answerFirstCodec} `
      + `transceivers=${describeTransceivers(pc)}`);
    if (codecChoice.name !== "default"
        && codecChoice.name !== answerFirstCodec
        && !(codecChoice.name === "HEVC" && ["H265", "HEVC"].includes(answerFirstCodec))) {
      log(`Codec preference fallback preferred=${codecChoice.name} `
        + `answerFirst=${answerFirstCodec}; actual codec will be verified by stats`);
    }
    window.camPlayer.answerOffer({ id, sdp: pc.localDescription.sdp });
    emitBootstrapFrames(`offer ${id} answered`, 5, 100);
    (async () => {
      try {
        return await waitForFirstEncodedFrame(pc, id, expectedOutput, 3500);
      } catch (firstError) {
        ensureOfferActive(id);
        log(`Encoder first attempt stalled id=${id}; retrying same resolution reason=`
          + `${firstError.message}`);
        await restartCaptureTrackAtCurrentResolution(`offer ${id}`, id);
        ensureOfferActive(id);
        return waitForFirstEncodedFrame(pc, id, expectedOutput, 4500);
      }
    })().then((result) => {
      if (!peers.has(id)) return;
      readyPeers.add(id);
      encoderFailures.delete(outputKey);
      lastWorkingOutput = { ...expectedOutput };
      savePreferences();
      log(`First encoded frame id=${id} frames=${result.encoded} `
        + `output=${result.width}x${result.height} actualCodec=${result.codec} `
        + `route=${result.route || "pending"}`);
      updateConnectionState();
    }).catch((error) => {
      const actualCodec = String(peerMaintenance.get(id)?.actualCodec || "");
      const failedMime = actualCodec && actualCodec !== "unknown"
        ? actualCodec.toLowerCase()
        : codecChoice.codecs.length
          ? String(codecChoice.codecs[0].mimeType).toLowerCase()
          : "";
      if (failedMime) {
        encoderFailures.set(outputKey, { mime: failedMime, at: performance.now() });
        log(`Encoder codec marked failed output=${outputKey} codec=${failedMime}`);
      }
      log(`Encoder readiness failed id=${id} output=${canvas.width}x${canvas.height} `
        + `preferredCodec=${codecChoice.name} reason=${error.message}`);
      if (fallbackResolutionToggle.checked
          && activeOutputOrigin === "site"
          && (canvas.width !== outputBeforeOffer.width
              || canvas.height !== outputBeforeOffer.height)) {
        log(`Restoring last working output=${outputBeforeOffer.width}x${outputBeforeOffer.height} `
          + `after explicit encoder failure fallbackEnabled=true`);
        applyOutputSize(
          outputBeforeOffer.width,
          outputBeforeOffer.height,
          "last working fallback after encoder failure",
          { origin: "fallback", persist: false },
        );
      } else {
        log(`Output preserved=${canvas.width}x${canvas.height} origin=${activeOutputOrigin} `
          + `fallbackEnabled=${fallbackResolutionToggle.checked}`);
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
          const actualCodec = String(codec?.mimeType || "unknown");
          if (maintenance && actualCodec !== "unknown"
              && maintenance.actualCodec !== actualCodec) {
            maintenance.actualCodec = actualCodec;
            log(`Actual encoder codec id=${id} preferred=${maintenance.preferredCodec} `
              + `actual=${actualCodec}`);
          }
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
          log(`WebRTC outbound id=${id} codec=${actualCodec} `
            + `size=${entry.frameWidth || 0}x${entry.frameHeight || 0} `
            + `fps=${entry.framesPerSecond || 0} encoded=${entry.framesEncoded || 0} `
            + `bytes=${bytes} bitrateMbps=${bitrateMbps.toFixed(2)} `
            + `minMbps=${(appliedBitrateProfile.minimum / 1_000_000).toFixed(2)} `
            + `targetMbps=${(appliedBitrateProfile.maximum / 1_000_000).toFixed(2)} `
            + `avgQp=${averageQp.toFixed(1)} avgEncodeMs=${averageEncodeMs.toFixed(2)} `
            + `quality=${entry.qualityLimitationReason || "none"} `
            + `sourceUploads=${sourceUploadCount} peers=${peers.size}`);
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
  if (resolved.width === canvas.width && resolved.height === canvas.height) {
    log(`Site size already active=${canvas.width}x${canvas.height} `
      + `reason=${reason} ${resolved.reason}`);
    return;
  }
  applyOutputSize(
    resolved.width,
    resolved.height,
    `site ${reason} ${resolved.reason}`,
    { origin: "site" },
  );
}

function scheduleSiteConfiguration(config, reason) {
  pendingSiteConfiguration = { config, reason };
  clearTimeout(siteConfigurationTimer);
  siteConfigurationTimer = setTimeout(() => {
    const pending = pendingSiteConfiguration;
    pendingSiteConfiguration = null;
    if (!pending) return;
    applySiteConfiguration(pending.config, pending.reason);
  }, 120);
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

function scheduleInteractiveRender() {
  if (interactiveRenderFrameId != null) return;
  interactiveRenderFrameId = requestAnimationFrame(() => {
    interactiveRenderFrameId = null;
    if (renderFrame(true)) interactionRenderedFrames += 1;
  });
}

function flushInteractiveRender() {
  if (interactiveRenderFrameId != null) {
    cancelAnimationFrame(interactiveRenderFrameId);
    interactiveRenderFrameId = null;
  }
  if (renderFrame(true)) interactionRenderedFrames += 1;
}

function setSourceInteraction(active, reason) {
  clearTimeout(interactionIdleTimer);
  interactionIdleTimer = null;
  if (active) {
    if (sourceInteractionActive) return;
    sourceInteractionActive = true;
    interactionStartedAt = performance.now();
    interactionRenderedFrames = 0;
    interactionSequence += 1;
    scheduleSenderQualityRefresh(`interaction ${reason} started`);
    updatePausedFrameHeartbeat();
    log(`Source interaction started sequence=${interactionSequence} reason=${reason} `
      + `output=${canvas.width}x${canvas.height}`);
    return;
  }
  if (!sourceInteractionActive) return;
  sourceInteractionActive = false;
  scheduleSenderQualityRefresh(`interaction ${reason} completed`);
  updatePausedFrameHeartbeat();
  log(`Source interaction completed sequence=${interactionSequence} reason=${reason} `
    + `durationMs=${Math.round(performance.now() - interactionStartedAt)} `
    + `rendered=${interactionRenderedFrames} output=${canvas.width}x${canvas.height}`);
}

function finishWheelInteraction() {
  clearTimeout(interactionIdleTimer);
  interactionIdleTimer = setTimeout(() => {
    interactionIdleTimer = null;
    flushInteractiveRender();
    setSourceInteraction(false, "zoom");
    schedulePreferencesSave(0);
  }, 220);
}

function schedulePreferencesSave(delayMs = 180) {
  clearTimeout(preferencesSaveTimer);
  preferencesSaveTimer = setTimeout(() => {
    preferencesSaveTimer = null;
    savePreferences();
  }, delayMs);
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
  setSourceInteraction(true, "zoom");
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
  scheduleInteractiveRender();
  schedulePreferencesSave();
  finishWheelInteraction();
}, { passive: false });

preview.addEventListener("pointerdown", (event) => {
  dragMode = spacePressed ? "preview" : "source";
  dragX = event.clientX;
  dragY = event.clientY;
  preview.setPointerCapture(event.pointerId);
  if (dragMode === "source" && sourceElement) setSourceInteraction(true, "drag");
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
    scheduleInteractiveRender();
  }
});

preview.addEventListener("pointerup", () => {
  const completedMode = dragMode;
  dragMode = "";
  if (completedMode === "source") {
    flushInteractiveRender();
    setSourceInteraction(false, "drag");
    savePreferences();
  }
});
preview.addEventListener("pointercancel", () => {
  if (dragMode === "source") {
    flushInteractiveRender();
    setSourceInteraction(false, "drag canceled");
  }
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
  if (dragMode === "source") setSourceInteraction(false, "window blur");
  dragMode = "";
});
window.addEventListener("resize", applyPreviewTransform);

document.getElementById("openButton").addEventListener("click", async () => {
  const file = await window.camPlayer.openMedia();
  if (file) loadMedia(file);
});
scanQrButton.addEventListener("click", async () => {
  scanQrButton.disabled = true;
  try {
    const result = await window.camPlayer.scanQr();
    if (result?.status === "copied") {
      showToast("QR copied");
    } else if (result?.status === "not-found") {
      showToast("QR not found");
    } else if (result?.status === "cancelled") {
      showToast("Selection cancelled");
    }
  } catch (error) {
    log(`QR scan failed ${error}`);
    showToast("QR scan failed");
  } finally {
    scanQrButton.disabled = false;
    scanQrButton.blur();
  }
});
document.getElementById("playButton").addEventListener("click", play);
document.getElementById("pauseButton").addEventListener("click", pause);
document.getElementById("applySizeButton").addEventListener("click", () => {
  try {
    applyOutputSize(widthInput.value, heightInput.value, "manual", { origin: "manual" });
  } catch (error) {
    alert(error.message || String(error));
  }
});
document.getElementById("resetSourceButton").addEventListener("click", () => {
  transforms[orientationForSize()] = { scale: 1, panX: 0, panY: 0 };
  renderFrame(true);
  scheduleKeyFrame("source reset", 0);
  savePreferences();
});
document.getElementById("fitPreviewButton").addEventListener("click", (event) => {
  showFullFrame();
  event.currentTarget.blur();
});
document.getElementById("rotateButton").addEventListener("click", () => {
  sourceRotation = (sourceRotation + 1) % 4;
  regenerateBackground("source rotation");
  scheduleKeyFrame("source rotation", 0);
  savePreferences();
});
document.getElementById("mirrorButton").addEventListener("click", (event) => {
  sourceMirrored = !sourceMirrored;
  event.currentTarget.setAttribute("aria-pressed", String(sourceMirrored));
  if (backgroundSnapshotReady) regenerateBackground("source mirror");
  else renderFrame(true);
  scheduleKeyFrame("source mirror", 0);
  savePreferences();
  log(`Source horizontal mirror=${sourceMirrored}`);
  event.currentTarget.blur();
});
function motionIsEnabled() {
  return motionMode.value !== "off";
}

function scheduleHandheldRender(now = performance.now()) {
  if (!motionIsEnabled() || !sourceElement || playing || handheldRenderFrameId != null) return;
  const configuredFps = Math.max(1, Math.min(60, Number(fpsInput.value) || 30));
  const motionFps = Math.min(
    configuredFps,
    30,
    Math.ceil(CamGeometry.adaptiveFrameRate(
      canvas.width,
      canvas.height,
      configuredFps,
      "interaction",
    ) * 1.5),
  );
  if (now - handheldLastRenderAt < 1000 / motionFps) return;
  handheldRenderFrameId = requestAnimationFrame(() => {
    handheldRenderFrameId = null;
    handheldLastRenderAt = performance.now();
    renderFrame(true);
  });
}

function stopRecordedMotion() {
  clearInterval(recordedMotionTimer);
  recordedMotionTimer = null;
  recordedMotionPlayer = null;
  activeMotionProfile = null;
}

function startRecordedMotion(profile) {
  stopRecordedMotion();
  activeMotionProfile = profile;
  recordedMotionPlayer = new CamMotionProfile.Player(profile);
  const startedAt = performance.now();
  recordedMotionPlayer.restart(startedAt);
  handheldController = new CamHandheld.Controller();
  handheldController.configure({
    enabled: true,
    motion: Number(motionInput.value),
    stabilization: Number(stabilizationInput.value),
  });
  const first = recordedMotionPlayer.sampleAt(startedAt);
  handheldController.ingest(first, startedAt);
  handheldController.recenter();
  recordedMotionTimer = setInterval(() => {
    const now = performance.now();
    handheldController.ingest(recordedMotionPlayer.sampleAt(now), now);
    scheduleHandheldRender(now);
  }, CamMotionProfile.SAMPLE_INTERVAL_MS);
  handheldStatus.textContent = `Recorded motion active: ${profile.name}`;
}

function renderMotionProfiles(selectedId = motionProfileSelect.value) {
  motionProfileSelect.textContent = "";
  if (!motionProfiles.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No saved profiles";
    motionProfileSelect.append(option);
  } else {
    for (const profile of motionProfiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = `${profile.name} (${Math.round(profile.durationMs / 1000)}s)`;
      motionProfileSelect.append(option);
    }
  }
  const availableId = motionProfiles.some((profile) => profile.id === selectedId)
    ? selectedId
    : motionProfiles[0]?.id || "";
  motionProfileSelect.value = availableId;
  const hasProfile = Boolean(availableId);
  motionProfileSelect.disabled = !hasProfile;
  renameMotionProfileButton.disabled = !hasProfile;
  deleteMotionProfileButton.disabled = !hasProfile;
  if (!hasProfile && motionMode.value === "recorded") motionMode.value = "off";
}

async function refreshMotionProfiles(selectedId) {
  motionProfiles = await window.camPlayer.listMotionProfiles();
  renderMotionProfiles(selectedId);
}

function applyMotionSettings(motion, stabilization) {
  motionInput.value = String(motion ?? 35);
  stabilizationInput.value = String(stabilization ?? 55);
  motionValue.value = motionInput.value;
  stabilizationValue.value = stabilizationInput.value;
}

async function activateRecordedProfile() {
  const profileId = motionProfileSelect.value;
  if (!profileId) {
    motionMode.value = "off";
    stopRecordedMotion();
    handheldController.configure({ enabled: false, motion: 0, stabilization: 0 });
    handheldStatus.textContent = "Record a motion profile first";
    return;
  }
  const profile = await window.camPlayer.readMotionProfile(profileId);
  if (!profile || !CamMotionProfile.validateProfile(profile)) {
    throw new Error("The selected motion profile is unavailable or damaged");
  }
  applyMotionSettings(profile.motion, profile.stabilization);
  startRecordedMotion(profile);
}

async function configureHandheld(reason, persist = true) {
  motionValue.value = motionInput.value;
  stabilizationValue.value = stabilizationInput.value;
  if (motionMode.value === "recorded") {
    await activateRecordedProfile();
  } else {
    stopRecordedMotion();
    handheldController = new CamHandheld.Controller();
    handheldController.configure({
      enabled: motionMode.value === "live",
      motion: Number(motionInput.value),
      stabilization: Number(stabilizationInput.value),
    });
    if (latestPhoneMotionAt > 0 && latestPhoneSample) {
      handheldController.ingest(latestPhoneSample, performance.now());
      handheldController.recenter();
    }
    if (motionMode.value === "live") {
      handheldStatus.textContent = latestPhoneMotionAt > 0
        ? "Live phone motion active"
        : "Waiting for phone motion";
    } else {
      handheldStatus.textContent = latestPhoneMotionAt > 0
        ? "Phone motion available"
        : "Waiting for phone motion";
    }
  }
  renderFrame(true);
  if (persist) {
    savePreferences();
    log(`Handheld configured mode=${motionMode.value} profile=${motionProfileSelect.value || "none"} `
      + `motion=${motionInput.value} stabilization=${stabilizationInput.value} reason=${reason}`);
  }
}

function scheduleActiveProfileSettingsSave() {
  if (motionMode.value !== "recorded" || !activeMotionProfile) return;
  const profile = activeMotionProfile;
  const motion = Number(motionInput.value);
  const stabilization = Number(stabilizationInput.value);
  clearTimeout(motionProfileSaveTimer);
  motionProfileSaveTimer = setTimeout(async () => {
    profile.motion = motion;
    profile.stabilization = stabilization;
    try {
      const summary = await window.camPlayer.saveMotionProfile(profile);
      const index = motionProfiles.findIndex((profile) => profile.id === summary.id);
      if (index >= 0) motionProfiles[index] = summary;
    } catch (error) {
      log(`Motion profile settings save failed ${error}`);
    }
  }, 300);
}

motionMode.addEventListener("change", async () => {
  try {
    if (motionMode.value === "live") applyMotionSettings(liveMotionSettings.motion, liveMotionSettings.stabilization);
    await configureHandheld("mode");
  } catch (error) {
    motionMode.value = "off";
    await configureHandheld("mode failure");
    showToast(error.message || String(error));
  }
});
motionProfileSelect.addEventListener("change", async () => {
  if (motionMode.value === "recorded") await configureHandheld("profile");
  else savePreferences();
});
function updateMotionStrengthPreview() {
  motionValue.value = motionInput.value;
  stabilizationValue.value = stabilizationInput.value;
  handheldController.configure({
    enabled: motionIsEnabled(),
    motion: Number(motionInput.value),
    stabilization: Number(stabilizationInput.value),
  });
  renderFrame(true);
}

motionInput.addEventListener("input", updateMotionStrengthPreview);
motionInput.addEventListener("change", () => {
  if (motionMode.value === "live") liveMotionSettings.motion = Number(motionInput.value);
  scheduleActiveProfileSettingsSave();
  updateMotionStrengthPreview();
  savePreferences();
  log(`Handheld motion=${motionInput.value} mode=${motionMode.value}`);
});
stabilizationInput.addEventListener("input", updateMotionStrengthPreview);
stabilizationInput.addEventListener("change", () => {
  if (motionMode.value === "live") liveMotionSettings.stabilization = Number(stabilizationInput.value);
  scheduleActiveProfileSettingsSave();
  updateMotionStrengthPreview();
  savePreferences();
  log(`Handheld stabilization=${stabilizationInput.value} mode=${motionMode.value}`);
});
recenterButton.addEventListener("click", () => {
  handheldController.recenter();
  renderFrame(true);
  log("Handheld recentered");
});

function defaultMotionProfileName() {
  const now = new Date();
  const date = now.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `Motion ${date} ${time}`;
}

function showMotionRecordingStatus(text) {
  motionRecordingStatus.textContent = text;
  motionRecordingStatus.hidden = false;
}

function resetMotionRecordingUi() {
  clearInterval(motionRecordingTimer);
  motionRecordingTimer = null;
  motionRecording = null;
  recordMotionButton.disabled = performance.now() - latestPhoneMotionAt > 2000;
  cancelMotionRecordingButton.hidden = true;
}

function cancelMotionRecording(reason = "cancelled") {
  if (!motionRecording) return;
  resetMotionRecordingUi();
  motionRecordingStatus.hidden = true;
  handheldStatus.textContent = "Motion recording cancelled";
  log(`Motion recording cancelled reason=${reason}`);
}

async function finishMotionRecording() {
  if (!motionRecording || motionRecording.phase === "processing") return;
  const samples = motionRecording.samples;
  motionRecording.phase = "processing";
  clearInterval(motionRecordingTimer);
  motionRecordingTimer = null;
  showMotionRecordingStatus("Processing...");
  cancelMotionRecordingButton.hidden = true;
  try {
    const profile = CamMotionProfile.prepareProfile(samples, {
      name: defaultMotionProfileName(),
      motion: Number(motionInput.value),
      stabilization: Number(stabilizationInput.value),
    });
    const summary = await window.camPlayer.saveMotionProfile(profile);
    await refreshMotionProfiles(summary.id);
    motionMode.value = "recorded";
    await configureHandheld("recording completed");
    showMotionRecordingStatus("Motion profile saved");
    setTimeout(() => {
      if (!motionRecording) motionRecordingStatus.hidden = true;
    }, 3000);
    log(`Motion recording completed samples=${samples.length} profile=${summary.id}`);
  } catch (error) {
    motionRecordingStatus.hidden = true;
    handheldStatus.textContent = "Motion profile was not saved";
    showToast(error.message || String(error));
    log(`Motion recording failed ${error.stack || error}`);
  } finally {
    resetMotionRecordingUi();
  }
}

function updateMotionRecordingClock() {
  if (!motionRecording) return;
  const now = performance.now();
  if (motionRecording.phase === "countdown") {
    const remaining = Math.max(0, Math.ceil((motionRecording.startsAt - now) / 1000));
    showMotionRecordingStatus(`Starting in ${remaining}...`);
    if (now >= motionRecording.startsAt) {
      motionRecording.phase = "recording";
      motionRecording.startedAt = now;
      motionRecording.endsAt = now + CamMotionProfile.RECORDING_DURATION_MS;
      motionRecording.samples = [];
      showMotionRecordingStatus("Recording 00:00 / 00:30");
      log("Motion recording started durationMs=30000");
    }
    return;
  }
  if (motionRecording.phase !== "recording") return;
  if (now - latestPhoneMotionAt > 2000) {
    const message = "Phone motion connection was lost";
    cancelMotionRecording(message);
    showToast(message);
    return;
  }
  const elapsedMs = Math.min(CamMotionProfile.RECORDING_DURATION_MS, now - motionRecording.startedAt);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  showMotionRecordingStatus(`Recording 00:${String(elapsedSeconds).padStart(2, "0")} / 00:30`);
  if (now >= motionRecording.endsAt) finishMotionRecording();
}

recordMotionButton.addEventListener("click", () => {
  if (performance.now() - latestPhoneMotionAt > 2000) {
    showToast("Connect Source and start Cam Player mode first");
    return;
  }
  motionRecording = {
    phase: "countdown",
    startsAt: performance.now() + 3000,
    samples: [],
  };
  recordMotionButton.disabled = true;
  cancelMotionRecordingButton.hidden = false;
  showMotionRecordingStatus("Starting in 3...");
  motionRecordingTimer = setInterval(updateMotionRecordingClock, 100);
  log("Motion recording countdown started seconds=3");
});
cancelMotionRecordingButton.addEventListener("click", () => cancelMotionRecording("user"));
rememberMotionStateToggle.addEventListener("change", savePreferences);
renameMotionProfileButton.addEventListener("click", async () => {
  const current = motionProfiles.find((profile) => profile.id === motionProfileSelect.value);
  if (!current) return;
  const name = window.prompt("Motion profile name", current.name);
  if (name == null || !name.trim()) return;
  const renamed = await window.camPlayer.renameMotionProfile(current.id, name.trim());
  await refreshMotionProfiles(renamed.id);
  if (activeMotionProfile?.id === renamed.id) {
    activeMotionProfile.name = renamed.name;
    handheldStatus.textContent = `Recorded motion active: ${renamed.name}`;
  }
  savePreferences();
});
deleteMotionProfileButton.addEventListener("click", async () => {
  const current = motionProfiles.find((profile) => profile.id === motionProfileSelect.value);
  if (!current || !window.confirm(`Delete motion profile "${current.name}"?`)) return;
  await window.camPlayer.deleteMotionProfile(current.id);
  await refreshMotionProfiles();
  if (!motionProfiles.length || activeMotionProfile?.id === current.id) {
    motionMode.value = "off";
    await configureHandheld("profile deleted");
  } else if (motionMode.value === "recorded") {
    await configureHandheld("profile deleted");
  }
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
video.addEventListener("seeked", () => {
  sourceTextureDirty = true;
  renderFrame(true);
  scheduleKeyFrame("video seek", 0);
});
recentFiles.addEventListener("change", () => {
  const selected = recent.find((item) => item.path === recentFiles.value);
  if (selected) {
    prepareAndLoadMediaPath(selected.path, "recent");
  }
  recentFiles.value = "";
});
clearRecentButton.addEventListener("click", (event) => {
  const count = recent.length;
  recent = [];
  renderRecent();
  savePreferences();
  log(`Recent files cleared count=${count}`);
  event.currentTarget.blur();
});

function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

document.addEventListener("dragenter", (event) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  fileDragDepth += 1;
  preview.classList.add("drag-over");
});
document.addEventListener("dragover", (event) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
document.addEventListener("dragleave", (event) => {
  if (fileDragDepth === 0) return;
  event.preventDefault();
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (fileDragDepth === 0) preview.classList.remove("drag-over");
});
document.addEventListener("drop", (event) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  fileDragDepth = 0;
  preview.classList.remove("drag-over");
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;
  let filePath = "";
  try {
    filePath = window.camPlayer.pathForDroppedFile(files[0]);
  } catch (error) {
    log(`Dropped file path unavailable ${error}`);
    alert("Unable to open the dropped file");
    return;
  }
  if (files.length > 1) log(`Media drop received files=${files.length}; opening first only`);
  prepareAndLoadMediaPath(filePath, "drop");
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
    if (input === fpsInput) scheduleSenderQualityRefresh("maximum FPS changed");
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
window.camPlayer.onOfferCancel(({ id, reason }) => {
  closePeer(id, reason || "offer canceled");
});
window.camPlayer.onSourceClose(({ sessionId, reason }) => {
  const matches = Array.from(peerMaintenance.entries())
    .filter(([, maintenance]) => !sessionId || maintenance?.sessionId === sessionId)
    .map(([id]) => id);
  for (const id of matches) closePeer(id, reason || "Source requested close");
  log(`Source close applied sessionId=${sessionId || "all"} peers=${matches.length}`);
});
window.camPlayer.onConfig((config) => scheduleSiteConfiguration(config, "live configuration"));
function applyServerInfo(info) {
  currentServerInfo = info;
  document.getElementById("networkValue").textContent =
    CamGeometry.formatNetworkInterfaces(info.interfaces, info.port) || `Port: ${info.port}`;
  document.getElementById("pairingCodeValue").textContent = info.pairingCode;
  updateConnectionState();
}
window.camPlayer.onServerInfo(applyServerInfo);
window.camPlayer.onLog(appendLog);
window.camPlayer.onHandheldMotion((sample) => {
  const now = performance.now();
  latestPhoneSample = sample;
  latestPhoneMotionAt = now;
  handheldSamples += 1;
  recenterButton.disabled = false;
  if (!motionRecording) recordMotionButton.disabled = false;
  if (motionRecording?.phase === "recording") {
    const elapsed = now - motionRecording.startedAt;
    if (elapsed >= 0 && elapsed <= CamMotionProfile.RECORDING_DURATION_MS) {
      motionRecording.samples.push({
        ...sample,
        quaternion: Array.from(sample.quaternion || []),
        gyro: Array.from(sample.gyro || []),
        acceleration: Array.from(sample.acceleration || []),
        t: elapsed,
      });
    }
  }
  if (motionMode.value === "live") {
    handheldController.ingest(sample, now);
    handheldStatus.textContent = "Live phone motion active";
    scheduleHandheldRender(now);
  } else if (motionMode.value === "off") {
    handheldStatus.textContent = "Phone motion available";
  }
  if (now - handheldMetricsStartedAt >= 10000) {
    const motion = handheldController.output(canvas.width, canvas.height);
    log(`Handheld samples rateHz=${(handheldSamples * 1000 / (now - handheldMetricsStartedAt)).toFixed(1)} `
      + `mode=${motionMode.value} recording=${motionRecording?.phase || "none"} `
      + `pan=${motion.panX.toFixed(1)},${motion.panY.toFixed(1)} `
      + `rollDeg=${(motion.roll * 180 / Math.PI).toFixed(2)}`);
    handheldSamples = 0;
    handheldMetricsStartedAt = now;
  }
});

async function initialize() {
  const preferences = await window.camPlayer.readPreferences();
  const restoreAfterContextLoss = sessionStorage.getItem("camexchRestoreMedia") || "";
  sessionStorage.removeItem("camexchRestoreMedia");
  applyServerInfo(await window.camPlayer.getServerInfo());
  recent = Array.isArray(preferences.recent) ? preferences.recent : [];
  renderRecent();
  fpsInput.value = String(
    Number(preferences.preferencesVersion) >= 2 ? preferences.fps || 60 : 60,
  );
  blurInput.value = String(preferences.blur ?? 40);
  followSiteToggle.checked = !!preferences.followSite;
  fallbackResolutionToggle.checked = preferences.fallbackResolution === true;
  document.getElementById("loopToggle").checked = preferences.loop !== false;
  sourceMirrored = preferences.mirrored === true;
  document.getElementById("mirrorButton")
    .setAttribute("aria-pressed", String(sourceMirrored));
  liveMotionSettings = {
    motion: Number(preferences.liveMotion ?? preferences.motion ?? 35),
    stabilization: Number(preferences.liveStabilization ?? preferences.stabilization ?? 55),
  };
  rememberMotionStateToggle.checked = preferences.rememberMotionEnabled == null
    ? preferences.handheld === true
    : preferences.rememberMotionEnabled === true;
  await refreshMotionProfiles(preferences.selectedMotionProfileId);
  const storedMotionMode = preferences.motionMode
    || (preferences.handheld === true ? "live" : "off");
  motionMode.value = rememberMotionStateToggle.checked ? storedMotionMode : "off";
  if (motionMode.value === "recorded" && !motionProfileSelect.value) motionMode.value = "off";
  if (motionMode.value === "recorded") {
    const summary = motionProfiles.find((profile) => profile.id === motionProfileSelect.value);
    applyMotionSettings(summary?.motion ?? 35, summary?.stabilization ?? 55);
  } else {
    applyMotionSettings(liveMotionSettings.motion, liveMotionSettings.stabilization);
  }
  recenterButton.disabled = true;
  recordMotionButton.disabled = true;
  if (preferences.lastWorkingOutput?.width && preferences.lastWorkingOutput?.height) {
    lastWorkingOutput = {
      width: Number(preferences.lastWorkingOutput.width),
      height: Number(preferences.lastWorkingOutput.height),
    };
  }
  try {
    manualOutput = {
      width: Number(preferences.width) || 720,
      height: Number(preferences.height) || 1280,
    };
    applyOutputSize(
      manualOutput.width,
      manualOutput.height,
      "startup",
      { origin: "manual" },
    );
  } catch (error) {
    applyOutputSize(720, 1280, "startup fallback", { origin: "manual" });
    log(`Stored output size rejected ${error}`);
  }
  try {
    await configureHandheld("startup", false);
  } catch (error) {
    motionMode.value = "off";
    await configureHandheld("startup profile failure", false);
    log(`Stored motion profile unavailable ${error}`);
  }
  clearInterval(timelineTimer);
  timelineTimer = setInterval(updateTimeline, 200);
  clearInterval(memoryTimer);
  memoryTimer = setInterval(logRuntimeMetrics, 30000);
  setTimeout(logRuntimeMetrics, 5000);
  applyPreviewTransform();
  logOutput.textContent = await window.camPlayer.readLogTail();
  updateConnectionState();
  if (restoreAfterContextLoss) {
    try {
      const selected = await window.camPlayer.prepareMedia(restoreAfterContextLoss);
      await loadMedia(selected);
      log(`Restored selected media after WebGL recovery path=${restoreAfterContextLoss}`);
    } catch (error) {
      log(`WebGL recovery media unavailable ${error}`);
    }
  }
}

canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  log(`WebGL context lost output=${canvas.width}x${canvas.height}; reloading renderer`);
  if (currentFile?.path) sessionStorage.setItem("camexchRestoreMedia", currentFile.path);
  savePreferences();
  setTimeout(() => location.reload(), 250);
});

window.addEventListener("beforeunload", () => {
  if (handheldRenderFrameId != null) cancelAnimationFrame(handheldRenderFrameId);
  clearInterval(recordedMotionTimer);
  clearInterval(motionRecordingTimer);
  clearTimeout(motionProfileSaveTimer);
  stopVideoFrameLoop();
  stopPausedFrameHeartbeat();
  clearInterval(timelineTimer);
  clearInterval(memoryTimer);
  clearTimeout(backgroundBlurTimer);
  clearTimeout(senderQualityRefreshTimer);
  clearTimeout(keyFrameTimer);
  clearTimeout(siteConfigurationTimer);
  clearTimeout(preferencesSaveTimer);
  if (interactiveRenderFrameId != null) cancelAnimationFrame(interactiveRenderFrameId);
  for (const id of Array.from(peers.keys())) closePeer(id, "renderer unload");
  stream?.getTracks().forEach((track) => track.stop());
});

initialize();
