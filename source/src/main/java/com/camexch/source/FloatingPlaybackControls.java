package com.camexch.source;

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
import android.widget.ImageButton;
import android.widget.LinearLayout;

final class FloatingPlaybackControls {
    interface Listener {
        void onPlay();

        void onPause();
    }

    private static final String PREFS = "playback_overlay";
    private static final String PREF_X = "x";
    private static final String PREF_Y = "y";

    private final Context context;
    private final Listener listener;
    private final WindowManager windowManager;
    private final SharedPreferences preferences;
    private LinearLayout root;
    private WindowManager.LayoutParams layoutParams;
    private ImageButton playButton;
    private ImageButton pauseButton;

    FloatingPlaybackControls(Context context, Listener listener) {
        this.context = context;
        this.listener = listener;
        windowManager = context.getSystemService(WindowManager.class);
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void show() {
        if (root != null || !Settings.canDrawOverlays(context)) {
            if (!Settings.canDrawOverlays(context)) {
                AppLog.info(context, "Playback overlay permission is unavailable");
            }
            return;
        }

        root = new LinearLayout(context);
        root.setOrientation(LinearLayout.HORIZONTAL);
        root.setGravity(Gravity.CENTER_VERTICAL);
        int padding = dp(4);
        root.setPadding(padding, padding, padding, padding);
        GradientDrawable background = new GradientDrawable();
        background.setColor(0xe61e2329);
        background.setCornerRadius(dp(8));
        root.setBackground(background);
        root.setElevation(dp(8));

        ImageButton moveButton = createButton(
                android.R.drawable.ic_menu_sort_by_size,
                "Move playback controls",
                32
        );
        playButton = createButton(android.R.drawable.ic_media_play, "Play video", 40);
        pauseButton = createButton(android.R.drawable.ic_media_pause, "Pause video", 40);
        root.addView(moveButton);
        root.addView(playButton);
        root.addView(pauseButton);

        playButton.setOnClickListener(view -> listener.onPlay());
        pauseButton.setOnClickListener(view -> listener.onPause());
        moveButton.setOnTouchListener(new DragTouchListener());

        layoutParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
        );
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        layoutParams.x = preferences.getInt(PREF_X, dp(16));
        layoutParams.y = preferences.getInt(PREF_Y, dp(160));

        try {
            windowManager.addView(root, layoutParams);
            root.post(this::clampToScreen);
            AppLog.info(context, "Video playback overlay shown");
        } catch (Throwable throwable) {
            AppLog.error(context, "Unable to show video playback overlay", throwable);
            root = null;
            layoutParams = null;
            playButton = null;
            pauseButton = null;
        }
    }

    void hide() {
        if (root == null) {
            return;
        }
        try {
            windowManager.removeView(root);
        } catch (Throwable throwable) {
            AppLog.error(context, "Unable to remove video playback overlay", throwable);
        }
        root = null;
        layoutParams = null;
        playButton = null;
        pauseButton = null;
    }

    void setPlaying(boolean playing) {
        if (playButton == null || pauseButton == null) {
            return;
        }
        playButton.setEnabled(!playing);
        playButton.setAlpha(playing ? 0.4f : 1f);
        pauseButton.setEnabled(playing);
        pauseButton.setAlpha(playing ? 1f : 0.4f);
    }

    private ImageButton createButton(int icon, String description, int sizeDp) {
        ImageButton button = new ImageButton(context);
        button.setImageResource(icon);
        button.setColorFilter(Color.WHITE);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setContentDescription(description);
        button.setTooltipText(description);
        button.setPadding(dp(8), dp(8), dp(8), dp(8));
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(sizeDp), dp(40)));
        return button;
    }

    private int dp(int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
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
                    int requestedX = initialX + Math.round(event.getRawX() - initialTouchX);
                    int requestedY = initialY + Math.round(event.getRawY() - initialTouchY);
                    OverlayPosition position = OverlayPosition.clamp(
                            requestedX,
                            requestedY,
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
                    AppLog.info(context, "Playback overlay moved x=" + layoutParams.x
                            + " y=" + layoutParams.y);
                    return true;
                default:
                    return false;
            }
        }
    }
}
