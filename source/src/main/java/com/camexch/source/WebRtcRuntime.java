package com.camexch.source;

import android.content.Context;

import org.webrtc.PeerConnectionFactory;

final class WebRtcRuntime {
    private static boolean initialized;

    private WebRtcRuntime() {
    }

    static synchronized void initialize(Context context) {
        if (initialized) {
            return;
        }
        Context applicationContext = context.getApplicationContext();
        AppLog.info(applicationContext, "Loading WebRTC native runtime");
        PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(applicationContext)
                        .createInitializationOptions()
        );
        initialized = true;
        AppLog.info(applicationContext, "WebRTC native runtime loaded");
    }
}
