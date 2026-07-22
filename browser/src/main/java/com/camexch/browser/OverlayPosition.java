package com.camexch.browser;

final class OverlayPosition {
    final int x;
    final int y;

    private OverlayPosition(int x, int y) {
        this.x = x;
        this.y = y;
    }

    static OverlayPosition clamp(
            int requestedX,
            int requestedY,
            int screenWidth,
            int screenHeight,
            int overlayWidth,
            int overlayHeight
    ) {
        int maxX = Math.max(0, screenWidth - overlayWidth);
        int maxY = Math.max(0, screenHeight - overlayHeight);
        return new OverlayPosition(
                Math.max(0, Math.min(requestedX, maxX)),
                Math.max(0, Math.min(requestedY, maxY))
        );
    }
}
