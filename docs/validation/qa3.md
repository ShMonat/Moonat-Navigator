<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# Website QA, round 3 (regressions after the merge wave), 2026-11-14

Tester: the `qa3` agent (branch `shay/qa3`, from `origin/main` at `69e7d63`). Goal: find and fix what broke when the 3D
globe, live Moon Trek terrain, the Earth-eclipses-the-Sun story, the rover planner, QA fix rounds A and B and the hosted
video were merged on the same day.

**How.** Playwright with the installed Microsoft Edge (`channel="msedge"`, headless), a fresh browser context (profile)
per run, at 1920 × 1080, 1366 × 768, 768 × 1024 (touch) and 390 × 844 (`is_mobile`, `has_touch`), both themes. Local
build served from `web/` on port 8020, and the live site <https://shmonat.github.io/Moonat-Navigator/> (deploy of
`69e7d63`). Each run logged console errors and warnings, page errors, failed requests and HTTP ≥ 400.

**Kept as decided:** the quick starts stay under the scenario box, in the same order and with the same ids
(`scripts/video/record_demo.py` still clicks them by position); the Sky tab's opening frame (C8); the globe as the map.

## What was tested

| Area | Checks | Result |
|---|---|---|
| First visit | Every viewport and theme: opens on Sky with Apollo 11, the caption, the intro line, the Validated badge, chips under the scenario box | OK |
| Six quick starts | Both tabs, Sun/Earth switch, time since start / UTC / distance (rover) | OK after F2, F4, F5 |
| Captions vs views | Every caption number against the Sky footer, the HUD and the Compare cards (e.g. 59° / 67 % lit; 5–15° and 44–77°; 94 %; −39 to −51°; 81 % and 2 h 17 min; 19.3 km, 40 h, 86 %) | all match |
| Share links | Copy the link, reopen it in a new profile, for all six stories (Sky moment, tab, axis, section, footer) | identical; F7 |
| Back / Forward | Five steps back and five forward across stories and tab switches | all OK |
| Custom globe clicks | Near side, far side and south-pole points, on both tabs: Moon Trek terrain arrives (2–7 s), the card, the Sky footer and the charts follow | OK |
| Builder | Duplicate 1 → 6, Duration mode ("2 d"), remove 6 → empty card, globe click on the empty card, Clear all | OK after F6 |
| Focus / Full screen | All six stories, both themes, Esc; Back while focused | OK (Full screen: the button shows; headless Edge cannot enter it) |
| Stale state | Eclipse with Look at Sun and playing → Apollo 11; rover with a dragged camera and playing → Far side | nothing leaks: T+0, default framing, auto speed, not playing |
| Memory | 10 story switches, garbage collected after each | WebGL contexts stay at 3 (shared sky renderer, globe, one probe); canvases and DOM nodes return; JS heap 49 → 63 MB, bounded caches |
| Resizing | Window resized while each tab or section is hidden | OK after F1, F2 |
| Dialogs, intro | Validated and About open/close (✕, Esc, backdrop), focus returns; intro links run the stories; ✕ hides the intro across reloads | OK after F8 |
| Load hints | `modulepreload` list vs the static module graph (`perf_preload.test.mjs`), console warnings on every link type | OK after F7 |
| Live site | Share round trips, Back/Forward, all quick starts; `video/moonat_demo.mp4` 200 `video/mp4` 8.5 MB; `assets/og.png` 200; `sky-demo.html` 404 | same as the local build before the fixes |

No console errors, page errors or failed requests in any run.

## Findings and fixes

