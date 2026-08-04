"use strict";

const jsQR = require("jsqr");
const {
  adaptiveThresholds,
  bgraToRgba,
  thresholdRgba,
} = require("./qr-selection");

function decodeQrImage(image) {
  const attempts = [image];
  const originalSize = image.getSize();
  if (Math.min(originalSize.width, originalSize.height) < 900) {
    const scale = Math.min(3, Math.max(2, Math.ceil(900 / Math.min(
      originalSize.width,
      originalSize.height,
    ))));
    attempts.push(image.resize({
      width: originalSize.width * scale,
      height: originalSize.height * scale,
      quality: "best",
    }));
  }
  for (const candidate of attempts) {
    const size = candidate.getSize();
    const rgba = bgraToRgba(candidate.toBitmap());
    const variants = [rgba];
    for (const threshold of adaptiveThresholds(rgba)) {
      variants.push(thresholdRgba(rgba, threshold));
    }
    for (const variant of variants) {
      const decoded = jsQR(
        variant,
        size.width,
        size.height,
        { inversionAttempts: "attemptBoth" },
      );
      if (decoded?.data) return decoded.data;
    }
  }
  return null;
}

module.exports = { decodeQrImage };
