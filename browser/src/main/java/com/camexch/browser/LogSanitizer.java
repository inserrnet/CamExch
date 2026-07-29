package com.camexch.browser;

final class LogSanitizer {
    private LogSanitizer() {
    }

    static String sanitize(String value) {
        if (value == null || value.isEmpty()) {
            return value == null ? "" : value;
        }
        return value
                .replaceAll("(?i)(https?://[^\\s?#]+)\\?[^#\\s]*", "$1?<redacted>")
                .replaceAll("(?i)([?&](?:token|ref_id|code|key)=)[^&#\\s]+", "$1<redacted>");
    }
}
