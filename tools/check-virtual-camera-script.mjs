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
  { kind: "videoinput", deviceId: "rear-id", label: "camera2 1", groupId: "rear" },
  { kind: "videoinput", deviceId: "front-id", label: "camera2 2, facing front", groupId: "front" },
];
let nativeGetCount = 0;
const context = {
  location: { href: "https://camera-routing.test/" },
  navigator: {
    mediaDevices: {
      getUserMedia: async () => {
        nativeGetCount += 1;
        return { getVideoTracks: () => [], getTracks: () => [] };
      },
      enumerateDevices: async () => nativeDevices,
    },
  },
  addEventListener: () => {},
  setTimeout,
  clearInterval,
  setInterval,
};
context.window = context;
context.globalThis = context;
const testScript = script.replace(
  /\}\)\(\);$/,
  "globalThis.__camexchForTest={route:isVirtualRequest,native:constraintsForNative};})();",
);
vm.runInNewContext(testScript, context);
await context.navigator.mediaDevices.enumerateDevices();

const route = context.__camexchForTest.route;
const cases = [
  [{ video: { facingMode: "user" } }, true, "explicit user"],
  [{ video: { facingMode: { exact: "environment" } } }, false, "explicit environment"],
  [{ video: { deviceId: { exact: "camexch-front-camera-4" } } }, true, "virtual id"],
  [{ video: { deviceId: { exact: "front-id" } } }, true, "enumerated front id"],
  [{ video: { deviceId: { exact: "rear-id" } } }, false, "enumerated rear id"],
  [{ video: true }, false, "browser default"],
  [{ video: {} }, false, "empty constraints"],
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
if (mapped.find((device) => device.deviceId === "rear-id")?.label !== "camera2 1") {
  throw new Error("Rear camera label was incorrectly replaced");
}
if (mapped.find((device) => device.deviceId === "front-id")?.label !== "Front Camera 4") {
  throw new Error("Front camera label was not replaced");
}

context.CamExchBridge = { getMode: () => "ERROR:source offline" };
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

console.log(`Virtual camera hook syntax and routing OK (${script.length} chars)`);
