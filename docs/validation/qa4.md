<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# Website QA, round 4 (final regression after the evening merges), 2026-11-15

Tester: the `qa4` agent (branch `shay/qa4`, from `origin/main` at `cfac135`). Goal: find and fix what broke where the
features merged on the last evening meet: the one-flow layout, the map with several pins, "Search the Moon" and Home
(StarHab on the Malapert massif crest), the date picker with suggested dates, the mission-date reset rule, trips with
stops and the drive on the globe, playback with Track and long missions (up to 1 year/s), and the hidden-body markers.

**How.** Playwright with the installed Microsoft Edge (`channel="msedge"`, headless), a fresh browser context (profile)
per run, at 1920 × 1080, 1366 × 768, 768 × 1024 (touch) and 390 × 844 (`is_mobile`, `has_touch`), both themes. Local
build served from `web/` on port 8026 (a threaded server with a large listen queue: `python -m http.server` refuses
connections under the page's ~60 parallel requests and made a DEM tile fetch fail once), and the live site
<https://shmonat.github.io/Moonat-Navigator/> (deploy of `cfac135`; `main.js` and `places.js` byte-identical to the
local build). Each run logged console errors and warnings, page errors, failed requests and HTTP ≥ 400; an init script
counted WebGL contexts (alive and created), `window`/`document` listeners, and layout shifts.

**Kept as decided:** the map first, then the inputs; the quick starts under the scenario box, in the same order and with
the same ids (the video recorder clicks them by position); one ☀ Sun | 🌍 Earth switch for the views and the data; the
opening sky view with the Earth and the horizon (C8); a click on a selected pin removes it.

## What was tested

