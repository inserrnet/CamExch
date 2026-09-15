"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const artifactPath = path.join(__dirname, "..", "..", ".artifacts", "player-ui-layout.png");
const virtualCameraArtifactPath = path.join(__dirname, "..", "..", ".artifacts", "player-virtual-camera-ui.png");
let window;
let settingsWidth = 682;

ipcMain.handle("read-preferences", () => ({}));
ipcMain.handle("get-server-info", () => ({ port: 8791, interfaces: [] }));
ipcMain.handle("list-motion-profiles", () => []);
ipcMain.handle("set-live-motion-requested", () => ({ ok: true }));
ipcMain.handle("set-motion-capture-requested", () => ({ ok: true }));
ipcMain.handle("write-preferences", () => ({ ok: true }));
ipcMain.handle("get-memory-info", () => ({ workingSetMb: 0, privateMb: 0, processes: 1 }));
ipcMain.handle("virtual-camera-status", () => ({
  available: false,
  installed: false,
  running: false,
  name: "Cam Player Camera",
  consumers: 0,
  width: 0,
  height: 0,
}));
ipcMain.handle("emulator-camera-mode-status", () => ({
  available: true,
  state: "active",
  message: "Only Cam Player Camera is available",
  consumers: [],
}));
ipcMain.on("settings-width", (event, value) => {
  if (!window || event.sender !== window.webContents) return;
  const next = Number(value);
  const [width, height] = window.getSize();
  window.setSize(width + next - settingsWidth, height);
  settingsWidth = next;
});

app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 1582,
    height: 820,
    show: false,
    backgroundColor: "#17191c",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  window.show();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const initial = await window.webContents.executeJavaScript(`({
    previewWidth: document.getElementById("preview").getBoundingClientRect().width,
    windowWidth: window.outerWidth,
  })`);
  const [initialNativeWidth] = window.getSize();
  await window.webContents.executeJavaScript(`{
    const columns = Array.from(document.querySelectorAll(".settings-column"));
    for (const column of columns) {
      if (!column.classList.contains("is-collapsed")) column.querySelector(".column-toggle").click();
    }
  }`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const collapsed = await window.webContents.executeJavaScript(`({
    previewWidth: document.getElementById("preview").getBoundingClientRect().width,
    windowWidth: window.outerWidth,
    settingsWidth: Array.from(document.querySelectorAll(".settings-column"))
      .reduce((sum, column) => sum + column.getBoundingClientRect().width, 0),
  })`);
  const [collapsedNativeWidth] = window.getSize();
  await window.webContents.executeJavaScript(`document.querySelector('[data-column="main"] .column-toggle').click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const expanded = await window.webContents.executeJavaScript(`(() => {
    const columns = Array.from(document.querySelectorAll(".settings-column"));
    return {
      previewWidth: document.getElementById("preview").getBoundingClientRect().width,
      windowWidth: window.outerWidth,
      previewHeight: document.getElementById("preview").getBoundingClientRect().height,
      settingsHeight: document.querySelector(".settings").getBoundingClientRect().height,
      settingsWidth: columns.reduce((sum, column) => sum + column.getBoundingClientRect().width, 0),
      mainWidth: columns.find((column) => column.dataset.column === "main").getBoundingClientRect().width,
      columns: columns.map((column) => ({
        name: column.dataset.column,
        width: Math.round(column.getBoundingClientRect().width),
        collapsed: column.classList.contains("is-collapsed"),
      })),
    };
  })()`);
  const [expandedNativeWidth] = window.getSize();
  const metrics = {
    initialPreviewWidth: initial.previewWidth,
    initialWindowWidth: initialNativeWidth,
    collapsedPreviewWidth: collapsed.previewWidth,
    collapsedWindowWidth: collapsedNativeWidth,
    expandedPreviewWidth: expanded.previewWidth,
    expandedWindowWidth: expandedNativeWidth,
    previewHeight: expanded.previewHeight,
    settingsHeight: expanded.settingsHeight,
    allCollapsedSettingsWidth: collapsed.settingsWidth,
    expandedSettingsWidth: expanded.settingsWidth,
    mainWidth: expanded.mainWidth,
    columns: expanded.columns,
  };
  if (metrics.allCollapsedSettingsWidth > 160) {
    throw new Error(`Collapsed columns reserve excess space: ${metrics.allCollapsedSettingsWidth}`);
  }
  if (metrics.mainWidth !== 320 || metrics.expandedSettingsWidth > 410) {
    throw new Error(`Expanded column stretched unexpectedly: ${JSON.stringify(metrics)}`);
  }
  for (const width of [metrics.collapsedPreviewWidth, metrics.expandedPreviewWidth]) {
    if (Math.abs(width - metrics.initialPreviewWidth) > 2) {
      throw new Error(`Preview width changed with columns: ${JSON.stringify(metrics)}`);
    }
  }
  if (BrowserWindow.getAllWindows().length !== 1) {
    throw new Error(`Expected one native window, found ${BrowserWindow.getAllWindows().length}`);
  }
  if (window.isAlwaysOnTop()) {
    throw new Error("Player must not stay above other applications");
  }
  if (Math.abs(metrics.previewHeight - metrics.settingsHeight) > 1) {
    throw new Error(`Settings height does not follow Player: ${JSON.stringify(metrics)}`);
  }
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.getElementById("virtualCameraTabButton").click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const emulatorMode = await window.webContents.executeJavaScript(`({
    state: document.getElementById("emulatorCameraModeStatus").textContent,
    message: document.getElementById("emulatorCameraModeMessage").textContent,
    button: document.getElementById("emulatorCameraModeButton").textContent,
  })`);
  if (emulatorMode.state !== "ACTIVE" || emulatorMode.button !== "Deactivate") {
    throw new Error(`Emulator camera mode state is not visible: ${JSON.stringify(emulatorMode)}`);
  }
  fs.writeFileSync(virtualCameraArtifactPath, (await window.webContents.capturePage()).toPNG());
  window.maximize();
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (!window.isMaximized()) throw new Error("Native maximize was intercepted");
  window.unmaximize();
  await new Promise((resolve) => setTimeout(resolve, 300));
  window.setPosition(80, 80);
  await new Promise((resolve) => setTimeout(resolve, 650));
  const [movedX, movedY] = window.getPosition();
  if (movedX !== 80 || movedY !== 80) {
    throw new Error(`Player position was overwritten: ${movedX},${movedY}`);
  }
  process.stdout.write(`${JSON.stringify(metrics)}\n${artifactPath}\n${virtualCameraArtifactPath}\n`);
  window.destroy();
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
