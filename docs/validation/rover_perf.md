<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# Rover playback speed in the sky view, 2026-11-15

Branch `shay/rover-perf`. Story chip 6, "Rover: Shackleton rim to the ridge" (VIPER-class, 19.3 km, about 40 h).
Domains: performance and the Web Worker are Shahar's (pending her review); the sky view's terrain is Shay's. The physics
is unchanged: the Sun, the Earth and the skyline at the rover's exact position are computed as before.

## Result

Rover story, 10 s of playback from the start, Edge on this laptop (Intel Iris Xe). Two runs per case, main and this
branch taking turns; values are "run 1 / run 2". Goal: at least 30 fps (target 60), no frame over about 50 ms.

| Case | Code | fps | median frame | 95th pct | worst frame | frames > 50 ms | long tasks > 50 ms (worst) |
|---|---|---|---|---|---|---|---|
| 1920 x 1080, 1 h/s | main | 3.5 / 3.0 | 300 / 284 ms | 433 / 714 ms | 450 / 762 ms | 32 / 28 | 32 (431 ms) / 28 (765 ms) |
| 1920 x 1080, 1 h/s | this PR | **53.8 / 55.2** | 17 / 18 ms | 33 / 18 ms | 50 / 36 ms | 1 / 0 | 0 / 0 |
| 1920 x 1080, 10 min/s | main | 18.8 / 22.0 | 18 / 18 ms | 463 / 265 ms | 1119 / 1183 ms | 14 / 20 | 13 (1116 ms) / 19 (1184 ms) |
| 1920 x 1080, 10 min/s | this PR | **52.0 / 49.1** | 18 / 18 ms | 19 / 18 ms | 303 / 1058 ms | 2 / 2 | 1 (313 ms) / 1 (1029 ms) |
| 390 x 844 phone, 1 h/s | main | 1.5 / 2.6 | 425 / 232 ms | 1328 / 1152 ms | 1328 / 1157 ms | 17 / 25 | 17 (1314 ms) / 25 (1150 ms) |
| 390 x 844 phone, 1 h/s | this PR | **54.7 / 38.3** | 18 / 17 ms | 18 / 50 ms | 230 / 67 ms | 1 / 23 | 1 (236 ms) / 0 |
| 390 x 844 phone, 10 min/s | main | 18.3 / 24.2 | 18 / 17 ms | 282 / 250 ms | 1117 / 483 ms | 19 / 23 | 18 (1122 ms) / 23 (488 ms) |
| 390 x 844 phone, 10 min/s | this PR | **55.9 / 56.4** | 18 / 17 ms | 18 / 33 ms | 54 / 66 ms | 1 / 3 | 1 (54 ms) / 0 |

- From 1.5–3.5 fps to 38–55 fps at 1 h/s, and from 18–24 fps (with 0.5–1.2 s freezes) to 49–56 fps at 10 min/s.
  Main has a long task (250–1300 ms) in almost every frame or every few frames; this PR has none in steady playback.
- Three runs of this PR had one isolated long frame each (230 ms, 303 ms, 1058 ms) that profiling did not reproduce: two
  more profiled runs at 10 min/s had no task over 50 ms and no stretch of our code longer than about 40 ms. The phone
  run at 38 fps had 23 frames of 50–67 ms with no long task, so those frames were waiting for the GPU (shared with
  other programs this afternoon; see Method). Run 1 of the same case: 54.7 fps.
- The other stories are as fast as before (6 s each, Apollo 11 with Follow Earth):

