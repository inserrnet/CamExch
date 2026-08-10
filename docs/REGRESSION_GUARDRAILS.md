# CamExch Regression Guardrails

This document is a required pre-change and pre-release checklist for CamExch.
It records behavior that has already worked and must not regress while fixing a
different problem. Preserve the behavior, not necessarily the current
implementation.

## How To Use This Document

Before changing Browser, Source, or Cam Player:

1. For media timing, canvas capture, receiver buffering, or WebRTC telemetry,
   first read `CHROMIUM_MEDIA_PIPELINE_NOTES.md` and recheck its linked runtime
   sources when Chromium, Electron, or Android WebView has changed.
2. Identify every guardrail touched directly or indirectly by the change.
3. Read the full call path, including cleanup, fallback, pause, reconnect, and
   orientation handling.
4. Add or update a regression test before replacing working timing, routing, or
   ownership logic.
5. Run the relevant component tests and the release matrix below.
6. Compare logs and behavior with the last known-good build in `GOOD`.
7. Do not call a release complete when a required scenario was not tested. State
   the missing verification explicitly.

A unit test for a helper is not sufficient when two independently correct
schedulers, sessions, or routes can conflict in the complete pipeline.

## Protected Workspace Data

- Never delete, clean, move, or overwrite `GOOD` or its contents unless the user
  explicitly requests that exact operation.
- Do not remove untracked user files or historical binaries as part of ordinary
  implementation, formatting, building, or cleanup.
- Do not replace a known-good artifact until the new artifact has passed its
  required checks.

## Video Cadence Contract

These rules are release blockers.

- While a video is playing, `metadata.mediaTime` is the master clock for source
  frame selection and order; callback arrival time must not decide which source
  frames survive an FPS reduction.
- One deadline-based frame pacer is the sole generated-track submission owner in
  every state: playing, paused, photo, Motion, interaction, and bootstrap.
- `requestVideoFrameCallback()` may update only the latest source composition.
  Motion and UI interaction may update only the latest transform/composition.
  None of them may create, request, or write a transport frame directly.
- The pacer writes at most one timestamped `VideoFrame` per deadline to one
  `MediaStreamTrackGenerator`; missed deadlines are skipped, never replayed as
  catch-up bursts.
- The normal production path must not mix `canvas.captureStream()` or
  `requestFrame()` with generated-track writes. Canvas capture is allowed only
  as the single fallback transport when `MediaStreamTrackGenerator` is absent.
- Generator backpressure may retain at most one not-yet-written latest frame.
  Replacing it closes the old frame; stale frames are never replayed later.
- Source zoom, pan, mirror, rotation, and motion transform the latest selected
  frame without creating another submission clock.
- Maximum FPS is a ceiling, not a forced output rate. Reduction is based on
  source `mediaTime`, never callback wall time or an encoder-side timer.
- A source below the ceiling keeps its native cadence: `24 -> 24`, `30 -> 30`,
  and `60 -> 60`.
- A source above the ceiling is reduced evenly using media timestamps, for
  example `60 -> 30`; it must not use callback arrival time for frame selection.
- Cadence logs include decoded, rendered, generated, written, replaced, encoded,
  and sent frame rates plus timestamp spacing and write backpressure.
- Output timestamps come from the pacer's single monotonic timebase and remain
  strictly increasing across pause, play, seek, loop, media replacement, FPS
  changes, and resolution changes.
- GPU texture storage is allocated only when dimensions change. Ordinary frames
  update existing texture storage.
- Decide whether a frame is needed before expensive upload, composition, and
  encoding work whenever possible.
- Rendering, generated-track submission, and WebRTC delivery preserve
  monotonically increasing transport time while playing.
- Receiver delay overrides are disabled by default. A non-null
  `playoutDelayHint` or `jitterBufferTarget` requires a measured runtime-specific
  A/B test because buffer adjustment may repeat or drop video frames.

Historical regressions:

- Cam Player `0.2.3`, commit `5e7a8d7`, stopped reallocating the source GPU
  texture for every frame and moved frame rejection before GPU upload.
