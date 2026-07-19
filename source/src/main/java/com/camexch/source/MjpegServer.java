package com.camexch.source;

import fi.iki.elonen.NanoHTTPD;

final class MjpegServer extends NanoHTTPD {
    static final int PORT = 8765;

    MjpegServer() {
        super("127.0.0.1", PORT);
    }

    @Override
    public Response serve(IHTTPSession session) {
        String path = session.getUri();
        if ("/health".equals(path)) {
            return newFixedLengthResponse(Response.Status.OK, "text/plain", "ok");
        }
        if ("/frame.jpg".equals(path) || "/stream.mjpeg".equals(path)) {
            byte[] jpeg = FrameStore.getJpeg();
            Response response = newFixedLengthResponse(Response.Status.OK, "image/jpeg", new java.io.ByteArrayInputStream(jpeg), jpeg.length);
            response.addHeader("Cache-Control", "no-store");
            response.addHeader("Access-Control-Allow-Origin", "*");
            return response;
        }
        return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not found");
    }
}