| Story | Speed | main: fps, worst frame | this PR: fps, worst frame | console errors (main / PR) |
|---|---|---|---|---|
| Apollo 11 · 1969 (Follow Earth) | 1 h/s | 58.7, 33 ms | 56.2, 34 ms | 0 / 0 |
| Compare all Apollo landings (6 views) | 1 h/s | 22.0, 67 ms | 21.5, 67 ms | 0 / 0 |
| South pole ridge | 1 day/s | 52.8, 100 ms | 52.5, 34 ms | 0 / 0 |
| Far side (Chang'e 4) | 6 h/s | 46.3, 50 ms | 47.5, 50 ms | 0 / 0 |
| Eclipse from the Moon | 10 min/s | 48.3, 67 ms | 51.2, 67 ms | 0 / 0 |
| Beresheet: the sky now | 1 day/s | 52.7, 67 ms | 55.5, 34 ms | 0 / 0 |

## Why it was slow

A profile of 8 s of playback at 1 h/s (Edge, CPU sampling) put 92 % of the main thread in one call chain:
`rideTerrain → setTerrain → buildTerrain`. The view rebuilt its whole 3D terrain each time the rover had moved one grid
cell (27 m on this route), at most every 160 ms. One rebuild took about 250 ms:

| Part of one rebuild | Time |
|---|---|
| synthetic micro relief (noise + 220 small craters) at the 194 000 polar-mesh points; the same values every time | 121 ms |
| `routePatch`: the ±8 km C4 patch from the route grids (257 × 257 points) | 28 ms |
| clamping the near field under the skyline | 28 ms |
| vertex normals (three.js `computeVertexNormals`) | 28 ms |
| shader programs linked again (the old materials were disposed first) | 16 ms |
| new buffers, index, winding, GPU upload, rest | about 30 ms |

At 1 h/s a rebuild was due every frame, so the view ran at about 4 fps. At 10 min/s it depended on the rover's speed:
where the rover drives fastest (7–12 km, flat ground), a rebuild was again due in nearly every frame.

## What changed

1. **Heights in place** (`web/js/sky/terrain.js`). Everything in the near field that does not depend on the ground is
   computed once per layout and kept: plan positions, triangles (with their winding), the micro relief at each polar
   point, the rock layout, and where each polar point samples the patch. A new patch on the same grid only gets new
   heights, normals, rock heights and skyline (`setGround`, about 12 ms). Materials, shaders and buffers stay.
   The result is the same, bit for bit: in Edge, a terrain moved with `setGround` and a fresh build give identical
   position, normal, rock-matrix, skirt and index arrays, and the new build is identical to the old code's.
2. **Faster normals** (`web/js/sky/math.js vertexNormals`): the same arithmetic as three.js, on plain typed arrays.
3. **Ground patch in a Web Worker** (`web/js/rover/ground.js`, `worker.js`): the worker gets a copy of the route grids
   once and runs the same `routePatch`; the frame loop no longer waits for it. One request per view at a time; the next
   takes the latest position; still at most one rebuild every 160 ms. Without workers, after a worker error, or when
   a reply takes more than 3 s, the patch is computed inline (so a lost reply cannot stop the ground).
4. The rock meshes are now disposed with the terrain (each full rebuild used to leave their GPU buffers behind).

## The "freezes halfway" report

Shay: "the driver's view is very clanky and half way in it freezes the terrain". Three findings:

1. **The ground does follow the rover, start to end** (old and new code). Log of every ground put on the view against
   the rover's position, Driver's view on, whole drive:

   Distance from the rover to the centre of the ground patch on show, at every frame (median of each 2 km stretch;
   maximum over the drive):

   | Run | Ground rebuilds | Median per 2 km | Max | Last frame |
   |---|---|---|---|---|
   | story, 10 min/s, main | 695 | 7–30 m | 43 m | 5 m |
   | story, 10 min/s, this PR | 709 | 7–8 m | 27 m | 5 m |
   | story, 1 h/s, main | 171 | 82–169 m | 187 m | 59 m |
   | story, 1 h/s, this PR | 246 | 43–91 m | 170 m | 5 m |
   | 2-stop trip (3 legs, A → D), 1 h/s, this PR | 247 | 40–86 m | 157 m | 28 m |

   At 1 h/s the rover drives up to 720 m per second of playback, so the 160 ms between rebuilds (unchanged) is up to
   115 m of travel, plus the grid rounding and one or two frames for the worker: the patch trails by about that. It
   never stops following. No rebuild is skipped, no cache key repeats, leg changes are handled, and the route grids
   cover the whole route.
2. **On main, the middle of the drive drops to about 3 fps** (10 min/s, frame interval per km of the drive): 60–115 ms
   per frame from 0 to 7 km, **245–330 ms from 7 to 12 km**, 55–90 ms after 12 km. There the rover drives fastest, so a
   250 ms rebuild was due in nearly every frame. This is the halfway "freeze", and this PR removes it (29–54 ms in the
   same stretch with three browsers running at once; see the table above for clean numbers).
3. **The synthetic foreground moves with the rover (not changed here).** The small craters and the 2 600 rocks within
   about 400 m are decoration (LOLA does not resolve them), generated around the eye with a fixed seed. The same rock
   sits at the same azimuth and distance at 12.8, 13.4, 13.9, 14.8, 15.2 and 16.3 km (screenshots, main and this PR
   alike). In the second half the path runs straight north-east and the ground is sunlit, so the foreground looks
   frozen while the 62.5 m DEM ground and the skyline change. Fixing it means anchoring the rocks and craters to the
   ground (world-fixed, with a level of detail for the many pebbles near the eye) and moving them between rebuilds:
   a visual change to every sky view, about half a day of work. **Decision for Shay.**

## Checks

In Edge, rover story at 1 h/s, this branch (all passed, 0 console errors or warnings):

- Driver's view: the view's direction (the globe wedge) is a median 8–9° from the path heading while it eases after
  the turning path (90th percentile 18°); the wedge sits on the rover's dot (median 0 m).
- The rover's dot moves on the globe (about 200 moves in 5 s); the trip line "x km driven" grows every 0.5 s.
- Follow Sun and Follow Earth: the body stays in frame while playing (0 of 8 samples out of frame each).
- Clear all while playing (`clearAll()`, what the button runs; the button shows from two scenarios on): no sky card
  left, the rover's dot and the wedge are removed, and neither comes back.
- Same pictures: screenshots at fixed moments with Driver's view on. At 30 h main and this branch are identical pixel
  for pixel. At 7.5 h and 26 h the camera was still easing toward the heading, and the two differ only along edges
  across the whole frame (stars, constellation lines, labels, compass ticks, rocks): a sub-pixel camera offset, not
  the terrain. The terrain arrays themselves are identical (see "What changed", item 1).
- Tests: `node --test web/tests/` 301 pass, among them new ones for `vertexNormals` (against a plane and a direct sum)
  and `rover_ground.test.mjs` (the worker's copy of a route, one leg and a joined trip, gives the same patch as the
  route itself; one request at a time, latest point next, 160 ms apart, a ground for another trip dropped).
  `uv run pytest -q` 175 pass; `uv run ruff check .` clean.

## Method

- Edge 157 (Playwright `channel="msedge"`), headless, `--use-angle=d3d11 --enable-gpu`; WebGL renderer
  "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, Direct3D11)". Page served by Python's threaded `http.server`.
- Main (`c84a434`) and this branch side by side: a second server returns main's versions of the changed files.
  Runs alternate main / this PR, two of each case. (The whole-drive logs and screenshots were taken against `83a80cf`;
  none of the files involved changed between the two.)
- Whole-drive logs: a third server adds one log line to `rideTerrain` (rover position) and one where a ground is put
  on the view (its point); playback with Driver's view on, from the start to the arrival.
- The measuring scripts are scratch tools, not in the repo; they can be added on request.
- Each run: open the page, click the story, wait for the route and the view, choose the speed, record
  `requestAnimationFrame` intervals for 10 s of playback; long tasks from `PerformanceObserver("longtask")`.
  "Hitch" = a frame over 50 ms.
- Outside load: the user's Chrome GPU process used 70–99 % of the GPU for seconds at a time during this session, also
  with nothing of ours running, and early runs varied from 3 to 50 fps for the same code. It stayed below 50 % during all
  16 timed runs above (sampled every second); other programs on the GPU were not tracked. A frame that waits for a busy
  GPU is long while the main thread is idle, which is how the 38 fps phone run looks.
- The 3.19 km screenshot shows a straight shading seam on the ground exactly at north (0°), on main and on this branch
  alike. It is not from this change; worth a separate look.
