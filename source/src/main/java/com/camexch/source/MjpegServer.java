package com.camexch.source;

import fi.iki.elonen.NanoHTTPD;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

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
        if ("/frame.jpg".equals(path)) {
            byte[] jpeg = FrameStore.getJpeg();
            Response response = newFixedLengthResponse(Response.Status.OK, "image/jpeg", new ByteArrayInputStream(jpeg), jpeg.length);
            response.addHeader("Cache-Control", "no-store");
            response.addHeader("Access-Control-Allow-Origin", "*");
            return response;
        }
        if ("/stream.mjpeg".equals(path)) {
            Response response = newChunkedResponse(
                    Response.Status.OK,
                    "multipart/x-mixed-replace; boundary=frame",
                    new MjpegInputStream()
            );
            response.addHeader("Cache-Control", "no-store, no-cache, must-revalidate");
            response.addHeader("Access-Control-Allow-Origin", "*");
            return response;
        }
        return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not found");
    }

    private static final class MjpegInputStream extends InputStream {
        private static final long FRAME_INTERVAL_MS = 50;
        private byte[] part = new byte[0];
        private int offset;
        private long nextFrameAt;

        @Override
        public int read() throws IOException {
            byte[] one = new byte[1];
            int count = read(one, 0, 1);
            return count < 0 ? -1 : one[0] & 0xff;
        }

        @Override
        public int read(byte[] buffer, int bufferOffset, int length) throws IOException {
            if (length == 0) {
                return 0;
            }
            if (offset >= part.length) {
                waitForNextFrame();
                byte[] jpeg = FrameStore.getJpeg();
                byte[] header = ("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                        + jpeg.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
                part = new byte[header.length + jpeg.length + 2];
                System.arraycopy(header, 0, part, 0, header.length);
                System.arraycopy(jpeg, 0, part, header.length, jpeg.length);
                part[part.length - 2] = '\r';
                part[part.length - 1] = '\n';
                offset = 0;
            }
            int count = Math.min(length, part.length - offset);
            System.arraycopy(part, offset, buffer, bufferOffset, count);
            offset += count;
            return count;
        }

        private void waitForNextFrame() throws IOException {
            long waitMs = nextFrameAt - System.currentTimeMillis();
            if (waitMs > 0) {
                try {
                    Thread.sleep(waitMs);
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new IOException("MJPEG stream interrupted", exception);
                }
            }
            nextFrameAt = System.currentTimeMillis() + FRAME_INTERVAL_MS;
        }
    }
}