| Area | Checks | Result |
|---|---|---|
| First visit | 4 viewports × 2 themes, local and live: Apollo 11, the caption, the intro line, the Validated badge, the first sky frame in 1.3–2.8 s | OK |
| Calm page | Layout shifts on the first visit and on story switches | 1366 × 768: 0.09 → 0.001 after F5; tablet left (below) |
| Pins + a trip | Apollo 11, 12, 14 by search; Apollo 12 made a trip (end typed); Apollo 15–17 added: 6 places, 7 pins; a 7th place → "Up to 6 places" toast | OK |
| A trip's pins | Start and end pins select the trip's card (they never remove it, as designed in `map.js`); another pin removes its place, Undo restores it; removing the trip's card clears its route, stop letters and rover dot | OK |
| Trips with stops | A → B → C from Apollo 17 next to Apollo 11: 22.0 km, legs 2.90 + 19.0 km, stop letter B on the globe, Look ahead, play, theme switch (route recoloured), Clear all (route, letters and dot gone), Back (replanned) | OK |
| Home → trip | Home button, "Add place", Trip to the Malapert Massif (5.3 km, 8 h 4 min), play: rover dot moves, live line "1.67 km driven … arrives …"; share link replans in a new profile | OK after F7 |
| Clear all during playback | Rover story playing → remove its card: empty state, timelapse stopped, no route or dot; Back restores it; a story from the empty state | OK |
| Track / Look ahead | Look ahead on the rover, switch story while playing: Look ahead off, not playing, T+0; Track Sun on the eclipse, play through totality; Track carried to the next story follows its body | OK |
| Story switches | 15 switches including the rover twice: WebGL contexts 2 alive / 3 created before and after, no new `window`/`document` listeners, play rate 1.00–1.01 × the speed before and after, JS heap 41 → 53 MB (64 MB with the rover's route grids cached) | OK (no leak) |
| Long missions | StarHab 2027–2032 (5 years): series in about 1 s, play at 1 month/s and 1 year/s at 60 fps, rate 1.01, Track on, "Show me" on the eclipse hint jumps to 17 Aug 2027 (46 %) and stops | OK |
| Suggested dates | Custom pins at 85.5° S 30° E and 26.1° N 3.6° E: the list before and after the Moon Trek terrain arrives, pick one | OK after F3 |
| Mission-date rule | Apollo 11 with a typed latitude: times reset to now, label follows; Clear all keeps "now"; a dropped pin, dragged, clicked (removed), Undo; Back steps | OK |
| Share, Back/Forward, reload | Share for each story after moving the time (reopened in a new profile at 1366 × 768: same caption, views, clock, body, pins, route), five steps back and forward through pins, trips and removals, reload with the hash | identical (Track is not in links, as designed) |
| Races | Leave the rover story 1 s into planning (by a story and by Back): no stale route, dot or caption; a 1426 km trip leg shows its message | OK |
| Hidden bodies | "Sun · 177° right" on Apollo 11 turns the view, the Earth then gets "Earth · 50° up"; far side "Earth · 46° down"; pole "Sun · behind terrain" | OK |
| Phone | Every story tapped: where the page lands, horizontal overflow, the layout viewport watched every frame through stories, the switch, a pin and the calendar sheet | OK after F4 |
| Keyboard | Tab order through the page, focus rings, stories, card remove, Clear all, search by keyboard | OK after F6 |

No console errors, page errors or failed requests in any run, other than Moon Trek and texture requests that a reload
or a superseded request cancels on purpose (`ERR_ABORTED`).

## Findings and fixes

| ID | Sev | What happened | Fix (commit) |
|---|---|---|---|
| F1 | S2 | "Search the Moon": typing "Luna 9" (or "luna", "malapert") and Enter selected StarHab. Home was listed first whenever it matched at all, and its description mentions a "lunar base" on the Malapert massif. | Home leads the list only for an empty query or its own name; a description match lists it last (`9bc4d35`) |
| F2 | S2 | "Search the Moon": "Shackleton" and Enter selected "de Gerlache Rim 2" (the Artemis III group comes before the places of interest, and that region's description mentions Shackleton); "pole" gave Chandrayaan-3. | Enter takes the best name match across the groups (`placeResults().best`): the Shackleton rim, the lunar south pole (`d544d38`) |
| F3 | S2 | The calendar's suggested dates for a custom pin were searched with the approximate horizon and stayed so after the real terrain arrived. At 85.5° S 30° E it offered "Best Earth contact" windows; with the Moon Trek terrain the Earth never clears the skyline there. | The open calendar searches again when the pin's terrain status changes, and says "Approximate horizon until NASA terrain arrives" until then (`09700b2`) |
| F4 | S2 | Phone: "Compare all Apollo landings" after Apollo 11 showed the Sun charts (drawn while their section was hidden) at Plotly's 700 px for about 0.5 s. The page widened to 723 px, so the phone zoomed the whole page out and back, and the scroll to the caption landed with the caption 721 px down the screen. | Chart boxes clip their content (`32e408b`); the viewport stays 390 px wide through every story and the caption lands at the top |
| F5 | S3 | The "Computing…" line appeared above the sky at every compute: adding a catalog place made the results column jump 22 px for a frame (a custom pin: for the whole compute), and on the first visit at 1366 × 768 it narrowed the Apollo 11 caption to two lines and back. | The line shows only after 400 ms, as the dimming does, and not over sky views (their own label says it). `#busy` itself still unhides at once (the demo recorder waits on it) (`305363c`) |
| F6 | S3 | Keyboard: removing a card (or the last one), Clear all, or a story chosen in the empty state dropped the focus to the page. | The focus returns to the same control, the first field of the card taking a removed card's place, or the same story chip; keyboard focus only, so a tap never opens a phone keyboard (`86f6e70`) |
| F7 | S3 | Trip points: the end list from StarHab offered two "Malapert Massif" entries told apart only by distance; the pick banner said "Click" on touch screens. | Artemis III regions say so in the list (`d7918b9`); "Tap" on touch (`d544d38`) |
| F8 | S2 | In a regression run Moon Trek answered one route-terrain request with HTTP 500: the A → B → C trip failed with "A → B: Moon Trek LRO_LOLA_DEM_Global_256ppd_v06: HTTP 500" and no way to try again except editing the trip. A rover story would fail the same way in a demo. | Route grids retry a server error or a dropped connection once (`fetchGrid` option `retries`; a 90 s timeout is not retried); a failure without a planner reason reads "NASA Moon Trek did not send the terrain (HTTP 500)." with **Try again**, which plans the card and the sky again. Checked in Edge with Moon Trek failing once (the trip plans) and always (Try again works once it answers). Pending review by Shahar (data fetching) (`5192cba`) |

Node tests: `web/tests/app_qa4.test.mjs` (search order and best match, the suggestion key and caveat, the Moon Trek
retry). Browser checks of F4–F6 and F8 are in the table above (they need a layout engine or the worker).

After the fixes every scenario script above ran again on the final code (15 scripts, about 40 browser sessions): no
console or page errors; the only failed requests were textures and Plotly cancelled by a reload.

## What remains (not fixed)

- Tablet portrait (768 × 1024): the first paint shifts the sky's placeholder down 92 px at about 0.3 s (layout shift
  0.13), when the scenario card and the story chips render after the catalog loads; before the first sky frame. A fix
  needs reserved heights per breakpoint; left.
- Track stays on when another story is chosen (the button shows it, and it follows the new story's body; the opening
  framing is the same as without it). Look ahead turns off when no trip is shown. Track and Look ahead are not in
  share links. Unchanged.
- A trip's start and end pins select its card instead of removing it (the exception to "a click on a selected pin
  removes it", in `map.js`); the trip is removed with its card's ✕. Unchanged.
- The calendar's heading says "21 h 36 min windows" while the windows read "21 h 40 min" (10-minute sampling).
  Cosmetic, suggest engine; left for Shay.
- Tab from "Search the Moon" skips the globe's Near side / Far side / pole buttons (the open result list hides them);
  Shift+Tab reaches them.
- Not verifiable headless: a real phone GPU and browser zoom behaviour, Safari and Firefox, the browser's full screen.
