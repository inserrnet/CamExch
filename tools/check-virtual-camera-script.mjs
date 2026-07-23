import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  "browser/src/main/java/com/camexch/browser/VirtualCameraScript.java",
  "utf8",
);
const start = source.indexOf("static final String SCRIPT =");
const end = source.indexOf("private VirtualCameraScript", start);
if (start < 0 || end < 0) {
  throw new Error("Unable to locate VirtualCameraScript.SCRIPT");
}

const expression = source.slice(start, end);
const pieces = [...expression.matchAll(/"((?:\\.|[^"\\])*)"/gs)].map((match) =>
  JSON.parse(`"${match[1]}"`),
);
const script = pieces.join("");
new Function(script);

for (const marker of [
  "WebRTC preferred codec=H264",
  "WebRTC track settings size=",
  "WebRTC inbound size=",
  "WebRTC receiver low-latency hints",
  "WebRTC frame latencyMs=",
  "getUserMedia resolved elapsedMs=",
  "getUserMedia route gateway target=",
  "getUserMedia wrapper observed target=",
  "camera route devicechange mode=",
  "synchronous iframe interception ready",
  "synchronous iframe hook source=",
  "track applyConstraints requestedRoute=",
  "RTCRtpSender.replaceTrack",
  "stopped camera stream revived route=",
  "managed WebRTC senders replaced=",
  "managed MediaStream clone registered",
  "live camera track reattached to existing MediaStream",
  "detachedRetained=",
  "RTCPeerConnection.removeTrack",
  "managed camera session discarded reason=",
  "page unhandledrejection",
  "source standby first track ready",
  "high resolution rear native direct size=",
  "shared source WebRTC released idle=true",
]) {
  if (!script.includes(marker)) {
    throw new Error(`Missing browser telemetry marker: ${marker}`);
  }
}

const nativeDevices = [
  { kind: "videoinput", deviceId: "rear-id", label: "camera 2, facing back", groupId: "rear" },
  { kind: "videoinput", deviceId: "main-rear-id", label: "camera 0, facing back", groupId: "main-rear" },
  { kind: "videoinput", deviceId: "front-id", label: "camera2 2, facing front", groupId: "front" },
];
let nativeGetCount = 0;
let continuousFocusCount = 0;
let canvasDrawCount = 0;
let canvasRequestFrameCount = 0;
let sourceOnline = false;
let deviceChangeCount = 0;
class FakeTrack {
  constructor(deviceId = "rear-id") {
    this.kind = "video";
    this.id = `track-${deviceId}`;
    this.label = deviceId === "front-id" ? "Front camera" : "Back camera";
    this.readyState = "live";
    this.muted = false;
    this.enabled = true;
    this.deviceId = deviceId;
  }

  getSettings() {
    return {
      facingMode: "environment",
      deviceId: this.deviceId,
      width: 1280,
      height: 720,
      frameRate: 30,
    };
  }

  getCapabilities() {
    return { focusMode: ["manual", "continuous"] };
  }

  async applyConstraints(constraints) {
    this.lastConstraints = constraints;
    if (constraints?.advanced?.[0]?.focusMode === "continuous") {
      continuousFocusCount += 1;
    }
  }

  clone() {
    return new FakeTrack(this.deviceId);
  }

  stop() {
    this.readyState = "ended";
  }
}

class FakeMediaStreamTrackGenerator extends FakeTrack {
  constructor() {
    super();
    this.kind = "video";
    this.writable = {
      getWriter: () => ({
        write: async () => {},
        close: async () => {},
      }),
    };
  }
}

class FakeMediaStreamTrackProcessor {
  constructor() {
    let delivered = false;
    let finish;
    this.readable = {
      getReader: () => ({
        read: () => {
          if (!delivered) {
            delivered = true;
            return Promise.resolve({ done: false, value: { close: () => {} } });
          }
          return new Promise((resolve) => { finish = resolve; });
        },
        cancel: () => {
          if (finish) finish({ done: true });
          return Promise.resolve();
        },
        releaseLock: () => {},
      }),
    };
  }
}

class FakeSourceTrack extends FakeTrack {
  constructor() {
    super("source-id");
    this.label = "RTSP source";
    this.muted = true;
  }

  getSettings() {
    return {
      facingMode: "user",
      deviceId: "source-id",
      width: 944,
      height: 960,
      frameRate: 30,
    };
  }

  clone() {
    const clone = new FakeSourceTrack();
    clone.muted = false;
    return clone;
  }
}

class FakeHighResolutionRearTrack extends FakeTrack {
  constructor() {
    super("main-rear-id");
  }

  getSettings() {
    return {
      facingMode: "environment",
      deviceId: this.deviceId,
      width: 3000,
      height: 4000,
      frameRate: 30,
    };
  }
}

