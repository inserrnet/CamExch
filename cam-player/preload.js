"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("camPlayer", {
  openMedia: () => ipcRenderer.invoke("open-media"),
  prepareMedia: (filePath) => ipcRenderer.invoke("prepare-media", filePath),
  readPreferences: () => ipcRenderer.invoke("read-preferences"),
  getServerInfo: () => ipcRenderer.invoke("get-server-info"),
  getMemoryInfo: () => ipcRenderer.invoke("get-memory-info"),
  writePreferences: (value) => ipcRenderer.invoke("write-preferences", value),
  readLog: () => ipcRenderer.invoke("read-log"),
  readLogTail: () => ipcRenderer.invoke("read-log-tail"),
  clearLog: () => ipcRenderer.invoke("clear-log"),
  copyText: (value) => ipcRenderer.invoke("copy-text", value),
  log: (message) => ipcRenderer.send("renderer-log", String(message)),
  updateState: (value) => ipcRenderer.send("player-state", value),
  answerOffer: (value) => ipcRenderer.send("webrtc-answer", value),
  onOffer: (listener) => ipcRenderer.on("webrtc-offer", (_event, value) => listener(value)),
  onOfferCancel: (listener) => ipcRenderer.on("webrtc-cancel", (_event, value) => listener(value)),
  onSourceClose: (listener) => ipcRenderer.on("source-close", (_event, value) => listener(value)),
  onConfig: (listener) => ipcRenderer.on("source-config", (_event, value) => listener(value)),
  onServerInfo: (listener) => ipcRenderer.on("server-info", (_event, value) => listener(value)),
  onLog: (listener) => ipcRenderer.on("app-log", (_event, value) => listener(value)),
});
