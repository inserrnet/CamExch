package com.camexch.source;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;

import java.io.ByteArrayOutputStream;

final class FrameStore {
    private static final Object LOCK = new Object();
    private static byte[] latestJpeg = placeholder();

    private FrameStore() {
    }

    static void setBitmap(Bitmap bitmap) {
        if (bitmap == null || bitmap.isRecycled()) {
            return;
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.JPEG, 82, out);
        synchronized (LOCK) {
            latestJpeg = out.toByteArray();
        }
    }

    static void setJpeg(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            return;
        }
        Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (decoded == null) {
            return;
        }
        setBitmap(decoded);
        decoded.recycle();
    }

    static byte[] getJpeg() {
        synchronized (LOCK) {
            return latestJpeg.clone();
        }
    }

    private static byte[] placeholder() {
        Bitmap bitmap = Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888);
        bitmap.eraseColor(Color.rgb(32, 32, 36));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.JPEG, 80, out);
        bitmap.recycle();
        return out.toByteArray();
    }
}