class FakeRTCRtpSender {
  constructor(track) {
    this.track = track;
    this.replaceCount = 0;
  }

  async replaceTrack(track) {
    this.track = track;
    this.replaceCount += 1;
  }
}

class FakeRTCPeerConnection {
  constructor() {
    this.iceGatheringState = "complete";
    this.connectionState = "connected";
    this.senders = [];
  }

  addTrack(track) {
    const sender = new FakeRTCRtpSender(track);
    this.senders.push(sender);
    return sender;
  }

  addTransceiver(trackOrKind) {
    const sender = new FakeRTCRtpSender(typeof trackOrKind === "string" ? null : trackOrKind);
    this.senders.push(sender);
    return { sender, setCodecPreferences: () => {} };
  }

  getSenders() {
    return this.senders;
  }

  removeTrack(sender) {
    sender.track = null;
  }

  async createOffer() {
    return { type: "offer", sdp: "fake-offer" };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
  }

  async setRemoteDescription() {
    queueMicrotask(() => this.ontrack?.({
      track: new FakeSourceTrack(),
      receiver: { playoutDelayHint: null, jitterBufferTarget: null },
    }));
  }

  addEventListener() {}

  removeEventListener() {}

  close() {
    this.connectionState = "closed";
  }
}

class FakeCanvasTrack extends FakeTrack {
  requestFrame() {
    canvasRequestFrameCount += 1;
  }
}

class FakeCanvas {
  constructor() {
    this.width = 300;
    this.height = 150;
  }

  getContext() {
    return { drawImage: () => { canvasDrawCount += 1; } };
  }

  captureStream() {
    return new FakeStream([new FakeCanvasTrack("canvas")]);
  }
}

class FakeVideo {
  constructor() {
    this.listeners = new Map();
    this.readyState = 0;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.callbackCount = 0;
    this.playCount = 0;
  }

  set srcObject(stream) {
    this.stream = stream;
    if (!stream) {
      this.readyState = 0;
      return;
    }
    const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
    if (settings.deviceId === "no-frame") {
      this.videoWidth = 0;
      this.videoHeight = 0;
      this.readyState = 0;
      return;
    }
    this.videoWidth = settings.width || 640;
    this.videoHeight = settings.height || 480;
    this.readyState = 2;
    this.callbackCount = 0;
    queueMicrotask(() => {
      for (const name of ["loadedmetadata", "loadeddata"]) {
        const callback = this.listeners.get(name);
        if (callback) callback();
      }
    });
  }

  get srcObject() {
    return this.stream;
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }

  async play() {
    this.playCount += 1;
  }

  pause() {}

  requestVideoFrameCallback(callback) {
    if (this.callbackCount < 2 && this.readyState >= 2) {
      this.callbackCount += 1;
      queueMicrotask(() => callback(10));
    }
  }
}

class FakeStream {
  constructor(videoTracks = []) {
    this.videoTracks = videoTracks;
  }

  get active() {
    return this.videoTracks.some((track) => track.readyState !== "ended");
  }

  getVideoTracks() {
    return this.videoTracks;
  }

  getAudioTracks() {
    return [];
  }

  getTracks() {
    return [...this.videoTracks];
  }

  addTrack(track) {
    this.videoTracks.push(track);
  }

  removeTrack(track) {
    this.videoTracks = this.videoTracks.filter((candidate) => candidate !== track);
  }

  clone() {
    return new FakeStream(this.videoTracks.map((track) => track.clone()));
  }
}

class FakeMediaDevices {
  constructor() {
    this.listeners = new Map();
  }

  async getUserMedia(constraints) {
    nativeGetCount += 1;
    const requestedId = constraints?.video?.deviceId?.exact;
    return new FakeStream(constraints?.video ? [new FakeTrack(requestedId || "rear-id")] : []);
  }

  async enumerateDevices() {
    return nativeDevices;
  }

  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }

  dispatchEvent(event) {
    if (event?.type === "devicechange") deviceChangeCount += 1;
    for (const callback of this.listeners.get(event?.type) || []) callback.call(this, event);
    return true;
  }
}
const nativeBypassGetUserMedia = FakeMediaDevices.prototype.getUserMedia;

