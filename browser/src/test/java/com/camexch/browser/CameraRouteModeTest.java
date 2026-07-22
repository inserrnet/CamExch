package com.camexch.browser;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class CameraRouteModeTest {
    @Test
    public void parsesKnownModesAndFallsBackToAuto() {
        assertEquals(CameraRouteMode.AUTO, CameraRouteMode.fromString(null));
        assertEquals(CameraRouteMode.AUTO, CameraRouteMode.fromString("invalid"));
        assertEquals(CameraRouteMode.SOURCE, CameraRouteMode.fromString("source"));
        assertEquals(CameraRouteMode.REAR, CameraRouteMode.fromString("REAR"));
    }
}
