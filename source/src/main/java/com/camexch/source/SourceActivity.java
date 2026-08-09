package com.camexch.source;

import android.annotation.SuppressLint;
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
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
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

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class SourceActivity extends Activity {
    private static final int PICK_FILE = 42;
    private static final int REQUEST_OVERLAY = 43;
    private static final int REQUEST_CAMERA = 44;
    private static final String UI_PREFERENCES = "source_ui";
    private static final String PREF_RTSP_URI = "rtsp_uri";
    private static final String DEFAULT_RTSP_URI = "rtsp://192.168.4.132:554/live";
    private static final String CAM_PLAYER_PREFERENCES = "cam_player";
    private static final String PREF_CAM_PLAYER_ADDRESS = "address";
    private static final String PREF_CAM_PLAYER_ROUTE = "preferred_route";
    private static final String DEFAULT_CAM_PLAYER_ADDRESS = "192.168.4.1:8791";

    private EditText rtspInput;
    private EditText camPlayerInput;
    private Button connectButton;
    private TextView camPlayerDiscoveryLabel;
    private TextView selectedFileLabel;
    private TextView statusLabel;
    private Uri selectedUri;
    private String mode = "RTSP";
    private boolean receiverRegistered;
    private boolean diagnosticsOnly;
    private boolean startVideoAfterOverlayPermission;
    private boolean startCamPlayerAfterCameraPermission;
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private CamPlayerDiscovery camPlayerDiscovery;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private boolean activityStarted;
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
    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    protected void onStart() {
        super.onStart();
        activityStarted = true;
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
        registerNetworkDiscovery();
        startCamPlayerDiscovery();
    }

    @Override
    protected void onStop() {
        activityStarted = false;
        if (camPlayerDiscovery != null) {
            camPlayerDiscovery.stop();
        }
        if (connectivityManager != null && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (IllegalArgumentException ignored) {
            }
            networkCallback = null;
        }
        if (receiverRegistered) {
            unregisterReceiver(statusReceiver);
            receiverRegistered = false;
        }
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        networkExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (startVideoAfterOverlayPermission && Settings.canDrawOverlays(this)) {
            startVideoAfterOverlayPermission = false;
            startSelectedSource();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && resultCode == RESULT_OK && data != null && data.getData() != null) {
            selectedUri = data.getData();
            try {
                if ((data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) {
                    getContentResolver().takePersistableUriPermission(
                            selectedUri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                    );
                }
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
                new String[]{"RTSP", "Video", "Photo", "Cam Player"}
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
        rtspInput.setHint(DEFAULT_RTSP_URI);
        rtspInput.setText(getSharedPreferences(UI_PREFERENCES, MODE_PRIVATE)
                .getString(PREF_RTSP_URI, DEFAULT_RTSP_URI));
        root.addView(rtspInput, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        LinearLayout camPlayerAddressRow = new LinearLayout(this);
        camPlayerAddressRow.setOrientation(LinearLayout.HORIZONTAL);
        camPlayerInput = new EditText(this);
        camPlayerInput.setSingleLine(true);
        camPlayerInput.setHint(DEFAULT_CAM_PLAYER_ADDRESS);
        camPlayerInput.setText(getSharedPreferences(CAM_PLAYER_PREFERENCES, MODE_PRIVATE)
                .getString(PREF_CAM_PLAYER_ADDRESS, DEFAULT_CAM_PLAYER_ADDRESS));
        camPlayerAddressRow.addView(camPlayerInput,
                new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                ));
        root.addView(camPlayerAddressRow);

        LinearLayout camPlayerConnectRow = new LinearLayout(this);
        camPlayerConnectRow.setGravity(Gravity.END);
        connectButton = new Button(this);
        connectButton.setText("Connect");
        camPlayerConnectRow.addView(connectButton);
        root.addView(camPlayerConnectRow);

        camPlayerDiscoveryLabel = new TextView(this);
        camPlayerDiscoveryLabel.setText("Cam Player is not connected");
        camPlayerDiscoveryLabel.setTextColor(0xff455a64);
        root.addView(camPlayerDiscoveryLabel);

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
                boolean camPlayerMode = "Cam Player".equals(mode);
                camPlayerAddressRow.setVisibility(camPlayerMode ? View.VISIBLE : View.GONE);
                camPlayerConnectRow.setVisibility(camPlayerMode ? View.VISIBLE : View.GONE);
                camPlayerDiscoveryLabel.setVisibility(camPlayerMode ? View.VISIBLE : View.GONE);
                pickButton.setEnabled("Video".equals(mode) || "Photo".equals(mode));
                pickButton.setVisibility(camPlayerMode || "RTSP".equals(mode) ? View.GONE : View.VISIBLE);
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });

        pickButton.setOnClickListener(view -> pickFile());
        connectButton.setOnClickListener(view -> connectCamPlayer());
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
            getSharedPreferences(UI_PREFERENCES, MODE_PRIVATE).edit()
                    .putString(PREF_RTSP_URI, uriText)
                    .apply();
        } else if ("Cam Player".equals(mode)) {
            uriText = camPlayerInput.getText().toString().trim();
            if (uriText.isEmpty()) {
                showError("Enter the Cam Player address");
                return;
            }
            getSharedPreferences(CAM_PLAYER_PREFERENCES, MODE_PRIVATE).edit()
                    .putString(PREF_CAM_PLAYER_ADDRESS, uriText)
                    .apply();
        } else {
            if (selectedUri == null) {
                showError("Choose a file first");
                return;
            }
            uriText = selectedUri.toString();
        }

        if ("Cam Player".equals(mode)
                && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            startCamPlayerAfterCameraPermission = true;
            AppLog.info(this, "Requesting camera permission for optional ARCore Live Motion");
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQUEST_CAMERA);
            return;
        }

        if ("Video".equals(mode) && !Settings.canDrawOverlays(this)) {
            startVideoAfterOverlayPermission = true;
            AppLog.info(this, "Requesting playback overlay permission");
            Intent permissionIntent = new Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName())
            );
            startActivityForResult(permissionIntent, REQUEST_OVERLAY);
            Toast.makeText(this, "Allow display over other apps, then return", Toast.LENGTH_LONG).show();
            return;
        }

        Intent intent = new Intent(this, SourceForegroundService.class);
        intent.setAction(SourceForegroundService.ACTION_START_SOURCE);
        intent.putExtra(SourceForegroundService.EXTRA_MODE, mode);
        intent.putExtra(SourceForegroundService.EXTRA_URI, uriText);
        AppLog.info(this, "Starting mode=" + mode + " uri=" + uriText);
        startServiceCompat(intent);
        statusLabel.setText(mode + " starting");
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_CAMERA || !startCamPlayerAfterCameraPermission) return;
        startCamPlayerAfterCameraPermission = false;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            AppLog.info(this, "Camera permission granted for optional ARCore Live Motion");
            startSelectedSource();
        } else {
            AppLog.info(this, "Camera permission denied; starting Cam Player without ARCore Live Motion");
            startSelectedSource();
        }
    }

    private void connectCamPlayer() {
        String address = camPlayerInput.getText().toString().trim();
        if (address.isEmpty()) {
            showError("Enter the Cam Player address");
            return;
        }
        connectButton.setEnabled(false);
        camPlayerDiscoveryLabel.setText("Connecting...");
        networkExecutor.execute(() -> {
            try {
                org.json.JSONObject status = new CamPlayerClient(address, "").status();
                getSharedPreferences(CAM_PLAYER_PREFERENCES, MODE_PRIVATE).edit()
                        .putString(PREF_CAM_PLAYER_ADDRESS, address)
                        .apply();
                AppLog.info(this, "Cam Player connected manually address=" + address
                        + " version=" + status.optString("version", "unknown"));
                runOnUiThread(() -> {
                    connectButton.setEnabled(true);
                    camPlayerDiscoveryLabel.setText("Cam Player connected");
                    Toast.makeText(this, "Cam Player connected", Toast.LENGTH_SHORT).show();
                });
            } catch (Throwable throwable) {
                AppLog.error(this, "Cam Player connection failed", throwable);
                runOnUiThread(() -> {
                    connectButton.setEnabled(true);
                    camPlayerDiscoveryLabel.setText("Connection failed");
                    showError(throwable.getMessage() == null
                            ? "Unable to connect Cam Player" : throwable.getMessage());
                });
            }
        });
    }

    private void startCamPlayerDiscovery() {
        if (diagnosticsOnly || camPlayerInput == null) return;
        camPlayerDiscoveryLabel.setText("Looking for Cam Player...");
        if (camPlayerDiscovery == null) {
            camPlayerDiscovery = new CamPlayerDiscovery(this, new CamPlayerDiscovery.Listener() {
                @Override
                public void onEndpoint(String name, String address) {
                    AppLog.info(SourceActivity.this,
                            "Cam Player discovered name=" + name + " address=" + address);
                    selectDiscoveredAddress(name, address);
                }

                @Override
                public void onError(String message) {
                    AppLog.info(SourceActivity.this, message);
                    runOnUiThread(() -> {
                        camPlayerDiscoveryLabel.setText(message);
                    });
                }
            });
        }
        camPlayerDiscovery.start();
    }

    private void registerNetworkDiscovery() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N || networkCallback != null) return;
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                runOnUiThread(() -> {
                    if (!activityStarted) return;
                    AppLog.info(SourceActivity.this, "Network available; refreshing Cam Player discovery");
                    startCamPlayerDiscovery();
                });
            }
        };
        connectivityManager.registerNetworkCallback(new NetworkRequest.Builder().build(), networkCallback);
    }

    private void selectDiscoveredAddress(String name, String address) {
        networkExecutor.execute(() -> {
            String selected = address;
            String route = "Wi-Fi";
            try {
                org.json.JSONObject status = new CamPlayerClient(address, "").status();
                org.json.JSONArray interfaces = status.optJSONArray("interfaces");
                if (interfaces != null) {
                    int playerPort = status.optInt("port", 8791);
                    String preferredRoute = getSharedPreferences(CAM_PLAYER_PREFERENCES, MODE_PRIVATE)
                            .getString(PREF_CAM_PLAYER_ROUTE, "USB");
                    for (int i = 0; i < interfaces.length(); i++) {
                        org.json.JSONObject item = interfaces.optJSONObject(i);
                        if (item != null && preferredRoute.equals(item.optString("route"))) {
                            String candidate = item.optString("address", "") + ":" + playerPort;
                            try {
                                new CamPlayerClient(candidate, "").status();
                                selected = candidate;
                                route = preferredRoute;
                                break;
                            } catch (Throwable unavailable) {
                                AppLog.info(this, "Preferred Cam Player route unavailable route="
                                        + preferredRoute + " address=" + candidate);
                            }
                        }
                    }
                }
            } catch (Throwable error) {
                AppLog.info(this, "Cam Player route inspection failed " + error);
            }
            final String endpoint = selected;
            final String selectedRoute = route;
            getSharedPreferences(CAM_PLAYER_PREFERENCES, MODE_PRIVATE).edit()
                    .putString(PREF_CAM_PLAYER_ADDRESS, endpoint)
                    .apply();
            runOnUiThread(() -> {
                camPlayerInput.setText(endpoint);
                camPlayerDiscoveryLabel.setText(name + " via " + selectedRoute + " at " + endpoint);
            });
        });
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
                .setNeutralButton("Clear log", (dialog, which) -> {
                    AppLog.clear(this);
                    Toast.makeText(this, "Log cleared", Toast.LENGTH_SHORT).show();
                })
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