- Cam Player `0.2.4`, commit `18b8e4f`, changed frame selection from callback
  wall time to `metadata.mediaTime`. Its verified 24 FPS result was approximately
  `decodedFps=23.8 renderedFps=23.8 skipped=0`.
- Any new scheduler must preserve both fixes in the complete renderer-to-WebRTC
  path, not merely leave the old helper functions present but bypassed.
- Cam Player `0.6.3` exposed a later ownership regression: paused heartbeat and
  Motion could keep submitting while playback also submitted decoded callbacks,
  producing roughly 46 FPS from a 24 FPS source and bursty Browser decode. The
  renderer must retain exactly one call site for `submitGeneratedFrame()` plus
  its declaration, and that call site must belong to the frame pacer.

## Pause, Photo, And Heartbeat Contract

- A loaded video starts paused after its first decoded frame is available.
- A paused video continues to expose the exact visible pause frame to Browser.
- Moving the source while paused updates the transmitted composed frame.
- A photo remains available as a live camera source without continuous decoding.
- The same pacer supplies the low-rate paused/photo heartbeat; a second timer is
  forbidden.
- Starting or pausing playback reconfigures that pacer atomically and resets its
  next deadline; it never leaves the previous state's clock running.
- Pausing retains the most recently presented frame.
- Motion can update a paused/photo composition at its required rate, but must not
  silently cap subsequent video playback or leave another scheduler active.

## WebRTC Session Contract

- One Browser source request owns at most one current Cam Player encoder.
- Superseded offers and peers are cancelled and closed promptly.
- Repeated site probes must not leave multiple encoders running concurrently.
- Cleanup of an old request must not close or freeze a newer replacement.
- A short site stop/reopen cycle may reuse a healthy session when geometry and
  route remain compatible.
- Signaling completion is not media readiness. A successful session must deliver
  a decoded frame with stable non-zero geometry.
- A paused/static source must still satisfy first-frame readiness.
- ICE route validation must inspect the selected candidate pair after connection.
- The endpoint selected when Source starts is locked for that service session.
  USB never falls back to Wi-Fi and Wi-Fi never falls back to USB. A route loss
  stops with an error until the user explicitly starts the source again.
- Discovery and route probing remain stopped while a Cam Player session is
  active; they must not compete with media traffic or rewrite the selected IP.
- Source controls signaling and ownership for Cam Player but does not decode or
  re-encode the Cam Player media stream.

## Resolution And Geometry Contract

- Never change the manually selected Cam Player output resolution unless
  `Follow site and phone orientation` is enabled.
- Maximum FPS and resolution controls are independent.
- With follow-site disabled, site constraints do not overwrite output size.
- With follow-site enabled, apply the site's requested geometry in the phone's
  physical orientation and support live portrait/landscape changes without page
  reload or stale dimensions.
- Arbitrary even resolutions are supported; do not hard-code example presets as
  limits.
- Do not silently reduce source or output resolution to recover performance.
- Preserve aspect ratio unless the user explicitly changes source transform.
- Preview zoom and fit-to-window never change output resolution.
- Source zoom is centered on the mouse pointer. Drag directions must match mouse
  movement.
- Background composition uses a static first-frame snapshot and must not render
  a second moving copy of the video.
- Mirroring and rotation must not introduce unintended crop, axis swap,
  stretching, or perspective deformation.

## Browser Camera Routing Contract

- Available explicit modes are `F`, `R`, and `N`. Removed automatic mode `A`
  must not return through defaults, migration, UI, or fallback logic.
- A clean Browser installation defaults to `F`.
- `F` routes the request to Source/Cam Player and preserves the requested camera
  identity and facing direction presented to the site.
- `R` selects the managed physical rear-camera path.
- `N` returns a native Android camera stream without Cam Player canvas or WebRTC
  substitution.
- A request for a rear camera must not accidentally open the phone front camera,
  and a front request in `F` must not fall through to the phone front camera when
  Source is healthy.
- Site `deviceId`, `facingMode`, width, height, frame-rate, and audio constraints
  must be logged before route selection.
