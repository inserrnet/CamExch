# CamExch

CamExch is an Android MVP made of two apps:

- **CamExch Source** chooses the `Front Camera 4` source: RTSP URL, video file, or photo file.
- **CamExch Browser** is a small WebView browser with tabs. It leaves the rear camera untouched and replaces front-camera `getUserMedia()` requests with the Source app frame stream.

The project is designed to build on GitHub Actions, so no Android Studio, Gradle, or Git installation is required on the local computer.

## Current MVP Flow

1. Install `source-debug.apk` and `browser-debug.apk` from the GitHub Actions artifact.
2. Open **CamExch Source**.
3. Select `RTSP`, `Video`, or `Photo`.
4. For RTSP, enter a local stream address such as:

   ```text
   rtsp://192.168.4.132/live
   ```

5. Tap `Start`.
6. Open **CamExch Browser**.
7. Visit a camera test site, for example:

   ```text
   https://webcamtests.com/
   ```

8. Choose `Front Camera 4`. The browser receives RTSP/video through a local WebRTC connection. Photos use the local MJPEG fallback.

The `!` button near the address bar shows `Front Camera 4 source active`. Long-press it to open the Browser log and copy it to the clipboard. Source has a `Logs` button with the same copy action. After a crash, either app opens its saved crash log before retrying normal startup.

Source starts its native WebRTC pipeline only for RTSP and video after `Start` is tapped. Photo mode does not load WebRTC. Native initialization and playback failures are reported in the Source screen instead of closing the app.

WebRTC frame ownership remains with `SurfaceTextureHelper`; the capture listener forwards frames without releasing them a second time.

## Architecture

```mermaid
flowchart LR
    A["RTSP / video"] --> B["Media3 in foreground service"]
    B --> C["WebRTC SurfaceTexture"]
    C --> D["Local WebRTC peer"]
    E["Photo"] --> F["MJPEG fallback"]
    D --> G["CamExch Browser getUserMedia hook"]
    F --> G
    G --> H["Website MediaStreamTrack"]
```

The browser installs its camera hook at document start, before site scripts can capture the original `getUserMedia()` function. RTSP and video frames remain on the hardware-accelerated Surface/WebRTC path and are not converted to JPEG. Playback belongs to the foreground service, so switching from Source to Browser does not destroy the decoder surface. The selected source is restored if Android restarts the service.

## Browser Features

- Address bar.
- Back and forward buttons.
- Reload button.
- Multiple tabs.
- Long-press a tab to close it.
- Automatic front-camera override for `video: true`, `facingMode: "user"`, an unconstrained default camera request, or `deviceId: "camexch-front-camera-4"`.
- A physical camera selected by `deviceId` is inspected through `MediaStreamTrack.getSettings()` and replaced automatically when it reports `facingMode: "user"`.
- Rear camera requests are passed through to the real Android camera.

## Build

The repository includes `.github/workflows/android.yml`.

Manual local build, if Gradle is available:

```bash
gradle assembleDebug
```

APK outputs:

```text
source/build/outputs/apk/debug/source-debug.apk
browser/build/outputs/apk/debug/browser-debug.apk
```

## Notes

This is a browser-controlled test camera source. Android does not expose a normal public API that lets an ordinary app register a system-wide camera device for Chrome, Brave, Firefox, or arbitrary native apps without root/system privileges.
