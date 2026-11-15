<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# Website QA, round 6 (last small fixes before the freeze), 2026-11-15

Tester: the `qa6` agent (branch `shay/qa6`, from `origin/main` at `d2dfbec`, merged with `ccea0d5`). Goal: the two S3
items QA5 left (rover Play while planning, the calendar at 1366 × 768), the untested sun-spot snap for trips, a last
pass on long texts, one bug reported by the validation agent (a link's camera `v=`), and a final smoke test.

**How.** Playwright with the installed Microsoft Edge (`channel="msedge"`, headless, `--use-angle=d3d11 --enable-gpu`),
a fresh context per run, local build served from `web/` by a threaded server on a free port (stopped at the end of each
run). Every run logged console errors, page errors and HTTP ≥ 400 responses, and the page's horizontal overflow.

## Smoke test

| Viewports | Themes | Stories | Result |
|---|---|---|---|
| 1920 × 1080, 1366 × 768, 390 × 844 (`is_mobile`, `has_touch`) | dark, light | all 7 (apollo11, apollo-all, pole, farside, eclipse, rover, beresheet-now), each from `#globe-search` | 0 console errors, 0 page errors, no HTTP errors, no horizontal overflow (also while a route is planned) |

Each run first played the race: the rover story, then the pole story 1.5 s later, while the route was still planned.
Play was held during the planning, and the pole story opened at T+0 with Play enabled.

## Findings and fixes

| ID | Sev | What happened (steps) | Fix |
|---|---|---|---|
| F1 | S3 | Apollo 11, then the rover story: for about 7–10 s the dimmed Apollo sky stayed on screen and Play played it. | While a trip's route is not computed yet, the timelapse is held (`holdPlayback`, `sky_panel.js`): playback stops; Play, the slider and the speed are disabled; the clock and Play's tooltip say "Planning the rover route…". When the route arrives, the rover story opens at T+0, paused, with Play enabled. Switching story during the planning releases the hold at once. Measured: 0.5–6.8 s held (two forced Play clicks ignored), then T+0, Play works (1 h 30 min after 1.5 s). |
| F2 | S3 | 1366 × 768, a Start field in the middle of the window (y ≈ 384): the 434 px calendar fit neither below (346 px) nor above (376 px) the field; it opened above with a max height and Now / Clear / Done were cut off (scroll inside the picker). | The picker opens below when it fits, else above when it fits, else inside the window over the field (its head repeats the value), bottom-aligned (`popSpot`, `time_picker.js`). Its full height is measured also while a max height is set. Measured: field at y = 384 → picker 326–760 px, buttons at 668–701 px, no inner scroll; low and high fields unchanged. |
| F3 | S3 | Validation agent's report: a link's camera `v=` was not applied. Reproduced only when the link is opened in the same tab over the scenarios already shown (a hash change, not a load): the views are kept, so the camera stayed at its default (272°, 31°); the next written link dropped `v=`. A fresh load applied `v=` (200°, 25°, 50° exactly), also on a phone (when the view is built) and for the rover story, and a drag then Share wrote the new camera. | `applyHash` turns the first view to the link's camera when the scenarios are the same (`setSkyCamera`, `sky_panel.js`); a view not built yet takes it when it is built. Measured: same-tab link → 200°, 25°, 50°; drag + Share → `v=193.56,26.16,50`; reload → 193.56°, 26.16° (within 0.01°). |

Node tests: `web/tests/app_qa6.test.mjs` (the hold, the picker's three places, the camera of a same-scenario link,
the shorter texts); `app_qa5.test.mjs` follows the new empty-state words.

## Sun-spot snap for trips (no change needed)

South pole story (Shackleton rim, −89.4395°, −137.1934°), "Most sunlit spots" on, map at zoom 22, then Trip: arming
pinned the map, which moved up by 32 px (stage top 82 → 51 px). A hover scan found the spot markers through the map
readout ("sunlit spot: lit up to 72 % of the time"). A click 60.0 km from the start (pointer at 87.997° S, 143.259° E)
set the end to −87.9699°, 147.9828°: exactly one row of the spot table (`overlays.json` `sun_spots`), 59.4 km from the
start. The pick ended, and no stale click position after the move.

## Texts trimmed

| Where | Before | After |
|---|---|---|
| Empty state (no place) | "Search the Moon or click the globe, or type coordinates. A story is the fastest way in:" | "Search the Moon, click the globe, or start a story:" |
| AI mode, lead | "... Claude turns it into requirements, runs Moonat's own Sun, Earth and terrain calculations on candidate sites (at most 8), and ranks them. It never makes up the numbers." | "Describe a mission in your own words. Claude runs Moonat's own Sun, Earth and terrain calculations on up to 8 candidate sites and ranks them." (the AI label above already says the numbers come from Moonat's validated physics) |
| AI mode, key note | "Uses your own Anthropic API key; a typical mission costs about $0.10–0.30. The key stays in this browser (this tab only, unless you tick Remember), goes only to api.anthropic.com, and is never put in a link. Get a key ..." | "About $0.10–0.30 a mission. The key stays in this browser, goes only to api.anthropic.com and is never put in a link. Get a key ..." (the field's label and the "Remember on this device" box say the rest) |

Kept as they are: the place card (no line over 70 characters besides the story caption, which is content), the trip
panel's rover line ("NASA VIPER: top drive speed 20 cm/s (nominal 10 cm/s), slopes up to 15° (design limit).": data
with its caveat), the route line ("+16 h 50 min vs. a straight drive · route 1.1× the straight line"), and the
suggested dates (each line is a result).

## Left as is

- The address bar is not rewritten on a camera drag alone; Share (and any other change) writes the current camera.
  By design: the hash is written on state changes, debounced.
- A Back/Forward step between entries with the same scenarios now also turns the first view to that entry's camera
  (when the entry has one). Judged correct; not a separate test.
- No suspected physics issue came up in this round.
