"use strict";

const http = require("node:http");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, session } = require("electron");

const [controlPath] = process.argv.slice(2);
let producer;
let server;

function sendTestFrame() {
  return new Promise((resolve, reject) => {
    producer = spawn(controlPath, ["serve", "portrait"], { stdio: ["pipe", "pipe", "inherit"] });
    producer.once("error", reject);
    producer.stdout.once("data", (data) => data[0] === 1
      ? resolve()
      : reject(new Error("Producer rejected frame")));
    const width = 64;
    const height = 48;
    const stride = width * 4;
    const bytes = stride * height;
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0x4d415243, 0);
    header.writeUInt32LE(width, 4);
    header.writeUInt32LE(height, 8);
    header.writeUInt32LE(stride, 12);
    header.writeUInt32LE(24_000, 16);
    header.writeUInt32LE(bytes, 20);
    const pixels = Buffer.alloc(bytes);
    for (let index = 0; index < bytes; index += 4) {
      pixels[index] = 16;
      pixels[index + 1] = 80;
      pixels[index + 2] = 192;
      pixels[index + 3] = 255;
    }
    producer.stdin.write(header);
    producer.stdin.write(pixels);
  });
}

async function main() {
  await app.whenReady();
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === "media");
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  await sendTestFrame();
  server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><video id='preview' autoplay playsinline></video><canvas id='sample'></canvas>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await window.loadURL(`http://127.0.0.1:${address.port}/`);
  const result = await window.webContents.executeJavaScript(`(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const camera = devices.find((device) => device.kind === "videoinput"
      && device.label === "Cam Player Camera");
    if (!camera) return { devices: devices.map(({ kind, label }) => ({ kind, label })) };
    const video = document.getElementById("preview");
    const open = async (videoConstraints) => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      video.srcObject = stream;
      await video.play();
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("No Chromium video frame")), 5000);
        video.requestVideoFrameCallback(() => { clearTimeout(timeout); resolve(); });
      });
      const canvas = document.getElementById("sample");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      context.drawImage(video, 0, 0);
      const pixel = Array.from(context.getImageData(video.videoWidth / 2, video.videoHeight / 2, 1, 1).data);
      const settings = stream.getVideoTracks()[0].getSettings();
      const dimensions = [video.videoWidth, video.videoHeight];
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      return { settings, video: dimensions, pixel };
    };
    const defaultCapture = await open({ deviceId: { exact: camera.deviceId } });
    const exactCapture = await open({
      deviceId: { exact: camera.deviceId }, width: { exact: 480 }, height: { exact: 640 },
    });
    return { label: camera.label, defaultCapture, exactCapture };
  })()`);
  console.log(JSON.stringify(result));
  if (result.label !== "Cam Player Camera"
      || !result.defaultCapture?.video?.every((dimension) => dimension > 0)
      || result.defaultCapture.video[1] <= result.defaultCapture.video[0]
      || result.exactCapture?.settings?.width !== 480
      || result.exactCapture?.settings?.height !== 640
      || result.exactCapture?.video?.[0] !== 480 || result.exactCapture?.video?.[1] !== 640) {
    throw new Error("Chromium did not open the requested virtual camera format");
  }
  window.destroy();
}

main().then(() => app.quit()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
  app.quit();
});

app.on("before-quit", () => {
  if (producer) producer.stdin.end();
  if (server) server.close();
});
