"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const geometry = require("../lib/geometry");

test("validates arbitrary even H264 dimensions without presets", () => {
  assert.equal(geometry.positiveInteger("2400", "Width"), 2400);
  assert.equal(geometry.positiveInteger("704", "Width"), 704);
  assert.throws(() => geometry.positiveInteger("701", "Width"), /even/);
  assert.throws(() => geometry.positiveInteger("0", "Width"), /positive/);
});

test("rotates landscape site constraints into portrait output", () => {
  const resolved = geometry.resolveRequestedSize({
    video: {
      width: { ideal: 2000 },
      height: { ideal: 1500 },
    },
  }, "portrait", { width: 720, height: 1280 });
  assert.deepEqual(resolved, {
    width: 1500,
    height: 2000,
    applied: true,
    reason: "ideal/ideal portrait",
  });
});

test("returns landscape dimensions after phone rotation", () => {
  const resolved = geometry.resolveRequestedSize({
    video: {
      width: { exact: 2000 },
      height: { exact: 1500 },
    },
  }, "landscape", { width: 720, height: 1280 });
  assert.equal(resolved.width, 2000);
  assert.equal(resolved.height, 1500);
});

test("keeps manual size when site omits dimensions", () => {
  const resolved = geometry.resolveRequestedSize(
    { video: { facingMode: "user" } },
    "portrait",
    { width: 2400, height: 3200 },
  );
  assert.equal(resolved.applied, false);
  assert.equal(resolved.width, 2400);
  assert.equal(resolved.height, 3200);
});

test("keeps the output point under the cursor while zooming", () => {
  const before = { scale: 1.25, panX: 110, panY: -75 };
  const point = { x: 620, y: 900 };
  const output = { width: 720, height: 1280 };
  const after = geometry.zoomAroundPoint(before, point, output, 2.5);

  const sourcePointBefore = {
    x: (point.x - (output.width / 2 + before.panX)) / before.scale,
    y: (point.y - (output.height / 2 + before.panY)) / before.scale,
  };
  const sourcePointAfter = {
    x: (point.x - (output.width / 2 + after.panX)) / after.scale,
    y: (point.y - (output.height / 2 + after.panY)) / after.scale,
  };
  assert.deepEqual(sourcePointAfter, sourcePointBefore);
});

test("moves the source down when the pointer moves down", () => {
  const next = geometry.dragInOutputCoordinates(
    { scale: 1, panX: 0, panY: 0 },
    { x: 25, y: 30 },
    { width: 360, height: 640 },
    { width: 720, height: 1280 },
  );
  assert.deepEqual(next, { scale: 1, panX: 50, panY: -60 });
});

test("preserves relative source position when output resolution changes", () => {
  assert.deepEqual(
    geometry.rescaleOutputTransform(
      { scale: 1.5, panX: 72, panY: -128 },
      { width: 720, height: 1280 },
      { width: 1440, height: 2560 },
    ),
    { scale: 1.5, panX: 144, panY: -256 },
  );
});

test("uses half the former source wheel sensitivity", () => {
  const oldFactor = geometry.wheelFactor(-120, 0.0015);
  const nextFactor = geometry.wheelFactor(-120, 0.00075);
  assert.ok(nextFactor > 1);
  assert.ok(nextFactor < oldFactor);
  assert.ok(Math.abs(Math.log(nextFactor) * 2 - Math.log(oldFactor)) < 1e-12);
});

test("renders every 24 FPS media frame when the output limit is 30 FPS", () => {
  let previous = null;
  let rendered = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    const current = frame / 24;
    if (geometry.shouldRenderMediaFrame(previous, current, 30)) {
      previous = current;
      rendered += 1;
    }
  }
  assert.equal(rendered, 120);
});

test("evenly limits 60 FPS media to 30 FPS using media timestamps", () => {
  let previous = null;
  const renderedFrames = [];
  for (let frame = 0; frame < 120; frame += 1) {
    const current = frame / 60;
    if (geometry.shouldRenderMediaFrame(previous, current, 30)) {
      previous = current;
      renderedFrames.push(frame);
    }
  }
  assert.deepEqual(renderedFrames.slice(0, 6), [0, 2, 4, 6, 8, 10]);
  assert.equal(renderedFrames.length, 60);
});

test("renders immediately when a looping video's media timestamp resets", () => {
  assert.equal(geometry.shouldRenderMediaFrame(12.4, 0, 30), true);
});

test("allocates detail-preserving WebRTC bitrate by output size", () => {
  assert.equal(geometry.targetVideoBitrate(480, 640, 30), 4_000_000);
  assert.equal(geometry.targetVideoBitrate(720, 1280, 30), 11_059_200);
  assert.equal(geometry.targetVideoBitrate(1200, 1600, 30), 23_040_000);
  assert.equal(geometry.targetVideoBitrate(3072, 4080, 60), 50_000_000);
});

