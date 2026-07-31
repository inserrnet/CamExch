package com.camexch.browser;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Debug;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.JavascriptInterface;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public class BrowserActivity extends Activity {
    private static final String HOME_URL = "https://webcamtests.com/";
    private final List<Tab> tabs = new ArrayList<>();
    private FrameLayout webContainer;
    private LinearLayout tabStrip;
    private EditText addressBar;
    private Button backButton;
    private Button forwardButton;
    private int activeTab = -1;
    private boolean diagnosticsOnly;
    private final NativeCameraAuthorizationStore nativeCameraAuthorizations = new NativeCameraAuthorizationStore();
    private CameraRoutePreferences cameraRoutePreferences;
    private FloatingCameraControls floatingCameraControls;
    private final ExecutorService bridgeExecutor = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<String, String> bridgeResults = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Future<?>> bridgeRequests = new ConcurrentHashMap<>();
    private final Set<String> bridgePending = ConcurrentHashMap.newKeySet();
    private final SourceBridge sourceBridge = new SourceBridge();
    private final Handler diagnosticsHandler = new Handler(Looper.getMainLooper());
    private final Runnable diagnosticsTask = new Runnable() {
        @Override
        public void run() {
            logProcessDiagnostics();
            diagnosticsHandler.postDelayed(this, 30_000L);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AppLog.info(this, "BrowserActivity.onCreate");
        if (AppLog.hasCrash(this)) {
            diagnosticsOnly = true;
            showCrashScreen();
            return;
        }
        requestCameraPermissions();
        WebView.setWebContentsDebuggingEnabled(true);
        buildUi();
        addTab(HOME_URL);
        try {
            android.content.pm.PackageInfo webViewPackage = WebView.getCurrentWebViewPackage();
            AppLog.info(this, "WebView package=" + (webViewPackage == null
                    ? "unknown"
                    : webViewPackage.packageName + " version=" + webViewPackage.versionName));
        } catch (RuntimeException error) {
            AppLog.info(this, "WebView package diagnostics failed " + error);
        }
        diagnosticsHandler.post(diagnosticsTask);
        cameraRoutePreferences = new CameraRoutePreferences(this);
        floatingCameraControls = new FloatingCameraControls(this, this::selectCameraRouteMode);
        floatingCameraControls.setMode(cameraRoutePreferences.getMode());
        if (Settings.canDrawOverlays(this)) {
            floatingCameraControls.show();
        } else {
            requestCameraOverlayPermission();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!diagnosticsOnly && floatingCameraControls != null && Settings.canDrawOverlays(this)) {
            floatingCameraControls.show();
        }
    }

    @Override
    protected void onDestroy() {
        diagnosticsHandler.removeCallbacks(diagnosticsTask);
        if (floatingCameraControls != null) {
            floatingCameraControls.hide();
        }
        if (isFinishing() && !isChangingConfigurations()) {
            AppLog.clear(this);
        }
        bridgeExecutor.shutdownNow();
        bridgeResults.clear();
        bridgeRequests.clear();
        bridgePending.clear();
        super.onDestroy();
    }

    private void logProcessDiagnostics() {
        Debug.MemoryInfo memory = new Debug.MemoryInfo();
        Debug.getMemoryInfo(memory);
        Runtime runtime = Runtime.getRuntime();
        long javaUsedMb = (runtime.totalMemory() - runtime.freeMemory()) / (1024L * 1024L);
        AppLog.info(this, "Browser memory pssMb=" + memory.getTotalPss() / 1024
                + " privateDirtyMb=" + memory.getTotalPrivateDirty() / 1024
                + " javaUsedMb=" + javaUsedMb
                + " nativeHeapMb=" + Debug.getNativeHeapAllocatedSize() / (1024L * 1024L)
                + " tabs=" + tabs.size()
                + " activeTab=" + activeTab);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        AppLog.info(this, "Browser configuration changed orientation=" + newConfig.orientation);
        if (floatingCameraControls != null) {
            floatingCameraControls.onConfigurationChanged();
        }
        String orientation = orientationName(newConfig);
        String script = "window.__camexchDeviceOrientationChanged&&"
                + "window.__camexchDeviceOrientationChanged('" + orientation + "',true)";
        WebView activeWebView = currentWebView();
        if (activeWebView != null) {
            activeWebView.evaluateJavascript(script, result -> AppLog.info(
                    BrowserActivity.this,
                    "Cam Player active-tab orientation update=" + orientation + " result=" + result
            ));
        }
    }

    @Override
    public void onBackPressed() {
        WebView webView = currentWebView();
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else if (tabs.size() > 1) {
            closeActiveTab();
        } else {
            super.onBackPressed();
        }
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xffffffff);

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setPadding(6, 6, 6, 4);

        backButton = smallButton("<");
        forwardButton = smallButton(">");
        Button reloadButton = smallButton("R");
        Button indicatorButton = smallButton("!");

        addressBar = new EditText(this);
        addressBar.setSingleLine(true);
        addressBar.setSelectAllOnFocus(true);
        addressBar.setImeOptions(EditorInfo.IME_ACTION_GO);
        addressBar.setTextSize(14);

        toolbar.addView(backButton);
        toolbar.addView(forwardButton);
        toolbar.addView(reloadButton);
        toolbar.addView(addressBar, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        toolbar.addView(indicatorButton);
        root.addView(toolbar);

        HorizontalScrollView scroller = new HorizontalScrollView(this);
        scroller.setHorizontalScrollBarEnabled(false);
        tabStrip = new LinearLayout(this);
        tabStrip.setOrientation(LinearLayout.HORIZONTAL);
        Button newTab = smallButton("+");
        newTab.setOnClickListener(view -> addTab(HOME_URL));
        tabStrip.addView(newTab);
        scroller.addView(tabStrip);
        root.addView(scroller, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        webContainer = new FrameLayout(this);
        root.addView(webContainer, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);

        backButton.setOnClickListener(view -> {
            WebView webView = currentWebView();
            if (webView != null && webView.canGoBack()) {
                webView.goBack();
            }
        });
        forwardButton.setOnClickListener(view -> {
            WebView webView = currentWebView();
            if (webView != null && webView.canGoForward()) {
                webView.goForward();
            }
        });
        reloadButton.setOnClickListener(view -> {
            WebView webView = currentWebView();
            if (webView != null) {
                webView.reload();
            }
        });
        indicatorButton.setOnClickListener(view -> Toast.makeText(this, "Front Camera 4 source active", Toast.LENGTH_SHORT).show());
        indicatorButton.setOnLongClickListener(view -> {
            showLogDialog();
            return true;
        });
        addressBar.setOnEditorActionListener((TextView v, int actionId, KeyEvent event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                loadAddress();
                return true;
            }
            return false;
        });
    }

    private Button smallButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(12, 0, 12, 0);
        return button;
    }

    private void requestCameraOverlayPermission() {
        AppLog.info(this, "Requesting camera routing overlay permission");
        Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getPackageName())
        );
        startActivity(intent);
    }

    private void selectCameraRouteMode(CameraRouteMode mode) {
        cameraRoutePreferences.setMode(mode);
        floatingCameraControls.setMode(mode);
        AppLog.info(this, "Camera route overlay selected mode=" + mode);
        WebView webView = currentWebView();
        if (webView != null) {
            String script = "(function(){if(!window.__camexchSwitchCamera)return 'unavailable';"
                    + "Promise.resolve(window.__camexchSwitchCamera('" + mode.name() + "'))"
                    + ".catch(function(e){console.error('Camera route switch rejected',e);});"
                    + "return 'dispatched';})()";
            webView.evaluateJavascript(script, result -> AppLog.info(
                    this, "Camera route switch result=" + result));
        }
        String message;
        if (mode == CameraRouteMode.SOURCE) {
            message = "Front Camera 4";
        } else if (mode == CameraRouteMode.REAR) {
            message = "Phone rear camera";
        } else if (mode == CameraRouteMode.NATIVE) {
            message = "Native WebView camera";
        } else {
            message = "Automatic camera routing";
        }
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void addTab(String url) {
        WebView webView = createWebView();
        Tab tab = new Tab(webView, "New");
        tabs.add(tab);
        webContainer.addView(webView, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        switchToTab(tabs.size() - 1);
        webView.loadUrl(url);
        rebuildTabs();
    }

    private WebView createWebView() {
        WebView webView = new WebView(this);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        // Keep the WebView provider's UA and UA Client Hints coherent. A custom product
        // token causes some sites to classify this otherwise current engine as unsupported.
        settings.setUserAgentString(null);
        webView.addJavascriptInterface(new JsLogBridge(), "CamExchLog");
        webView.addJavascriptInterface(sourceBridge, "CamExchBridge");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(
                    webView,
                    VirtualCameraScript.SCRIPT,
                    Collections.singleton("*")
            );
        }
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                if (consoleMessage.messageLevel() == ConsoleMessage.MessageLevel.ERROR
                        || consoleMessage.messageLevel() == ConsoleMessage.MessageLevel.WARNING) {
                    AppLog.info(BrowserActivity.this, "Page console "
                            + consoleMessage.messageLevel()
                            + " line=" + consoleMessage.lineNumber()
                            + " source=" + LogSanitizer.sanitize(consoleMessage.sourceId())
                            + " message=" + LogSanitizer.sanitize(consoleMessage.message()));
                }
                return super.onConsoleMessage(consoleMessage);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                AppLog.info(BrowserActivity.this, "Permission request origin="
                        + LogSanitizer.sanitize(String.valueOf(request.getOrigin()))
                        + " resources=" + Arrays.toString(request.getResources()));
                runOnUiThread(() -> handlePermissionRequest(request));
            }

            @Override
            public void onReceivedTitle(WebView view, String title) {
                Tab tab = findTab(view);
                if (tab != null && title != null && !title.trim().isEmpty()) {
                    tab.title = title;
                    rebuildTabs();
                }
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                AppLog.info(BrowserActivity.this, "Page started: " + LogSanitizer.sanitize(url));
                addressBar.setText(url);
                updateNavButtons();
                injectVirtualCamera(view);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                AppLog.info(BrowserActivity.this, "Page finished: " + LogSanitizer.sanitize(url));
                addressBar.setText(url);
                updateNavButtons();
                injectVirtualCamera(view);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                return recoverFromRendererExit(view, detail);
            }
        });
        return webView;
    }

    private boolean recoverFromRendererExit(WebView failed, RenderProcessGoneDetail detail) {
        Tab tab = findTab(failed);
        AppLog.info(this, "WebView renderer exited crashed=" + detail.didCrash()
                + " priority=" + detail.rendererPriorityAtExit()
                + " page=" + failed.getUrl());
        if (tab == null) {
            failed.destroy();
            return true;
        }

        int index = tabs.indexOf(tab);
        String url = failed.getUrl();
        webContainer.removeView(failed);
        failed.destroy();

        WebView replacement = createWebView();
        tab.webView = replacement;
        webContainer.addView(replacement, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        replacement.setVisibility(index == activeTab ? View.VISIBLE : View.GONE);
        replacement.loadUrl(url == null || url.trim().isEmpty() ? HOME_URL : url);
        if (index == activeTab) {
            addressBar.setText(url);
            updateNavButtons();
            Toast.makeText(this, "Web page recovered", Toast.LENGTH_SHORT).show();
        }
        rebuildTabs();
        return true;
    }

    private void handlePermissionRequest(PermissionRequest request) {
        String[] requested = request.getResources();
        boolean requestsVideo = Arrays.asList(requested).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
        boolean requestsAudio = Arrays.asList(requested).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
        AppLog.info(this, "Microphone WebView permission requested=" + requestsAudio
                + " origin=" + request.getOrigin()
                + " cameraRoute=" + (cameraRoutePreferences == null
                ? CameraRouteMode.AUTO : cameraRoutePreferences.getMode()));
        if (!requestsVideo) {
            request.grant(requested);
            AppLog.info(this, "Microphone WebView permission decision=granted requested="
                    + requestsAudio + " video=false");
            return;
        }

        boolean rearAuthorized = nativeCameraAuthorizations.consume(
                request.getOrigin().toString(), SystemClock.elapsedRealtime());
        if (rearAuthorized) {
            AppLog.info(this, "Granted one-shot native rear camera request origin=" + request.getOrigin());
            request.grant(requested);
            AppLog.info(this, "Microphone WebView permission decision=granted requested="
                    + requestsAudio + " nativeVideo=true");
            return;
        }

        List<String> nonVideo = new ArrayList<>();
        for (String resource : requested) {
            if (!PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                nonVideo.add(resource);
            }
        }
        CameraRouteMode routeMode = cameraRoutePreferences == null
                ? CameraRouteMode.AUTO : cameraRoutePreferences.getMode();
        WebView webView = currentWebView();
        AppLog.info(this, "Denied unclassified native video request origin=" + request.getOrigin()
                + " routeMode=" + routeMode
                + " page=" + (webView == null ? "none" : webView.getUrl()));
        if (nonVideo.isEmpty()) {
            request.deny();
            AppLog.info(this, "Microphone WebView permission decision=none requested="
                    + requestsAudio + " nativeVideoDenied=true");
        } else {
            request.grant(nonVideo.toArray(new String[0]));
            AppLog.info(this, "Microphone WebView permission decision=granted requested="
                    + requestsAudio + " nativeVideoDenied=true resources=" + nonVideo);
        }
    }

    private void rebuildTabs() {
        if (tabStrip == null) {
            return;
        }
        View plus = tabStrip.getChildAt(0);
        tabStrip.removeAllViews();
        tabStrip.addView(plus);
        for (int i = 0; i < tabs.size(); i++) {
            int index = i;
            Button button = smallButton((i == activeTab ? "* " : "") + shortTitle(tabs.get(i).title));
            button.setOnClickListener(view -> switchToTab(index));
            button.setOnLongClickListener(view -> {
                if (tabs.size() > 1) {
                    closeTab(index);
                }
                return true;
            });
            tabStrip.addView(button);
        }
    }

    private String shortTitle(String title) {
        if (title == null || title.trim().isEmpty()) {
            return "Tab";
        }
        return title.length() > 16 ? title.substring(0, 16) : title;
    }

    private void switchToTab(int index) {
        activeTab = index;
        for (int i = 0; i < tabs.size(); i++) {
            tabs.get(i).webView.setVisibility(i == index ? View.VISIBLE : View.GONE);
        }
        WebView webView = currentWebView();
        if (webView != null) {
            addressBar.setText(webView.getUrl());
        }
        rebuildTabs();
        updateNavButtons();
    }

    private void closeActiveTab() {
        closeTab(activeTab);
    }

    private void closeTab(int index) {
        if (index < 0 || index >= tabs.size() || tabs.size() == 1) {
            return;
        }
        Tab removed = tabs.remove(index);
        webContainer.removeView(removed.webView);
        removed.webView.destroy();
        switchToTab(Math.max(0, Math.min(index, tabs.size() - 1)));
    }

    private void loadAddress() {
        String input = addressBar.getText().toString().trim();
        if (input.isEmpty()) {
            return;
        }
        String url = input.contains("://") ? input : "https://" + input;
        WebView webView = currentWebView();
        if (webView != null) {
            webView.loadUrl(url);
        }
    }

    private void updateNavButtons() {
        WebView webView = currentWebView();
        backButton.setEnabled(webView != null && webView.canGoBack());
        forwardButton.setEnabled(webView != null && webView.canGoForward());
    }

    private WebView currentWebView() {
        return activeTab >= 0 && activeTab < tabs.size() ? tabs.get(activeTab).webView : null;
    }

    private Tab findTab(WebView webView) {
        for (Tab tab : tabs) {
            if (tab.webView == webView) {
                return tab;
            }
        }
        return null;
    }

    private void injectVirtualCamera(WebView webView) {
        AppLog.info(this, "Installing Front Camera 4 hook; documentStart="
                + WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT));
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            webView.evaluateJavascript(VirtualCameraScript.SCRIPT, null);
        }
    }

    private void requestCameraPermissions() {
        if (Build.VERSION.SDK_INT >= 23 && (
                checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
                        || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)) {
            requestPermissions(new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO}, 22);
        }
    }

    private void showCrashScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(18, 18, 18, 18);

        TextView title = new TextView(this);
        title.setText("CamExch Browser crash log");
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
                .setTitle("CamExch Browser log")
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
        clipboard.setPrimaryClip(ClipData.newPlainText("CamExch Browser log", AppLog.read(this)));
        Toast.makeText(this, "Log copied", Toast.LENGTH_SHORT).show();
    }

    private final class JsLogBridge {
        @JavascriptInterface
        public void log(String message) {
            AppLog.info(BrowserActivity.this, "JS " + message);
        }
    }

    private final class SourceBridge {
        private static final String BRIDGE_URI = "content://com.camexch.source.bridge";

        @JavascriptInterface
        public String getCameraRouteMode() {
            if (cameraRoutePreferences == null) {
                return CameraRouteMode.AUTO.name();
            }
            return cameraRoutePreferences.getMode().name();
        }

        @JavascriptInterface
        public String authorizeNativeCamera(String origin, String route) {
            if (!"environment".equals(route) && !"native".equals(route)) {
                AppLog.info(BrowserActivity.this, "Rejected native camera authorization route=" + route);
                return "ERROR:Unsupported native camera route";
            }
            boolean authorized = nativeCameraAuthorizations.authorize(origin, SystemClock.elapsedRealtime());
            AppLog.info(BrowserActivity.this, "Native camera authorization origin=" + origin
                    + " route=" + route
                    + " accepted=" + authorized);
            return authorized ? "OK" : "ERROR:Invalid origin";
        }

        @JavascriptInterface
        public String getMode() {
            return callString("mode", null);
        }

        @JavascriptInterface
        public String getCamPlayerRouteAddress() {
            return callString("route", null);
        }

        @JavascriptInterface
        public String answerOffer(String offer) {
            AppLog.info(BrowserActivity.this, "IPC offer length=" + (offer == null ? 0 : offer.length()));
            return callString("offer", offer);
        }

        @JavascriptInterface
        public String answerOfferWithConfig(String offer, String config) {
            AppLog.info(BrowserActivity.this, "IPC offer length=" + (offer == null ? 0 : offer.length())
                    + " configLength=" + (config == null ? 0 : config.length()));
            Bundle extras = new Bundle();
            extras.putString("config", config == null ? "" : config);
            return callString("offer", offer, extras);
        }

        @JavascriptInterface
        public String beginAnswerOffer(String offer, String config) {
            final String requestId = UUID.randomUUID().toString();
            AppLog.info(BrowserActivity.this, "IPC async offer started requestId=" + requestId
                    + " offerLength=" + (offer == null ? 0 : offer.length())
                    + " configLength=" + (config == null ? 0 : config.length()));
            bridgePending.add(requestId);
            Future<?> request = bridgeExecutor.submit(() -> {
                Bundle extras = new Bundle();
                extras.putString("config", config == null ? "" : config);
                String result = callString("offer", offer, extras);
                if (bridgePending.contains(requestId)) {
                    bridgeResults.put(requestId, result);
                }
                AppLog.info(BrowserActivity.this, "IPC async offer completed requestId="
                        + requestId + " resultLength=" + result.length());
            });
            bridgeRequests.put(requestId, request);
            return requestId;
        }

        @JavascriptInterface
        public String pollAnswerOffer(String requestId) {
            if (requestId == null || requestId.isEmpty()) {
                return "ERROR:Invalid async offer request";
            }
            String result = bridgeResults.remove(requestId);
            if (result != null) {
                bridgePending.remove(requestId);
                bridgeRequests.remove(requestId);
                return result;
            }
            return bridgePending.contains(requestId)
                    ? "PENDING" : "ERROR:Unknown async offer request";
        }

        @JavascriptInterface
        public String cancelAnswerOffer(String requestId) {
            Future<?> request = bridgeRequests.remove(requestId);
            bridgeResults.remove(requestId);
            bridgePending.remove(requestId);
            if (request != null) {
                request.cancel(true);
            }
            AppLog.info(BrowserActivity.this, "IPC async offer canceled requestId=" + requestId);
            return "OK";
        }

        @JavascriptInterface
        public String closeCamPlayerSession(String sessionId, String reason) {
            try {
                JSONObject payload = new JSONObject();
                payload.put("sessionId", sessionId == null ? "" : sessionId);
                payload.put("reason", reason == null ? "" : reason);
                bridgeExecutor.execute(() -> callString("close", payload.toString()));
                return "QUEUED";
            } catch (Throwable throwable) {
                return "ERROR:" + throwable;
            }
        }

        @JavascriptInterface
        public String configureCamPlayer(String config) {
            return callString("configure", config);
        }

        @JavascriptInterface
        public String getDeviceOrientation() {
            return orientationName(getResources().getConfiguration());
        }

        @JavascriptInterface
        public String getPhotoDataUrl() {
            try {
                Bundle result = getContentResolver().call(Uri.parse(BRIDGE_URI), "photo", null, null);
                String error = result == null ? "No response from Source" : result.getString("error");
                if (error != null) {
                    return "ERROR:" + error;
                }
                byte[] jpeg = result.getByteArray("value");
                if (jpeg == null || jpeg.length == 0) {
                    return "ERROR:Source returned an empty photo";
                }
                AppLog.info(BrowserActivity.this, "IPC photo bytes=" + jpeg.length);
                return "data:image/jpeg;base64," + Base64.encodeToString(jpeg, Base64.NO_WRAP);
            } catch (Throwable throwable) {
                AppLog.info(BrowserActivity.this, "IPC photo failed: " + throwable);
                return "ERROR:" + throwable;
            }
        }

        private String callString(String method, String arg) {
            return callString(method, arg, null);
        }

        private String callString(String method, String arg, Bundle extras) {
            try {
                Bundle result = getContentResolver().call(Uri.parse(BRIDGE_URI), method, arg, extras);
                String error = result == null ? "No response from Source" : result.getString("error");
                if (error != null) {
                    AppLog.info(BrowserActivity.this, "IPC " + method + " error=" + error);
                    return "ERROR:" + error;
                }
                String value = result.getString("value", "");
                AppLog.info(BrowserActivity.this, "IPC " + method + " success length=" + value.length());
                return value;
            } catch (Throwable throwable) {
                AppLog.info(BrowserActivity.this, "IPC " + method + " failed: " + throwable);
                return "ERROR:" + throwable;
            }
        }
    }

    private static String orientationName(Configuration configuration) {
        return configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
                ? "landscape" : "portrait";
    }

    private static final class Tab {
        WebView webView;
        String title;

        Tab(WebView webView, String title) {
            this.webView = webView;
            this.title = title;
        }
    }
}