class FakeNode {
  constructor() {
    this.children = [];
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  insertBefore(node) {
    this.children.unshift(node);
    return node;
  }

  replaceChild(node, previous) {
    const index = this.children.indexOf(previous);
    if (index >= 0) this.children[index] = node;
    return previous;
  }

  querySelectorAll(selector) {
    const result = [];
    const visit = (node) => {
      if (selector === "iframe" && node?.tagName === "IFRAME") result.push(node);
      for (const child of node?.children || []) visit(child);
    };
    for (const child of this.children) visit(child);
    return result;
  }
}

class FakeElement extends FakeNode {
  constructor(tagName = "DIV") {
    super();
    this.tagName = tagName;
    this.html = "";
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  prepend(...nodes) {
    this.children.unshift(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  get innerHTML() {
    return this.html;
  }

  set innerHTML(value) {
    this.html = String(value);
  }

  insertAdjacentHTML(_position, value) {
    this.html += String(value);
  }
}

class FakeIFrameElement extends FakeElement {
  constructor(childWindow) {
    super("IFRAME");
    this.childWindow = childWindow;
  }

  get contentWindow() {
    return this.childWindow;
  }

  get contentDocument() {
    return { defaultView: this.childWindow };
  }

  addEventListener() {}
}

const context = {
  location: { href: "https://camera-routing.test/", origin: "https://camera-routing.test" },
  navigator: { mediaDevices: new FakeMediaDevices() },
  MediaDevices: FakeMediaDevices,
  MediaStream: FakeStream,
  MediaStreamTrack: FakeTrack,
  MediaStreamTrackGenerator: FakeMediaStreamTrackGenerator,
  MediaStreamTrackProcessor: FakeMediaStreamTrackProcessor,
  RTCPeerConnection: FakeRTCPeerConnection,
  RTCRtpSender: FakeRTCRtpSender,
  RTCRtpReceiver: {
    getCapabilities: () => ({
      codecs: [{ mimeType: "video/H264" }],
    }),
  },
  HTMLMediaElement: FakeVideo,
  Node: FakeNode,
  Element: FakeElement,
  HTMLIFrameElement: FakeIFrameElement,
  Event: class FakeEvent {
    constructor(type) {
      this.type = type;
    }
  },
  document: {
    querySelectorAll: () => [],
    documentElement: null,
    createElement: (name) => name === "canvas" ? new FakeCanvas() : new FakeVideo(),
  },
  addEventListener: () => {},
  requestAnimationFrame: () => 1,
  setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 5)),
  clearTimeout,
  clearInterval,
  setInterval: () => 1,
};
context.window = context;
context.globalThis = context;
context.CamExchBridge = {
  authorizeNativeCamera: () => "OK",
  getCameraRouteMode: () => "AUTO",
  getMode: () => sourceOnline ? "RTSP" : "ERROR:source offline",
  answerOffer: () => sourceOnline ? "fake-answer" : "ERROR:source offline",
};
const testScript = script.replace(
  /\}\)\(\);$/,
  "globalThis.__camexchForTest={route:isVirtualRequest,native:constraintsForNative,routedGet:routeGet,managed:managedStreams,proxy:createRouteProxy,configure:configureManagedController,install:installHooks,installFrame:installFrame};})();",
);
vm.runInNewContext(testScript, context);

const canvasBeforeHighResolutionProxy = canvasDrawCount;
const highResolutionDirect = context.__camexchForTest.proxy(
  new FakeStream([new FakeHighResolutionRearTrack()]),
  "REAR",
);
context.__camexchForTest.configure(highResolutionDirect, { video: true });
if (highResolutionDirect.kind !== "native-direct"
    || highResolutionDirect.track.getSettings().width !== 3000
    || canvasDrawCount !== canvasBeforeHighResolutionProxy) {
  throw new Error("High-resolution rear camera was not exposed as a native track");
}
highResolutionDirect.hardStop();

let earlyIframeNativeCalls = 0;
class EarlyIframeMediaDevices {
  async getUserMedia() {
    earlyIframeNativeCalls += 1;
    return new FakeStream([new FakeTrack("front-id")]);
  }

  async enumerateDevices() {
    return nativeDevices;
  }
}
const makeEarlyIframeWindow = () => ({
  navigator: { mediaDevices: new EarlyIframeMediaDevices() },
  MediaDevices: EarlyIframeMediaDevices,
  location: { origin: "https://camera-routing.test" },
  document: {},
});
const earlyAccessWindow = makeEarlyIframeWindow();
const earlyAccessFrame = new FakeIFrameElement(earlyAccessWindow);
const capturedEarlyGetUserMedia = earlyAccessFrame.contentWindow.navigator.mediaDevices.getUserMedia;
let earlyAccessFailure;
try {
  await capturedEarlyGetUserMedia.call(
    earlyAccessWindow.navigator.mediaDevices,
    { video: { facingMode: "user" } },
  );
} catch (error) {
  earlyAccessFailure = error;
}
if (!earlyAccessWindow.__camexchInstalled
    || earlyAccessFailure?.name !== "NotReadableError"
    || earlyIframeNativeCalls !== 0) {
  throw new Error("Immediate iframe contentWindow capture bypassed camera routing");
}

