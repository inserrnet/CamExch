package com.camexch.source;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class SourceActivity extends Activity {
    private static final int PICK_FILE = 42;

    private EditText rtspInput;
    private TextView selectedFileLabel;
    private TextView statusLabel;
    private Uri selectedUri;
    private String mode = "RTSP";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestNotificationPermission();
        buildUi();
        ensureSourceService();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && resultCode == RESULT_OK && data != null && data.getData() != null) {
            selectedUri = data.getData();
            try {
                getContentResolver().takePersistableUriPermission(
                        selectedUri,
                        data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION
                );
            } catch (SecurityException ignored) {
            }
            selectedFileLabel.setText(selectedUri.toString());
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

        Spinner modeSpinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(
                this,
                android.R.layout.simple_spinner_item,
                new String[]{"RTSP", "Video", "Photo"}
        );
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
        root.addView(rtspInput, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));

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

        statusLabel = new TextView(this);
        statusLabel.setText("Idle");
        statusLabel.setTextSize(18);
        statusLabel.setTextColor(0xff263238);
        statusLabel.setGravity(Gravity.CENTER);
        root.addView(statusLabel, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1
        ));

        TextView endpoint = new TextView(this);
        endpoint.setText("Browser transport: local WebRTC");
        endpoint.setTextColor(0xff263238);
        endpoint.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(endpoint);

        setContentView(root);

        modeSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                mode = (String) parent.getItemAtPosition(position);
                rtspInput.setVisibility("RTSP".equals(mode) ? View.VISIBLE : View.GONE);
                pickButton.setEnabled(!"RTSP".equals(mode));
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });

        pickButton.setOnClickListener(view -> pickFile());
        startButton.setOnClickListener(view -> startSelectedSource());
        stopButton.setOnClickListener(view -> stopSource());
    }

    private void pickFile() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("Photo".equals(mode) ? "image/*" : "video/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, PICK_FILE);
    }

    private void startSelectedSource() {
        String uriText;
        if ("RTSP".equals(mode)) {
            uriText = rtspInput.getText().toString().trim();
            if (uriText.isEmpty()) {
                showError("Enter an RTSP address");
                return;
            }
        } else {
            if (selectedUri == null) {
                showError("Choose a file first");
                return;
            }
            uriText = selectedUri.toString();
            if ("Photo".equals(mode) && !loadPhoto(selectedUri)) {
                showError("Unable to read the selected image");
                return;
            }
        }

        Intent intent = new Intent(this, SourceForegroundService.class);
        intent.setAction(SourceForegroundService.ACTION_START_SOURCE);
        intent.putExtra(SourceForegroundService.EXTRA_MODE, mode);
        intent.putExtra(SourceForegroundService.EXTRA_URI, uriText);
        startServiceCompat(intent);
        statusLabel.setText(mode + " active\nYou can switch to CamExch Browser");
    }

    private boolean loadPhoto(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri);
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
        } catch (Exception ignored) {
            return false;
        }
    }

    private void stopSource() {
        Intent intent = new Intent(this, SourceForegroundService.class);
        intent.setAction(SourceForegroundService.ACTION_STOP_SOURCE);
        startServiceCompat(intent);
        statusLabel.setText("Idle");
    }

    private void ensureSourceService() {
        startServiceCompat(new Intent(this, SourceForegroundService.class));
    }

    private void startServiceCompat(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
    }

    private void showError(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 12);
        }
    }
}
