package com.camexch.source;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;

import org.webrtc.CapturerObserver;
import org.webrtc.DataChannel;
import org.webrtc.DefaultVideoDecoderFactory;
import org.webrtc.DefaultVideoEncoderFactory;
import org.webrtc.EglBase;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpReceiver;
import org.webrtc.RtpParameters;
import org.webrtc.RtpSender;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoSource;
import org.webrtc.VideoFrame;
import org.webrtc.VideoTrack;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

final class WebRtcPublisher implements WebRtcSessionPublisher {
    private static final long SIGNAL_TIMEOUT_SECONDS = 10;
    private static final int MAX_PEERS = 4;
    private static final long FROZEN_FRAME_INTERVAL_MS = 200;

    private final EglBase eglBase;
    private final Context context;
    private final PeerConnectionFactory factory;
    private final SurfaceTextureHelper textureHelper;
    private final VideoSource videoSource;
    private final VideoTrack videoTrack;
    private final Surface videoSurface;
    private final CapturerObserver capturerObserver;
    private final Handler repeatHandler = new Handler(Looper.getMainLooper());
    private final Object frozenFrameLock = new Object();
    private final List<PeerConnection> peerConnections = new ArrayList<>();
    private final Map<PeerConnection, RtpSender> peerSenders = new HashMap<>();
    private int videoWidth = 640;
    private int videoHeight = 480;
    private VideoFrame frozenFrame;
    private Runnable freezeCallback;
    private boolean freezeCapturePending;
    private boolean repeatFrozenFrame;
    private boolean released;
    private final Runnable frozenFrameRepeater = new Runnable() {
        @Override
        public void run() {
            VideoFrame repeatedFrame = createRepeatedFrozenFrame();
            if (repeatedFrame != null) {
                try {
                    capturerObserver.onFrameCaptured(repeatedFrame);
                } finally {
                    repeatedFrame.release();
                }
            }
            synchronized (frozenFrameLock) {
                if (repeatFrozenFrame && !released) {
                    repeatHandler.postDelayed(this, FROZEN_FRAME_INTERVAL_MS);
                }
            }
        }
    };

    WebRtcPublisher(Context context) {
        this.context = context.getApplicationContext();
        WebRtcRuntime.initialize(this.context);
        eglBase = EglBase.create();
        AppLog.info(this.context, "EGL base created");
        factory = PeerConnectionFactory.builder()
                .setVideoEncoderFactory(new DefaultVideoEncoderFactory(eglBase.getEglBaseContext(), true, true))
                .setVideoDecoderFactory(new DefaultVideoDecoderFactory(eglBase.getEglBaseContext()))
                .createPeerConnectionFactory();
        textureHelper = SurfaceTextureHelper.create("CamExchVideo", eglBase.getEglBaseContext());
        if (textureHelper == null) {
            throw new IllegalStateException("Unable to create WebRTC video surface");
        }
        textureHelper.setTextureSize(640, 480);
        videoSource = factory.createVideoSource(false);
        capturerObserver = videoSource.getCapturerObserver();
        capturerObserver.onCapturerStarted(true);
        textureHelper.startListening(this::onTextureFrame);
        videoTrack = factory.createVideoTrack("camexch-video", videoSource);
        videoTrack.setEnabled(true);
        videoSurface = new Surface(textureHelper.getSurfaceTexture());
        AppLog.info(this.context, "WebRTC video surface ready");
    }

    Surface getVideoSurface() {
        return videoSurface;
    }

    void freezeOnNextFrame(Runnable callback) {
        synchronized (frozenFrameLock) {
            if (released) {
                return;
            }
            freezeCapturePending = true;
            freezeCallback = callback;
        }
        AppLog.info(context, "Waiting to capture video pause frame");
    }

    void cancelPendingFreeze() {
        synchronized (frozenFrameLock) {
            freezeCapturePending = false;
            freezeCallback = null;
        }
    }

    void setFrozenFrameRepeating(boolean repeating) {
        synchronized (frozenFrameLock) {
            repeatFrozenFrame = repeating && frozenFrame != null && !released;
        }
        repeatHandler.removeCallbacks(frozenFrameRepeater);
        if (repeating) {
            repeatHandler.post(frozenFrameRepeater);
        }
        AppLog.info(context, "Frozen video frame repeating=" + repeating);
    }

