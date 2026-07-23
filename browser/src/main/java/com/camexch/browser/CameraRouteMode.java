package com.camexch.browser;

enum CameraRouteMode {
    AUTO,
    SOURCE,
    REAR,
    NATIVE;

    static CameraRouteMode fromString(String value) {
        if (value != null) {
            for (CameraRouteMode mode : values()) {
                if (mode.name().equalsIgnoreCase(value)) {
                    return mode;
                }
            }
        }
        return AUTO;
    }
}
