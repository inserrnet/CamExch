package com.camexch.source;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.WindowManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

final class CamPlayerMotionSender implements SensorEventListener {
    private static final long SEND_INTERVAL_MS = 33L;
    private static final long RECONNECT_DELAY_MS = 1_000L;

    private final Context context;
    private final CamPlayerClient client;
    private final SensorManager sensorManager;
    private final WindowManager windowManager;
    private final int cameraSensorOrientation;
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService controlExecutor = Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicLong sequence = new AtomicLong();
    private volatile Sample latestSensor;
    private volatile Sample latestArCore;
    private volatile boolean arCoreRequested;
    private volatile long sendIntervalMs = 500L;
    private volatile long nextArCoreStartMs;
    private volatile float[] gyro = new float[]{0f, 0f, 0f};
    private volatile float[] acceleration = new float[]{0f, 0f, 0f};
    private volatile HttpURLConnection activeConnection;
    private HandlerThread sensorThread;
    private ArCorePoseTracker arCoreTracker;

    CamPlayerMotionSender(Context context, CamPlayerClient client) {
        this.context = context.getApplicationContext();
        this.client = client;
        sensorManager = this.context.getSystemService(SensorManager.class);
        windowManager = this.context.getSystemService(WindowManager.class);
        cameraSensorOrientation = findRearCameraSensorOrientation();
    }

