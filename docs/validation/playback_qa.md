<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# Playback: smoothness and view changes while the time runs, 2026-11-15

Branch `shay/playback-smooth`. Story "Rover: Shackleton rim to the ridge" (VIPER-class, 19.3 km, about 40 h), measured
at 1 h/s; the view-change checks also play it at 10 min/s and 6 h/s, and play Apollo 11. Domains: the camera behaviour and the
sky view are Shay's; the per-frame cost (DOM writes, renders) is Shahar's (pending her review). No physics changed:
the Sun, the Earth, the skyline and the rover's position are computed exactly as before.

## What a viewer sees: before and after

Measured per frame while playing (`scripts/check_playback_smooth.py`): the frame interval, the scenario time, the
rover's distance and the camera's azimuth **in one fixed frame** (near the pole the local north turns quickly as the
rover moves, so the local azimuth number changes even when the camera looks the same way). "Step jitter" = mean
|step_i − step_(i−1)| / mean |step_i| (0 for perfectly even steps). Edge, 1920 × 1080, 8 s of playback from the start,
main and this branch alternating, medians of the runs (GPU shared with other agents' headless browsers this afternoon).

| Rover drive, 1 h/s | Code | runs | fps | frames > 25 ms (of ~400) | frames > 50 ms | largest camera turn in one frame | camera turn reversals | camera turn-rate jitter |
|---|---|---|---|---|---|---|---|---|
| Driver's view | main | 4 | 41.3 | 124 | 10.5 | **91°** (70–130°) | 20 | 1.07 |
| Driver's view | this PR | 3 | **49.0** | 88 | **0** | **2.2°** | 11 | **0.50** |
| Free look | main | 4 | 50.2 | 74 | 0 | 0.02° | 2 | 0.59 |
| Free look | this PR | 4 | 49.3 | 75 | 5 | **0.000°** | **0** | 0.57 |

(One free-look run of this PR ran while another browser loaded, at 28 fps; it is in the medians. One planned PR run
failed to load the page because the test server refused a connection, so Driver's view has 3 PR runs.)

- **The biggest visible fault was the camera in a drive near the pole.** In Driver's view the camera jumped by up to
  70–130° in a single frame and swung back and forth (20–26 reversals in 8 s): each frame the rover's local frame
  turned, the camera's azimuth number stayed, so the view swung physically with the frame turn, then eased back toward
  the heading. Now the camera turns with the frame first and only real changes of heading are eased: the largest step
  is about 2° and the reversals halve (the rest follow the route's own bends).
- In free look the camera now holds its direction exactly (largest step 0.000° instead of 0.02°, no reversals): turns
  below 0.02° were dropped (a slow drift), and each ground rebuild (about 6 a second) re-applied the opening framing of
  the Earth (small periodic jumps).
- Frame intervals: the sim time already follows the wall clock (no quantised steps; the rover's distance steps track
  the frame intervals exactly), so the remaining unevenness is frames that miss the 60 Hz deadline. In Driver's view
  this PR gives 41 → 49 fps and no frame over 50 ms (was about 10 in 8 s). In free look the frame timing is the same
  within the noise of a shared GPU: the per-frame DOM work removed here (see "Changes") is small next to the ground
  rebuild (about 10–16 ms on the main thread, every 160 ms), which is left for later (see "Left to do").

## View changes during playback

`scripts/check_playback_views.py` plays the rover story at 1 h/s and changes the view step by step. After each step
it checks: no console error, a finite camera, a view that is not blank, playback still running at the chosen speed
(one loop, not two; scrubbing and a new story stop it on purpose), the camera buttons' states, and the aim (Follow:
the camera within 3° of the followed body's azimuth; Driver's view: within 30° of the heading, since it eases toward
a heading that bends with the path). Steps: Sun | Earth | Both switch (free look and while following), Follow on, drag
(pauses: "mixed"), Follow again (resumes), zoom while following, Driver's view on, drag, resume, off, on again, a
body's edge arrow pressed while playing, full screen on and off (button and Esc), each "⋯" option, speeds 10 min/s,
6 h/s and 1 h/s, theme, window resize (desktop) or landscape and portrait (phone, 390 × 844, touch), slider scrub,
play again, pause and play quickly, another story (Apollo 11) and back to the rover.

| Run | Steps | Failures |
|---|---|---|
| main before #76 and #78, 1920 × 1080 | 33 | 1: the edge arrow, pressed for 150 ms while playing, did nothing (camera 79° off the Sun). (Two more failures in one run were the trip reaching its end, fixed in the check by going back to the start.) |
| this PR merged with main (#76 Sun / Earth / Both bar, #78 stories in the search), 1920 × 1080, two runs | 33 | 0 (in one run no body was out of the frame, so the edge-arrow step was skipped) |
| the same, phone 390 × 844 (touch), portrait, landscape and back, two runs | 33 | 0 and 1: Driver's view resumed after a drag was 30.1° off the heading 1.2 s later (limit 30°); the heading at 1 h/s bends quickly (see "Left to do") |

### Bugs found and fixed

Each: steps → before → after.

1. **Driver's view swings near the pole.** Rover story, Driver's view on, play at 1 h/s → the view jumps by up to
   70–130° in one frame and swings back over the next half second, again and again (20–26 reversals in 8 s) → the
   camera turns with the rover's local frame every frame (`rideCamera` → new C8 extra `view.turnFrame`); largest step
   about 2°, reversals about halved.
2. **Follow on a drive lost its feed-forward.** Rover story, Follow Sun or Earth, play → every frame `rideCamera`
   turned the camera with `lookAt`, which cleared the tracking target (the body's motion was eased with a 0.35 s lag
   instead of followed) and, when the camera happened to point within 0.5° of a body, re-applied the framing rule
   (`lookAtBody`, which resets the zoom) → `turnFrame` keeps the target and the zoom; the next update feeds the body's
   own motion forward as for a fixed site.
3. **Driver's view one frame late.** The new direction of travel was given after the frame was drawn → given before
   `view.update` draws it.
4. **Free look drifted and twitched on a drive.** Small frame turns (< 0.02°) were dropped, and each ground rebuild
   re-applied the opening framing (`autoFit`) → the camera holds its direction exactly; a moving view (a drive) keeps its
   camera when its ground is rebuilt (a static view still keeps its framing when real terrain arrives).
5. **A body's edge arrow did not respond while playing.** The arrow ("Earth" with an arrow on the frame edge) is drawn
   again in each frame, so the button under the pointer at the release was a new one and the browser sent no click →
   a press and a release on the arrow of the same body turn the view (pointer events); Enter and Space still work.
   With a 150 ms press while playing: main leaves the camera 79° off the Sun; this PR turns it to the Sun (0.1° off).
6. **Two renders in one frame at each ground rebuild.** `setTerrain` drew the view at once although the playing
   timelapse draws it again in the same frame → it asks for the next animation frame instead.

### Checked and fine (no change needed)

Playback rate stays 0.9–1.1 × the chosen speed after every step (no duplicated loops); the Follow and Driver's view
buttons show on / paused / off correctly; full screen in and out keeps the camera mode and the playback; the "⋯"
options, theme, speeds, resize and phone orientation changes keep playing with no console error and no blank view;
switching stories stops the old playback and the new set starts at T+0 as designed.

## Changes

- `web/js/sky/index.js`: `turnFrame(dAzDeg)` (C8 extra); `update(state, { render })`; `setTerrain` draws at the next
  frame and keeps a moving view's camera.
- `web/js/rover/sky_ride.js`: `rideCamera` turns the camera with the local frame in every mode (`turnFrame`; the 2D
  fallback keeps `lookAt` in free look).
- `web/js/app/sky_panel.js`: the Driver's view direction before the frame is drawn; the view's text alternative, the
  slider and the clock written only when they change; `skyDebug()` for the checks. (The status line under the view
  now changes only its texts, from main's page cleanup, #76, so it needs no throttle.)
- `web/js/sky/hud.js`: each HUD element's HTML written only when it changed; the readout and note boxes measured again
  only when their shape or the view size changed (they forced a layout in every frame); edge arrows on pointer events.
- `scripts/check_playback_smooth.py`, `scripts/check_playback_views.py`: the two checks above.
- `web/tests/rover_ride_camera.test.mjs`: the camera keeps its physical direction along a path near the pole, in free
  look and in Driver's view (within the sphere's holonomy, 0.002°), with no `lookAt`.
- `docs/CONTRACTS.md`: C8 `turnFrame`, C10 ride camera.

## Left to do

- The ground rebuild of a drive (`terrain.js place`: heights, clamping and normals of about 200 000 vertices, then the
  GPU upload) takes 10–16 ms on the main thread every 160 ms; with the rest of a frame it often misses the 60 Hz
  deadline, so about 1 frame in 5 still takes 33 ms. Moving the heights and normals into the ground worker (it already
  builds the patch) would remove most of it; a cheaper step is a table of tan(skyline) per azimuth instead of a
  `horizonElAt` and a `Math.tan` per grid vertex.
- Driver's view at 1 h/s and faster: the heading over ±80 m bends with every turn of the planned path, which goes past
  in a fraction of a second; a heading averaged over the distance driven in about half a second of playback would be
  calmer (Shay's call: what "ahead" means).
- The charts' time cursor (Plotly `relayout`, about 12 times a second) also costs frame time while the charts are off
  screen.
