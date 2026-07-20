package com.camexch.browser;

import java.net.URI;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

final class NativeCameraAuthorizationStore {
    static final long AUTHORIZATION_TTL_MS = 3_000L;

    private final Map<String, ArrayDeque<Long>> authorizations = new HashMap<>();

    synchronized boolean authorize(String origin, long nowMs) {
        String normalized = normalizeOrigin(origin);
        if (normalized == null) {
            return false;
        }
        authorizations.computeIfAbsent(normalized, ignored -> new ArrayDeque<>())
                .addLast(nowMs + AUTHORIZATION_TTL_MS);
        return true;
    }

    synchronized boolean consume(String origin, long nowMs) {
        String normalized = normalizeOrigin(origin);
        ArrayDeque<Long> pending = normalized == null ? null : authorizations.get(normalized);
        if (pending == null) {
            return false;
        }
        while (!pending.isEmpty() && nowMs > pending.peekFirst()) {
            pending.removeFirst();
        }
        boolean authorized = !pending.isEmpty();
        if (authorized) {
            pending.removeFirst();
        }
        if (pending.isEmpty()) {
            authorizations.remove(normalized);
        }
        return authorized;
    }

    static String normalizeOrigin(String value) {
        if (value == null) {
            return null;
        }
        try {
            URI uri = new URI(value.trim());
            String scheme = uri.getScheme();
            String authority = uri.getRawAuthority();
            if (scheme == null || authority == null || authority.isEmpty()) {
                return null;
            }
            return scheme.toLowerCase(Locale.ROOT) + "://" + authority.toLowerCase(Locale.ROOT);
        } catch (Exception ignored) {
            return null;
        }
    }
}
