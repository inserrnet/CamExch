import { readFileSync } from "node:fs";

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
]) {
  if (!script.includes(marker)) {
    throw new Error(`Missing browser telemetry marker: ${marker}`);
  }
}

console.log(`Virtual camera hook syntax OK (${script.length} chars)`);
