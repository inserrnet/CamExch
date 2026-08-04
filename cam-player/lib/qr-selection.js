"use strict";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function normalizedSelection(start, end, viewport) {
  const width = Math.max(1, Number(viewport?.width) || 1);
  const height = Math.max(1, Number(viewport?.height) || 1);
  const left = clamp(Math.min(start.x, end.x), 0, width);
  const top = clamp(Math.min(start.y, end.y), 0, height);
  const right = clamp(Math.max(start.x, end.x), 0, width);
  const bottom = clamp(Math.max(start.y, end.y), 0, height);
  return {
    x: left / width,
    y: top / height,
    width: (right - left) / width,
    height: (bottom - top) / height,
  };
}

function cropForNormalized(selection, imageSize) {
  const imageWidth = Math.max(1, Math.floor(Number(imageSize?.width) || 1));
  const imageHeight = Math.max(1, Math.floor(Number(imageSize?.height) || 1));
  const left = clamp(selection?.x, 0, 1);
  const top = clamp(selection?.y, 0, 1);
  const right = clamp(left + (Number(selection?.width) || 0), left, 1);
  const bottom = clamp(top + (Number(selection?.height) || 0), top, 1);
  const x = Math.min(imageWidth - 1, Math.round(left * imageWidth));
  const y = Math.min(imageHeight - 1, Math.round(top * imageHeight));
  return {
    x,
    y,
    width: Math.max(1, Math.min(imageWidth - x, Math.round(right * imageWidth) - x)),
    height: Math.max(1, Math.min(imageHeight - y, Math.round(bottom * imageHeight) - y)),
  };
}

function bgraToRgba(bitmap) {
  const source = Buffer.from(bitmap || []);
  const result = new Uint8ClampedArray(source.length);
  for (let index = 0; index + 3 < source.length; index += 4) {
    result[index] = source[index + 2];
    result[index + 1] = source[index + 1];
    result[index + 2] = source[index];
    result[index + 3] = source[index + 3];
  }
  return result;
}

function adaptiveThresholds(rgba) {
  const histogram = new Uint32Array(256);
  let pixels = 0;
  for (let offset = 0; offset + 3 < rgba.length; offset += 4) {
    const luminance = Math.max(0, Math.min(255, Math.round(
      rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114,
    )));
    histogram[luminance] += 1;
    pixels += 1;
  }
  if (!pixels) return [];
  function percentile(fraction) {
    const target = pixels * fraction;
    let count = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      count += histogram[value];
      if (count >= target) return value;
    }
    return 255;
  }
  const dark = percentile(0.1);
  const light = percentile(0.9);
  if (light - dark < 24) return [];
  return [0.2, 0.32, 0.45]
    .map((fraction) => Math.round(dark + (light - dark) * fraction))
    .filter((value, index, values) => values.indexOf(value) === index);
}

function thresholdRgba(rgba, threshold) {
  const result = new Uint8ClampedArray(rgba.length);
  for (let offset = 0; offset + 3 < rgba.length; offset += 4) {
    const luminance = rgba[offset] * 0.299
      + rgba[offset + 1] * 0.587
      + rgba[offset + 2] * 0.114;
    const value = luminance < threshold ? 0 : 255;
    result[offset] = value;
    result[offset + 1] = value;
    result[offset + 2] = value;
    result[offset + 3] = 255;
  }
  return result;
}

module.exports = {
  normalizedSelection,
  cropForNormalized,
  bgraToRgba,
  adaptiveThresholds,
  thresholdRgba,
};
