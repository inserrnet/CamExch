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
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class SourceForegroundService extends Service {
    static final String ACTION_START_SOURCE = "com.camexch.source.START_SOURCE";
    static final String ACTION_STOP_SOURCE = "com.camexch.source.STOP_SOURCE";
    static final String EXTRA_MODE = "mode";
    static final String EXTRA_URI = "uri";

    private static final String CHANNEL_ID = "virtual_camera_source";
    private static final int NOTIFICATION_ID = 1001;

    private MjpegServer server;
    private WebRtcPublisher publisher;
    private ExoPlayer player;
    private String mode = "Idle";

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        try {
            publisher = new WebRtcPublisher(this);
            server = new MjpegServer(publisher, () -> mode);
            server.start();
            player = new ExoPlayer.Builder(this).build();
            player.setVideoSurface(publisher.getVideoSurface());
            player.setRepeatMode(Player.REPEAT_MODE_ONE);
            restoreSource();
        } catch (Exception exception) {
            stopSelf();
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
        if (player != null) {
            player.release();
            player = null;
        }
        if (server != null) {
            server.stop();
            server = null;
        }
        if (publisher != null) {
            publisher.release();
            publisher = null;
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
        getSharedPreferences("source", MODE_PRIVATE).edit()
                .putString(EXTRA_MODE, mode)
                .putString(EXTRA_URI, uriText)
                .apply();
        if ("Photo".equals(mode)) {
            if (player != null) {
                player.stop();
            }
            loadPhoto(uriText);
        } else if (player != null && uriText != null && !uriText.trim().isEmpty()) {
            player.setMediaItem(MediaItem.fromUri(Uri.parse(uriText)));
            player.prepare();
            player.play();
        }
        updateNotification();
    }

    private void stopSource() {
        mode = "Idle";
        getSharedPreferences("source", MODE_PRIVATE).edit().clear().apply();
        if (player != null) {
            player.stop();
        }
        updateNotification();
    }

    private void restoreSource() {
        String savedMode = getSharedPreferences("source", MODE_PRIVATE).getString(EXTRA_MODE, null);
        String savedUri = getSharedPreferences("source", MODE_PRIVATE).getString(EXTRA_URI, null);
        if (savedMode != null) {
            startSource(savedMode, savedUri);
        }
    }

    private void loadPhoto(String uriText) {
        if (uriText == null) {
            return;
        }
        try (InputStream in = getContentResolver().openInputStream(Uri.parse(uriText));
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) {
                return;
            }
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            FrameStore.setJpeg(out.toByteArray());
        } catch (Exception ignored) {
        }
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
        return builder
                .setContentTitle("Virtual camera source active")
                .setContentText(mode + " via local WebRTC")
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setOngoing(true)
                .build();
    }
}