| ID | Sev | What happened | Fix (commit) |
|---|---|---|---|
| F1 | S2 | Phones and tablets (≤ 860 px): the globe's "near side / far side" labels lost their position and piled up as "NEAR SIDEFAR SIDENEAR SIDEFAR SIDE" above the globe. Cause: `app.css` styles the scenario column by the class `.side`, which the globe labels also carry, and on narrow screens `.side` gets `display: contents`. | Rules scoped to `.layout > .side` (`7cdfd51`) |
| F2 | S2 | Phone: the Far side story's Compare tab was 719 px wide at 390 px (the page zooms out and scrolls sideways). Charts first drawn in a hidden section get Plotly's default 700 px width, and `Plotly.react` keeps it; on a desktop the same charts were narrower than their boxes. | Every chart draw ends by fitting the shown section (`a91fc0f`) |
| F3 | S2 | Phone: the "All Apollo" Compare tab was 425 px wide. The "(best)" screen-reader note of the last column escaped the Side by side table's scroll box; the last column was cut off. | The scroll box contains it; below 520 px ranges and headings wrap, so all five columns fit (`32a81cb`) |
| F4 | S2 | Compare charts kept their old width after a window resize or rotation made while the Sky tab was open. | Showing the Compare tab fits the shown charts (`07db3ca`) |
| F5 | S2 | The rover quick start plans its route for 5–10 s. Meanwhile its caption showed above the previous story's results (e.g. the Blue Ghost eclipse sky), and the Sky tab had no progress indicator. | After 400 ms of computing the old results dim and the Sky tab says "Planning the rover route…" (or "Computing…") (`9a984ec`) |
| F6 | S3 | Duplicating a card five times gave "Apollo 11 (copy) (copy) (copy) (copy) (copy)". | "(copy)", "(copy 2)" … from the base name; node test `app_qa3.test.mjs` (`1afba32`) |
| F7 | S3 | A shared rover link logged five "preloaded but not used within a few seconds" warnings (the route is planned before the sky needs the data). | Links with a route prefetch that data instead (`035c2c8`) |
| F8 | S3 | 390 px: the Validated panel's title ran under its ✕ button. | Dialog titles leave room for the button (`c0f836b`) |

The demo recorder is unaffected: it waits for the "Computing…" badge to hide, and the dimming is removed at that moment.

## Notes for the layout redesign (one vertical flow)

F1, F3 and F8 are CSS fixes made before the redesign was announced; the redesign will rewrite `index.html`, `app.css`
and the tab logic, so keep their intent:
- Do not style the page by the bare class `.side` (the globe labels use it too); scope column rules to the layout.
- Plotly charts drawn while hidden (another tab, another section) must be fitted when they appear (`resizeShownCharts`
  in `compare.js`); a redesign that shows the Sun | Earth data under the sky still needs it for the hidden section.
- The busy dimming (`setBusy` in `main.js`, `[data-busy]` in `app.css`) targets `#compare-body` and `#sky-grid`; move
  the attribute if those containers change.
- The Side by side table must wrap or scroll inside its box below 520 px.

Deferred to the redesign (layout and CSS polish, not done here): the sticky Sky time bar covers the top of a sky card
when the page is scrolled; on phones the first sky view starts near the fold (y ≈ 580 of 844) under the intro line and
the caption; the intro's "Try:" list names five stories, not the rover.

## What remains (not fixed)

- The address bar's hash is not rewritten while the slider plays or after "Look at …"; **Share** computes the link fresh
  (verified), but Back returns a story to its opening moment. By design (one history entry per navigation).
- After the last rover traverse is removed by hand, the Compare axis falls back to time since start on screen, but the
  stored choice (and the hash) keeps `x=dist` until the next quick start. Harmless.
- The page opens dark unless the visitor picks light with the theme button (`prefers-color-scheme` is not followed). A
  design choice, unchanged.
- Moon Trek is sometimes slow: in one late run a custom point took 25 s and got the 474 m grid (the 118 m near-field
  grid timed out); the status line said "(474 m)", so it stays honest. External service, no app change.
- Six sky views hold about 140 MB of JS heap (terrain patches); it drops back when the story changes.
- Not verifiable headless: entering the browser's full screen, multi-touch pinch, a real phone GPU, Safari and Firefox.
