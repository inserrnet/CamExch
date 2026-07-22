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
    private static final int MAX_BYTES = 2 * 1024 * 1024;

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
                if (target.length() > MAX_BYTES) {
                    writeFile(context, name, "");
                }
                try (FileOutputStream out = new FileOutputStream(target, true)) {
                    out.write(text.getBytes(StandardCharsets.UTF_8));
                    if (force) {
                        out.getFD().sync();
                    }
                }
            } catch (Throwable ignored) {
            }
        }
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
