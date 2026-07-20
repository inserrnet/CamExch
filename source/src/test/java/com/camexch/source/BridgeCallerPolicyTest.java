package com.camexch.source;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class BridgeCallerPolicyTest {
    @Test
    public void acceptsOnlyBrowserPackage() {
        assertTrue(BridgeCallerPolicy.isAllowed(new String[]{"com.camexch.browser"}, true));
        assertTrue(BridgeCallerPolicy.isAllowed(
                new String[]{"example.shared", "com.camexch.browser"},
                true
        ));
        assertFalse(BridgeCallerPolicy.isAllowed(new String[]{"example.attacker"}, true));
        assertFalse(BridgeCallerPolicy.isAllowed(new String[]{"com.camexch.browser"}, false));
        assertFalse(BridgeCallerPolicy.isAllowed(null, true));
    }
}
