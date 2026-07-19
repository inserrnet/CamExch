package com.camexch.source;

import fi.iki.elonen.NanoHTTPD;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

final class MjpegServer extends NanoHTTPD {
    interface ModeProvider {
        String getMode();
    }

    interface PublisherProvider {
        WebRtcSessionPublisher getPublisher();
    }

    static final int PORT = 8765;
    private final PublisherProvider publisherProvider;
    private final ModeProvider modeProvider;

    MjpegServer(PublisherProvider publisherProvider, ModeProvider modeProvider) {
        super("127.0.0.1", PORT);
        this.publisherProvider = publisherProvider;
        this.modeProvider = modeProvider;
    }

    @Override
    public Response serve(IHTTPSession session) {
        if (Method.OPTIONS.equals(session.getMethod())) {
            return cors(newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", ""));
        }
        String path = session.getUri();
        if ("/health".equals(path)) {
            return cors(newFixedLengthResponse(Response.Status.OK, "text/plain", "ok"));
        }
        if ("/mode".equals(path)) {
            return cors(newFixedLengthResponse(Response.Status.OK, "text/plain", modeProvider.getMode()));
        }
        if ("/webrtc/offer".equals(path) && Method.POST.equals(session.getMethod())) {
            try {
                Map<String, String> files = new HashMap<>();
                session.parseBody(files);
                String offer = files.get("postData");
                if (offer == null || offer.trim().isEmpty()) {
                    return cors(newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "missing SDP offer"));
                }
                WebRtcSessionPublisher publisher = publisherProvider.getPublisher();
                if (publisher == null) {
                    return cors(newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "WebRTC source is unavailable"));
                }
                String answer = publisher.answerOffer(offer);
                return cors(newFixedLengthResponse(Response.Status.OK, "application/sdp", answer));
            } catch (Exception exception) {
                return cors(newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", exception.getMessage()));
            }
        }
        if ("/frame.jpg".equals(path)) {
            byte[] jpeg = FrameStore.getJpeg();
            return cors(newFixedLengthResponse(
                    Response.Status.OK,
                    "image/jpeg",
                    new ByteArrayInputStream(jpeg),
                    jpeg.length
            ));
        }
        if ("/stream.mjpeg".equals(path)) {
            return cors(newChunkedResponse(
                    Response.Status.OK,
                    "multipart/x-mixed-replace; boundary=frame",
                    new MjpegInputStream()
            ));
        }
        return cors(newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not found"));
    }

    private Response cors(Response response) {
        response.addHeader("Access-Control-Allow-Origin", "*");
        response.addHeader("Access-Control-Allow-Headers", "Content-Type");
        response.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.addHeader("Access-Control-Allow-Private-Network", "true");
        response.addHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        return response;
    }

    private static final class MjpegInputStream extends InputStream {
        private static final long FRAME_INTERVAL_MS = 100;
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
