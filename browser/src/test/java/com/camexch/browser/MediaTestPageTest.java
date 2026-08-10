package com.camexch.browser;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class MediaTestPageTest {
    @Test
    public void pageKeepsOneStreamAcrossEqualDisplayAndRecorderPhases() throws Exception {
        String page = new String(Files.readAllBytes(
                Paths.get("src/main/assets/media_test.html")), StandardCharsets.UTF_8);

        assertTrue(page.contains("const PHASE_MS = 60000"));
        assertTrue(page.contains("A_display_only"));
        assertTrue(page.contains("B_media_recorder"));
        assertTrue(page.contains("new MediaRecorder(stream"));
        assertTrue(page.contains("No video file is retained"));
        assertFalse(page.contains("recordedBlobs"));
        assertFalse(page.contains("URL.createObjectURL"));
    }
}
