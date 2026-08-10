package com.camexch.source;

import android.content.Context;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLSurface;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.os.Handler;
import android.os.HandlerThread;

import com.google.ar.core.Camera;
import com.google.ar.core.Config;
import com.google.ar.core.Frame;
import com.google.ar.core.Pose;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import com.google.ar.core.TrackingFailureReason;

import java.util.concurrent.atomic.AtomicBoolean;

/** Headless ARCore session used only while Cam Player requests live 6DoF motion. */
final class ArCorePoseTracker {
    interface Listener {
        void onPose(long timestampNs, float[] position, float[] quaternion);
        void onError(Throwable error);
    }

    private final Context context;
    private final Listener listener;
    private final AtomicBoolean running = new AtomicBoolean();
    private HandlerThread thread;
    private Handler handler;
    private Session session;
    private EGLDisplay eglDisplay = EGL14.EGL_NO_DISPLAY;
    private EGLContext eglContext = EGL14.EGL_NO_CONTEXT;
    private EGLSurface eglSurface = EGL14.EGL_NO_SURFACE;
    private int cameraTexture;
    private TrackingState lastTrackingState;
    private TrackingFailureReason lastTrackingFailureReason;
    private long pausedSinceMs;

    ArCorePoseTracker(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
    }

    boolean start() {
        if (!running.compareAndSet(false, true)) {
            return false;
        }
        thread = new HandlerThread("CamExchArCore");
        thread.start();
        handler = new Handler(thread.getLooper());
        handler.post(this::initialize);
        return true;
    }

    void stop() {
        if (!running.getAndSet(false)) {
            return;
        }
        Handler activeHandler = handler;
        HandlerThread activeThread = thread;
        if (activeHandler != null) {
            activeHandler.post(() -> {
                release();
                if (activeThread != null) activeThread.quitSafely();
            });
        }
        handler = null;
        thread = null;
    }

    private void initialize() {
        try {
            createGlContext();
            session = new Session(context);
            Config config = new Config(session);
            config.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);
            config.setFocusMode(Config.FocusMode.AUTO);
            config.setPlaneFindingMode(Config.PlaneFindingMode.DISABLED);
            config.setLightEstimationMode(Config.LightEstimationMode.DISABLED);
            if (session.isDepthModeSupported(Config.DepthMode.DISABLED)) {
                config.setDepthMode(Config.DepthMode.DISABLED);
            }
            session.configure(config);
            session.setCameraTextureName(cameraTexture);
            session.resume();
            AppLog.info(context, "ARCore live motion session started");
            update();
        } catch (Throwable error) {
            fail(error);
        }
    }

    private void update() {
        if (!running.get() || session == null) {
            release();
            return;
        }
        try {
            Frame frame = session.update();
            Camera camera = frame.getCamera();
            TrackingState state = camera.getTrackingState();
            TrackingFailureReason failureReason = camera.getTrackingFailureReason();
            if (state != lastTrackingState || failureReason != lastTrackingFailureReason) {
                lastTrackingState = state;
                lastTrackingFailureReason = failureReason;
                AppLog.info(context, "ARCore tracking state=" + state
                        + " reason=" + failureReason);
            }
            if (state == TrackingState.TRACKING) {
                pausedSinceMs = 0L;
                Pose pose = camera.getPose();
                float[] xyzw = pose.getRotationQuaternion();
                listener.onPose(
                        frame.getTimestamp(),
                        pose.getTranslation(),
                        new float[]{xyzw[3], xyzw[0], xyzw[1], xyzw[2]}
                );
            } else {
                long nowMs = android.os.SystemClock.elapsedRealtime();
                if (pausedSinceMs == 0L) pausedSinceMs = nowMs;
                boolean restartable = failureReason == TrackingFailureReason.NONE
                        || failureReason == TrackingFailureReason.BAD_STATE
                        || failureReason == TrackingFailureReason.CAMERA_UNAVAILABLE;
                if (restartable && nowMs - pausedSinceMs >= 10_000L) {
                    throw new IllegalStateException("ARCore tracking remained paused reason="
                            + failureReason);
                }
            }
            Handler activeHandler = handler;
            if (activeHandler != null) activeHandler.postDelayed(this::update, 16L);
        } catch (Throwable error) {
            fail(error);
        }
    }

    private void fail(Throwable error) {
        if (running.getAndSet(false)) {
            AppLog.info(context, "ARCore live motion failed "
                    + error.getClass().getSimpleName() + ": " + error.getMessage());
            listener.onError(error);
        }
        release();
        HandlerThread activeThread = thread;
        if (activeThread != null) activeThread.quitSafely();
        handler = null;
        thread = null;
    }

    private void createGlContext() {
        eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
        int[] version = new int[2];
        if (!EGL14.eglInitialize(eglDisplay, version, 0, version, 1)) {
            throw new IllegalStateException("Unable to initialize EGL");
        }
        int[] attributes = {
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
                EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
                EGL14.EGL_RED_SIZE, 8,
                EGL14.EGL_GREEN_SIZE, 8,
                EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_NONE
        };
        EGLConfig[] configs = new EGLConfig[1];
        int[] count = new int[1];
        if (!EGL14.eglChooseConfig(eglDisplay, attributes, 0, configs, 0, 1, count, 0)
                || count[0] < 1) {
            throw new IllegalStateException("Unable to choose EGL config");
        }
        eglContext = EGL14.eglCreateContext(
                eglDisplay,
                configs[0],
                EGL14.EGL_NO_CONTEXT,
                new int[]{EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE},
                0
        );
        eglSurface = EGL14.eglCreatePbufferSurface(
                eglDisplay,
                configs[0],
                new int[]{EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE},
                0
        );
        if (!EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext)) {
            throw new IllegalStateException("Unable to make ARCore EGL context current");
        }
        int[] textures = new int[1];
        GLES20.glGenTextures(1, textures, 0);
        cameraTexture = textures[0];
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, cameraTexture);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
                GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
                GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
                GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
                GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
    }

    private void release() {
        Session activeSession = session;
        session = null;
        if (activeSession != null) {
            try { activeSession.pause(); } catch (Throwable ignored) { }
            try { activeSession.close(); } catch (Throwable ignored) { }
        }
        if (eglDisplay != EGL14.EGL_NO_DISPLAY) {
            if (cameraTexture != 0) {
                GLES20.glDeleteTextures(1, new int[]{cameraTexture}, 0);
                cameraTexture = 0;
            }
            EGL14.eglMakeCurrent(eglDisplay, EGL14.EGL_NO_SURFACE,
                    EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
            if (eglSurface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(eglDisplay, eglSurface);
            if (eglContext != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(eglDisplay, eglContext);
            EGL14.eglTerminate(eglDisplay);
        }
        eglDisplay = EGL14.EGL_NO_DISPLAY;
        eglSurface = EGL14.EGL_NO_SURFACE;
        eglContext = EGL14.EGL_NO_CONTEXT;
        lastTrackingState = null;
        lastTrackingFailureReason = null;
        pausedSinceMs = 0L;
    }
}
