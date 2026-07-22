package com.camexch.browser;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.LinearLayout;

final class FloatingCameraControls {
    interface Listener {
        void onModeSelected(CameraRouteMode mode);
    }

    private static final String PREFS = "camera_route_overlay";
    private static final String PREF_X = "x";
    private static final String PREF_Y = "y";

    private final Context context;
    private final Listener listener;
    private final WindowManager windowManager;
    private final SharedPreferences preferences;
    private LinearLayout root;
    private WindowManager.LayoutParams layoutParams;
    private Button autoButton;
    private Button sourceButton;
    private Button rearButton;
    private CameraRouteMode selectedMode = CameraRouteMode.AUTO;

    FloatingCameraControls(Context context, Listener listener) {
        this.context = context;
        this.listener = listener;
        windowManager = context.getSystemService(WindowManager.class);
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void show() {
        if (root != null || !Settings.canDrawOverlays(context)) {
            return;
        }

        root = new LinearLayout(context);
        root.setOrientation(LinearLayout.HORIZONTAL);
        root.setGravity(Gravity.CENTER_VERTICAL);
        root.setPadding(dp(4), dp(4), dp(4), dp(4));
        GradientDrawable background = new GradientDrawable();
        background.setColor(0xe61e2329);
        background.setCornerRadius(dp(8));
        root.setBackground(background);
        root.setElevation(dp(8));

        ImageButton moveButton = new ImageButton(context);
        moveButton.setImageResource(android.R.drawable.ic_menu_sort_by_size);
        moveButton.setColorFilter(Color.WHITE);
        moveButton.setBackgroundColor(Color.TRANSPARENT);
        moveButton.setContentDescription("Move camera controls");
        moveButton.setTooltipText("Move camera controls");
        moveButton.setLayoutParams(new LinearLayout.LayoutParams(dp(34), dp(40)));
        moveButton.setOnTouchListener(new DragTouchListener());

        autoButton = createModeButton("A", "Automatic camera routing", CameraRouteMode.AUTO);
        sourceButton = createModeButton("F", "Front Camera 4", CameraRouteMode.SOURCE);
        rearButton = createModeButton("R", "Phone rear camera", CameraRouteMode.REAR);
        root.addView(moveButton);
        root.addView(autoButton);
        root.addView(sourceButton);
        root.addView(rearButton);

        layoutParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
        );
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        layoutParams.x = preferences.getInt(PREF_X, dp(16));
        layoutParams.y = preferences.getInt(PREF_Y, dp(240));

        try {
            windowManager.addView(root, layoutParams);
            root.post(this::clampToScreen);
            updateButtons();
            AppLog.info(context, "Camera routing overlay shown");
        } catch (Throwable throwable) {
            AppLog.error(context, "Unable to show camera routing overlay", throwable);
            clearViews();
        }
    }

    void hide() {
        if (root == null) {
            return;
        }
        try {
            windowManager.removeView(root);
        } catch (Throwable throwable) {
            AppLog.error(context, "Unable to remove camera routing overlay", throwable);
        }
        clearViews();
    }

    void setMode(CameraRouteMode mode) {
        selectedMode = mode;
        updateButtons();
    }

    void onConfigurationChanged() {
        if (root != null) {
            root.post(this::clampToScreen);
        }
    }

    private Button createModeButton(String text, String description, CameraRouteMode mode) {
        Button button = new Button(context);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(0, 0, 0, 0);
        button.setContentDescription(description);
        button.setTooltipText(description);
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(38), dp(40)));
        button.setOnClickListener(view -> listener.onModeSelected(mode));
        return button;
    }

    private void updateButtons() {
        updateButton(autoButton, selectedMode == CameraRouteMode.AUTO);
        updateButton(sourceButton, selectedMode == CameraRouteMode.SOURCE);
        updateButton(rearButton, selectedMode == CameraRouteMode.REAR);
    }

    private void updateButton(Button button, boolean selected) {
        if (button == null) {
            return;
        }
        GradientDrawable background = new GradientDrawable();
        background.setColor(selected ? 0xff1976d2 : Color.TRANSPARENT);
        background.setCornerRadius(dp(4));
        button.setBackground(background);
        button.setAlpha(selected ? 1f : 0.72f);
    }

    private void clampToScreen() {
        if (root == null || layoutParams == null) {
            return;
        }
        OverlayPosition position = OverlayPosition.clamp(
                layoutParams.x,
                layoutParams.y,
                context.getResources().getDisplayMetrics().widthPixels,
                context.getResources().getDisplayMetrics().heightPixels,
                root.getWidth(),
                root.getHeight()
        );
        layoutParams.x = position.x;
        layoutParams.y = position.y;
        windowManager.updateViewLayout(root, layoutParams);
    }

    private int dp(int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    private void clearViews() {
        root = null;
        layoutParams = null;
        autoButton = null;
        sourceButton = null;
        rearButton = null;
    }

    private final class DragTouchListener implements View.OnTouchListener {
        private int initialX;
        private int initialY;
        private float initialTouchX;
        private float initialTouchY;

        @Override
        public boolean onTouch(View view, MotionEvent event) {
            if (root == null || layoutParams == null) {
                return false;
            }
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    initialX = layoutParams.x;
                    initialY = layoutParams.y;
                    initialTouchX = event.getRawX();
                    initialTouchY = event.getRawY();
                    return true;
                case MotionEvent.ACTION_MOVE:
                    OverlayPosition position = OverlayPosition.clamp(
                            initialX + Math.round(event.getRawX() - initialTouchX),
                            initialY + Math.round(event.getRawY() - initialTouchY),
                            context.getResources().getDisplayMetrics().widthPixels,
                            context.getResources().getDisplayMetrics().heightPixels,
                            root.getWidth(),
                            root.getHeight()
                    );
                    layoutParams.x = position.x;
                    layoutParams.y = position.y;
                    windowManager.updateViewLayout(root, layoutParams);
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    preferences.edit()
                            .putInt(PREF_X, layoutParams.x)
                            .putInt(PREF_Y, layoutParams.y)
                            .apply();
                    return true;
                default:
                    return false;
            }
        }
    }
}
