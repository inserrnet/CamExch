package com.camexch.source;

final class VideoGeometry {
    static final class Size {
        final int width;
        final int height;

        Size(int width, int height) {
            this.width = width;
            this.height = height;
        }
    }

    private VideoGeometry() {
    }

    static Size displaySize(int width, int height, int rotationDegrees, float pixelAspectRatio) {
        if (width <= 0 || height <= 0) {
            throw new IllegalArgumentException("Video dimensions must be positive");
        }
        if (Math.abs(pixelAspectRatio - 1.0f) > 0.01f) {
            throw new IllegalArgumentException("Non-square RTSP pixels are unsupported: "
                    + pixelAspectRatio);
        }
        int rotation = ((rotationDegrees % 360) + 360) % 360;
        if (rotation % 90 != 0) {
            throw new IllegalArgumentException("Unsupported video rotation: " + rotationDegrees);
        }
        return rotation == 90 || rotation == 270
                ? new Size(height, width)
                : new Size(width, height);
    }
}
