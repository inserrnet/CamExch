package com.camexch.source;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

public class SourceActivity extends Activity {
    private static final int PICK_FILE = 42;

    private EditText rtspInput;
    private TextView selectedFileLabel;
    private TextView statusLabel;
    private Uri selectedUri;
    private String mode = "RTSP";
    private boolean receiverRegistered;
    private boolean diagnosticsOnly;
    private final BroadcastReceiver statusReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String status = intent.getStringExtra(SourceForegroundService.EXTRA_STATUS);
            String error = intent.getStringExtra(SourceForegroundService.EXTRA_ERROR);
            if (status != null) {
                statusLabel.setText(status);
                AppLog.info(SourceActivity.this, "Service status: " + status);
            }
            if (error != null && !error.isEmpty()) {
                showError(error);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AppLog.info(this, "SourceActivity.onCreate");
        if (AppLog.hasCrash(this)) {
            diagnosticsOnly = true;
            showCrashScreen();
            return;
        }
        requestNotificationPermission();
        buildUi();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (diagnosticsOnly) {
            return;
        }
        IntentFilter filter = new IntentFilter(SourceForegroundService.ACTION_STATUS);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(statusReceiver, filter);
        }
        receiverRegistered = true;
    }

    @Override
    protected void onStop() {
        if (receiverRegistered) {
            unregisterReceiver(statusReceiver);
            receiverRegistered = false;
        }
        super.onStop();
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
        Button logButton = new Button(this);
        logButton.setText("Logs");
        buttons.addView(startButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        buttons.addView(stopButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        buttons.addView(logButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
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
        logButton.setOnClickListener(view -> showLogDialog());
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
        }

        Intent intent = new Intent(this, SourceForegroundService.class);
        intent.setAction(SourceForegroundService.ACTION_START_SOURCE);
        intent.putExtra(SourceForegroundService.EXTRA_MODE, mode);
        intent.putExtra(SourceForegroundService.EXTRA_URI, uriText);
        AppLog.info(this, "Starting mode=" + mode + " uri=" + uriText);
        startServiceCompat(intent);
        statusLabel.setText(mode + " starting");
    }

    private void stopSource() {
        Intent intent = new Intent(this, SourceForegroundService.class);
        intent.setAction(SourceForegroundService.ACTION_STOP_SOURCE);
        startServiceCompat(intent);
        AppLog.info(this, "Stop requested");
        statusLabel.setText("Idle");
    }

    private void startServiceCompat(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
    }

    private void showError(String message) {
        AppLog.info(this, "UI error: " + message);
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void showCrashScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(18, 18, 18, 18);

        TextView title = new TextView(this);
        title.setText("CamExch Source crash log");
        title.setTextSize(20);
        root.addView(title);

        TextView log = new TextView(this);
        log.setText(AppLog.read(this));
        log.setTextSize(12);
        log.setTextIsSelectable(true);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(log);
        root.addView(scroll, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));

        LinearLayout actions = new LinearLayout(this);
        Button copy = new Button(this);
        copy.setText("Copy log");
        Button retry = new Button(this);
        retry.setText("Clear and retry");
        actions.addView(copy, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        actions.addView(retry, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        root.addView(actions);
        setContentView(root);

        copy.setOnClickListener(view -> copyLog());
        retry.setOnClickListener(view -> {
            AppLog.clearCrash(this);
            recreate();
        });
    }

    private void showLogDialog() {
        new AlertDialog.Builder(this)
                .setTitle("CamExch Source log")
                .setMessage(AppLog.read(this))
                .setPositiveButton("Copy log", (dialog, which) -> copyLog())
                .setNegativeButton("Close", null)
                .show();
    }

    private void copyLog() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("CamExch Source log", AppLog.read(this)));
        Toast.makeText(this, "Log copied", Toast.LENGTH_SHORT).show();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 12);
        }
    }
}
