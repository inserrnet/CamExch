package com.camexch.browser;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class CameraRouteModeTest {
    @Test
    public void parsesKnownModesAndFallsBackToSource() {
        assertEquals(CameraRouteMode.SOURCE, CameraRouteMode.fromString(null));
        assertEquals(CameraRouteMode.SOURCE, CameraRouteMode.fromString("invalid"));
        assertEquals(CameraRouteMode.SOURCE, CameraRouteMode.fromString("source"));
        assertEquals(CameraRouteMode.REAR, CameraRouteMode.fromString("REAR"));
        assertEquals(CameraRouteMode.NATIVE, CameraRouteMode.fromString("native"));
    }
}
