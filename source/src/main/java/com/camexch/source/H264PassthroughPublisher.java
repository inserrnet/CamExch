package com.camexch.source;

import android.content.Context;

import org.webrtc.DataChannel;
import org.webrtc.DefaultVideoDecoderFactory;
import org.webrtc.EglBase;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpReceiver;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;
import org.webrtc.VideoSource;
import org.webrtc.VideoTrack;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

final class H264PassthroughPublisher implements WebRtcSessionPublisher {
    private static final long SIGNAL_TIMEOUT_SECONDS = 10;
    private static final int MAX_PEERS = 4;

    private final Context context;
    private final H264FrameBridge bridge;
    private final EglBase eglBase;
    private final PeerConnectionFactory factory;
    private final VideoSource videoSource;
    private final VideoTrack videoTrack;
    private final List<PeerConnection> peerConnections = new ArrayList<>();

    H264PassthroughPublisher(Context context, H264FrameBridge bridge) {
        this.context = context.getApplicationContext();
        this.bridge = bridge;
        AppLog.info(this.context, "Initializing direct H264 WebRTC publisher codecs=" + bridge.getCodecs());
        WebRtcRuntime.initialize(this.context);
        eglBase = EglBase.create();
        factory = PeerConnectionFactory.builder()
                .setVideoEncoderFactory(new H264PassthroughEncoderFactory(bridge))
                .setVideoDecoderFactory(new DefaultVideoDecoderFactory(eglBase.getEglBaseContext()))
                .createPeerConnectionFactory();
        videoSource = factory.createVideoSource(false);
        bridge.attach(videoSource.getCapturerObserver());
        videoTrack = factory.createVideoTrack("camexch-h264-direct", videoSource);
        videoTrack.setEnabled(true);
    }

    @Override
    public synchronized String answerOffer(String offerSdp) throws Exception {
        if (offerSdp == null || offerSdp.trim().isEmpty()) {
            throw new IllegalArgumentException("WebRTC offer is empty");
        }
        while (peerConnections.size() >= MAX_PEERS) {
            closePeer(peerConnections.remove(0));
        }
        CountDownLatch iceComplete = new CountDownLatch(1);
        PeerConnection.RTCConfiguration configuration = new PeerConnection.RTCConfiguration(new ArrayList<>());
        configuration.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        PeerConnection peerConnection = factory.createPeerConnection(configuration, new PeerObserver(iceComplete));
        if (peerConnection == null) {
            throw new IllegalStateException("Unable to create direct H264 WebRTC peer");
        }
        peerConnections.add(peerConnection);
        peerConnection.addTrack(videoTrack, Collections.singletonList("camexch"));

        awaitDescription(observer -> peerConnection.setRemoteDescription(
                observer,
                new SessionDescription(SessionDescription.Type.OFFER, offerSdp)
        ));
        SessionDescription answer = awaitDescription(
                observer -> peerConnection.createAnswer(observer, new MediaConstraints())
        );
        awaitDescription(observer -> peerConnection.setLocalDescription(observer, answer));
        iceComplete.await(SIGNAL_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        SessionDescription local = peerConnection.getLocalDescription();
        if (local == null) {
            throw new IllegalStateException("Direct H264 WebRTC answer was not created");
        }
        AppLog.info(context, "Direct H264 WebRTC answer ready, length=" + local.description.length());
        return local.description;
    }

    @Override
    public synchronized void release() {
        for (PeerConnection peerConnection : peerConnections) {
            closePeer(peerConnection);
        }
        peerConnections.clear();
        bridge.detach(videoSource.getCapturerObserver());
        videoTrack.dispose();
        videoSource.dispose();
        factory.dispose();
        eglBase.release();
    }

    private void closePeer(PeerConnection peerConnection) {
        peerConnection.close();
        peerConnection.dispose();
    }

    private SessionDescription awaitDescription(SdpAction action) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<SessionDescription> description = new AtomicReference<>();
        AtomicReference<String> error = new AtomicReference<>();
        action.run(new SdpObserver() {
            @Override public void onCreateSuccess(SessionDescription value) { description.set(value); latch.countDown(); }
            @Override public void onSetSuccess() { latch.countDown(); }
            @Override public void onCreateFailure(String message) { error.set(message); latch.countDown(); }
            @Override public void onSetFailure(String message) { error.set(message); latch.countDown(); }
        });
        if (!latch.await(SIGNAL_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw new IllegalStateException("Direct H264 WebRTC signaling timed out");
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
            AppLog.info(context, "Direct H264 ICE state=" + state);
        }
        @Override public void onIceConnectionReceivingChange(boolean receiving) {}
        @Override public void onIceGatheringChange(PeerConnection.IceGatheringState state) {
            if (state == PeerConnection.IceGatheringState.COMPLETE) iceComplete.countDown();
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
