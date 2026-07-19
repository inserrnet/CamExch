package com.camexch.source;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.Renderer;
import androidx.media3.exoplayer.rtsp.RtspMediaSource;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class SourceForegroundService extends Service {
    private static volatile SourceForegroundService instance;
    static final String ACTION_START_SOURCE = "com.camexch.source.START_SOURCE";
    static final String ACTION_STOP_SOURCE = "com.camexch.source.STOP_SOURCE";
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

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
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
        }
        return START_REDELIVER_INTENT;
    }

    @Override
    public void onDestroy() {
        instance = null;
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
        AppLog.info(this, "startSource mode=" + requestedMode + " uri=" + uriText);
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
        directH264 = "RTSP".equals(mode);
        if (!ensureVideoPipeline(directH264)) {
            return;
        }
        prepareVideoSource(uriText);
    }

    private void prepareVideoSource(String uriText) {
        try {
            MediaItem mediaItem = MediaItem.fromUri(Uri.parse(uriText));
            if ("RTSP".equals(mode)) {
                AppLog.info(this, "RTSP transport=TCP maxBufferMs=1000 directH264=" + directH264);
                player.setMediaSource(new RtspMediaSource.Factory()
                        .setForceUseRtpTcp(true)
                        .createMediaSource(mediaItem));
            } else {
                player.setMediaItem(mediaItem);
            }
            player.prepare();
            player.play();
            reportStatus(mode + " starting");
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
                    .setBufferDurationsMs(250, 1000, 100, 250)
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
                player = new ExoPlayer.Builder(this)
                        .setLoadControl(loadControl)
                        .build();
                player.setVideoSurface(decodedPublisher.getVideoSurface());
            }
            player.setRepeatMode(Player.REPEAT_MODE_ONE);
            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY) {
                        AppLog.info(SourceForegroundService.this, "Player STATE_READY");
                        reportStatus(directH264 ? "RTSP direct H264 active" : mode + " active");
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

    private void stopSource() {
        mode = "Idle";
        error = "";
        directH264 = false;
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
        reportStatus(error);
    }

    private void reportStatus(String status) {
        updateNotification();
        Intent intent = new Intent(ACTION_STATUS);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_STATUS, status);
        intent.putExtra(EXTRA_ERROR, error);
        sendBroadcast(intent);
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
