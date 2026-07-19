package com.camexch.source;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class VideoGeometryTest {
    @Test
    public void keepsPortraitAndLandscapeDimensions() {
        VideoGeometry.Size portrait = VideoGeometry.displaySize(704, 1248, 0, 1.0f);
        VideoGeometry.Size landscape = VideoGeometry.displaySize(1920, 1080, 0, 1.0f);

        assertEquals(704, portrait.width);
        assertEquals(1248, portrait.height);
        assertEquals(1920, landscape.width);
        assertEquals(1080, landscape.height);
    }

    @Test
    public void swapsDimensionsForQuarterTurn() {
        VideoGeometry.Size rotated = VideoGeometry.displaySize(1920, 1080, 90, 1.0f);
        assertEquals(1080, rotated.width);
        assertEquals(1920, rotated.height);
    }

    @Test
    public void rejectsGeometryThatWouldRequireSilentResampling() {
        assertThrows(IllegalArgumentException.class,
                () -> VideoGeometry.displaySize(720, 576, 0, 1.25f));
        assertThrows(IllegalArgumentException.class,
                () -> VideoGeometry.displaySize(1280, 720, 45, 1.0f));
    }
}
