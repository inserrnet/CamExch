package com.camexch.browser;

import android.app.Application;
import android.os.Build;

public class CamExchApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            AppLog.crash(this, thread, throwable);
            if (previous != null) {
                previous.uncaughtException(thread, throwable);
            }
        });
        AppLog.info(this, "Application started; Android=" + Build.VERSION.RELEASE
                + " sdk=" + Build.VERSION.SDK_INT
                + " device=" + Build.MANUFACTURER + " " + Build.MODEL
                + " abis=" + java.util.Arrays.toString(Build.SUPPORTED_ABIS));
    }
}
