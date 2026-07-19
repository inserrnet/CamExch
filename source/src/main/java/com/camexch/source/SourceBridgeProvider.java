package com.camexch.source;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;

public class SourceBridgeProvider extends ContentProvider {
    static final String AUTHORITY = "com.camexch.source.bridge";

    @Override
    public boolean onCreate() {
        AppLog.info(getContext(), "SourceBridgeProvider created");
        return true;
    }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        Bundle result = new Bundle();
        AppLog.info(getContext(), "Bridge call method=" + method + " argLength=" + (arg == null ? 0 : arg.length()));
        SourceForegroundService service = SourceForegroundService.getInstance();
        if (service == null) {
            result.putString("error", "Source service is not running");
            return result;
        }
        try {
            if ("mode".equals(method)) {
                result.putString("value", service.getBridgeMode());
            } else if ("offer".equals(method)) {
                result.putString("value", service.answerBridgeOffer(arg));
            } else if ("photo".equals(method)) {
                result.putByteArray("value", FrameStore.getJpeg());
            } else {
                result.putString("error", "Unknown bridge method: " + method);
            }
        } catch (Throwable throwable) {
            AppLog.error(getContext(), "Bridge method failed: " + method, throwable);
            String detail = throwable.getMessage();
            result.putString("error", detail == null ? throwable.getClass().getSimpleName() : detail);
        }
        return result;
    }

    @Override public String getType(Uri uri) { return null; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
}
