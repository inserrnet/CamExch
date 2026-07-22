package com.camexch.browser;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;

import org.junit.Test;

public class AppLogTest {
    @Test
    public void tailWithinUtf8BytesKeepsCompleteAsciiTail() {
        assertEquals("6789", AppLog.tailWithinUtf8Bytes("0123456789", 4));
    }

    @Test
    public void tailWithinUtf8BytesDoesNotSplitUnicodeSurrogatePair() {
        String result = AppLog.tailWithinUtf8Bytes("prefix-\uD83D\uDE00-end", 8);

        assertTrue(result.getBytes(StandardCharsets.UTF_8).length <= 8);
        assertEquals("\uD83D\uDE00-end", result);
    }

    @Test
    public void tailWithinUtf8BytesReturnsWholeTextWhenItFits() {
        assertEquals("complete", AppLog.tailWithinUtf8Bytes("complete", 64));
    }
}
