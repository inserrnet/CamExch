package com.camexch.source;

import android.content.Context;
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
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoSource;
import org.webrtc.VideoTrack;

import java.util.ArrayList;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

final class WebRtcPublisher {
    private static final long SIGNAL_TIMEOUT_SECONDS = 10;

    private final EglBase eglBase;
    private final Context context;
    private final PeerConnectionFactory factory;
    private final SurfaceTextureHelper textureHelper;
    private final VideoSource videoSource;
    private final VideoTrack videoTrack;
    private final Surface videoSurface;
    private PeerConnection peerConnection;

    WebRtcPublisher(Context context) {
        this.context = context.getApplicationContext();
        AppLog.info(this.context, "PeerConnectionFactory.initialize");
        PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context.getApplicationContext())
                        .createInitializationOptions()
        );
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
        CapturerObserver observer = videoSource.getCapturerObserver();
        observer.onCapturerStarted(true);
        textureHelper.startListening(frame -> {
            observer.onFrameCaptured(frame);
            frame.release();
        });
        videoTrack = factory.createVideoTrack("camexch-video", videoSource);
        videoTrack.setEnabled(true);
        videoSurface = new Surface(textureHelper.getSurfaceTexture());
        AppLog.info(this.context, "WebRTC video surface ready");
    }

    Surface getVideoSurface() {
        return videoSurface;
    }

    synchronized String answerOffer(String offerSdp) throws Exception {
        AppLog.info(context, "WebRTC offer received, length=" + offerSdp.length());
        closePeer();
        CountDownLatch iceComplete = new CountDownLatch(1);
        PeerConnection.RTCConfiguration configuration = new PeerConnection.RTCConfiguration(new ArrayList<>());
        configuration.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        peerConnection = factory.createPeerConnection(configuration, new PeerObserver(iceComplete));
        if (peerConnection == null) {
            throw new IllegalStateException("Unable to create WebRTC peer");
        }
        peerConnection.addTrack(videoTrack, Collections.singletonList("camexch"));

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

    synchronized void release() {
        closePeer();
        videoSurface.release();
        textureHelper.stopListening();
        videoSource.getCapturerObserver().onCapturerStopped();
        textureHelper.dispose();
        videoTrack.dispose();
        videoSource.dispose();
        factory.dispose();
        eglBase.release();
    }

    private void closePeer() {
        if (peerConnection != null) {
            peerConnection.close();
            peerConnection.dispose();
            peerConnection = null;
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

    private static final class PeerObserver implements PeerConnection.Observer {
        private final CountDownLatch iceComplete;

        PeerObserver(CountDownLatch iceComplete) {
            this.iceComplete = iceComplete;
        }

        @Override public void onSignalingChange(PeerConnection.SignalingState state) {}
        @Override public void onIceConnectionChange(PeerConnection.IceConnectionState state) {}
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
