package com.camexch.source;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class OverlayPositionTest {
    @Test
    public void preservesPositionInsideScreen() {
        OverlayPosition position = OverlayPosition.clamp(40, 80, 1080, 2400, 280, 120);

        assertEquals(40, position.x);
        assertEquals(80, position.y);
    }

    @Test
    public void clampsPositionToEveryScreenEdge() {
        OverlayPosition topLeft = OverlayPosition.clamp(-20, -30, 1080, 2400, 280, 120);
        OverlayPosition bottomRight = OverlayPosition.clamp(1200, 2500, 1080, 2400, 280, 120);

        assertEquals(0, topLeft.x);
        assertEquals(0, topLeft.y);
        assertEquals(800, bottomRight.x);
        assertEquals(2280, bottomRight.y);
    }

    @Test
    public void keepsOversizedOverlayAnchoredToTopLeft() {
        OverlayPosition position = OverlayPosition.clamp(100, 100, 200, 100, 280, 120);

        assertEquals(0, position.x);
        assertEquals(0, position.y);
    }
}