    boolean start() {
        if (!running.compareAndSet(false, true)) {
            return false;
        }
        if (sensorManager == null) {
            running.set(false);
            return false;
        }
        Sensor rotation = sensorManager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR);
        if (rotation == null) {
            rotation = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        }
        if (rotation == null) {
            running.set(false);
            AppLog.info(context, "Cam Player motion unavailable: rotation sensor missing");
            return false;
        }
        sensorThread = new HandlerThread("CamExchMotionSensors");
        sensorThread.start();
        Handler handler = new Handler(sensorThread.getLooper());
        sensorManager.registerListener(this, rotation, SensorManager.SENSOR_DELAY_GAME, handler);
        Sensor gyroSensor = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
        if (gyroSensor != null) {
            sensorManager.registerListener(this, gyroSensor, SensorManager.SENSOR_DELAY_GAME, handler);
        }
        Sensor accelerationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION);
        if (accelerationSensor != null) {
            sensorManager.registerListener(
                    this,
                    accelerationSensor,
                    SensorManager.SENSOR_DELAY_GAME,
                    handler
            );
        }
        networkExecutor.execute(this::streamLoop);
        controlExecutor.scheduleWithFixedDelay(this::refreshMotionConfig,
                0L, 500L, TimeUnit.MILLISECONDS);
        AppLog.info(context, "Cam Player motion sensors started rotation=" + rotation.getName()
                + " gyro=" + (gyroSensor != null)
                + " linearAcceleration=" + (accelerationSensor != null));
        return true;
    }

    void stop() {
        if (!running.getAndSet(false)) {
            return;
        }
        sensorManager.unregisterListener(this);
        if (sensorThread != null) {
            sensorThread.quitSafely();
            sensorThread = null;
        }
        networkExecutor.shutdownNow();
        controlExecutor.shutdownNow();
        stopArCore();
        HttpURLConnection connection = activeConnection;
        activeConnection = null;
        if (connection != null) {
            connection.disconnect();
        }
        AppLog.info(context, "Cam Player motion sensors stopped");
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (!running.get()) {
            return;
        }
        if (event.sensor.getType() == Sensor.TYPE_GYROSCOPE) {
            gyro = copyVector(event.values);
            return;
        }
        if (event.sensor.getType() == Sensor.TYPE_LINEAR_ACCELERATION) {
            acceleration = copyVector(event.values);
            return;
        }
        if (event.sensor.getType() != Sensor.TYPE_GAME_ROTATION_VECTOR
                && event.sensor.getType() != Sensor.TYPE_ROTATION_VECTOR) {
            return;
        }
        float[] quaternion = new float[4];
        SensorManager.getQuaternionFromVector(quaternion, event.values);
        latestSensor = Sample.sensor(
                sequence.incrementAndGet(),
                event.timestamp,
                quaternion,
                gyro,
                acceleration,
                displayRotation()
        );
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }

    private void streamLoop() {
        long sentSequence = -1L;
        long sentCount = 0L;
        long metricsStartedMs = android.os.SystemClock.elapsedRealtime();
        while (running.get() && !Thread.currentThread().isInterrupted()) {
            HttpURLConnection connection = null;
            try {
                connection = client.openMotionStream();
                activeConnection = connection;
                try (OutputStream output = connection.getOutputStream()) {
                    while (running.get() && !Thread.currentThread().isInterrupted()) {
                        Sample sample = arCoreRequested ? latestArCore : latestSensor;
                        if (sample != null && sample.sequence != sentSequence) {
                            byte[] payload = (sample.toJson().toString() + "\n")
                                    .getBytes(StandardCharsets.UTF_8);
                            output.write(payload);
                            output.flush();
                            sentSequence = sample.sequence;
                            sentCount++;
                        }
                        long nowMs = android.os.SystemClock.elapsedRealtime();
                        if (nowMs - metricsStartedMs >= 10_000L) {
                            float hz = sentCount * 1_000f / Math.max(1L, nowMs - metricsStartedMs);
                            AppLog.info(context, "Cam Player motion stream rateHz="
                                    + String.format(java.util.Locale.US, "%.1f", hz));
                            sentCount = 0L;
                            metricsStartedMs = nowMs;
                        }
                        Thread.sleep(sendIntervalMs);
                    }
                }
            } catch (Throwable error) {
                if (running.get()) {
                    AppLog.info(context, "Cam Player motion stream reconnecting reason="
                            + error.getClass().getSimpleName() + ": " + error.getMessage());
                    sleepQuietly(RECONNECT_DELAY_MS);
                }
            } finally {
                activeConnection = null;
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }
    }

    private void refreshMotionConfig() {
        if (!running.get()) return;
        try {
            JSONObject config = client.motionConfig();
            boolean requested = config.optBoolean("liveMotion", false);
            long requestedInterval = config.optLong("sampleIntervalMs",
                    config.optBoolean("streamMotion", false) ? SEND_INTERVAL_MS : 500L);
            sendIntervalMs = Math.max(SEND_INTERVAL_MS, Math.min(1_000L, requestedInterval));
            if (requested != arCoreRequested) {
                arCoreRequested = requested;
                latestArCore = null;
                AppLog.info(context, "Cam Player ARCore requested=" + requested);
            }
            if (requested) {
                startArCoreIfNeeded();
            } else {
                stopArCore();
            }
        } catch (Throwable error) {
            if (running.get()) {
                AppLog.info(context, "Cam Player motion config unavailable "
                        + error.getClass().getSimpleName() + ": " + error.getMessage());
            }
        }
    }

    private synchronized void startArCoreIfNeeded() {
        if (arCoreTracker != null || !running.get()
                || android.os.SystemClock.elapsedRealtime() < nextArCoreStartMs) {
            return;
        }
        ArCorePoseTracker tracker = new ArCorePoseTracker(context, new ArCorePoseTracker.Listener() {
            @Override
            public void onPose(long timestampNs, float[] position, float[] quaternion) {
                if (!running.get() || !arCoreRequested) return;
                latestArCore = Sample.arCore(
                        sequence.incrementAndGet(), timestampNs, position, quaternion,
                        displayRotation(), sensorToDisplayRotation());
            }

            @Override
            public void onError(Throwable error) {
                synchronized (CamPlayerMotionSender.this) {
                    arCoreTracker = null;
                    latestArCore = null;
                    nextArCoreStartMs = android.os.SystemClock.elapsedRealtime() + 5_000L;
                }
            }
        });
        arCoreTracker = tracker;
        tracker.start();
    }

    private synchronized void stopArCore() {
        ArCorePoseTracker tracker = arCoreTracker;
        arCoreTracker = null;
        latestArCore = null;
        if (tracker != null) tracker.stop();
    }

    private int displayRotation() {
        try {
            return windowManager == null ? 0 : windowManager.getDefaultDisplay().getRotation();
        } catch (Throwable ignored) {
            return 0;
        }
    }

    private int sensorToDisplayRotation() {
        int displayDegrees = displayRotation() * 90;
        return ((cameraSensorOrientation - displayDegrees + 360) % 360) / 90;
    }

    private int findRearCameraSensorOrientation() {
        try {
            CameraManager manager = context.getSystemService(CameraManager.class);
            if (manager == null) return 0;
            for (String cameraId : manager.getCameraIdList()) {
                CameraCharacteristics characteristics = manager.getCameraCharacteristics(cameraId);
                Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    Integer orientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION);
                    int value = orientation == null ? 0 : orientation;
                    AppLog.info(context, "ARCore rear camera sensorOrientation=" + value);
                    return value;
                }
            }
        } catch (Throwable error) {
            AppLog.info(context, "Unable to read rear camera orientation "
                    + error.getClass().getSimpleName() + ": " + error.getMessage());
        }
        return 0;
    }

    private static float[] copyVector(float[] values) {
        return new float[]{values[0], values[1], values[2]};
    }

    private static JSONArray array(float[] values) throws org.json.JSONException {
        JSONArray result = new JSONArray();
        for (float value : values) {
            result.put(value);
        }
        return result;
    }

    private static void sleepQuietly(long milliseconds) {
        try {
            Thread.sleep(milliseconds);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    private static final class Sample {
        final long sequence;
        final long timestampNs;
        final float[] quaternion;
        final float[] gyro;
        final float[] acceleration;
        final float[] position;
        final int displayRotation;
        final String trackingSource;
        final int sensorToDisplayRotation;

        private Sample(long sequence, long timestampNs, float[] quaternion, float[] gyro,
                       float[] acceleration, float[] position, int displayRotation,
                       String trackingSource, int sensorToDisplayRotation) {
            this.sequence = sequence;
            this.timestampNs = timestampNs;
            this.quaternion = quaternion.clone();
            this.gyro = gyro.clone();
            this.acceleration = acceleration.clone();
            this.position = position == null ? null : position.clone();
            this.displayRotation = displayRotation;
            this.trackingSource = trackingSource;
            this.sensorToDisplayRotation = sensorToDisplayRotation;
        }

        static Sample sensor(long sequence, long timestampNs, float[] quaternion, float[] gyro,
                             float[] acceleration, int displayRotation) {
            return new Sample(sequence, timestampNs, quaternion, gyro, acceleration,
                    null, displayRotation, "sensors", 0);
        }

        static Sample arCore(long sequence, long timestampNs, float[] position,
                             float[] quaternion, int displayRotation,
                             int sensorToDisplayRotation) {
            return new Sample(sequence, timestampNs, quaternion, new float[]{0f, 0f, 0f},
                    new float[]{0f, 0f, 0f}, position, displayRotation, "arcore",
                    sensorToDisplayRotation);
        }

        JSONObject toJson() throws Exception {
            JSONObject value = new JSONObject();
            value.put("sequence", sequence);
            value.put("timestampNs", timestampNs);
            value.put("quaternion", array(quaternion));
            value.put("gyro", array(gyro));
            value.put("acceleration", array(acceleration));
            value.put("displayRotation", displayRotation);
            value.put("trackingSource", trackingSource);
            value.put("sensorToDisplayRotation", sensorToDisplayRotation);
            if (position != null) value.put("position", array(position));
            return value;
        }
    }
}