test("keeps a quality floor below the WebRTC bitrate ceiling", () => {
  assert.deepEqual(
    geometry.videoBitrateProfile(720, 1280, 60),
    {
      minimum: 6_635_520,
      start: 13_271_040,
      maximum: 22_118_400,
    },
  );
});

test("prefers interoperable H264 at every resolution when available", () => {
  const codecs = [
    { mimeType: "video/H264" },
    { mimeType: "video/H265" },
    { mimeType: "video/VP9" },
  ];
  assert.equal(geometry.preferredVideoCodecs(codecs, 1080, 1920).name, "H264");
  assert.equal(geometry.preferredVideoCodecs(codecs, 2400, 3200).name, "H264");
  assert.equal(geometry.preferredVideoCodecs(codecs, 3072, 4080).name, "H264");
});

test("falls back to HEVC only when H264 is unavailable", () => {
  const result = geometry.preferredVideoCodecs(
    [{ mimeType: "video/H265" }, { mimeType: "video/VP9" }],
    3072,
    4080,
  );
  assert.equal(result.name, "HEVC");
  assert.equal(result.h264Available, false);
});

test("reports the actually negotiated primary video codec", () => {
  const sdp = [
    "v=0",
    "m=video 9 UDP/TLS/RTP/SAVPF 98 99 96 97",
    "a=rtpmap:96 H264/90000",
    "a=rtpmap:97 rtx/90000",
    "a=rtpmap:98 H265/90000",
    "a=rtpmap:99 rtx/90000",
  ].join("\r\n");
  assert.equal(geometry.negotiatedVideoCodec(sdp), "H265");
});

test("moves a preferred video codec and its RTX payload to the front", () => {
  const sdp = [
    "v=0",
    "m=video 9 UDP/TLS/RTP/SAVPF 98 99 96 97",
    "a=rtpmap:96 H264/90000",
    "a=fmtp:97 apt=96",
    "a=rtpmap:97 rtx/90000",
    "a=rtpmap:98 H265/90000",
    "a=fmtp:99 apt=98",
    "a=rtpmap:99 rtx/90000",
  ].join("\r\n");
  const preferred = geometry.prioritizeVideoCodec(sdp, "H264");
  assert.match(preferred, /m=video 9 UDP\/TLS\/RTP\/SAVPF 96 97 98 99/);
  assert.equal(geometry.negotiatedVideoCodec(preferred), "H264");
});

test("treats HEVC and H265 as the same SDP codec preference", () => {
  const sdp = [
    "m=video 9 UDP/TLS/RTP/SAVPF 96 98",
    "a=rtpmap:96 H264/90000",
    "a=rtpmap:98 H265/90000",
  ].join("\n");
  assert.match(
    geometry.prioritizeVideoCodec(sdp, "HEVC"),
    /m=video 9 UDP\/TLS\/RTP\/SAVPF 98 96/,
  );
});

test("adds encoder bitrate hints to the selected video codec", () => {
  const sdp = [
    "v=0",
    "m=video 9 UDP/TLS/RTP/SAVPF 96 97 98",
    "a=rtpmap:96 H264/90000",
    "a=fmtp:96 profile-level-id=42e01f;packetization-mode=1",
    "a=rtpmap:97 rtx/90000",
    "a=fmtp:97 apt=96",
    "a=rtpmap:98 VP9/90000",
  ].join("\r\n");
  const result = geometry.applyVideoBitrateHints(
    sdp,
    "H264",
    { minimum: 6_000_000, start: 12_000_000, maximum: 20_000_000 },
  );
  assert.match(result, /m=video[^\r\n]*\r\nb=AS:20000/);
  assert.match(
    result,
    /a=fmtp:96 profile-level-id=42e01f;packetization-mode=1;x-google-min-bitrate=6000;x-google-start-bitrate=12000;x-google-max-bitrate=20000/,
  );
  assert.doesNotMatch(result, /a=fmtp:98[^\r\n]*x-google/);
});

test("formats dynamic network routes without duplicate address fields or commas", () => {
  assert.equal(geometry.formatNetworkInterfaces([
    { route: "Wi-Fi", address: "192.168.4.132" },
    { route: "USB", address: "10.137.181.58" },
    { route: "Ethernet", address: "192.168.56.1" },
  ], 8791), [
    "Wi-Fi: 192.168.4.132:8791",
    "USB: 10.137.181.58:8791",
    "Ethernet: 192.168.56.1:8791",
  ].join("\n"));
});
