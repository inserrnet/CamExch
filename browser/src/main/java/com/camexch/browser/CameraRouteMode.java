package com.camexch.browser;

enum CameraRouteMode {
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
        return SOURCE;
    }
}
