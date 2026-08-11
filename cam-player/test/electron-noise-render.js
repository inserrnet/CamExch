"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

app.setPath("userData", path.join(os.tmpdir(), `camexch-noise-render-${process.pid}`));

const timeout = setTimeout(() => {
  process.stderr.write("Camera noise render test timed out\n");
  app.exit(1);
}, 30_000);

ipcMain.once("noise-result", (_event, result) => {
  clearTimeout(timeout);
  if (result?.ok) {
    process.stdout.write(`Camera noise render OK ${JSON.stringify(result)}\n`);
    app.exit(0);
    return;
  }
  process.stderr.write(`Camera noise render failed ${result?.error || "unknown"}\n`);
  app.exit(1);
});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
  });
  const renderer = fs.readFileSync(
    path.join(__dirname, "..", "renderer", "renderer.js"),
    "utf8",
  );
  const vertexSource = renderer.match(/const vertexSource = `([\s\S]*?)`;/)?.[1];
  const fragmentSource = renderer.match(/const fragmentSource = `([\s\S]*?)`;/)?.[1];
  if (!vertexSource || !fragmentSource) throw new Error("Production shaders were not found");
  await window.loadURL("data:text/html,<html><body></body></html>");
  await window.webContents.executeJavaScript(`(() => {
    const { ipcRenderer } = require("electron");
    try {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
      if (!gl) throw new Error("WebGL 2 unavailable");
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(shader));
        }
        return shader;
      };
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, ${JSON.stringify(vertexSource)}));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, ${JSON.stringify(fragmentSource)}));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program));
      }
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const position = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const makeTexture = (unit, width, height, data, filter = gl.LINEAR) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texImage2D(
          gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
          gl.RGBA, gl.UNSIGNED_BYTE, data,
        );
      };
      makeTexture(0, 1, 1, new Uint8Array([128, 128, 128, 255]));
      makeTexture(1, 1, 1, new Uint8Array([128, 128, 128, 255]));
      const noise = new Uint8Array(512 * 512 * 4);
      let state = 0x6d2b79f5;
      for (let index = 0; index < noise.length; index += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        noise[index] = state >>> 24;
      }
      makeTexture(2, 512, 512, noise, gl.NEAREST);
      const oneI = (name, value) => gl.uniform1i(gl.getUniformLocation(program, name), value);
      const oneF = (name, value) => gl.uniform1f(gl.getUniformLocation(program, name), value);
      const twoF = (name, x, y) => gl.uniform2f(gl.getUniformLocation(program, name), x, y);
      oneI("u_texture", 0);
      oneI("u_background", 1);
      oneI("u_noise_texture", 2);
      twoF("u_output", size, size);
      twoF("u_source", size, size);
      oneF("u_scale", 1);
      oneF("u_lod_bias", 0);
      twoF("u_pan", 0, 0);
      oneI("u_rotation", 0);
      oneI("u_mirrored", 0);
      oneF("u_handheld_roll", 0);
      oneF("u_noise_color", 1);
      oneF("u_noise_low_light", 1);
      oneF("u_noise_pattern", 1);
      twoF("u_noise_offset", 17 / 512, 31 / 512);
      const render = (enabled, amount) => {
        oneI("u_noise_enabled", enabled ? 1 : 0);
        const normalizedAmount = Math.max(0, Math.min(100, amount)) / 100;
        oneF("u_noise_amount", normalizedAmount * normalizedAmount * 0.1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const pixels = new Uint8Array(size * size * 4);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      const baseline = render(false, 0);
      const zero = render(true, 0);
      const maximum = render(true, 100);
      let zeroDifference = 0;
      let maximumDifference = 0;
      let changedPixels = 0;
      for (let index = 0; index < baseline.length; index += 4) {
        const zeroPixelDifference = Math.abs(baseline[index] - zero[index])
          + Math.abs(baseline[index + 1] - zero[index + 1])
          + Math.abs(baseline[index + 2] - zero[index + 2]);
        const maximumPixelDifference = Math.abs(baseline[index] - maximum[index])
          + Math.abs(baseline[index + 1] - maximum[index + 1])
          + Math.abs(baseline[index + 2] - maximum[index + 2]);
        zeroDifference += zeroPixelDifference;
        maximumDifference += maximumPixelDifference;
        if (maximumPixelDifference > 6) changedPixels += 1;
      }
      const pixelCount = size * size;
      const result = {
        ok: zeroDifference === 0
          && maximumDifference / pixelCount >= 8
          && changedPixels / pixelCount >= 0.5,
        zeroDifference,
        meanMaximumDifference: maximumDifference / pixelCount,
        changedRatio: changedPixels / pixelCount,
      };
      ipcRenderer.send("noise-result", result);
    } catch (error) {
      ipcRenderer.send("noise-result", { ok: false, error: error.stack || String(error) });
    }
  })()`);
}).catch((error) => {
  clearTimeout(timeout);
  process.stderr.write(`Camera noise render setup failed ${error.stack || error}\n`);
  app.exit(1);
});
