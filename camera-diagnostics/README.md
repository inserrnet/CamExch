# CamExch Camera Diagnostics

LSPosed diagnostic module for observing how one selected Android app uses the device cameras.

The module is intentionally pass-through only:

- it does not replace camera frames;
- it does not change camera IDs or capabilities;
- it does not modify capture requests;
- it only logs Camera1, Camera2, ImageReader, and SurfaceTexture calls.

## Build

From the repository root:

```powershell
gradle :camera-diagnostics:assembleDebug
```

If Gradle cannot find Java, install a JDK or set `JAVA_HOME` before running Gradle.

## Install

```powershell
adb install -r camera-diagnostics\build\outputs\apk\debug\camera-diagnostics-debug.apk
```

Then open LSPosed Manager:

1. Enable `CamExch Camera Diagnostics`.
2. Scope only the app being tested.
3. Force stop and reopen that app.

## Logs

```powershell
adb logcat -s CamExchCameraDiag Xposed
```

Useful lines:

- `Camera1.open` / `Camera2.openCamera` shows which camera API and camera ID were opened.
- `Camera2.getCameraCharacteristics` shows facing direction, hardware level, FPS ranges, and sensor size.
- `ImageReader.newInstance` shows requested still/capture buffer sizes.
- `SurfaceTexture.setDefaultBufferSize` shows preview buffer size.
- `Camera2.createCaptureRequest` and `Camera2.createCaptureSession` show session lifecycle.

For the first test pass, keep the rear camera physical and use this module only to confirm when the target app switches from document capture to front camera capture.