const earlyDocumentWindow = makeEarlyIframeWindow();
const earlyDocumentFrame = new FakeIFrameElement(earlyDocumentWindow);
const capturedDocumentGetUserMedia = earlyDocumentFrame.contentDocument.defaultView
  .navigator.mediaDevices.getUserMedia;
let earlyDocumentFailure;
try {
  await capturedDocumentGetUserMedia.call(
    earlyDocumentWindow.navigator.mediaDevices,
    { video: { facingMode: "user" } },
  );
} catch (error) {
  earlyDocumentFailure = error;
}
if (!earlyDocumentWindow.__camexchInstalled
    || earlyDocumentFailure?.name !== "NotReadableError"
    || earlyIframeNativeCalls !== 0) {
  throw new Error("Immediate iframe contentDocument capture bypassed camera routing");
}

const insertedWindow = makeEarlyIframeWindow();
const insertedFrame = new FakeIFrameElement(insertedWindow);
new FakeElement().appendChild(insertedFrame);
if (!insertedWindow.__camexchInstalled) {
  throw new Error("Synchronous iframe insertion did not install camera routing");
}

await context.navigator.mediaDevices.enumerateDevices();

const route = context.__camexchForTest.route;
const cases = [
  [{ video: { facingMode: "user" } }, true, "explicit user"],
  [{ video: { facingMode: { exact: "environment" } } }, false, "explicit environment"],
  [{ video: { deviceId: { exact: "camexch-front-camera-4" } } }, true, "virtual id"],
  [{ video: { deviceId: { exact: "camexch-back-camera" } } }, false, "synthetic back id"],
  [{ video: { deviceId: { exact: "front-id" } } }, true, "enumerated front id"],
  [{ video: { deviceId: { exact: "rear-id" } } }, false, "enumerated rear id"],
  [{ video: { deviceId: { exact: "unknown-id" } } }, true, "unknown device id"],
  [{ video: true }, true, "browser default"],
  [{ video: {} }, true, "empty constraints"],
];
for (const [constraints, expected, name] of cases) {
  const actual = route(constraints);
  if (actual !== expected) {
    throw new Error(`Camera route ${name}: expected ${expected}, got ${actual}`);
  }
}

const environmentWithVirtualId = context.__camexchForTest.native({
  video: {
    facingMode: "environment",
    deviceId: { exact: "camexch-front-camera-4" },
    width: { ideal: 1920 },
  },
  audio: false,
});
if (environmentWithVirtualId.video.deviceId !== undefined) {
  throw new Error("Virtual deviceId was passed to the physical rear camera");
}
if (environmentWithVirtualId.video.facingMode !== "environment"
    || environmentWithVirtualId.video.width.ideal !== 1920) {
  throw new Error("Rear camera constraints were not preserved");
}

const mapped = await context.navigator.mediaDevices.enumerateDevices();
if (mapped.find((device) => device.deviceId === "rear-id")?.label !== "camera 2, facing back") {
  throw new Error("Rear camera label was incorrectly replaced");
}
if (mapped.find((device) => device.kind === "videoinput")?.deviceId !== "main-rear-id") {
  throw new Error("The primary camera 0 was not preferred over secondary rear modules");
}
if (mapped.find((device) => device.deviceId === "front-id")?.label !== "Front Camera 4") {
  throw new Error("Front camera label was not replaced");
}
if (mapped.some((device) => device.deviceId === "camexch-back-camera")) {
  throw new Error("Synthetic back camera duplicated a visible physical back camera");
}

