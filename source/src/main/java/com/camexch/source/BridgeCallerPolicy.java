package com.camexch.source;

final class BridgeCallerPolicy {
    private static final String BROWSER_PACKAGE = "com.camexch.browser";

    private BridgeCallerPolicy() {
    }

    static boolean isAllowed(String[] packages, boolean signaturesMatch) {
        if (packages == null || !signaturesMatch) {
            return false;
        }
        for (String packageName : packages) {
            if (BROWSER_PACKAGE.equals(packageName)) {
                return true;
            }
        }
        return false;
    }
}
