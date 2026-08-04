"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qrSelection", {
  complete: (selection) => ipcRenderer.send("qr-selection-complete", selection),
  cancel: () => ipcRenderer.send("qr-selection-cancel"),
  onInitialize: (listener) => ipcRenderer.once("qr-selection-initialize", (_event, value) => listener(value)),
});