const originalRearStream = await context.navigator.mediaDevices.getUserMedia(
  { video: { facingMode: "environment" } },
);
const stableRearTrack = originalRearStream.getVideoTracks()[0];
if (nativeGetCount !== 1) {
  throw new Error("Rear camera request did not reach the native camera exactly once");
}
const initialManagedEntry = Array.from(context.__camexchForTest.managed)[0];
if (initialManagedEntry.controller.sourceTrack.getSettings().deviceId !== "main-rear-id") {
  throw new Error("Environment request did not select the primary camera 0 deviceId");
}
if (stableRearTrack.getSettings().facingMode !== "environment"
    || stableRearTrack.label !== "Back camera") {
  throw new Error("Managed rear track did not expose physical rear identity");
}
await stableRearTrack.applyConstraints({ width: { ideal: 640 } });
if (nativeGetCount !== 1
    || initialManagedEntry.controller.sourceTrack.lastConstraints?.width?.ideal !== 640) {
  throw new Error("Same-route applyConstraints did not stay on the active rear camera");
}
const sourceBeforeConstraintSwitch = initialManagedEntry.controller.sourceTrack;
let constraintSourceFailure;
try {
  await stableRearTrack.applyConstraints({ facingMode: { exact: "user" } });
} catch (error) {
  constraintSourceFailure = error;
}
if (!constraintSourceFailure || constraintSourceFailure.name !== "NotReadableError"
    || initialManagedEntry.controller.route !== "REAR"
    || initialManagedEntry.controller.sourceTrack !== sourceBeforeConstraintSwitch
    || sourceBeforeConstraintSwitch.readyState !== "live"
    || nativeGetCount !== 1) {
  throw new Error("Failed applyConstraints route switch did not preserve the active rear camera");
}
await new Promise((resolve) => setTimeout(resolve, 0));
if (initialManagedEntry.controller.kind !== "canvas-direct"
    || canvasDrawCount < 1 || canvasRequestFrameCount < 1) {
  throw new Error("Production canvas proxy did not publish an output frame");
}
const sourceBeforeTimeout = initialManagedEntry.controller.sourceTrack;
const noFrameTrack = new FakeTrack("no-frame");
let noFrameFailure;
try {
  await initialManagedEntry.controller.switchTo(new FakeStream([noFrameTrack]));
} catch (error) {
  noFrameFailure = error;
}
if (!noFrameFailure || noFrameTrack.readyState !== "ended"
    || initialManagedEntry.controller.sourceTrack !== sourceBeforeTimeout
    || stableRearTrack.readyState !== "live") {
  throw new Error("No-frame camera switch did not time out and roll back safely");
}

let switchedFrontFailure;
try {
  await context.navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
} catch (error) {
  switchedFrontFailure = error;
}
if (!switchedFrontFailure || switchedFrontFailure.name !== "NotReadableError") {
  throw new Error("Rear-to-front switch did not route to Front Camera 4");
}
if (nativeGetCount !== 1) {
  throw new Error("Rear-to-front switch opened a physical front camera");
}

let frontDeviceFailure;
try {
  await context.navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: "front-id" } },
  });
} catch (error) {
  frontDeviceFailure = error;
}
if (!frontDeviceFailure || nativeGetCount !== 1) {
  throw new Error("Enumerated front deviceId bypassed Front Camera 4");
}

const failedSourceSwitch = await context.__camexchSwitchCamera("SOURCE");
if (failedSourceSwitch.switched !== 0 || failedSourceSwitch.failed !== 1
    || nativeGetCount !== 1) {
  throw new Error("Failed active source switch did not preserve the physical camera");
}
const rearSwitch = await context.__camexchSwitchCamera("REAR");
if (rearSwitch.switched !== 1 || rearSwitch.failed !== 0 || nativeGetCount !== 1) {
  throw new Error("Selecting the active rear camera reopened Camera2");
}
const managedEntry = Array.from(context.__camexchForTest.managed)[0];
if (managedEntry.stream !== originalRearStream
    || managedEntry.stream.getVideoTracks()[0] !== stableRearTrack
    || stableRearTrack.readyState !== "live") {
  throw new Error("Camera switch changed or stopped the page's stable video track");
}
const pageVideo = new FakeVideo();
pageVideo.srcObject = originalRearStream;
pageVideo.isConnected = false;
pageVideo.srcObject = null;
stableRearTrack.stop();
if (stableRearTrack.readyState !== "ended"
    || managedEntry.controller.sourceTrack.readyState !== "ended") {
  throw new Error("Page stop did not end the proxy and physical source tracks");
}
const stoppedSourceSwitch = await context.__camexchSwitchCamera("SOURCE");
if (stoppedSourceSwitch.switched !== 0 || stoppedSourceSwitch.revived !== 0
    || stoppedSourceSwitch.failed !== 1
    || pageVideo.srcObject !== null || nativeGetCount !== 1) {
  throw new Error("Unavailable Source did not leave the stopped camera session intact");
}
let nextFrontFailure;
try {
  await context.navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
  });
} catch (error) {
  nextFrontFailure = error;
}
if (!nextFrontFailure || nativeGetCount !== 1) {
  throw new Error("F mode did not route the site's next camera request to Source");
}
await context.__camexchSwitchCamera("AUTO");

const syntheticBack = context.__camexchForTest.native({
  video: {
    facingMode: "user",
    deviceId: { exact: "camexch-back-camera" },
    width: { ideal: 1920 },
  },
});
if (syntheticBack.video.deviceId !== undefined
    || syntheticBack.video.facingMode !== "environment"
    || syntheticBack.video.width.ideal !== 1920) {
  throw new Error("Synthetic back camera was not converted to a native environment request");
}

