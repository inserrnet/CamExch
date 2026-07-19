package com.camexch.source;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.TextureView;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.media3.common.MediaItem;
import androidx.media3.exoplayer.ExoPlayer;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class SourceActivity extends Activity {
    private static final int PICK_FILE = 42;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable captureLoop = new Runnable() {
        @Override
        public void run() {
            captureCurrentFrame();
            handler.postDelayed(this, 100);
        }
    };

    private Spinner modeSpinner;
    private EditText rtspInput;
    private TextView selectedFileLabel;
    private TextureView textureView;
    private ExoPlayer player;
    private Uri selectedUri;
    private String mode = "RTSP";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestNotificationPermission();
        buildUi();
        startSourceService();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(captureLoop);
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && resultCode == RESULT_OK && data != null && data.getData() != null) {
            selectedUri = data.getData();
            try {
                getContentResolver().takePersistableUriPermission(
                        selectedUri,
                        data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                );
            } catch (SecurityException ignored) {
            }
            selectedFileLabel.setText(selectedUri.toString());
            if ("Photo".equals(mode)) {
                loadPhoto(selectedUri);
            } else {
                play(selectedUri);
            }
        }
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(18, 18, 18, 18);
        root.setBackgroundColor(0xfff7f8fa);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        modeSpinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, new String[]{"RTSP", "Video", "Photo"});
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        modeSpinner.setAdapter(adapter);
        row.addView(modeSpinner, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        Button pickButton = new Button(this);
        pickButton.setText("Pick file");
        row.addView(pickButton);
        root.addView(row);

        rtspInput = new EditText(this);
        rtspInput.setSingleLine(true);
        rtspInput.setHint("rtsp://192.168.4.132/live");
        rtspInput.setText("rtsp://192.168.4.132/live");
        root.addView(rtspInput, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        selectedFileLabel = new TextView(this);
        selectedFileLabel.setText("No file selected");
        selectedFileLabel.setTextColor(0xff455a64);
        root.addView(selectedFileLabel);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        Button startButton = new Button(this);
        startButton.setText("Start");
        Button stopButton = new Button(this);
        stopButton.setText("Stop");
        buttons.addView(startButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        buttons.addView(stopButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        root.addView(buttons);

        TextView endpoint = new TextView(this);
        endpoint.setText("Browser source: http://127.0.0.1:8765/stream.mjpeg");
        endpoint.setTextColor(0xff263238);
        endpoint.setPadding(0, 8, 0, 8);
        root.addView(endpoint);

        textureView = new TextureView(this);
        textureView.setBackgroundColor(0xff202124);
        root.addView(textureView, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));

        setContentView(root);

        modeSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                mode = (String) parent.getItemAtPosition(position);
                rtspInput.setVisibility("RTSP".equals(mode) ? View.VISIBLE : View.GONE);
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });

        pickButton.setOnClickListener(view -> pickFile());
        startButton.setOnClickListener(view -> startSelectedSource());
        stopButton.setOnClickListener(view -> stopPlayback());
    }

    private void pickFile() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("Photo".equals(mode) ? "image/*" : "video/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, PICK_FILE);
    }

    private void startSelectedSource() {
        startSourceService();
        if ("RTSP".equals(mode)) {
            play(Uri.parse(rtspInput.getText().toString().trim()));
        } else if ("Photo".equals(mode) && selectedUri != null) {
            loadPhoto(selectedUri);
        } else if (selectedUri != null) {
            play(selectedUri);
        }
    }

    private void play(Uri uri) {
        if (player == null) {
            player = new ExoPlayer.Builder(this).build();
            player.setVideoTextureView(textureView);
        }
        player.setMediaItem(MediaItem.fromUri(uri));
        player.setRepeatMode(ExoPlayer.REPEAT_MODE_ONE);
        player.prepare();
        player.play();
        handler.removeCallbacks(captureLoop);
        handler.post(captureLoop);
    }

    private void loadPhoto(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while (in != null && (read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            FrameStore.setJpeg(out.toByteArray());
        } catch (Exception ignored) {
        }
    }

    private void stopPlayback() {
        handler.removeCallbacks(captureLoop);
        if (player != null) {
            player.stop();
        }
    }

    private void captureCurrentFrame() {
        Bitmap bitmap = textureView.getBitmap(640, 480);
        if (bitmap != null) {
            FrameStore.setBitmap(bitmap);
            bitmap.recycle();
        }
    }

    private void startSourceService() {
        Intent intent = new Intent(this, SourceForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 12);
        }
    }
}
