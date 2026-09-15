const { execFileSync, spawn } = require("node:child_process");

const [controlPath, filterPath, ffmpegPath] = process.argv.slice(2);
if (!controlPath || !filterPath || !ffmpegPath) {
  throw new Error("Expected control executable, filter DLL, and ffmpeg paths");
}

function waitForData(stream, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Virtual camera producer timed out")), timeoutMs);
    stream.once("data", (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Virtual camera process timed out"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function main() {
  execFileSync(controlPath, ["install", filterPath, "Cam Player Camera CI"], { stdio: "inherit" });
  const producer = spawn(controlPath, ["serve", "portrait"], { stdio: ["pipe", "pipe", "inherit"] });
  try {
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
    header.writeBigUInt64LE(1n, 24);
    producer.stdin.write(header);
    producer.stdin.write(Buffer.alloc(bytes, 0xff));
    const acknowledgement = await waitForData(producer.stdout, 5_000);
    if (acknowledgement[0] !== 1) throw new Error("Producer rejected the test frame");

    const startedAt = Date.now();
    const capture = spawn(ffmpegPath, [
      "-hide_banner", "-loglevel", "warning", "-f", "dshow",
      "-video_size", "480x640", "-framerate", "30",
      "-i", "video=Cam Player Camera CI", "-frames:v", "30",
      "-f", "framemd5", "-",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    capture.stdout.on("data", (data) => { stdout += data; });
    capture.stderr.on("data", (data) => { stderr += data; });
    const code = await waitForExit(capture, 10_000);
    const elapsedMs = Date.now() - startedAt;
    const frames = stdout.split(/\r?\n/).filter((line) => line.startsWith("0,")).length;
    const dimensions = stdout.match(/#dimensions 0: ([^\r\n]+)/)?.[1];
    if (code !== 0 || frames !== 30 || dimensions !== "480x640") {
      throw new Error(`Capture failed: code=${code} frames=${frames} dimensions=${dimensions}\n${stderr}`);
    }
    if (elapsedMs < 700 || elapsedMs > 5_000 || /buffer .*too full/i.test(stderr)) {
      throw new Error(`Invalid camera cadence: elapsedMs=${elapsedMs}\n${stderr}`);
    }
    console.log(JSON.stringify({ frames, dimensions, elapsedMs }));
  } finally {
    producer.stdin.end();
    await waitForExit(producer, 3_000).catch(() => {});
    execFileSync(controlPath, ["uninstall"], { stdio: "inherit" });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
