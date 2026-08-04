package com.camexch.source;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
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
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

final class CamPlayerMotionSender implements SensorEventListener {
    private static final long SEND_INTERVAL_MS = 33L;
    private static final long RECONNECT_DELAY_MS = 1_000L;

    private final Context context;
    private final CamPlayerClient client;
    private final SensorManager sensorManager;
    private final WindowManager windowManager;
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicLong sequence = new AtomicLong();
    private volatile Sample latest;
    private volatile float[] gyro = new float[]{0f, 0f, 0f};
    private volatile float[] acceleration = new float[]{0f, 0f, 0f};
    private volatile HttpURLConnection activeConnection;
    private HandlerThread sensorThread;

    CamPlayerMotionSender(Context context, CamPlayerClient client) {
        this.context = context.getApplicationContext();
        this.client = client;
        sensorManager = this.context.getSystemService(SensorManager.class);
        windowManager = this.context.getSystemService(WindowManager.class);
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
        latest = new Sample(
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
                        Sample sample = latest;
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
                        Thread.sleep(SEND_INTERVAL_MS);
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

    private int displayRotation() {
        try {
            return windowManager == null ? 0 : windowManager.getDefaultDisplay().getRotation();
        } catch (Throwable ignored) {
            return 0;
        }
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
        final int displayRotation;

        Sample(long sequence, long timestampNs, float[] quaternion, float[] gyro,
               float[] acceleration, int displayRotation) {
            this.sequence = sequence;
            this.timestampNs = timestampNs;
            this.quaternion = quaternion.clone();
            this.gyro = gyro.clone();
            this.acceleration = acceleration.clone();
            this.displayRotation = displayRotation;
        }

        JSONObject toJson() throws Exception {
            JSONObject value = new JSONObject();
            value.put("sequence", sequence);
            value.put("timestampNs", timestampNs);
            value.put("quaternion", array(quaternion));
            value.put("gyro", array(gyro));
            value.put("acceleration", array(acceleration));
            value.put("displayRotation", displayRotation);
            return value;
        }
    }
}