- Camera switching must work repeatedly, including `F -> N/R -> F`.
- Stopping an obsolete site track must not destroy the active replacement track.
- Browser rotation must preserve the current page, tabs, active tab, and camera
  state instead of reopening the start page.
- File inputs must open Android's file picker and return the selected file to the
  requesting page.
- The Browser must not append a custom product token to the system User-Agent.
- Camera and microphone permission requests remain independently logged.

## Native Camera Contract

- Rear-camera autofocus must work on initial open and after repeated route
  switches.
- Select the main rear camera when an auxiliary camera lacks continuous focus.
- Do not report successful autofocus merely because settings contain
  `focusMode=continuous`; log capabilities, constraint application, resulting
  settings, and failures.
- Do not insert a single-shot focus sequence into a working continuous-focus path
  without device-level regression testing.
- Native camera routes must not inherit Cam Player resolution, timing, motion, or
  transform state.

## Source Contract

- Source mode and source readiness are distinct and both must be logged.
- RTSP supports arbitrary source dimensions and preserves them unless the user
  explicitly chooses another output behavior.
- RTSP playback stays latest-frame oriented; stale buffered media is not played
  later as accumulated latency.
- H.264 direct delivery must retain parameter sets, keyframe recovery, timestamp
  monotonicity, and correct WebRTC native runtime initialization.
- Video and photo sources continue to produce a visible frame while paused or
  static.
- Cam Player discovery refreshes addresses dynamically. A manual address remains
  an explicit fallback.
- Only one phone owns an active Cam Player session; a new explicit owner can
  replace a stale owner without creating simultaneous encoders.
- Logs remain viewable, copyable in full, and clearable. Browser logs clear after
  Browser exits as requested; crash information remains available where the
  application contract requires it.

## Cam Player Controls And Data Contract

- Open button, drag-and-drop media loading, recent-file selection, and clearing
  recent files must remain functional.
- Play/pause controls are one-shot actions and must not remain logically pressed.
- Preview-only controls never mutate source transform or output resolution.
- Source transform reset occurs only from the explicit Reset command.
- Horizontal mirror is explicit and persistent only as designed.
- QR capture scans the user-selected screen region and copies decoded text to the
  clipboard; it does not open links automatically.
- Motion profiles persist across restarts, remain accessible through the profile
  folder button, and use the agreed date/time naming format.
- Recorded Motion and Live Motion are opt-in. Disabled motion produces no hidden
  transform updates or unnecessary camera/sensor load.
- Motion processing must not reduce playing-video FPS or continue to hold Android
  camera resources after it is disabled.
- Network interface labels and addresses are generated from current interfaces;
  virtual adapters stay hidden when inactive and must not be hard-coded.

## Required Release Matrix

Run the applicable rows after every timing, media, routing, lifecycle, geometry,
or WebRTC change.

| Scenario | Required result |
| --- | --- |
| 24 FPS video, Maximum FPS 60 | Native cadence, no periodic skips or repeats |
| 30 FPS video, Maximum FPS 60 | Native cadence, no periodic skips or repeats |
| 60 FPS video, Maximum FPS 60 | Approximately 60 evenly presented frames/s |
| 60 FPS video, Maximum FPS 30 | Even `60 -> 30` reduction by media timestamp |
| Video pause before site request | Site receives the visible pause frame |
| Pause then Play then Pause | Exactly one active cadence source in each state |
| Photo source | Stable visible frame with bounded CPU/GPU use |
| Source drag/zoom during pause | Browser receives each current composition promptly |
| Site opens/closes camera repeatedly | One current peer/encoder; no stale close race |
| `F -> N -> F` and `F -> R -> F` | Correct source every time; no frozen track |
| Rear camera near/far target | Continuous autofocus remains active |
| Portrait/landscape rotation | Page and tabs persist; geometry updates correctly |
| USB selected | USB candidate pair only; disconnect fails without Wi-Fi fallback |
| Wi-Fi selected | Wi-Fi candidate pair only; disconnect fails without USB fallback |
| Follow-site disabled | Manual output resolution remains unchanged |
| Follow-site enabled | Requested geometry follows physical orientation |
| Five-minute run | At most one pending frame; no peer/encoder leak or memory climb |

