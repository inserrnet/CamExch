package com.camexch.source;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.annotation.OptIn;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.Renderer;
import androidx.media3.exoplayer.rtsp.RtspMediaSource;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

@OptIn(markerClass = UnstableApi.class)
public class SourceForegroundService extends Service {
    private static volatile SourceForegroundService instance;
    static final String ACTION_START_SOURCE = "com.camexch.source.START_SOURCE";
    static final String ACTION_STOP_SOURCE = "com.camexch.source.STOP_SOURCE";
    static final String ACTION_PLAY_VIDEO = "com.camexch.source.PLAY_VIDEO";
    static final String ACTION_PAUSE_VIDEO = "com.camexch.source.PAUSE_VIDEO";
    static final String ACTION_STATUS = "com.camexch.source.STATUS";
    static final String EXTRA_MODE = "mode";
    static final String EXTRA_URI = "uri";
    static final String EXTRA_STATUS = "status";
    static final String EXTRA_ERROR = "error";

    private static final String CHANNEL_ID = "virtual_camera_source";
    private static final int NOTIFICATION_ID = 1001;

    private MjpegServer server;
    private WebRtcSessionPublisher publisher;
    private H264FrameBridge directBridge;
    private ExoPlayer player;
    private String mode = "Idle";
    private String error = "";
    private String currentUri = "";
    private boolean directH264;
    private boolean fallbackScheduled;
    private boolean forceRtspTcp;
    private int rtspReconnectAttempts;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private Handler metricsHandler;
    private FloatingPlaybackControls playbackControls;
    private boolean videoPausePending;
    private final Runnable pipelineMetrics = new Runnable() {
        @Override
        public void run() {
            ExoPlayer activePlayer = player;
            if (activePlayer == null || !"RTSP".equals(mode)) {
                return;
            }
            AppLog.info(SourceForegroundService.this, "Pipeline metrics playerBufferedMs="
                    + activePlayer.getTotalBufferedDuration()
                    + " positionMs=" + activePlayer.getCurrentPosition()
                    + " state=" + activePlayer.getPlaybackState());
            metricsHandler.postDelayed(this, 2_000);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        metricsHandler = new Handler(Looper.getMainLooper());
        AppLog.info(this, "SourceForegroundService.onCreate");
        createChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        try {
            server = new MjpegServer(() -> publisher, () -> mode);
            server.start();
            AppLog.info(this, "Local bridge started on 127.0.0.1:" + MjpegServer.PORT);
        } catch (Throwable throwable) {
            reportError("Local server", throwable);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_START_SOURCE.equals(intent.getAction())) {
            startSource(intent.getStringExtra(EXTRA_MODE), intent.getStringExtra(EXTRA_URI));
        } else if (intent != null && ACTION_STOP_SOURCE.equals(intent.getAction())) {
            stopSource();
        } else if (intent != null && ACTION_PLAY_VIDEO.equals(intent.getAction())) {
            setVideoPlaying(true);
        } else if (intent != null && ACTION_PAUSE_VIDEO.equals(intent.getAction())) {
            setVideoPlaying(false);
        }
        return START_REDELIVER_INTENT;
    }

    @Override
    public void onDestroy() {
        instance = null;
        removePlaybackControls();
        releaseVideoPipeline();
        if (server != null) {
            server.stop();
            server = null;
        }
        super.onDestroy();
    }

    static SourceForegroundService getInstance() {
        return instance;
    }

    String getBridgeMode() {
        if ("Error".equals(mode)) {
            throw new IllegalStateException(error.isEmpty() ? "Source is in an error state" : error);
        }
        if ("Idle".equals(mode)) {
            throw new IllegalStateException("Source is idle");
        }
        if (directH264 && (directBridge == null || !directBridge.isReady())) {
            throw new IllegalStateException("Direct H264 source is still waiting for its first frame");
        }
        return mode;
    }

    synchronized String answerBridgeOffer(String offer) throws Exception {
        if (publisher == null && directH264) {
            if (directBridge == null || !directBridge.isReady()) {
                throw new IllegalStateException("Direct H264 source is not ready");
            }
            publisher = new H264PassthroughPublisher(this, directBridge);
        }
        if (publisher == null) {
            throw new IllegalStateException("WebRTC source is not active; mode=" + mode);
        }
        AppLog.info(this, "Answering offer through Android IPC");
        String answer = publisher.answerOffer(offer);
        if (directH264) {
            scheduleDirectRtspRefresh();
        }
        return answer;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void startSource(String requestedMode, String uriText) {
        if (requestedMode == null) {
            return;
        }
        mode = requestedMode;
        currentUri = uriText == null ? "" : uriText;
        fallbackScheduled = false;
        forceRtspTcp = false;
        rtspReconnectAttempts = 0;
        videoPausePending = false;
        AppLog.info(this, "startSource mode=" + requestedMode + " uri=" + uriText);
        removePlaybackControls();
        error = "";
        getSharedPreferences("source", MODE_PRIVATE).edit()
                .putString(EXTRA_MODE, mode)
                .putString(EXTRA_URI, uriText)
                .apply();

        if ("Photo".equals(mode)) {
            releaseVideoPipeline();
            directH264 = false;
            if (!loadPhoto(uriText)) {
                reportError("Photo", new IllegalStateException("Unable to read the selected image"));
                return;
            }
            reportStatus("Photo active");
            return;
        }

        if (uriText == null || uriText.trim().isEmpty()) {
            reportError(mode, new IllegalArgumentException("Source address is empty"));
            return;
        }
        releaseVideoPipeline();
        directH264 = false;
        if (!ensureVideoPipeline(false)) {
            return;
        }
        acquirePipelineLocks();
        prepareVideoSource(uriText);
    }

    private void prepareVideoSource(String uriText) {
        try {
            MediaItem mediaItem = MediaItem.fromUri(Uri.parse(uriText));
            if ("RTSP".equals(mode)) {
                AppLog.info(this, "RTSP transport=" + (forceRtspTcp ? "TCP forced" : "UDP preferred")
                        + " maxBufferMs=" + VideoPipelinePolicy.MAX_BUFFER_MS
                        + " hardwareTranscode=true");
                player.setMediaSource(new RtspMediaSource.Factory()
                        .setTimeoutMs(VideoPipelinePolicy.RTSP_TIMEOUT_MS)
                        .setForceUseRtpTcp(forceRtspTcp)
                        .createMediaSource(mediaItem));
            } else {
                player.setMediaItem(mediaItem);
            }
            boolean autoPlay = SourcePlaybackPolicy.shouldAutoPlay(mode);
            if ("Video".equals(mode)) {
                videoPausePending = true;
                showPlaybackControls(false);
                if (publisher instanceof WebRtcPublisher) {
                    ExoPlayer activePlayer = player;
                    ((WebRtcPublisher) publisher).freezeOnNextFrame(
                            () -> completeVideoPause(activePlayer, "initial frame")
                    );
                }
            }
            player.prepare();
            player.play();
            metricsHandler.removeCallbacks(pipelineMetrics);
            metricsHandler.postDelayed(pipelineMetrics, 2_000);
            reportStatus(autoPlay ? mode + " starting" : "Video preparing first frame");
        } catch (Throwable throwable) {
            reportError(mode, throwable);
        }
    }

    private boolean ensureVideoPipeline(boolean direct) {
        if (publisher != null && player != null) {
            return true;
        }
        releaseVideoPipeline();
        try {
            DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                    .setBufferDurationsMs(
                            VideoPipelinePolicy.MIN_BUFFER_MS,
                            VideoPipelinePolicy.MAX_BUFFER_MS,
                            VideoPipelinePolicy.PLAYBACK_BUFFER_MS,
                            VideoPipelinePolicy.REBUFFER_MS)
                    .setBackBuffer(0, false)
                    .setPrioritizeTimeOverSizeThresholds(true)
                    .build();
            if (direct) {
                AppLog.info(this, "Initializing direct H264 Media3 renderer");
                directBridge = new H264FrameBridge(this);
                player = new ExoPlayer.Builder(this, (eventHandler, videoListener, audioListener,
                                                       textOutput, metadataOutput) -> new Renderer[]{
                        new H264PassthroughRenderer(directBridge)
                }).setLoadControl(loadControl).build();
            } else {
                AppLog.info(this, "Initializing decoded WebRTC publisher");
                WebRtcPublisher decodedPublisher = new WebRtcPublisher(this);
                publisher = decodedPublisher;
                if ("RTSP".equals(mode)) {
                    AppLog.info(this, "Initializing custom low-latency H264 decoder renderer");
                    LowLatencyH264DecoderRenderer renderer = new LowLatencyH264DecoderRenderer(
                            this,
                            decodedPublisher.getVideoSurface(),
                            decodedPublisher::setVideoSize
                    );
                    player = new ExoPlayer.Builder(this, (eventHandler, videoListener, audioListener,
                                                           textOutput, metadataOutput) -> new Renderer[]{renderer})
                            .setLoadControl(loadControl)
                            .build();
                } else {
                    player = new ExoPlayer.Builder(this)
                            .setLoadControl(loadControl)
                            .build();
                    player.setVideoSurface(decodedPublisher.getVideoSurface());
                }
            }
            player.setRepeatMode(Player.REPEAT_MODE_ONE);
            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY) {
                        AppLog.info(SourceForegroundService.this, "Player STATE_READY");
                        if ("Video".equals(mode) && videoPausePending) {
                            reportStatus("Video preparing pause frame");
                        } else if ("Video".equals(mode) && !player.getPlayWhenReady()) {
                            reportStatus("Video paused");
                        } else {
                            reportStatus("RTSP".equals(mode)
                                    ? "RTSP hardware transcode active"
                                    : mode + " active");
                        }
                    }
                }

                @Override
                public void onRenderedFirstFrame() {
                    AppLog.info(SourceForegroundService.this, "Player rendered first video frame");
                }

                @Override
                public void onVideoSizeChanged(VideoSize videoSize) {
                    AppLog.info(SourceForegroundService.this, "Player video size="
                            + videoSize.width + "x" + videoSize.height);
                    if (publisher instanceof WebRtcPublisher) {
                        WebRtcPublisher activePublisher = (WebRtcPublisher) publisher;
                        activePublisher.setVideoSize(videoSize.width, videoSize.height);
                    }
                }

                @Override
                public void onTracksChanged(Tracks tracks) {
                    if (!directH264 || fallbackScheduled) {
                        return;
                    }
                    boolean videoFound = false;
                    boolean h264Found = false;
                    for (Tracks.Group group : tracks.getGroups()) {
                        for (int i = 0; i < group.length; i++) {
                            Format format = group.getTrackFormat(i);
                            if (MimeTypes.isVideo(format.sampleMimeType)) {
                                videoFound = true;
                                h264Found |= MimeTypes.VIDEO_H264.equals(format.sampleMimeType);
                            }
                        }
                    }
                    if (videoFound && !h264Found) {
                        scheduleDecodedFallback("RTSP codec is not H264");
                    }
                }

                @Override
                public void onPlayerError(PlaybackException playbackError) {
                    if (directH264 && !fallbackScheduled) {
                        scheduleDecodedFallback("Direct H264 failed: " + playbackError.getMessage());
                    } else if ("RTSP".equals(mode)
                            && playbackError.errorCode != PlaybackException.ERROR_CODE_DECODING_FAILED
                            && rtspReconnectAttempts < 2) {
                        scheduleRtspReconnect(playbackError);
                    } else {
                        reportError(mode, playbackError);
                    }
                }
            });
            return true;
        } catch (Throwable throwable) {
            releaseVideoPipeline();
            reportError("WebRTC", throwable);
            return false;
        }
    }

    private void releaseVideoPipeline() {
        if (metricsHandler != null) {
            metricsHandler.removeCallbacks(pipelineMetrics);
        }
        if (player != null) {
            try {
                player.release();
            } catch (Throwable ignored) {
            }
            player = null;
        }
        if (publisher != null) {
            try {
                publisher.release();
            } catch (Throwable ignored) {
            }
            publisher = null;
        }
        if (directBridge != null) {
            directBridge.release();
            directBridge = null;
        }
        releasePipelineLocks();
    }

    private void acquirePipelineLocks() {
        if (wakeLock == null) {
            PowerManager powerManager = getSystemService(PowerManager.class);
            wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "CamExch:SourcePipeline"
            );
            wakeLock.setReferenceCounted(false);
        }
        if (!wakeLock.isHeld()) {
            wakeLock.acquire(10 * 60 * 1_000L);
        }
        if (wifiLock == null) {
            WifiManager wifiManager = getApplicationContext().getSystemService(WifiManager.class);
            wifiLock = wifiManager.createWifiLock(
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                    "CamExch:RtspPipeline"
            );
            wifiLock.setReferenceCounted(false);
        }
        if (!wifiLock.isHeld()) {
            wifiLock.acquire();
        }
        AppLog.info(this, "Pipeline WakeLock and WifiLock acquired");
    }

    private void releasePipelineLocks() {
        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    private void scheduleDecodedFallback(String reason) {
        fallbackScheduled = true;
        AppLog.info(this, reason + "; switching to decoded fallback");
        new Handler(Looper.getMainLooper()).post(() -> {
            if (!directH264 || currentUri.isEmpty()) {
                return;
            }
            releaseVideoPipeline();
            directH264 = false;
            fallbackScheduled = false;
            if (ensureVideoPipeline(false)) {
                reportStatus("RTSP decoded fallback starting");
                prepareVideoSource(currentUri);
            }
        });
    }

    private void scheduleDirectRtspRefresh() {
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (!directH264 || player == null || currentUri.isEmpty()) {
                return;
            }
            AppLog.info(this, "Restarting RTSP session to request an immediate H264 keyframe");
            try {
                player.stop();
                prepareVideoSource(currentUri);
            } catch (Throwable throwable) {
                reportError("RTSP keyframe refresh", throwable);
            }
        }, 300);
    }

    private void scheduleRtspReconnect(PlaybackException playbackError) {
        rtspReconnectAttempts++;
        forceRtspTcp = true;
        AppLog.info(this, "RTSP reconnect attempt=" + rtspReconnectAttempts
                + " transport=TCP reason=" + playbackError.getMessage());
        reportStatus("RTSP reconnecting over TCP");
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (player == null || currentUri.isEmpty() || !"RTSP".equals(mode)) {
                return;
            }
            try {
                player.stop();
                prepareVideoSource(currentUri);
            } catch (Throwable throwable) {
                reportError("RTSP reconnect", throwable);
            }
        }, 200);
    }

    private void stopSource() {
        mode = "Idle";
        error = "";
        directH264 = false;
        removePlaybackControls();
        getSharedPreferences("source", MODE_PRIVATE).edit().clear().apply();
        releaseVideoPipeline();
        reportStatus("Idle");
    }

    private boolean loadPhoto(String uriText) {
        if (uriText == null) {
            return false;
        }
        try (InputStream in = getContentResolver().openInputStream(Uri.parse(uriText));
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) {
                return false;
            }
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            FrameStore.setJpeg(out.toByteArray());
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private void reportError(String component, Throwable throwable) {
        String detail = throwable.getMessage();
        if (detail == null || detail.trim().isEmpty()) {
            detail = throwable.getClass().getSimpleName();
        }
        error = component + ": " + detail;
        AppLog.error(this, error, throwable);
        mode = "Error";
        removePlaybackControls();
        reportStatus(error);
        new Handler(Looper.getMainLooper()).post(this::releaseVideoPipeline);
    }

    private void reportStatus(String status) {
        updateNotification();
        Intent intent = new Intent(ACTION_STATUS);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_STATUS, status);
        intent.putExtra(EXTRA_ERROR, error);
        sendBroadcast(intent);
    }

    private void showPlaybackControls(boolean playing) {
        if (playbackControls == null) {
            playbackControls = new FloatingPlaybackControls(this, new FloatingPlaybackControls.Listener() {
                @Override
                public void onPlay() {
                    setVideoPlaying(true);
                }

                @Override
                public void onPause() {
                    setVideoPlaying(false);
                }
            });
        }
        playbackControls.show();
        playbackControls.setPlaying(playing);
    }

    private void removePlaybackControls() {
        if (playbackControls != null) {
            playbackControls.hide();
            playbackControls = null;
        }
    }

    private void setVideoPlaying(boolean playing) {
        ExoPlayer activePlayer = player;
        if (!"Video".equals(mode) || activePlayer == null) {
            AppLog.info(this, "Ignoring playback control; mode=" + mode);
            return;
        }
        if (playing) {
            videoPausePending = false;
            if (publisher instanceof WebRtcPublisher) {
                WebRtcPublisher activePublisher = (WebRtcPublisher) publisher;
                activePublisher.cancelPendingFreeze();
                activePublisher.setFrozenFrameRepeating(false);
            }
            activePlayer.play();
        } else {
            if (activePlayer.getPlayWhenReady() && publisher instanceof WebRtcPublisher) {
                videoPausePending = true;
                if (playbackControls != null) {
                    playbackControls.setPlaying(false);
                }
                reportStatus("Video capturing pause frame");
                ((WebRtcPublisher) publisher).freezeOnNextFrame(
                        () -> completeVideoPause(activePlayer, "current frame")
                );
                return;
            }
            activePlayer.pause();
            if (publisher instanceof WebRtcPublisher) {
                ((WebRtcPublisher) publisher).setFrozenFrameRepeating(true);
            }
        }
        if (playbackControls != null) {
            playbackControls.setPlaying(playing);
        }
        AppLog.info(this, "Video playback " + (playing ? "resumed" : "paused"));
        reportStatus(playing ? "Video active" : "Video paused");
    }

    private void completeVideoPause(ExoPlayer expectedPlayer, String reason) {
        if (player != expectedPlayer || !"Video".equals(mode) || !videoPausePending) {
            return;
        }
        expectedPlayer.pause();
        videoPausePending = false;
        if (playbackControls != null) {
            playbackControls.setPlaying(false);
        }
        AppLog.info(this, "Video paused on " + reason
                + " positionMs=" + expectedPlayer.getCurrentPosition());
        reportStatus("Video paused");
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Front Camera 4 source",
                NotificationManager.IMPORTANCE_LOW
        );
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void updateNotification() {
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildNotification());
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        String text = error.isEmpty() ? mode + " via local WebRTC" : error;
        return builder
                .setContentTitle(error.isEmpty() ? "Front Camera 4 source" : "Front Camera 4 source error")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setOngoing(true)
                .build();
    }
}
