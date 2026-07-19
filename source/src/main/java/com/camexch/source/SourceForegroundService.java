package com.camexch.source;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class SourceForegroundService extends Service {
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
    private WebRtcPublisher publisher;
    private ExoPlayer player;
    private String mode = "Idle";
    private String error = "";

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        try {
            server = new MjpegServer(() -> publisher, () -> mode);
            server.start();
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
        releaseVideoPipeline();
        if (server != null) {
            server.stop();
            server = null;
        }
        super.onDestroy();
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
        error = "";
        getSharedPreferences("source", MODE_PRIVATE).edit()
                .putString(EXTRA_MODE, mode)
                .putString(EXTRA_URI, uriText)
                .apply();

        if ("Photo".equals(mode)) {
            if (player != null) {
                player.stop();
            }
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
        if (!ensureVideoPipeline()) {
            return;
        }
        try {
            player.setMediaItem(MediaItem.fromUri(Uri.parse(uriText)));
            player.prepare();
            player.play();
            reportStatus(mode + " starting");
        } catch (Throwable throwable) {
            reportError(mode, throwable);
        }
    }

    private boolean ensureVideoPipeline() {
        if (publisher != null && player != null) {
            return true;
        }
        releaseVideoPipeline();
        try {
            publisher = new WebRtcPublisher(this);
            player = new ExoPlayer.Builder(this).build();
            player.setVideoSurface(publisher.getVideoSurface());
            player.setRepeatMode(Player.REPEAT_MODE_ONE);
            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY) {
                        reportStatus(mode + " active");
                    }
                }

                @Override
                public void onPlayerError(PlaybackException playbackError) {
                    reportError(mode, playbackError);
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
    }

    private void stopSource() {
        mode = "Idle";
        error = "";
        getSharedPreferences("source", MODE_PRIVATE).edit().clear().apply();
        if (player != null) {
            player.stop();
        }
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
                "Virtual camera source",
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
                .setContentTitle(error.isEmpty() ? "Virtual camera source" : "Virtual camera source error")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setOngoing(true)
                .build();
    }
}