## Generated Frame Transport

- Playing video has exactly one frame publisher: the decoded-frame callback.
  The frame pacer must reject playing-video submissions and may publish only a
  paused frame, photo, or Motion-updated static composition. Do not restore a
  second timer-driven playing-video path.
- The Browser SOURCE route has exactly one shared latest-frame worker for the
  incoming receiver track. Construct its processor with `maxBufferSize: 1`, do
  frame reads/writes in the worker, and give sites clones of its generated
  output track. Never create one worker or queue per `getUserMedia()` request.

- Never construct a `VideoFrame` directly from the production WebGL canvas when
  its context uses `preserveDrawingBuffer: false`. Copy the just-rendered back
  buffer to the reusable 2D transfer surface first.
- The Electron smoke test must exercise the production WebGL-to-transfer path,
  production frame pacer, a `Motion pause -> 24 FPS playback` transition, remote
  WebRTC decode, live resize, repeated peers, `1500x2000`, `2400x3200`, and a
  measured 24 FPS cadence cycle.
- Keep at most one pending generated frame. Backpressure replaces an obsolete
  pending frame; it must never build a playback queue.
- Resolve every repeated site `configure` and `offer` from the same manual
  resolution baseline. Identical constraints must produce identical geometry.
- Do not mark a negotiated codec as failed unless the frame producer delivered
  at least one input frame to that encoder attempt.

For cadence tests, inspect at least decoded, rendered, submitted, skipped,
repeated, late, encoder FPS, receiver FPS, dropped frames, packet loss, and
freeze counters. A visually smooth preview alone is not proof that Browser sees
the same cadence.

The Browser Media A/B diagnostic keeps one source stream alive for both phases:
60 seconds of display-only playback followed by 60 seconds with MediaRecorder.
It must stop automatically, discard recorder chunks after counting their bytes,
and report displayed-frame cadence for both phases. Reacquiring the camera
between phases invalidates the comparison.

For a strict USB route, both SDP sides must be restricted before negotiation:
the Browser offer to the phone's local USB address and the Player answer to the
computer's USB address. A route mismatch is a network failure, never an encoder
or codec failure. Do not expose a SOURCE track to a page before the selected ICE
pair is validated, and never retain or reattach an ended SOURCE track.

Cam Player may listen on all interfaces only while waiting for Source
discovery. After Source presses Start, `/lock-route` must rebind port 8791 to
the local address that accepted that Source connection, stop Bonjour, and
disable interface fallback. `/release` restores discovery listening.

## Release Gate

Do not publish artifacts until all of the following are true:

- Relevant unit and integration tests pass.
- Android build, lint, and camera-hook checks pass.
- Cam Player unit tests and Electron WebRTC smoke test pass when relevant.
- No known guardrail is bypassed by a new fallback or parallel scheduler.
- Logs identify version, session, route, constraints, resolution, source FPS,
  effective FPS, peer count, encoder count, and first-frame readiness.
- The diff contains no unrelated cleanup or user-data deletion.
- Any unverified device-only behavior is clearly reported before asking the user
  to install and test a build.

## Native Chromium Migration Gate

- The legacy WebView implementation is frozen on branch
  `legacy-webview-0.6.22`; native-browser work must not alter its Browser,
  Source, or Cam Player behavior.
- The first native prototype uses Chromium's own `VideoCaptureDevice` pipeline.
  It must not install the legacy `getUserMedia`, `enumerateDevices`, Canvas, or
  receiver-`RTCPeerConnection` substitution in page JavaScript.
- Do not connect Cam Player until the upstream native test device passes
  discovery, constraints, MediaRecorder, repeated open/close, and five-minute
  stability checks on the target phone.
- Keep the Chromium revision pinned. An upstream source-shape mismatch is a hard
  build failure and requires review; patch scripts must never guess.
- The final Cam Player receiver will replace the test frame producer behind the
  same native capture interface. It must not add a second page-facing track
  owner or reintroduce the WebView hook.

When a regression is discovered, add its invariant and a reproducing test here
before or together with the fix. Do not rely on conversation history alone.
