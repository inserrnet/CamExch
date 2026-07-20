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
class FakeMediaDevices {
  async getUserMedia(constraints) {
    nativeGetCount += 1;
    return {
      getVideoTracks: () => constraints?.video ? [{
        getSettings: () => ({ facingMode: "environment", deviceId: "rear-id" }),
      }] : [],
      getTracks: () => [],
    };
  }

  async enumerateDevices() {
    return nativeDevices;
  }
}
const context = {
  location: { href: "https://camera-routing.test/" },
  navigator: { mediaDevices: new FakeMediaDevices() },
  MediaDevices: FakeMediaDevices,
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
  getMode: () => "ERROR:source offline",
};
const testScript = script.replace(
  /\}\)\(\);$/,
  "globalThis.__camexchForTest={route:isVirtualRequest,native:constraintsForNative,install:installHooks};})();",
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

let virtualFailure;
try {
  await context.navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
} catch (error) {
  virtualFailure = error;
}
if (!virtualFailure || virtualFailure.name !== "NotReadableError") {
  throw new Error("Unavailable Front Camera 4 did not reject the camera request");
}
if (nativeGetCount !== 0) {
  throw new Error("Unavailable Front Camera 4 fell back to the physical front camera");
}

await FakeMediaDevices.prototype.getUserMedia.call(
  context.navigator.mediaDevices,
  { video: { facingMode: "environment" } },
);
if (nativeGetCount !== 1) {
  throw new Error("MediaDevices.prototype.getUserMedia bypassed the camera router");
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
};
context.__camexchForTest.install(childWindow, "test iframe");
if (childWindow.navigator.mediaDevices.getUserMedia
    !== context.navigator.mediaDevices.getUserMedia) {
  throw new Error("Dynamic same-origin iframe did not receive the camera router");
}

console.log(`Virtual camera hook syntax and routing OK (${script.length} chars)`);
