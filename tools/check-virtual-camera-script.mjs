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
]) {
  if (!script.includes(marker)) {
    throw new Error(`Missing browser telemetry marker: ${marker}`);
  }
}

const nativeDevices = [
  { kind: "videoinput", deviceId: "rear-id", label: "camera 2, facing back", groupId: "rear" },
  { kind: "videoinput", deviceId: "front-id", label: "camera2 2, facing front", groupId: "front" },
];
let nativeGetCount = 0;
class FakeTrack {
  constructor() {
    this.readyState = "live";
  }

  getSettings() {
    return { facingMode: "environment", deviceId: "rear-id" };
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
}

class FakeMediaDevices {
  async getUserMedia(constraints) {
    nativeGetCount += 1;
    return new FakeStream(constraints?.video ? [new FakeTrack()] : []);
  }

  async enumerateDevices() {
    return nativeDevices;
  }
}
const context = {
  location: { href: "https://camera-routing.test/", origin: "https://camera-routing.test" },
  navigator: { mediaDevices: new FakeMediaDevices() },
  MediaDevices: FakeMediaDevices,
  MediaStream: FakeStream,
  MediaStreamTrackGenerator: FakeMediaStreamTrackGenerator,
  MediaStreamTrackProcessor: FakeMediaStreamTrackProcessor,
  document: { querySelectorAll: () => [], documentElement: null },
  addEventListener: () => {},
  setTimeout,
  clearInterval,
  setInterval: () => 1,
};
context.window = context;
context.globalThis = context;
context.CamExchBridge = {
  authorizeNativeCamera: () => "OK",
  getCameraRouteMode: () => "AUTO",
  getMode: () => "ERROR:source offline",
};
const testScript = script.replace(
  /\}\)\(\);$/,
  "globalThis.__camexchForTest={route:isVirtualRequest,native:constraintsForNative,routedGet:routeGet,managed:managedStreams,install:installHooks,installFrame:installFrame};})();",
);
vm.runInNewContext(testScript, context);
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
if (rearSwitch.switched !== 1 || rearSwitch.failed !== 0 || nativeGetCount !== 2) {
  throw new Error("Active rear-camera switch did not replace the proxy source");
}
const managedEntry = Array.from(context.__camexchForTest.managed)[0];
if (managedEntry.stream !== originalRearStream
    || managedEntry.stream.getVideoTracks()[0] !== stableRearTrack
    || stableRearTrack.readyState !== "live") {
  throw new Error("Camera switch changed or stopped the page's stable video track");
}

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

await FakeMediaDevices.prototype.getUserMedia.call(
  context.navigator.mediaDevices,
  { video: { facingMode: "environment" } },
);
if (nativeGetCount !== 3) {
  throw new Error("MediaDevices.prototype.getUserMedia bypassed the camera router");
}

const autoSwitch = await context.__camexchSwitchCamera("AUTO");
if (autoSwitch.switched !== 2 || autoSwitch.failed !== 0 || nativeGetCount !== 5) {
  throw new Error("Active automatic-camera switch did not restore constraint routing");
}

const lockedGet = context.navigator.mediaDevices.getUserMedia;
const lockedPrototypeGet = FakeMediaDevices.prototype.getUserMedia;
try {
  context.navigator.mediaDevices.getUserMedia = async () => "bypass";
  FakeMediaDevices.prototype.getUserMedia = async () => "prototype bypass";
} catch (_) {
  // Non-writable hooks throw in strict mode, which is expected.
}
if (context.navigator.mediaDevices.getUserMedia !== lockedGet
    || FakeMediaDevices.prototype.getUserMedia !== lockedPrototypeGet) {
  throw new Error("Page code was able to overwrite a locked camera hook");
}
const getDescriptor = Object.getOwnPropertyDescriptor(
  context.navigator.mediaDevices,
  "getUserMedia",
);
if (!getDescriptor || getDescriptor.configurable || getDescriptor.writable) {
  throw new Error("Camera hook is not immutable");
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
if (!legacyFailure || legacyFailure.name !== "NotReadableError" || nativeGetCount !== 5) {
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
if (childWindow.navigator.mediaDevices.getUserMedia
    !== context.navigator.mediaDevices.getUserMedia) {
  throw new Error("Dynamic same-origin iframe did not receive the camera router");
}
if (!childWindow.__camexchInstalled) {
  throw new Error("Dynamic iframe did not acquire a single camera-hook owner");
}
const childHook = childWindow.navigator.mediaDevices.getUserMedia;
context.__camexchForTest.installFrame({ contentWindow: childWindow });
if (childWindow.navigator.mediaDevices.getUserMedia !== childHook) {
  throw new Error("An owned iframe camera hook was replaced by another context");
}

console.log(`Virtual camera hook syntax and routing OK (${script.length} chars)`);
