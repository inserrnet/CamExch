package com.camexch.browser;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NativeCameraAuthorizationStoreTest {
    @Test
    public void authorizationIsOriginBoundAndOneShot() {
        NativeCameraAuthorizationStore store = new NativeCameraAuthorizationStore();

        assertTrue(store.authorize("https://Example.com/path", 100L));
        assertFalse(store.consume("https://other.example", 101L));
        assertTrue(store.consume("https://example.com/another", 102L));
        assertFalse(store.consume("https://example.com", 103L));
    }

    @Test
    public void expiredAuthorizationIsRejected() {
        NativeCameraAuthorizationStore store = new NativeCameraAuthorizationStore();

        assertTrue(store.authorize("https://example.com", 100L));
        assertFalse(store.consume(
                "https://example.com",
                100L + NativeCameraAuthorizationStore.AUTHORIZATION_TTL_MS + 1L));
    }

    @Test
    public void simultaneousRequestsEachReceiveOneAuthorization() {
        NativeCameraAuthorizationStore store = new NativeCameraAuthorizationStore();

        assertTrue(store.authorize("https://example.com", 100L));
        assertTrue(store.authorize("https://example.com", 101L));
        assertTrue(store.consume("https://example.com", 102L));
        assertTrue(store.consume("https://example.com", 103L));
        assertFalse(store.consume("https://example.com", 104L));
    }

    @Test
    public void invalidOriginCannotBeAuthorized() {
        NativeCameraAuthorizationStore store = new NativeCameraAuthorizationStore();

        assertFalse(store.authorize("not an origin", 100L));
        assertFalse(store.consume("not an origin", 101L));
    }
}
