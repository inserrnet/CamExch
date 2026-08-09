# Chromium Media Pipeline Notes

This document records the browser-engine behavior that CamExch timing changes
must account for. Read it together with `REGRESSION_GUARDRAILS.md` before
changing Cam Player frame scheduling, Browser receiver buffering, or WebRTC
telemetry.

Last reviewed: 2026-08-10

Relevant deployed engines at the time of review:

- Cam Player 0.5.7: Electron 39.2.7 / Chromium 142.0.7444.235.
- Browser 0.6.18: Android System WebView 150.0.7871.181.

The specifications and Chromium main branch can change. Recheck the linked
sources when either runtime changes or before replacing timing logic.

## Authoritative Sources

- W3C Media Capture from DOM Elements:
  https://www.w3.org/TR/mediacapture-fromelement/
- WHATWG/WICG video frame callback interface as implemented by Chromium:
  https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/video_rvfc/
- W3C WebRTC:
  https://www.w3.org/TR/webrtc/
- W3C WebRTC Statistics:
  https://www.w3.org/TR/webrtc-stats/
- Chromium canvas capture handler:
  https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/mediacapturefromelement/canvas_capture_handler.cc
- Chromium RTCRtpReceiver interface:
  https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/peerconnection/rtc_rtp_receiver.idl
- Chromium WebRTC stats interface:
  https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/peerconnection/rtc_stats_report.idl
- Chromium WebRTC video stats notes:
  https://chromium.googlesource.com/external/webrtc/+/master/video/g3doc/stats.md

## Decoded Video Clock

`HTMLVideoElement.requestVideoFrameCallback()` is the Cam Player master clock
while a video is playing. Its metadata exposes values needed for diagnostics:

- `mediaTime`: position on the source media timeline.
- `presentedFrames`: cumulative frames submitted for composition by the media
  element; jumps can reveal frames missed before Cam Player composition.
- `presentationTime` and `expectedDisplayTime`: callback and intended display
  timing.
- `processingDuration`: decode processing information when Chromium exposes it.

Use `mediaTime`, not callback wall time, to decide which source frames survive a
Maximum FPS reduction. Accept a backward `mediaTime` only for a known seek,
media reload, or loop transition. Log unexpected duplicates or regressions.

## Canvas Capture Clock

`canvas.captureStream(0)` disables the periodic canvas capture timer and makes
`CanvasCaptureMediaStreamTrack.requestFrame()` the explicit request mechanism.
A requested frame is captured when new canvas content is painted. Drawing and
then calling `requestFrame()` is the intended usage.

Important limitation: `requestFrame()` accepts no timestamp. Chromium's canvas
capture handler assigns each output `VideoFrame` a timestamp derived from the
canvas capture wall clock (`this_frame_ticks - first_frame_ticks`). The original
MP4 `mediaTime` is therefore not carried through the canvas track.

Consequences for Cam Player:

- Submit exactly once for each accepted fresh decoded frame while playing.
- Do not add an independent playing-video timer to make the output look like a
  requested FPS; that creates new wall-clock frames containing old pixels.
- Do not submit a paused heartbeat frame after playback startup begins.
- Do not use an immediate redraw of the pause frame as a substitute for an
  unavailable encoder keyframe request.
- Pause/photo heartbeat redraws intentionally create new monotonically timed
  frames with unchanged pixels. Keep that scheduler isolated from playback.
- Chromium can also send a refresh copy of its last canvas frame. Its current
  implementation defers refresh while asynchronous reads are pending to avoid
  non-increasing timestamps, but the pixels may still be a repeated frame.

## Receiver Buffering

`RTCRtpReceiver.playoutDelayHint` and `jitterBufferTarget` are application
preferences, not harmless telemetry controls:

- Chromium maps `playoutDelayHint` to a minimum jitter-buffer delay.
- `jitterBufferTarget` requests a target amount of buffered media in
  milliseconds.
- The WebRTC specification says target changes are applied gradually. For
  video, adjustment may render the same frame more than once or drop frames.
- Setting both values forces two related controls instead of allowing the
  receiver's default adaptive behavior.

Default CamExch rule: leave both values `null` unless a measured A/B test for a
specific runtime proves that an override improves the complete pipeline. An
experiment must log requested target, actual target delay, minimum delay,
actual buffer delay, discarded packets, decode cadence, and display cadence.

