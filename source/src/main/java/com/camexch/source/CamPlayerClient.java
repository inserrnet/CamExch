package com.camexch.source;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class CamPlayerClient {
    private static final int CONNECT_TIMEOUT_MS = 2_000;
    private static final int OFFER_TIMEOUT_MS = 18_000;

    private final String baseUrl;
    private final String token;

    CamPlayerClient(String address, String token) {
        this.baseUrl = normalizeAddress(address);
        this.token = token == null ? "" : token.trim();
    }

    static String normalizeAddress(String address) {
        String value = address == null ? "" : address.trim();
        if (value.isEmpty()) {
            return "";
        }
        if (!value.contains("://")) {
            value = "http://" + value;
        }
        try {
            URL url = new URL(value);
            int port = url.getPort() < 0 ? 8791 : url.getPort();
            return "http://" + url.getHost() + ":" + port;
        } catch (Exception error) {
            throw new IllegalArgumentException("Invalid Cam Player address: " + address, error);
        }
    }

    static String pair(String address, String code, String deviceName) throws Exception {
        CamPlayerClient client = new CamPlayerClient(address, "");
        JSONObject request = new JSONObject();
        request.put("code", code == null ? "" : code.trim());
        request.put("device", deviceName);
        JSONObject response = client.post("/pair", request, false, CONNECT_TIMEOUT_MS);
        String token = response.optString("token", "");
        if (token.isEmpty()) {
            throw new IllegalStateException("Cam Player did not return a pairing token");
        }
        return token;
    }

    JSONObject status() throws Exception {
        HttpURLConnection connection = open("/status", "GET", CONNECT_TIMEOUT_MS);
        try {
            return readResponse(connection);
        } finally {
            connection.disconnect();
        }
    }

    JSONObject motionConfig() throws Exception {
        if (token.isEmpty()) {
            throw new IllegalStateException("Cam Player is not paired");
        }
        HttpURLConnection connection = open("/motion-config", "GET", CONNECT_TIMEOUT_MS);
        try {
            connection.setRequestProperty("Authorization", "Bearer " + token);
            return readResponse(connection);
        } finally {
            connection.disconnect();
        }
    }

    String answerOffer(String offer, String configJson) throws Exception {
        if (token.isEmpty()) {
            throw new IllegalStateException("Cam Player is not paired");
        }
        JSONObject request = new JSONObject();
        request.put("sdp", offer);
        mergeConfig(request, configJson);
        JSONObject response = post("/offer", request, true, OFFER_TIMEOUT_MS);
        String answer = response.optString("sdp", "");
        if (answer.isEmpty()) {
            throw new IllegalStateException("Cam Player returned an empty WebRTC answer");
        }
        return answer;
    }

    JSONObject configure(String configJson) throws Exception {
        if (token.isEmpty()) {
            throw new IllegalStateException("Cam Player is not paired");
        }
        JSONObject request = configJson == null || configJson.trim().isEmpty()
                ? new JSONObject()
                : new JSONObject(configJson);
        return post("/configure", request, true, CONNECT_TIMEOUT_MS);
    }

    void closeSession(String sessionId, String reason) throws Exception {
        if (token.isEmpty()) {
            throw new IllegalStateException("Cam Player is not paired");
        }
        JSONObject request = new JSONObject();
        request.put("sessionId", sessionId == null ? "" : sessionId);
        request.put("reason", reason == null ? "" : reason);
        post("/close", request, true, CONNECT_TIMEOUT_MS);
    }

    HttpURLConnection openMotionStream() throws Exception {
        if (token.isEmpty()) {
            throw new IllegalStateException("Cam Player is not paired");
        }
        HttpURLConnection connection = open("/motion-stream", "POST", 0);
        connection.setRequestProperty("Content-Type", "application/x-ndjson");
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setDoOutput(true);
        connection.setChunkedStreamingMode(512);
        return connection;
    }

    private static void mergeConfig(JSONObject target, String configJson) throws Exception {
        if (configJson == null || configJson.trim().isEmpty()) {
            return;
        }
        JSONObject config = new JSONObject(configJson);
        java.util.Iterator<String> keys = config.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            target.put(key, config.get(key));
        }
    }

    private JSONObject post(String path, JSONObject body, boolean authenticated, int timeoutMs)
            throws Exception {
        HttpURLConnection connection = open(path, "POST", timeoutMs);
        try {
            connection.setRequestProperty("Content-Type", "application/json");
            if (authenticated) {
                connection.setRequestProperty("Authorization", "Bearer " + token);
            }
            connection.setDoOutput(true);
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(payload.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(payload);
            }
            return readResponse(connection);
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection open(String path, String method, int timeoutMs) throws Exception {
        if (baseUrl.isEmpty()) {
            throw new IllegalStateException("Cam Player address is empty");
        }
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(timeoutMs);
        connection.setUseCaches(false);
        return connection;
    }

    private static JSONObject readResponse(HttpURLConnection connection) throws Exception {
        int status = connection.getResponseCode();
        InputStream input = status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
        String body = readText(input);
        JSONObject json = body.isEmpty() ? new JSONObject() : new JSONObject(body);
        if (status < 200 || status >= 300) {
            String detail = json.optString("error", "HTTP " + status);
            throw new IllegalStateException(detail);
        }
        return json;
    }

    private static String readText(InputStream input) throws Exception {
        if (input == null) {
            return "";
        }
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8_192];
            int count;
            while ((count = stream.read(buffer)) >= 0) {
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
}
