<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# Rover drive: decorative detail anchored to the ground, 2026-11-15

Branch `shay/rover-anchor`. Shay's decision: "Yes, drives only". Follows `rover_perf.md` (PR #70).

## What changed

During a drive the bumps, small craters and rocks (decoration below the 62.5 m LOLA ground) stay at fixed places on
the Moon and stream past the rover. Before, they were generated around the viewer and travelled with it.

- **One frame for the trip:** the route's stereographic plane (tangent at the route centre, metres; the frame of
  `route.path` x, y). Every ground point gets an *anchor*: its map position and the map metres per metre east and
  north there. A local point (east, north) is at map `x0 + east·ax + north·an` (first order; under 1 mm over the near
  field). The moving ENU axes are never used as the pattern frame.
- **Detail by map position** (`web/js/sky/detail.js`, pure, tested in Node): bumps = the same four noise octaves as
  the static detail, in map metres; craters = 0–2 per 50 m map cell (radii 0.45–22 m, as before); rocks = a world
  population with a power-law size distribution, in hashed map cells per size octave, drawn where they look big enough
  (within size / 0.003, up to 380 m), shrinking over the last quarter of that range so none pops. No rock within
  1.6 m (+ its size) of the rover's path. Computed with each ground in the existing worker (about 28 ms there).
- **Smooth between rebuilds:** every frame the view moves and turns its near field so the eye is at the rover's exact
  position (`view.setEye`: the rover's offset from the ground point on show, and the frame turn between them). The
  skyline skirt turns with it. The rebuild (every grid cell, at most every 160 ms) re-centres the mesh; the detail is
  continuous across rebuilds because it depends on map position only.
- **Shader** (`shaders.js`, define `WORLD_DETAIL`, drives only): the fine ground texture and the rock texture are
  taken in map coordinates; the heightfield shadows in the near field's own frame. The map origin enters each octave
  reduced modulo the hash period (4096 cells), so GPU inputs stay small over a whole trip.
- **Static views are untouched:** no detail → the old code path. Checked: terrain arrays identical to main, and
  screenshots of Apollo 11, the south pole, the far side and the eclipse story identical pixel for pixel.
- Physics unchanged: the Sun, the Earth, the skyline and the LOLA ground heights are as before.

- **Rebuild step:** the near field is re-centred on the rover every 10 m of travel (before: every grid cell, 27 m),
  still at most every 160 ms, so the ground at the rover's feet stays as finely meshed as in a static view.

## Checks

**Rocks stay in place.** Real route, ground points every 20 s of drive time from 26 h (13.41 km). Three rocks of 20 cm
and up, their map position from each ground point's detail, and their distance from the rover:

| Drive (m) | Ground point | Rock 1 (map x, y; from rover) | Rock 2 | Rock 3 |
|---|---|---|---|---|
| 13 413 | 494 | −2241.5213, 3281.3139; 17.7 m | −2228.8450, 3302.8958; 8.4 m | −2203.7033, 3321.8631; 39.9 m |
| 13 420 | 494 | same; 24.8 m | same; **4.1 m** (passing) | same; 33.8 m |
| 13 435 | 495 | same; 39.5 m | same; 14.7 m | same; 21.8 m |
| 13 454 | 495 | same; 56.9 m | same; 31.9 m | same; **11.7 m** (passing) |
| 13 463 | 496 | same; 65.8 m | same; 40.8 m | same; 14.7 m |
| 13 489 | 497 | gone at 89.5 m (its visible range) | same; 66.6 m | same; 36.9 m |

The positions agree to 0.1 mm across four different ground points (rebuilds). (Logged with the 27 m step; the step
changes when the near field is rebuilt, not where the detail is.) Unit test `web/tests/sky_detail.test.mjs`: the same
world points get the same bumps and craters, and the same rocks (turn, tint, shape), from two patch centres 60 m apart
with frames turned by 0.30 and 0.35 rad; no rock on the lane.

**Frames 1 s apart** in Driver's view at 1 min/s from 30 h (14.8 km), sunlit: `docs/figures/rover_anchor_seq_0.jpg`
… `_4.jpg`. The big rock at the left of frame 0 passes out of view by frame 2; the pebbles stream past.

**Frame rate** (Edge, Iris Xe, 10 s of playback; main = 7fccc1d with PR #70):

| Case | main fps | this branch fps | long tasks > 50 ms |
|---|---|---|---|
| 1920 x 1080, 1 h/s | 54.3 | 53.0 (also 52.2, 51.9) | 0 |
| 1920 x 1080, 10 min/s | 54.5 | 51.1 (54.9 with the 27 m step) | 0 |
| 1920 x 1080, 1 min/s | – | 59.9 | 0 |
| 390 x 844 phone, 1 h/s | 60.0 | 59.3 | 0 |
| 390 x 844 phone, 10 min/s | 60.0 | 60.0 (27 m step) | 0 |

**Static views unchanged:** terrain arrays of a build without detail are identical to main's (0 differing values);
screenshots of Apollo 11, the south pole, the far side and the eclipse story at a fixed moment are identical pixel for
pixel.

**Regressions** (rover story, 1 h/s, all pass, 0 console errors): Driver's view faces the direction of travel (median
8.4° while easing); the globe dot moves and the wedge sits on it; Follow Sun and Follow Earth keep the body framed;
"km driven" grows; Clear all during playback removes the views, the dot and the wedge.

Tests: `node --test web/tests/` 305 pass; `uv run pytest -q` 175 pass; `uv run ruff check .` clean.

## Not done or uncertain

- The detail looks different from the static one (it is a new world-fixed field): rocks are uniform in density on
  the ground, so there are fewer big rocks right next to the camera, and craters are as likely far as near.
- The near field (with its clamp under the drawn skyline) moves with the rover between rebuilds while the skyline
  skirt only turns, so in the up to 160 ms before a rebuild, terrain near the skyline can differ from the drawn
  profile by a small angle. The physics horizon is unaffected.
- At 1 h/s the rover covers up to 115 m between rebuilds, so the ground at its feet is meshed more coarsely just before
  each rebuild (moving far too fast to see at that speed).
- Rocks at the far edge of their range shrink to nothing at rebuilds rather than every frame.