Do not infer current jitter from a lifetime average. For an interval, calculate:

```text
actualBufferMs = 1000 * delta(jitterBufferDelay)
                 / delta(jitterBufferEmittedCount)
targetBufferMs = 1000 * delta(jitterBufferTargetDelay)
                 / delta(jitterBufferEmittedCount)
minimumBufferMs = 1000 * delta(jitterBufferMinimumDelay)
                  / delta(jitterBufferEmittedCount)
```

## WebRTC Statistics

Most WebRTC counters are cumulative. Compare deltas from the same inbound RTP
object over the same time interval. Never combine paused heartbeat and playing
video into one value and label it playback FPS.

Useful receiver values include:

- `framesReceived`, `framesDecoded`, `framesDropped`, `framesPerSecond`.
- `totalDecodeTime`, `totalProcessingDelay`, and `lastPacketReceivedTimestamp`.
- `packetsLost`, `packetsDiscarded`, `nackCount`, `pliCount`, and `firCount`.
- `jitterBufferDelay`, `jitterBufferTargetDelay`,
  `jitterBufferMinimumDelay`, and `jitterBufferEmittedCount`.
- `totalInterFrameDelay`, `totalSquaredInterFrameDelay`, `freezeCount`, and
  `totalFreezesDuration`.
- `decoderImplementation` and `powerEfficientDecoder` when exposed.

W3C defines `framesRendered`, but Chromium main currently marks that member as
not implemented in `rtc_stats_report.idl`. Telemetry must feature-detect it.
When it is absent, label cadence based on `framesDecoded` as decode cadence, not
screen presentation cadence. Chromium's own stats rate calculator currently
uses `framesDecoded` as the denominator for `totalInterFrameDelay`; preserve the
runtime distinction in logs instead of assuming every engine follows the final
spec field set.

`jitterBufferDelay / jitterBufferEmittedCount` is average buffer residence time,
not RTP packet jitter. Do not log it as `jitterMs`.

## Required Transition Behavior

For `Pause -> Play`:

1. Enter a playback-starting state.
2. Stop the paused/static heartbeat before calling `video.play()`.
3. If `video.play()` fails, restore paused state and heartbeat.
4. Wait for the first fresh `requestVideoFrameCallback` result.
5. Upload, compose, and request one canvas frame for that decoded frame.
6. Continue with one canvas submission per accepted decoded frame.

For `Play -> Pause`:

1. Stop/cancel the playing callback ownership.
2. Pause the media element.
3. Render the final visible frame once.
4. Start one isolated static heartbeat.

Every transition must log its generation, source `mediaTime`,
`presentedFrames`, and the owner of the next canvas submission.

## Current Diagnostic Interpretation

The 2026-08-09 Browser 0.6.18 / Player 0.5.7 test does not prove that playing
video decoded at only 10-17 FPS. Its five-second Browser samples mixed a 10 FPS
paused heartbeat with short 24 FPS playback intervals.

Confirmed observations from that test:

- One peer and one encoder were active.
- H.264 encode time was about 6-7 ms at 1080x1080.
- No RTP packet loss, NACK, PLI, FIR, or decoded-frame drops were reported.
- The selected route was USB before user playback began; an early provisional
  Wi-Fi pair appeared during ICE convergence.
- Browser forced both receiver delay controls to 80 ms.
- The page emitted WebGL binding errors while Browser memory increased, so GPU
  contention after decode remains a separate possibility.
- Player playback intervals were shorter than the five-second cadence report
  threshold, so Player discarded the useful per-state measurements on pause.

## Pre-Change Checklist

Before the next cadence fix:

1. Preserve decoded-frame callback ownership and media-time FPS filtering.
2. Remove overlap between static heartbeat and playback startup.
3. Never synthesize a stale canvas frame to imitate a keyframe request.
4. Restore receiver delay properties to `null` by default.
5. Emit a Player cadence summary on every state transition, including short
   intervals.
6. Correct Browser buffer metric names and use interval deltas.
7. Feature-detect stats fields and label decode versus presentation metrics.
8. Keep page-facing diagnostics passive; do not install a per-frame JavaScript
   loop into the site's media element merely for logging.
9. Run the full cadence and route release matrix in
   `REGRESSION_GUARDRAILS.md` before publishing artifacts.
