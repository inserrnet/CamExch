# CamExch Native Browser Prototype

This directory is the isolated replacement path for the legacy Android WebView
camera hook. It builds a pinned Chromium Android APK and enables Chromium's own
native fake `VideoCaptureDevice` for the first architecture gate.

The prototype deliberately does not connect Cam Player yet. Its purpose is to
prove that camera discovery, `getUserMedia()`, constraints, repeated open/close,
and `MediaRecorder` work through Chromium's native capture pipeline without a
page-level JavaScript camera substitution or a receiver `RTCPeerConnection`.

## Build Requirements

The workflow is manual and uses a self-hosted GitHub runner labelled:

```text
self-hosted, linux, x64, chromium
```

The runner should have at least 16 CPU cores, 64 GB RAM, and 200 GB of free
disk. Its tool cache is reused for `depot_tools` and the Chromium checkout.
Nothing from the Chromium checkout is committed to this repository.

## Pinned Source

`VERSION` is the only allowed Chromium revision. The overlay refuses to patch a
different upstream source shape instead of silently modifying the wrong code.

The first overlay changes Chromium's existing native fake-capture feature from
disabled-by-default to enabled-by-default. Chromium's `MediaStreamManager` then
constructs the upstream `FakeVideoCaptureDeviceFactory` in the browser process.
This is a temporary test generator, not the final Cam Player transport.

## Acceptance Gate

1. Install the generated APK beside the legacy CamExch applications.
2. Serve `tests/native_camera_test.html` over HTTPS or open an equivalent camera
   test page.
3. Grant camera permission.
4. Verify a moving native test pattern, non-zero geometry, stable device label,
   and a non-empty ten-second MediaRecorder result.
5. Repeat open/close at least five times and run for five minutes.
6. Test the same APK on webcamtests.com and nextlevelockers.com.

Only after this gate passes should the native fake generator be replaced with a
Cam Player/RTSP receiver.
