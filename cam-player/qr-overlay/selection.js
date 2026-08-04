"use strict";

const screenImage = document.getElementById("screenImage");
const selectionElement = document.getElementById("selection");
let start = null;

function point(event) {
  return {
    x: Math.max(0, Math.min(window.innerWidth, event.clientX)),
    y: Math.max(0, Math.min(window.innerHeight, event.clientY)),
  };
}

function drawSelection(end) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  Object.assign(selectionElement.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
  selectionElement.hidden = false;
}

window.qrSelection.onInitialize(({ image }) => {
  screenImage.src = image;
});

window.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  start = point(event);
  drawSelection(start);
  document.body.setPointerCapture(event.pointerId);
});

window.addEventListener("pointermove", (event) => {
  if (!start) return;
  drawSelection(point(event));
});

window.addEventListener("pointerup", (event) => {
  if (!start || event.button !== 0) return;
  const end = point(event);
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  start = null;
  if (width < 8 || height < 8) {
    selectionElement.hidden = true;
    return;
  }
  window.qrSelection.complete({
    x: left / window.innerWidth,
    y: top / window.innerHeight,
    width: width / window.innerWidth,
    height: height / window.innerHeight,
  });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.qrSelection.cancel();
});

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.qrSelection.cancel();
});
