package com.camexch.browser;

import android.content.Context;
import android.content.SharedPreferences;

final class CameraRoutePreferences {
    private static final String PREFS = "camera_routing";
    private static final String PREF_MODE = "mode";

    private final SharedPreferences preferences;

    CameraRoutePreferences(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    CameraRouteMode getMode() {
        return CameraRouteMode.fromString(
                preferences.getString(PREF_MODE, CameraRouteMode.AUTO.name()));
    }

    void setMode(CameraRouteMode mode) {
        preferences.edit().putString(PREF_MODE, mode.name()).apply();
    }
}
