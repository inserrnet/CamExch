package com.camexch.browser;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

public class LogSanitizerTest {
    @Test
    public void removesSensitiveUrlQueries() {
        String sanitized = LogSanitizer.sanitize(
                "open https://example.test/path?token=secret&mode=test#screen");

        assertFalse(sanitized.contains("secret"));
        assertEquals("open https://example.test/path?<redacted>#screen", sanitized);
    }

    @Test
    public void keepsPlainDiagnosticText() {
        assertEquals(
                "WebRTC selected route=10.0.0.2",
                LogSanitizer.sanitize("WebRTC selected route=10.0.0.2")
        );
    }
}