nativeDevices.splice(0, nativeDevices.length,
  { kind: "videoinput", deviceId: "", label: "", groupId: "" },
);
const anonymousMapped = await context.navigator.mediaDevices.enumerateDevices();
if (!anonymousMapped.some((device) => device.deviceId === "camexch-front-camera-4")) {
  throw new Error("Front Camera 4 is missing while native devices are anonymous");
}
if (!anonymousMapped.some((device) => device.deviceId === "camexch-back-camera")) {
  throw new Error("Back Camera is missing while native devices are anonymous");
}

stableRearTrack.stop();
await FakeMediaDevices.prototype.getUserMedia.call(
  context.navigator.mediaDevices,
  { video: { facingMode: "environment" } },
);
if (nativeGetCount !== 2 || stableRearTrack.readyState !== "ended"
    || context.__camexchForTest.managed.size !== 1) {
  throw new Error("MediaDevices.prototype.getUserMedia bypassed the camera router");
}

const autoSwitch = await context.__camexchSwitchCamera("AUTO");
if (autoSwitch.switched !== 1 || autoSwitch.failed !== 0 || nativeGetCount !== 2) {
  throw new Error("Active automatic-camera switch did not restore constraint routing");
}
if (continuousFocusCount !== nativeGetCount) {
  throw new Error("Continuous autofocus was not applied to every physical rear track");
}

const lockedGet = context.navigator.mediaDevices.getUserMedia;
const lockedPrototypeGet = FakeMediaDevices.prototype.getUserMedia;
let instanceWrapperCalls = 0;
let prototypeWrapperCalls = 0;
context.navigator.mediaDevices.getUserMedia = function (...args) {
  instanceWrapperCalls += 1;
  return nativeBypassGetUserMedia.apply(this, args);
};
FakeMediaDevices.prototype.getUserMedia = function (...args) {
  prototypeWrapperCalls += 1;
  return nativeBypassGetUserMedia.apply(this, args);
};
let wrappedInstanceFailure;
try {
  await context.navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
} catch (error) {
  wrappedInstanceFailure = error;
}
let wrappedPrototypeFailure;
try {
  await FakeMediaDevices.prototype.getUserMedia.call(
    context.navigator.mediaDevices,
    { video: { facingMode: "user" } },
  );
} catch (error) {
  wrappedPrototypeFailure = error;
}
if (instanceWrapperCalls !== 0 || prototypeWrapperCalls !== 0
    || wrappedInstanceFailure?.name !== "NotReadableError"
    || wrappedPrototypeFailure?.name !== "NotReadableError"
    || nativeGetCount !== 2) {
  throw new Error("Site getUserMedia wrappers bypassed the permanent video router");
}
if (context.navigator.mediaDevices.getUserMedia !== lockedGet
    || FakeMediaDevices.prototype.getUserMedia !== lockedPrototypeGet) {
  throw new Error("Site assignment replaced a permanent camera route gateway");
}
const getDescriptor = Object.getOwnPropertyDescriptor(
  context.navigator.mediaDevices,
  "getUserMedia",
);
if (!getDescriptor || getDescriptor.configurable
    || typeof getDescriptor.get !== "function"
    || typeof getDescriptor.set !== "function") {
  throw new Error("Compatible camera hook accessor was not retained");
}

let legacyFailure;
try {
  await context.navigator.webkitGetUserMedia(
    { video: { facingMode: "user" } },
    () => {},
    (error) => { legacyFailure = error; },
  );
} catch (_) {
  // The callback is asserted below.
}
if (!legacyFailure || legacyFailure.name !== "NotReadableError" || nativeGetCount !== 2) {
  throw new Error("Legacy getUserMedia did not route the front camera to Front Camera 4");
}

class ChildMediaDevices {
  async getUserMedia() {
    throw new Error("Unpatched iframe native camera method called");
  }

  async enumerateDevices() {
    return nativeDevices;
  }
}
const childWindow = {
  navigator: { mediaDevices: new ChildMediaDevices() },
  MediaDevices: ChildMediaDevices,
  location: { origin: "https://camera-routing.test" },
};
context.__camexchForTest.installFrame({ contentWindow: childWindow });
if (!childWindow.__camexchInstalled) {
  throw new Error("Dynamic iframe did not acquire a single camera-hook owner");
}
let childRouteFailure;
try {
  await childWindow.navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
  });
} catch (error) {
  childRouteFailure = error;
}
if (childRouteFailure?.name !== "NotReadableError" || nativeGetCount !== 2) {
  throw new Error("Dynamic same-origin iframe did not receive routed camera behavior");
}
const childHook = childWindow.navigator.mediaDevices.getUserMedia;
context.__camexchForTest.installFrame({ contentWindow: childWindow });
if (childWindow.navigator.mediaDevices.getUserMedia !== childHook) {
  throw new Error("An owned iframe camera hook was replaced by another context");
}

