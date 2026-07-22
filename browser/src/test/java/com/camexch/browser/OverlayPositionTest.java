package com.camexch.browser;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class OverlayPositionTest {
    @Test
    public void clampsOverlayToScreen() {
        OverlayPosition topLeft = OverlayPosition.clamp(-10, -20, 1080, 2400, 200, 80);
        OverlayPosition bottomRight = OverlayPosition.clamp(1200, 2600, 1080, 2400, 200, 80);

        assertEquals(0, topLeft.x);
        assertEquals(0, topLeft.y);
        assertEquals(880, bottomRight.x);
        assertEquals(2320, bottomRight.y);
    }
}
