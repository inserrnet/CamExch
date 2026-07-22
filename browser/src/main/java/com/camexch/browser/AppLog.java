package com.camexch.browser;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

final class AppLog {
    private static final Object LOCK = new Object();
    private static final String LOG_FILE = "camexch-browser.log";
    private static final String CRASH_FILE = "camexch-browser-crash.log";
    // Clipboard data crosses Android's Binder boundary. Keep the complete retained log
    // comfortably below the transaction limit so Samsung devices do not truncate it.
    private static final int MAX_BYTES = 320 * 1024;
    private static final String TRIM_NOTICE = "[Older browser log entries removed]\n";

    private AppLog() {
    }

    static void info(Context context, String message) {
        append(context, "INFO", message, false);
    }

    static void error(Context context, String message, Throwable throwable) {
        StringWriter writer = new StringWriter();
        throwable.printStackTrace(new PrintWriter(writer));
        append(context, "ERROR", message + "\n" + writer, true);
    }

    static void crash(Context context, Thread thread, Throwable throwable) {
        StringWriter writer = new StringWriter();
        throwable.printStackTrace(new PrintWriter(writer));
        String text = line("CRASH", "thread=" + thread.getName() + "\n" + writer);
        appendRaw(context, LOG_FILE, text, true);
        writeFile(context, CRASH_FILE, text);
    }

    static boolean hasCrash(Context context) {
        return file(context, CRASH_FILE).length() > 0;
    }

    static String read(Context context) {
        synchronized (LOCK) {
            try {
                String crash = readFile(file(context, CRASH_FILE));
                String log = readFile(file(context, LOG_FILE));
                return (crash.isEmpty() ? "" : "LAST CRASH\n" + crash + "\n") + log;
            } catch (Exception exception) {
                return "Unable to read log: " + exception;
            }
        }
    }

    static void clearCrash(Context context) {
        writeFile(context, CRASH_FILE, "");
    }

    static void clear(Context context) {
        writeFile(context, LOG_FILE, "");
        writeFile(context, CRASH_FILE, "");
    }

    private static void append(Context context, String level, String message, boolean force) {
        appendRaw(context, LOG_FILE, line(level, message), force);
    }

    private static String line(String level, String message) {
        String timestamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(new Date());
        return timestamp + " " + level + " " + message + "\n";
    }

    private static void appendRaw(Context context, String name, String text, boolean force) {
        synchronized (LOCK) {
            try {
                File target = file(context, name);
                byte[] encoded = text.getBytes(StandardCharsets.UTF_8);
                if (target.length() + encoded.length > MAX_BYTES) {
                    String combined = readFile(target) + text;
                    int contentLimit = MAX_BYTES - TRIM_NOTICE.getBytes(StandardCharsets.UTF_8).length;
                    writeFile(context, name, TRIM_NOTICE + tailWithinUtf8Bytes(combined, contentLimit));
                    return;
                }
                try (FileOutputStream out = new FileOutputStream(target, true)) {
                    out.write(encoded);
                    if (force) {
                        out.getFD().sync();
                    }
                }
            } catch (Throwable ignored) {
            }
        }
    }

    static String tailWithinUtf8Bytes(String text, int maxBytes) {
        if (maxBytes <= 0) {
            return "";
        }
        if (text.getBytes(StandardCharsets.UTF_8).length <= maxBytes) {
            return text;
        }

        int low = 0;
        int high = text.length();
        while (low < high) {
            int middle = (low + high) >>> 1;
            String suffix = text.substring(middle);
            if (suffix.getBytes(StandardCharsets.UTF_8).length <= maxBytes) {
                high = middle;
            } else {
                low = middle + 1;
            }
        }

        int start = low;
        if (start < text.length() && Character.isLowSurrogate(text.charAt(start))) {
            start++;
        }
        return text.substring(start);
    }

    private static void writeFile(Context context, String name, String text) {
        synchronized (LOCK) {
            try (FileOutputStream out = new FileOutputStream(file(context, name), false)) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            } catch (Throwable ignored) {
            }
        }
    }

    private static String readFile(File source) throws Exception {
        if (!source.exists()) {
            return "";
        }
        return new String(java.nio.file.Files.readAllBytes(source.toPath()), StandardCharsets.UTF_8);
    }

    private static File file(Context context, String name) {
        return new File(context.getFilesDir(), name);
    }
}