const activeEntry = Array.from(context.__camexchForTest.managed)[0];
const stableTrackBeforeOnlineSwitch = activeEntry.controller.track;
const nativeCountBeforeOnlineSwitch = nativeGetCount;
const deviceChangesBeforeOnlineSwitch = deviceChangeCount;
sourceOnline = true;
const onlineSourceSwitch = await context.__camexchSwitchCamera("SOURCE");
if (onlineSourceSwitch.switched !== 1 || onlineSourceSwitch.failed !== 0
    || activeEntry.controller.track !== stableTrackBeforeOnlineSwitch
    || activeEntry.controller.route !== "SOURCE"
    || onlineSourceSwitch.devicechange !== 1
    || deviceChangeCount !== deviceChangesBeforeOnlineSwitch + 1
    || stableTrackBeforeOnlineSwitch.label !== "Front Camera 4") {
  throw new Error("Online Source switch did not preserve and relabel the page track");
}
const sourceSettings = stableTrackBeforeOnlineSwitch.getSettings();
if (sourceSettings.facingMode !== "user"
    || sourceSettings.deviceId !== "camexch-front-camera-4"
    || sourceSettings.width !== 944 || sourceSettings.height !== 960
    || nativeGetCount !== nativeCountBeforeOnlineSwitch) {
  throw new Error("Managed Source track did not expose the real Source identity and resolution");
}
const onlineRearSwitch = await context.__camexchSwitchCamera("REAR");
if (onlineRearSwitch.switched !== 1 || onlineRearSwitch.failed !== 0
    || activeEntry.controller.track !== stableTrackBeforeOnlineSwitch
    || activeEntry.controller.route !== "REAR"
    || stableTrackBeforeOnlineSwitch.getSettings().facingMode !== "environment"
    || nativeGetCount !== nativeCountBeforeOnlineSwitch + 1
    || continuousFocusCount !== nativeGetCount) {
  throw new Error("Source-to-rear switch did not restore the physical camera on the stable track");
}

const endedSessionTrack = activeEntry.controller.track;
const clonedSessionTrack = endedSessionTrack.clone();
const outboundPeer = new context.RTCPeerConnection();
const directSender = outboundPeer.addTrack(endedSessionTrack, activeEntry.stream);
const cloneSender = outboundPeer.addTrack(clonedSessionTrack, activeEntry.stream);
outboundPeer.removeTrack(cloneSender);
const connectedConsumer = new FakeVideo();
connectedConsumer.isConnected = true;
connectedConsumer.srcObject = activeEntry.stream;
const clonedManagedStream = activeEntry.stream.clone();
const clonedStreamTrackBeforeRevival = clonedManagedStream.getVideoTracks()[0];
const clonedConsumer = new FakeVideo();
clonedConsumer.isConnected = true;
clonedConsumer.srcObject = clonedManagedStream;
const detachedConsumer = new FakeVideo();
detachedConsumer.isConnected = false;
detachedConsumer.srcObject = activeEntry.stream;
activeEntry.stream.removeTrack(endedSessionTrack);
const detachedLiveSwitch = await context.__camexchSwitchCamera("SOURCE");
if (detachedLiveSwitch.switched !== 1 || detachedLiveSwitch.revived !== 0
    || detachedLiveSwitch.reattached !== 1 || detachedLiveSwitch.failed !== 0
    || activeEntry.stream.getVideoTracks()[0] !== endedSessionTrack
    || endedSessionTrack.readyState !== "live"
    || endedSessionTrack.getSettings().facingMode !== "user"
    || clonedManagedStream.getVideoTracks().length !== 1
    || connectedConsumer.playCount < 1 || clonedConsumer.playCount < 1
    || detachedConsumer.playCount < 1
    || detachedConsumer.srcObject !== activeEntry.stream) {
  throw new Error("Live track removed from MediaStream was not reattached and switched");
}
const consumerPlayCountBeforeRevival = connectedConsumer.playCount;
const clonedConsumerPlayCountBeforeRevival = clonedConsumer.playCount;
const detachedConsumerPlayCountBeforeRevival = detachedConsumer.playCount;
activeEntry.stream.removeTrack(endedSessionTrack);
endedSessionTrack.stop();
if (activeEntry.stream.getVideoTracks().length !== 0
    || endedSessionTrack.readyState !== "ended") {
  throw new Error("Stopped-session fixture did not match removeTrack then stop lifecycle");
}
const revivedSourceSwitch = await context.__camexchSwitchCamera("SOURCE");
const revivedTrack = activeEntry.stream.getVideoTracks()[0];
const revivedClonedTrack = clonedManagedStream.getVideoTracks()[0];
if (revivedSourceSwitch.switched !== 1 || revivedSourceSwitch.revived !== 1
    || revivedSourceSwitch.reattached !== 2
    || revivedSourceSwitch.senders !== 2 || revivedSourceSwitch.failed !== 0
    || !revivedTrack || revivedTrack === endedSessionTrack
    || revivedTrack.readyState !== "live"
    || !revivedClonedTrack || revivedClonedTrack === clonedStreamTrackBeforeRevival
    || revivedClonedTrack.readyState !== "live"
    || clonedStreamTrackBeforeRevival.readyState !== "ended"
    || revivedTrack.label !== "Front Camera 4"
    || revivedTrack.getSettings().width !== 944
    || revivedTrack.getSettings().height !== 960) {
  throw new Error("Stopped camera session was not rebuilt with a new Source track");
}
if (directSender.track !== revivedTrack || cloneSender.track !== revivedTrack
    || directSender.replaceCount !== 1 || cloneSender.replaceCount !== 1
    || clonedSessionTrack.readyState !== "ended") {
  throw new Error("Managed WebRTC senders were not moved to the revived Source track");
}
if (connectedConsumer.srcObject !== activeEntry.stream
    || clonedConsumer.srcObject !== clonedManagedStream
    || detachedConsumer.srcObject !== activeEntry.stream
    || connectedConsumer.playCount <= consumerPlayCountBeforeRevival
    || clonedConsumer.playCount <= clonedConsumerPlayCountBeforeRevival
    || detachedConsumer.playCount <= detachedConsumerPlayCountBeforeRevival) {
  throw new Error("Connected media consumer was not rebound to the revived stream");
}