    synchronized void setVideoSize(int width, int height) {
        if (width <= 0 || height <= 0) {
            return;
        }
        videoWidth = width;
        videoHeight = height;
        AppLog.info(context, "WebRTC texture size=" + width + "x" + height);
        textureHelper.setTextureSize(width, height);
        for (RtpSender sender : peerSenders.values()) {
            configureHighQualitySender(sender);
        }
    }

    @Override
    public synchronized String answerOffer(String offerSdp) throws Exception {
        if (offerSdp == null || offerSdp.trim().isEmpty()) {
            throw new IllegalArgumentException("WebRTC offer is empty");
        }
        AppLog.info(context, "WebRTC offer received, length=" + offerSdp.length());
        while (peerConnections.size() >= MAX_PEERS) {
            closePeer(peerConnections.remove(0));
        }
        CountDownLatch iceComplete = new CountDownLatch(1);
        PeerConnection.RTCConfiguration configuration = new PeerConnection.RTCConfiguration(new ArrayList<>());
        configuration.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        PeerConnection peerConnection = factory.createPeerConnection(configuration, new PeerObserver(iceComplete));
        if (peerConnection == null) {
            throw new IllegalStateException("Unable to create WebRTC peer");
        }
        peerConnections.add(peerConnection);
        RtpSender sender = peerConnection.addTrack(videoTrack, Collections.singletonList("camexch"));
        if (sender == null) {
            closePeer(peerConnection);
            peerConnections.remove(peerConnection);
            throw new IllegalStateException("Unable to add transcoded video track");
        }
        peerSenders.put(peerConnection, sender);
        configureHighQualitySender(sender);

        awaitDescription(observer -> peerConnection.setRemoteDescription(
                observer,
                new SessionDescription(SessionDescription.Type.OFFER, offerSdp)
        ));
        SessionDescription answer = awaitDescription(observer -> peerConnection.createAnswer(observer, new MediaConstraints()));
        awaitDescription(observer -> peerConnection.setLocalDescription(observer, answer));
        iceComplete.await(SIGNAL_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        SessionDescription local = peerConnection.getLocalDescription();
        if (local == null) {
            throw new IllegalStateException("WebRTC answer was not created");
        }
        AppLog.info(context, "WebRTC answer ready, length=" + local.description.length());
        return local.description;
    }

    private void configureHighQualitySender(RtpSender sender) {
        RtpParameters parameters = sender.getParameters();
        parameters.degradationPreference = RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION;
        int maxBitrateBps = VideoPipelinePolicy.maxBitrateForSize(videoWidth, videoHeight);
        for (RtpParameters.Encoding encoding : parameters.encodings) {
            encoding.scaleResolutionDownBy = VideoPipelinePolicy.RESOLUTION_SCALE;
            encoding.minBitrateBps = null;
            encoding.maxBitrateBps = maxBitrateBps;
            encoding.maxFramerate = VideoPipelinePolicy.TARGET_FPS;
            encoding.bitratePriority = 4.0;
        }
        boolean applied = sender.setParameters(parameters);
        AppLog.info(context, "Transcoded WebRTC quality lock applied=" + applied
                + " scale=" + VideoPipelinePolicy.RESOLUTION_SCALE
                + " size=" + videoWidth + "x" + videoHeight
                + " maxBitrate=" + maxBitrateBps
                + " maxFps=" + VideoPipelinePolicy.TARGET_FPS
                + " degradation=MAINTAIN_RESOLUTION");
    }

    @Override
    public synchronized void release() {
        synchronized (frozenFrameLock) {
            released = true;
            repeatFrozenFrame = false;
            freezeCapturePending = false;
            freezeCallback = null;
        }
        repeatHandler.removeCallbacks(frozenFrameRepeater);
        VideoFrame frameToRelease;
        synchronized (frozenFrameLock) {
            frameToRelease = frozenFrame;
            frozenFrame = null;
        }
        if (frameToRelease != null) {
            frameToRelease.release();
        }
        for (PeerConnection peerConnection : peerConnections) {
            closePeer(peerConnection);
        }
        peerConnections.clear();
        peerSenders.clear();
        videoSurface.release();
        textureHelper.stopListening();
        capturerObserver.onCapturerStopped();
        textureHelper.dispose();
        videoTrack.dispose();
        videoSource.dispose();
        factory.dispose();
        eglBase.release();
    }

    private void onTextureFrame(VideoFrame frame) {
        boolean capture;
        Runnable callback;
        synchronized (frozenFrameLock) {
            capture = freezeCapturePending && !released;
            callback = capture ? freezeCallback : null;
            if (capture) {
                freezeCapturePending = false;
                freezeCallback = null;
            }
        }

        capturerObserver.onFrameCaptured(frame);
        if (!capture) {
            return;
        }

        VideoFrame.I420Buffer i420Buffer = frame.getBuffer().toI420();
        VideoFrame snapshot = new VideoFrame(i420Buffer, frame.getRotation(), frame.getTimestampNs());
        VideoFrame previous;
        boolean accepted;
        synchronized (frozenFrameLock) {
            previous = frozenFrame;
            accepted = !released;
            if (accepted) {
                frozenFrame = snapshot;
                repeatFrozenFrame = true;
            }
        }
        if (!accepted) {
            snapshot.release();
            return;
        }
        if (previous != null) {
            previous.release();
        }
        repeatHandler.removeCallbacks(frozenFrameRepeater);
        repeatHandler.post(frozenFrameRepeater);
        AppLog.info(context, "Captured frozen video frame size="
                + snapshot.getBuffer().getWidth() + "x" + snapshot.getBuffer().getHeight());
        if (callback != null) {
            repeatHandler.post(callback);
        }
    }

    private VideoFrame createRepeatedFrozenFrame() {
        synchronized (frozenFrameLock) {
            if (!repeatFrozenFrame || frozenFrame == null || released) {
                return null;
            }
            VideoFrame.Buffer buffer = frozenFrame.getBuffer();
            buffer.retain();
            return new VideoFrame(buffer, frozenFrame.getRotation(), System.nanoTime());
        }
    }

    private void closePeer(PeerConnection peerConnection) {
        if (peerConnection != null) {
            peerSenders.remove(peerConnection);
            peerConnection.close();
            peerConnection.dispose();
        }
    }

    private SessionDescription awaitDescription(SdpAction action) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<SessionDescription> description = new AtomicReference<>();
        AtomicReference<String> error = new AtomicReference<>();
        action.run(new SdpObserver() {
            @Override
            public void onCreateSuccess(SessionDescription value) {
                description.set(value);
                latch.countDown();
            }

            @Override
            public void onSetSuccess() {
                latch.countDown();
            }

            @Override
            public void onCreateFailure(String message) {
                error.set(message);
                latch.countDown();
            }

            @Override
            public void onSetFailure(String message) {
                error.set(message);
                latch.countDown();
            }
        });
        if (!latch.await(SIGNAL_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw new IllegalStateException("WebRTC signaling timed out");
        }
        if (error.get() != null) {
            throw new IllegalStateException(error.get());
        }
        return description.get();
    }

    private interface SdpAction {
        void run(SdpObserver observer);
    }

    private final class PeerObserver implements PeerConnection.Observer {
        private final CountDownLatch iceComplete;

        PeerObserver(CountDownLatch iceComplete) {
            this.iceComplete = iceComplete;
        }

        @Override public void onSignalingChange(PeerConnection.SignalingState state) {}
        @Override public void onIceConnectionChange(PeerConnection.IceConnectionState state) {
            AppLog.info(context, "WebRTC ICE state=" + state);
        }
        @Override public void onIceConnectionReceivingChange(boolean receiving) {}
        @Override public void onIceGatheringChange(PeerConnection.IceGatheringState state) {
            if (state == PeerConnection.IceGatheringState.COMPLETE) {
                iceComplete.countDown();
            }
        }
        @Override public void onIceCandidate(IceCandidate candidate) {}
        @Override public void onIceCandidatesRemoved(IceCandidate[] candidates) {}
        @Override public void onAddStream(MediaStream stream) {}
        @Override public void onRemoveStream(MediaStream stream) {}
        @Override public void onDataChannel(DataChannel channel) {}
        @Override public void onRenegotiationNeeded() {}
        @Override public void onAddTrack(RtpReceiver receiver, MediaStream[] streams) {}
    }
}
