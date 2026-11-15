<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# Website QA, round 5 (final: fewer words, last bugs), 2026-11-15

Tester: the `qa5` agent (branch `shay/qa5`, from `origin/main` at `290f855`, merged with `539f922`). Goal: Shay's
feedback on the live site ("still a bit buggy at places, and too many explanation texts where there shouldn't be, for
example in the Layers of the map"), then a last bug hunt as a judge would do it.

**How.** Playwright with the installed Microsoft Edge (`channel="msedge"`, headless, `--use-angle=d3d11 --enable-gpu`),
a fresh profile per run, at 1920 × 1080, 1366 × 768, 390 × 844 and 844 × 390 (`is_mobile`, `has_touch`), dark and
light themes. Local build served from `web/` by a threaded server on a free port. Each run logged console errors and
warnings, page errors and HTTP ≥ 400 responses, the page's horizontal overflow, and every visible text node longer
than 90 characters (a "long text census").

## What was tested

| Area | Checks | Result |
|---|---|---|
| Stories | All 7 (Apollo 11, all Apollo, pole, far side, eclipse, rover, Beresheet now) × 3 viewports × 2 themes | OK: no errors, no horizontal overflow |
| Sun \| Earth \| Both | Pressed state, the sections shown, the Follow button's body after each switch | OK |
| Playback | Rover story: play, Follow, Driver's view on and off while playing (clock keeps running: 10 h 20 min → 11 h 50 min); story switch while playing stops at T+0 with Driver's view hidden; eclipse plays | OK |
| Trips | Trip from Apollo 11, end picked by a map click, the too-long-leg message, swap, "Add stop" arms the map | OK after F3 |
| Layers panel | Each base map, each overlay, the "i" helpers (click and hover), deep zoom at the pole and out, legend under the map | OK after F1, F2 |
| Date picker | Suggested dates for Apollo 11, pick one, the near-side note | OK after F4 |
| Share, Back/Forward, reload | Share toast, Back to the pole story, Forward, reload with the hash | OK |
| AI mode (no key) | Open, the 3 example chips fill the mission, Forget key, Esc closes, the header button works again | OK |
| Slides | `slides/` loads (7 slides), no overflow at 844 px | OK |
| Phone | Portrait and landscape: stories, Layers panel (fits), no horizontal overflow | OK |

Console: no errors in any run. One 1366 × 768 run logged five "preloaded but not used within a few seconds" warnings
(the first sky frame took longer while three other browsers ran); they did not repeat.

## Findings and fixes

| ID | Sev | What happened (steps) | Fix |
|---|---|---|---|
| F1 | S2 | Layers panel: every row printed its full note and source (e.g. "Day and night on a smooth Moon, and the Earth's shadow during an eclipse, at the moment the sky view shows ... Sun direction: JPL DE421 (this site's physics)"). Too much text for a map control (Shay's feedback). | Each row is now a name, an "i" and one short muted line: the colour keys, or a short line for rows without keys. The note and the source sit behind the "i" (`info_tip.js`); the popover spans the row so it never overflows the narrow panel, and a click on its text does not toggle the row's checkbox. Science caveats kept behind the "i" (smooth Moon, no terrain shadows; no ground lit all the time). |
| F2 | S2 | Layers panel at 1920 × 1080 (and any map shorter than the panel): open Layers. The panel grows up from the tool column and the map clips it, so its head ("Map layers" and the close button) was cut off; Playwright could not click Close. | The open panel's height is limited to the map's room (`fit()` on open, on a base-map change and on resize); the panel scrolls inside. |
| F3 | S2 | Apollo 11, "Trip", click the map far away: the card says "A → B is 655 km ... keep each leg under 60 km", but the results area said "Pick a place on the Moon and a time", which contradicts the card. | The empty state says "Almost there: check the place and time. The card's message says what is missing. Or start a story:" when a card holds a place; blank cards keep "Pick a place...". |
| F4 | S3 | Date picker, Apollo 11: the "Earth always in view: any date works" note printed a 6-line paragraph and was cut off by the list. | The note shows its title with an "i"; the paragraph is in the popover, and the list (only the list) scrolls to show it. |

Node tests: `web/tests/app_qa5.test.mjs` (short lines ≤ 45 characters, the "i" text holds the note, the source and
the caveats, the panel fit, the empty-state words, the picker note).

## Texts trimmed (Layers panel)

| Row | Before (visible in the panel) | After (visible) | Behind the "i" |
|---|---|---|---|
| Imagery | "The Moon as photographed: LRO WAC mosaic, with LOLA relief at the poles." + "NASA LRO WAC (Moon Trek) and LOLA" | "Photo mosaic (LRO)" | note + source |
| Elevation | "Colour by height above the 1737.4 km reference sphere, with relief shading." + scale + "Height in km relative to the 1737.4 km reference sphere" + source | "Height colours (LOLA)" + scale + "km, relative to 1737.4 km" | note + source |
| Plain | "Neutral grey with light relief shading, so the overlays stand out." + source | "Grey relief, so the overlays stand out" | note + source |
| Daylight | key + "Day and night on a smooth Moon, and the Earth's shadow during an eclipse, at the moment the sky view shows (the selected scenario). Local terrain shadows are shown in the sky view and in the permanent shadow layer, not by this shading." + "Sun direction: JPL DE421 (this site's physics)" | "Night side (smooth Moon)" | note + source |
| Grid lines | "Latitude and longitude every 30°; near the poles every 10°, with rings at 80°, 85° and 88°." | "Every 30°; every 10° near the poles" | full note |
| Contour lines | key + "Lines of equal height: every 1 km (bold every 5 km); poleward of 80°, every 250 m (bold every 1 km)." + source | "Contours: 1 km; 250 m poleward of 80°" | note + source |
| Permanently shadowed | key + "Ground the Sun never reaches directly, poleward of 80°." + source | "Never in direct sunlight" | note + source |
| Most sunlit | two keys + "Lit: some of the Sun in view, at ground level, averaged over 18.6 years. No ground is lit all the time: the best ridges here are lit 89–93 % of the time." + source | "Lit 70–80 % of the time", "Lit 80 % of the time or more" | note (with "No ground is lit all the time") + source |

The sweep of the rest of the page found little else: the map hint, the chart descriptions and the sky source lines
were already behind "i" helpers; the long texts left on screen are the story captions ("What to look for"), which
are the content, and the far-side insight line.

## Left as is

- S3: The rover story plans its route for about 10 s while the previous story's sky stays on screen, dimmed and
  labelled "Planning the rover route...". Play still works on that old sky; when the route arrives the new story
  starts at T+0, paused (the rule for a new set of scenarios). Not changed this late.
- S3: At 1366 × 768 the calendar opened from a Start field low in the window scrolls inside itself to reach Now /
  Clear / Done.
- No suspected physics issue came up in this round.