revivedTrack.stop();
activeEntry.controller.endedAt = Date.now() - 300001;
const expiredSwitch = await context.__camexchSwitchCamera("REAR");
if (expiredSwitch.switched !== 0 || expiredSwitch.revived !== 0
    || context.__camexchForTest.managed.size !== 0) {
  throw new Error("Expired stopped camera session was retained or revived");
}

let deviceChangeStreamPromise;
context.navigator.mediaDevices.addEventListener("devicechange", () => {
  deviceChangeStreamPromise = context.navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment",
      deviceId: { exact: "main-rear-id" },
    },
  });
});
const nativeCountBeforeDeviceChangeRequest = nativeGetCount;
const sourceDeviceChangeSwitch = await context.__camexchSwitchCamera("SOURCE");
const deviceChangeStream = await deviceChangeStreamPromise;
const deviceChangeTrack = deviceChangeStream?.getVideoTracks?.()[0];
if (sourceDeviceChangeSwitch.devicechange !== 1
    || !deviceChangeTrack
    || deviceChangeTrack.label !== "Front Camera 4"
    || deviceChangeTrack.getSettings().facingMode !== "user"
    || nativeGetCount !== nativeCountBeforeDeviceChangeRequest) {
  throw new Error("Devicechange camera retry bypassed Source routing");
}

const sourceIframeWindow = makeEarlyIframeWindow();
const sourceIframeFrame = new FakeIFrameElement(sourceIframeWindow);
const sourceIframeGetUserMedia = sourceIframeFrame.contentWindow
  .navigator.mediaDevices.getUserMedia;
const earlyIframeCallsBeforeSourceRetry = earlyIframeNativeCalls;
const sourceIframeStream = await sourceIframeGetUserMedia.call(
  sourceIframeWindow.navigator.mediaDevices,
  {
    video: {
      facingMode: "environment",
      deviceId: { exact: "main-rear-id" },
    },
  },
);
const sourceIframeTrack = sourceIframeStream?.getVideoTracks?.()[0];
if (!sourceIframeTrack
    || sourceIframeTrack.label !== "Front Camera 4"
    || sourceIframeTrack.getSettings().facingMode !== "user"
    || earlyIframeNativeCalls !== earlyIframeCallsBeforeSourceRetry) {
  throw new Error("Early iframe retry ignored the selected Source route");
}

let cooperativeWrapperCalls = 0;
context.navigator.mediaDevices.getUserMedia = function (...args) {
  cooperativeWrapperCalls += 1;
  return lockedGet.apply(this, args);
};
const nativeCountBeforeAudioWrapper = nativeGetCount;
await context.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
if (cooperativeWrapperCalls !== 1
    || nativeGetCount !== nativeCountBeforeAudioWrapper + 1) {
  throw new Error("Non-video site wrapper did not delegate without recursion");
}

console.log(`Virtual camera hook syntax and routing OK (${script.length} chars)`);
