<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# Website QA, round 2 (judge's-eye audit), 2026-11-14

Tester: the `qa2` agent (branch `shay/qa2`). This round is **audit only**: no app code was changed. Fix agents work
through the table after the terrain-wiring and rover-planner branches merge.

**What was tested.** The live site <https://shmonat.github.io/Moonat-Navigator/>. Most runs used the deploy of `f3705b5`.
`eb3bc45` (live Moon Trek terrain for custom points) went live during the audit. The custom-point items, the 17-view
test and the wording items were checked again on `eb3bc45`. Each persona used a fresh Edge profile: Playwright with the
installed Microsoft Edge (`channel="msedge"`), headless, with an Intel Iris Xe GPU through ANGLE/D3D11. Viewports were
1920 × 1080, 1366 × 768, 768 × 1024 (tablet) and 390 × 844 (phone, `is_mobile`, `has_touch`), in both themes. Network
runs used a cold cache, then CDP throttling to 5 Mbit/s with 150 ms RTT, then "Fast 3G" (1.44 Mbit/s, 562 ms RTT).

**Personas.** (1) A NASA judge with 3 minutes. (2) A curious 12-year-old. (3) A mission planner who compares candidate
sites, picks custom points and shares links.

**Headline.** Nothing is broken. In about 25 browser sessions (all flows, 4 viewports, both themes, throttled networks)
there were **no console errors, no page errors and no failed requests**. The physics in the UI agrees with JPL Horizons
to the displayed precision, and the HUD, the cards and the charts agree with each other at the same instant. The
findings are about the **first 10 seconds**, the **story** and the **phone**: the app hides its best material.

| Severity | Count | Meaning |
|---|---|---|
| S1 broken | 0 | — |
| S2 confusing or ugly | 16 | A judge or user notices it in normal use |
| S3 polish | 22 | Edge cases, wording, accessibility details |

## Top 10 "biggest wins for judges"

These are improvements, not only bug fixes, ranked by the effect on a 3-minute judging session.

1. **Put the quick starts at the top of the page, on every screen** (Q01, Q14). Today they are below the fold
   everywhere: at y = 1099 px on a 1080 px screen (the globe pushes them down when it loads, 2 to 3 s in), at y = 1006 px at 1366 × 768, and 3.4 screens down on a phone.
2. **Open on the wow** (Q02, Q03). On a first visit (no hash), open the Sky tab for Apollo 11, or put a sky hero above
   the charts. Add one line of context: "You are at Tranquility Base, 20 July 1969, 20:17 UTC. Try a quick start or
   click the Moon." Today a judge first sees a slowly rising line chart.
3. **A visible "Validated" badge with real numbers** (Q04). Sun and Earth directions within 0.055″ of JPL Horizons
   (399 comparisons). South-pole illumination 92.7 % against 92.5 % published (Gläser et al. 2014). Eclipse contacts within
   2.6 s of NASA. Link each number to `docs/validation/*.md` on GitHub, and link the source code. Today there is one
   footer line below the fold.
4. **The eclipse quick start should open on the Sky tab at 81 % cover or at totality** (Q05, Q06, Q36). The red ring of
   Earth's atmosphere around a black Earth is the best image in the app (`qa2_eclipse_partial.png`). Today the quick start
   opens 30 min before the eclipse starts, often on the Compare tab, and the card says "No sunset during the stay".
5. **One "what to look for" line for each quick start, and the best tab for its story** (Q05, Q07). The story is now
   only in hover tooltips, which a touch screen never shows.
6. **A social-share preview** (Q34): `og:title`, `og:description`, `og:image` (1200 × 630, e.g. the enlarged LOLA south-pole
   globe or an eclipse frame) and an `apple-touch-icon`. The Space Apps project page and every shared link would then
   show a picture.
7. **Answer "Which Apollo crew had the best view?"** (Q07, Q08). Today all six cards say 100 % sunlight, no sunset and
   Earth always up. Add a small ranked table at landing: Sun elevation, Earth elevation and Earth phase. Also give Apollo 14 and 17 different colours (both are green now).
8. **Share links that reopen the same moment and view, and a working Back button** (Q09, Q10). Today a shared Sky link
   opens at T+0, and Back leaves the site.
9. **Phone polish** (Q12, Q13, Q14). Remove the scroll traps on the globe and the sky views, keep the Earth out from under
   the HUD buttons, and show the story first.
10. **A lighter first load** (Q15). Start the globe with the 148 kB texture, and load the 2.65 MB mosaic and the
    1.36 MB polar caps later. At 5 Mbit/s the first chart now takes 9.4 s; at Fast 3G it takes 29.7 s.

Also worth doing, for the 12-year-old: plain words in the HUD ("height", "direction" for el/az), constellation names, and
glossary entries for T+, "×6" and exposure (Q21, Q22).

## Findings

Screenshots are in `docs/figures/` (PNG, provenance in the text chunks). Domain tags follow `docs/TEAM.md`: **UI (both)**
changes need both humans, **Shay** = physics or physics wording, **Shahar** = performance, deployment, data.

| ID | Sev | Area | Steps to reproduce | Expected vs actual | Screenshot | Suggested fix |
|---|---|---|---|---|---|---|
| Q01 | S2 | Landing · UI (both) | Fresh profile, open the site at 1920 × 1080, 1366 × 768, 768 × 1024 or 390 × 844. | Expected: the five quick starts visible without scrolling. Actual: the first chip is at y = 1099 px (1920 × 1080, after the globe loads), 1006 px (1366 × 768), 2826 px (tablet) and 2875 px (phone). The globe loads after the first results (layout shifts at 0.7 to 3.2 s; later on slow networks) and pushes the scenario card and the chips down: CLS 0.12 at 1920 and 0.21 at 1366 (good is < 0.1). | `qa2_first_1920.png` | `web/index.html`: move `.qs-block` above `#map-block`, or add a chip row under the top bar. `web/css/app.css`: reserve the map block's height (e.g. `aspect-ratio` on `.map`) before `initMap()` so nothing shifts. |
| Q02 | S2 | Landing · UI (both) | Fresh profile, open the site. | Expected: the first screen shows the sky (the "wow" in VISION §3). Actual: the Compare tab with a Sun-elevation line from 10.7° to 21.7°. Nothing points to the Sky tab. | `qa2_first_1920.png` | `web/js/app/main.js` `boot()`: on a first visit (no hash), call `showTab("sky")`. Or add a "See this sky →" button in the first metric card. Shared links keep their own tab. |
| Q03 | S2 | Landing · UI (both) | Fresh profile on a phone; also on desktop. | Expected: a one-line explanation of what this is and what to do. Actual: on desktop there is only the tagline. On the phone the tagline is hidden, so the first screen is "Moonat", Sun/Earth switches and a chart for "Apollo 11", with no place or time context (the scenario card is 1800 px down). | `qa2_first_phone.png` | Dismissible two-line intro under the top bar (store "seen" in `localStorage`, wrapped in try/catch). Keep a short tagline on phones. |
| Q04 | S2 | Validation · content (Shay) | Look for evidence of accuracy without reading the repo. | Expected: numbers and sources a judge can check. Actual: the footer says "validated against JPL Horizons" (below the fold). About says "better than one arcsecond" and gives no numbers. Nothing mentions the LOLA illumination check or the NASA eclipse times. The app has no link to the source code or to `docs/validation/`. | — | A "Validated ✓" chip in the top bar that opens a small panel: Horizons 0.055″ worst of 399 comparisons (`ephem.md`), Gläser et al. 2014 92.7 % against 92.5 % (`terrain.md`), NASA eclipse contacts ≤ 2.6 s (`eclipse.md`). Each line links to GitHub. Add a "Source code" link in the footer and in About. |
| Q05 | S2 | Quick start: eclipse · UI (both) | Compare tab → "Eclipse from the Moon". | Expected: the eclipse. Actual: the quick start keeps the current tab (Compare). On Sky it opens at T+0 = 04:30 UTC, 30 min before the Earth starts to cover the Sun. You must scrub to about T+1 h 28 min (81 % covered) or T+2 h 55 min (total, red ring). | `qa2_eclipse_t0.png`, `qa2_eclipse_partial.png` | `web/js/app/catalog.js` `QUICK_STARTS`: optional `tab`, `offsetMs`, `xaxis`, `look`. `main.js` applies them. `sky_tab.js` exports `setOffset(ms)`. Eclipse: Sky tab, 05:57 UTC or 07:25 UTC, "Look at Sun". Apply `tab` to the other quick starts too (Apollo 11 → Sky, Apollo-all → Compare). |
| Q06 | S2 | Compare: eclipse · physics presentation (Shay) | Eclipse quick start, Compare tab, Sun. | Expected: the card names the eclipse. Actual: "62 % of the stay with sunlight" with no reason, then "**No sunset** during the stay". In "Visible Sun" the solid line stays at 100 % during totality, and only the dashed line drops to 0. | `qa2_eclipse_compare.png` | `web/js/app/compare.js` event line: "Eclipse: the Earth covers the Sun 05:01–09:51 UTC, total 06:17–08:34 (2 h 17 min)". Visible Sun: solid = what reaches the panel (terrain × eclipse), dashed = terrain only. Alternatively, rename the legend. |
| Q07 | S2 | Quick start: Apollo · UI (both) | "Compare all Apollo landings". The tooltip asks "Which Apollo crew had the best view of Earth and the most sunlight?" | Expected: an answer. Actual: all six Sun cards say 100 %, "No sunset during the stay". All six Earth cards say 100 % in view and "Earth stays in view the whole stay". The differences (Sun 5.1° to 14.8° at landing, Earth 44° to 77° up, phase 12 % to 70 %) are buried in the ranges. | `qa2_apollo6_compare.png` | When all scenarios tie on the headline metric, show a compact table "at landing" (Sun el, Earth el, Earth phase, stay length) sorted by the most interesting column, plus one generated sentence. `compare.js`. |
| Q08 | S2 | Charts · UI (both) | "Compare all Apollo landings", Sun elevation chart. | Expected: six distinct lines. Actual: Apollo 14 (`#199e70`) and Apollo 17 (`#0ca30c`) are both green. The Apollo 11 blue line and the Apollo 14 teal line overlap for the first 20 h. | `qa2_apollo6_compare.png` | `web/js/app/state.js` `PALETTE` is documented as a validated colour-blind-safe order. Reorder it so that the first six slots hold only one green (e.g. swap slot 6 `#0ca30c` with slot 7 `#9085e9`), and run the colour-vision check again in both themes. |
| Q09 | S2 | Navigation · UI (both) | Fresh tab: open the site, click "Apollo 11", then "Far side", then press Back. | Expected: back to the previous scenarios. Actual: Back leaves the app (to `about:blank` in a fresh tab, or to the referring page, e.g. the Space Apps project page). | — | `main.js` `writeHash()`: `history.pushState` for "structure" changes (quick start, add/remove scenario) and tab changes; keep `replaceState` for field edits. The existing `hashchange` handler already restores the state; add `popstate`. |
| Q10 | S2 | Share · UI (both) | Sky tab, scrub to T+5 d 14 h, "Look at Sun", Share. Open the link in a new profile. | Expected: same moment and same view. Actual: scenarios, tab, x-axis and Sun/Earth switch come back, but the sky opens at T+0 with the default framing (QA1 open item 5). | — | Add `t=<offset ms>` and `look=earth|sun|az,el` to `encodeHash`/`decodeHash` (`state.js`). `sky_tab.js` applies them after the first build. |
| Q11 | S2 | Sky: Focus · UI (both) | Apollo 11, Sky, "Focus" at 1920 × 1080. | Expected: the view fills the window. Actual: the view is pillarboxed to about 1000 px wide, with black bars on both sides. The Earth is a dot at the top and 60 % of the frame is empty sky. | `qa2_focus_pillarbox.png` | `sky_tab.js` `setViewFocus()`: use tall frames only when the window is portrait. In landscape, keep the full width and fit horizon and Earth with a larger vertical field of view (C8 framing). |
| Q12 | S2 | Phone: Sky · UI (both) | 390 × 844, Sky tab, Apollo 11. | Expected: the Earth is visible. Actual: the Earth disk is under the "Close-up" button; only the label "Earth" shows (QA1 open item 2). | `qa2_phone_sky.png` | In views narrower than 560 px, move the HUD buttons to the bottom-right or into one "⋯" menu, or make the framing's top margin as tall as the button bar (`web/js/sky/hud.js`, `math.js` framing). |
| Q13 | S2 | Phone: scrolling · UI (both) | 390 × 844 with touch. Swipe up over the globe (364 × 423 px), and over a sky view. Control: swipe over a metric card. | Expected: the page scrolls, as it does over the metric card (0 → 437 px). Actual: over the globe (also its corners outside the disk) and over the sky views the page does not move. With six Apollo views on the Sky tab, the page scrolls only from the card headers and footers. | — | `touch-action: pan-y` on the globe stage and the sky view containers. One-finger vertical swipes then scroll the page; horizontal drags turn the view; two fingers zoom and turn. Alternative: a "Tap to explore" activation overlay. `web/js/globe/globe.js`, `web/js/app/gestures.js`, `web/js/sky/`. |
| Q14 | S2 | Phone/tablet layout · UI (both) | 390 × 844 and 768 × 1024, first visit. | Expected: the story first, then the controls. Actual: results (y = 299), then the globe (y = 1829), then the scenario card, then the quick starts (y = 2875 of 3173). A phone visitor never sees the quick starts unless they scroll to the end. | `qa2_first_phone.png` | Below 900 px: a compact scenario summary ("Apollo 11 · 20 Jul 1969 · edit") and the quick-start chips above the results. The globe and the full editor go into an "Edit place and time" section (CSS `order` in the layout grid, `app.css`). |
| Q15 | S2 | Performance (Shahar) | Cold cache at 5 Mbit/150 ms and at Fast 3G; measure first metric and first chart. | Expected: the first chart in a few seconds on venue Wi-Fi. Actual: at 5 Mbit the first metric appears at 3.4 s, the globe at 5.0 s and the **first chart at 9.4 s**. At Fast 3G: first metric 10.1 s, globe 16.2 s, **first chart 29.7 s**. One visit transfers 6.9 MB: `wac_global.jpg` 2.65 MB, Plotly 0.97 MB, `cap_south_inner.jpg` 0.72 MB, `cap_south.jpg` and `cap_north.jpg` 0.32 MB each. The map images compete with Plotly for bandwidth. | — | `web/js/globe/globe.js`: start with `wac_global_1k.jpg` (148 kB). Load the 2.65 MB mosaic and the polar caps on zoom > 2 or on a polar preset, or after the first chart. Add `<link rel="preload" as="script">` for Plotly, and `fetchpriority="low"` on the map images. |
| Q16 | S2 | Sky wording · physics (Shay) | Custom point 7.4° N 170.0° W, 1969-07-20 20:17:40 UTC (Sun +3.0°, behind a ridge). Also 89.5° S 0° E, 2026-11-14 12:00 UTC (Sun +1.3°). | Expected: "behind terrain" for a body above the flat horizon but hidden by the skyline. About itself says "A positive value does not guarantee a view". Actual: HUD "Sun el 3.0° … **below the horizon**", plus the note "Night: the Sun is below the horizon, so the ground is dark". | `qa2_far_terrain_wording.png` | `web/js/sky/hud.js:114` and `:96`, `web/js/sky/index.js:235` and `:238`: say "behind terrain" when `el + r > 0`, and "below the horizon" otherwise (as `index.js:262` already does for the Earth loupe). For the note: "Night: hills hide the Sun". |
| Q17 | S3 | Compare: single instant | Apollo 11 coordinates, start 2040-12-31 20:00, no end. | Expected: an honest look-ahead. Actual: "**Sun does not rise in the next 0 days**" (the look-ahead window is cut by the end of the tables). | `qa2_lookahead_0_days.png` | `compare.js` look-ahead text: when the window is under 1 day or was cut by coverage, say "No sunrise before 31 Dec 2040 (end of the data)". |
| Q18 | S3 | Compare: charts | Custom point 80.8° S 126.0° E (Sun hidden all stay). | Expected: a power axis in W/m² that reads as zero. Actual: the "Sunlight power" y-axis runs 0 to 1 (W/m²), so a flat line looks like data. | `qa2_custom_point_dark.png` | `compare.js`: fixed y-range `[0, max(1400, data)]` for power and `[0, 100]` for the % charts. |
| Q19 | S3 | Sky: far side | Far side (Chang'e 4), or any far-side custom point, Sky tab. | Expected: a clear "Earth is under your feet" message. Actual: the Earth close-up inset magnifies a patch of ground with a small arrow. The footer says "Earth hidden (−70.7° ENE)" while the HUD says "below the horizon". | `qa2_far_terrain_wording.png` | `web/js/sky/index.js` loupe: below about −5°, show a text badge instead of the magnifier ("Earth is 71° below the horizon: this is the far side"). Footer (`sky_tab.js`): "below the horizon" for el < 0, "behind terrain" for el > 0. |
| Q20 | S3 | Compare: captions | Far side (Chang'e 4) → Earth. | Expected: captions that fit the scenario. Actual: the Earth elevation chart says "From the near side, Earth barely moves." for a far-side site (and for polar sites, where it moves by about 7°). | — | `compare.js`: choose the caption from the scenario (near side, far side, polar). |
| Q21 | S3 | Plain language · UI (both) | Use the app as a 12-year-old. | Expected: words a child can follow. Actual: the HUD shows "el", "az", "T+0 min", "Exposure: eye", "Earth ×6", "approximate"; the charts say "Mission elapsed time"; "LOLA" appears everywhere. The explanations are in About and in hover tooltips, which touch screens never show. Libration is only mentioned in passing. | — | HUD: "height 10.7°, direction 89° (E)"; "6× zoom". Add a tap-able "?" next to the HUD. Add About glossary entries for T+, close-up zoom, exposure, LOLA and libration. |
| Q22 | S3 | Sky: stars | Any Sky view. | Expected: constellations that teach something. Actual: constellation lines are on by default but have no names, so they add clutter. | `qa2_eclipse_partial.png` | Label the constellation names at their centroid (`web/js/sky/sky.js`; names may need adding to `data/stars/constellations.json`, with a REFERENCES entry), or turn the lines off by default in "eye" exposure. |
| Q23 | S3 | Sky: grid framing | "Compare all Apollo landings", Sky tab, 1920 × 1080. | Expected: ground and sky in every view. Actual: Apollo 16 shows no ground ("Looking up: drag down to see the ground", Earth at 77°). In all six views the Earth is a few pixels; only the insets show it. | `qa2_apollo6_sky.png` | Grid views: frame from the horizon to the Earth with a taller vertical field of view, or keep the horizon in the lower third and rely on the inset for a high Earth (C8 framing). |
| Q24 | S3 | Sky: notes | 17 scenarios on the Sky tab (night-side points). | Expected: one short note. Actual: up to three notes ("Night: the Sun is below the horizon…", "Earth is below the horizon", the inset caption) stack in the bottom-right and overlap. | `qa2_grid_notes.png` | `web/js/sky/index.js`: merge them into one line; in views under 560 px move it to the card footer. |
| Q25 | S3 | Picker | Search "Malapert", then "Shackleton". | Expected: one entry per place, or clearly different names. Actual: two "Malapert Massif" entries (Artemis III region and POI). "Shackleton" lists "de Gerlache Rim 2" and "de Gerlache rim". | — | `web/data/sites.json` names or picker meta: e.g. "Malapert Massif (Artemis III region)" and "Malapert Massif summit". (Data: Shahar) |
| Q26 | S3 | Builder | Make a custom point, then type exactly 0.6741, 23.473 (Apollo 11). | Expected: it becomes "Apollo 11" again, with the precomputed LOLA horizon. Actual: "Point 0.7° N, 23.5° E · Real terrain: NASA LOLA via Moon Trek (118 m)". The catalog site is not found again. | — | `scenarios_ui.js`: after a coordinate edit, match catalog sites within 1e-4° and restore `site_id` and the label. |
| Q27 | S3 | Builder: dates | Type "1969/07/20 20:17" or "20 July 1969" as the start. | Expected: accepted, or a hint that shows the format. Actual: "That start time is not a valid date." ISO forms with "T…Z" and "1969-7-20" do work. | — | `state.js` `parseUtc`: accept "/" separators and English month names. The message should show "YYYY-MM-DD hh:mm". |
| Q28 | S3 | Builder: messages | Latitude 95 and start "1980-06-01". | Expected: both problems listed. Actual: only the latitude message (both fields are marked invalid). | — | `scenarios_ui.js` `refreshCard`: join all error messages. |
| Q29 | S3 | Share | Open `…/#tab=sky` (no scenarios). | Expected: Apollo 11 on the Sky tab. Actual: the Compare tab. | — | `state.js` `decodeHash`: return `tab` even without `s`; `boot()` applies it. |
| Q30 | S3 | Compare layout | "Compare all Apollo landings" at 1920 × 1080 (also at 1366 × 768). | Expected: 6 in a row or 3 + 3 (QA1 #16). Actual: 5 + 1 at 1920 and 4 + 2 at 1366, now that the side column holds the globe. | `qa2_apollo6_compare.png` | `app.css` `.metric-cards`: grid columns from the scenario count (`repeat(min(n, 6), 1fr)`, or 3 + 3 for n = 6). |
| Q31 | S3 | Accessibility: contrast | Light theme, Compare tab. | Expected: ≥ 4.5:1 for small text. Actual: the active "☀ Sun" switch is orange on white at 3.1:1. The muted 12 px text (section labels "Scenarios"/"Quick start", the footer, the map hint) is 4.34:1. The dark theme passes everywhere. | — | `app.css` light-theme tokens: a darker sun/orange text colour and a slightly darker muted colour. |
| Q32 | S3 | Sky: HUD typography | Eclipse, T+1 h 28 min. | Expected: one style. Actual: "81 % covered" (with a space) next to "0% lit" (without). The Sun at 258.9° is "W" and the Earth at 258.6° is "WSW", 0.3° apart. | `qa2_eclipse_partial.png` | `hud.js`: no space before %. Optionally use the same compass label for both bodies when they are within 1°. |
| Q33 | S3 | Accessibility: keyboard | Tab through the page; try to look around a sky view by keyboard. | Expected: every control can be used by keyboard. Actual: focus rings are visible and the order is logical. But a sky view cannot be focused or turned by keyboard and has no text alternative. The open picker list (`ul.picker-list`) is an extra Tab stop. | — | Sky view container: `tabindex="0"`, arrow keys to pan, +/− to zoom, and an `aria-label` summary ("Sky from Apollo 11: Sun 10.7° up in the east, Earth 59° up in the west"). `tabindex="-1"` on the picker list. |
| Q34 | S3 | Sharing preview | Paste the site URL into Slack, WhatsApp or LinkedIn. | Expected: a title, a line and a picture. Actual: no `og:*` or `twitter:*` tags. The only icon is an SVG data URI: no PNG, no `apple-touch-icon`. | — | `web/index.html`: `og:title`, `og:description`, `og:image` (absolute URL, 1200 × 630 PNG, e.g. a render of the enlarged globe or the eclipse), `twitter:card=summary_large_image`, and `apple-touch-icon` 180 × 180. Add the image to REFERENCES with its sources. |
| Q35 | S3 | Deployment (Shahar) | Open `…/sky-demo.html`; look at the GitHub repo page. | Expected: only the app is public; the repo is easy to find. Actual: the dev page `sky-demo.html` is live. The repo has no topics. | — | `.github/workflows/pages.yml`: leave `sky-demo.html` out of the artifact (or delete the file). Add topics (`nasa-space-apps`, `moon`, `lola`, `ephemeris`). |
| Q36 | S3 | Quick start: eclipse | Eclipse, Compare tab. | Expected: UTC on the x-axis, since NASA gives the contact times in UTC. Actual: "Mission elapsed time" (hours since 04:30). | `qa2_eclipse_compare.png` | Per-quick-start `xaxis: "utc"` (see Q05). |
| Q37 | S3 | Builder: empty state | "Clear all", then click the globe. | Expected: results for the clicked point. Actual: the card has no start time, so nothing is computed until a time is typed. The empty state says "A quick start is the fastest way in" but shows no chips. | — | Keep the previous start time on "Clear all" (or default to a sensible date). Render the quick-start chips inside `#compare-empty` and `#sky-empty`. |
| Q38 | S3 | Docs | Compare `docs/validation/qa.md` § "South-pole quick start (changed)" with the live quick start. | Expected: the same window. Actual: `qa.md` says 2027-02-05 → 03-06 (30 d). The live quick start is 2027-01-19 → 03-22 (62 d, "two lunar months"), with 94 % sunlit and sunset on day 30. | — | Update the note in `qa.md`, or mark it superseded by this file. (The video caption in `docs/submission/` is out of this audit's scope.) |

## Fix status, part B: sky view, Compare tab, phone, accessibility

Branch `shay/qa2-fix-b`, 2026-11-14 (part A is at the end of this file). Checked with Playwright and the installed Edge (headless) at 1920 × 1080,
1366 × 768 and 390 × 844 (`is_mobile`, `has_touch`, touch via CDP `Input.dispatchTouchEvent`), both themes, with the
quick starts Apollo-all, eclipse, far side, south pole and the rover traverse. No console or page errors.
Before/after screenshots: `docs/figures/qa2fix_*.png`. **Shay** marks the wording and physics-presentation decisions to review.

| ID | Status | What changed (files) | Screenshots |
|---|---|---|---|
| Q06 | fixed; flux-weighted Visible Sun chart approved by Shay (2026-11-14) | Sun card footer names the eclipse: "Earth eclipses the Sun: total for 2 h 17 min (06:17–08:34 UTC), partly covered 05:00–09:51 UTC"; the terrain sunset or sunrise follows only if one happens. **Visible Sun** solid line = C6 `flux_frac` (share of the Sun's light reaching the site: limb-darkened, terrain and Earth); dashed = terrain only (`vis_frac`), with a legend key. Documented in `eclipse.md` § In the app. **Shay**: the solid line is now flux-weighted, so outside eclipses it differs from the old area line only while terrain cuts the disk. (`compare.js`, `compare_text.js`) | `qa2fix_eclipse_compare_before/after.png` |
| Q16 | fixed; wording "below the horizon" / "hidden behind terrain" approved by Shay (2026-11-14) | One wording rule (`web/js/sky/words.js`) for the HUD, the HUD notes, the close-up captions and the Sky card footers. **Shay**: "below the horizon" only when the whole disk is below the local horizontal plane (el + r < 0); a hidden body with any of its disk above that plane is "hidden behind terrain (skyline +x°)"; a body below the plane but above a lower skyline (seen from a peak) is visible and gets no wording. Night note: "Night: the Sun is below the horizon" or "In shadow: terrain hides the Sun". Compare cards already said "height above the flat horizon" and "% of the disk clears the real terrain", so they agree. C8 text updated. | `qa2fix_terrain_wording_after.png` |
| Q19 | fixed; far-side 105° threshold approved by Shay (2026-11-14) | An Earth more than 5° below the horizontal plane gets a text message instead of a close-up of the ground. **Shay**: "Earth is below your feet … It never rises here: this is the Moon's far side" when the site is more than 105° from the mean sub-Earth point (libration ≤ 10.4°, Earth radius ≤ 1.03°, parallax ≤ 0.28° give 101.7°, plus 3° for a skyline below the horizontal); otherwise "Earth is N° below the horizon". The footer says "Earth below your feet: height −48.6°, S (181°) · it never rises here". | `qa2fix_farside_sky_before/after.png` |
| Q20 | fixed, wording pending Shay | The Earth elevation caption depends on the sites: near side ("stays in about the same spot: libration rocks it by up to about 8° over a month"), poles and limb (d = 75–105° from the sub-Earth point: "skims the horizon … hills can hide it"), far side ("never rises"), or a short mix. **Shay** to check the wording. | — |
| Q07 | fixed | "Side by side" table for 2+ scenarios: sunlight (% of the time, eclipse = dark), Sun height, Earth height and Earth phase ranges; sorted best first (the column headers sort; ties fall back to sunlight, Sun height, phase, Earth height); best value per column highlighted, none when all tie; one sentence ("All 6 have sunlight the whole time. Highest Sun: Apollo 16 (15° to 50°). Highest Earth: Apollo 16 (73° to 77°). Fullest Earth: Apollo 11 (58% to 67% lit)."). "Best" is the highest mean over the stay. | `qa2fix_apollo6_compare_before/after.png` |
| Q08 | fixed | Six scenario colours: Paul Tol's "bright" hues stepped per theme, checked with the dataviz validator on **all pairs** (lines overlap): CVD ΔE ≥ 8.5, normal vision ≥ 16, contrast ≥ 3:1, lightness band, in both themes. A 7th scenario wraps and gets dashes. Apollo 14 green, 17 purple. (`state.js` `PALETTE` only, REFERENCES) | same |
| Q30 | fixed | Metric cards by count: 6 in a row (section ≥ 1340 px) or 3 + 3; 5 in a row or 3 + 2; 4 or 2 + 2; never a lone card. (`app.css`) | same |
| Q11 | fixed | Views keep the full width whenever the C8 body rule fits the horizon and the Earth with its margins; only a higher Earth gets a centred frame as wide as the rule allows at 100° (`bodyFitAspect`), so Apollo 11 in a 1920 × 1080 focus fills ~1570 of 1900 px (was ~1000). The side bands show the same view stretched, blurred and dimmed (sky and ground continue). C8 opening rule kept: Earth and horizon in frame. | `qa2fix_focus_1920_before/after.png` |
| Q23 | fixed | Tall frames are on in every view, so the six-site grid shows ground and sky in each (Apollo 16, Earth 77°, had none); the close-up still shows the small Earth. | `qa2fix_apollo6_sky_before/after.png` |
| Q12 | fixed | Views under 560 px: the HUD buttons move to the bottom left as glyphs (◎ close-up, ✦ constellations; the words stay as accessible names), clear of the Earth. | `qa2fix_phone_sky_before/after.png` |
| Q13 | fixed | `touch-action: pan-y` on the sky views and the globe, plus an axis lock on the first 10 px (`gestures.js` `bindAxisLock`): a vertical swipe scrolls the page (146–177 px in the CDP test, and never becomes a tap on the globe), a horizontal drag turns the view, two fingers pinch (tested). Focus mode and the enlarged globe keep every gesture. | — |
| Q14 | fixed | Phones and tablets (≤ 860 px): results first, then the scenario cards with the quick starts directly under them, then the globe. | `qa2fix_phone_order_after.png` |
| Q17 | fixed | A look-ahead cut by the end of the tables says "No sunrise before 31 Dec 2040 (end of the data)" / "stays up at least until …". | — |
| Q18 | fixed | Sunlight power axis from 0 to at least 1400 W/m² (Sun-facing) or 100 W/m² (flat). | — |
| Q21 | fixed in part | HUD "height 59.2° direction W 272.2°", footers "height 59.2°, W (272°)", close-ups "Earth, 6× zoom", Sky clock "5 d 14 h after start" (T+ in the tooltip), cards "height above the flat horizon (elevation)"; About glossary: height and direction, T+, close-up zoom, exposure, LOLA, libration. The Compare time toggle reads "Time since start" (tooltip: mission elapsed time). Not done: a tap-able "?" in the HUD (the plain words and the glossary cover it). | — |
| Q22 | fixed | Names of 18 well-known constellations (Orion, Big Dipper, Southern Cross, Scorpius …) at the centre of their lines, faint, while the lines are on; left out in views under 360 px, below the skyline, near frame edges or over buttons and close-ups. | `qa2fix_kbd_focus_after.png` |
| Q24 | fixed | One note line (the two most useful: looking up, total eclipse, Sun hidden, Earth hidden, smooth terrain); under 560 px it moves to the card footer (C8 extra `onNotes`), without repeating the Sun and Earth lines. | — |
| Q31 | fixed | Light theme: `--muted` #68665f (5.2:1 on the page, 4.7:1 on --surface-3); new `--sun-ink` #946200 (5.2:1) for the active "☀ Sun" switch text. | — |
| Q32 | fixed | "81% covered" (no space) in the HUD and the close-up; two bodies within 1° of azimuth share one compass word (Sun 258.9° and Earth 258.6° are both W). | — |
| Q33 | fixed | A sky view takes keyboard focus with a visible ring; arrow keys turn it (1/12 of the field per press), + and − zoom, the page does not scroll; `aria-label` "Sky from Apollo 11 at …: Sun: height 10.7°, E (89°). Earth: …". The picker list is no longer a Tab stop (`tabindex="-1"`). | `qa2fix_kbd_focus_after.png` |

## What works well (keep it)

- **Stability:** no console errors, page errors or failed requests in any flow, at any size, in either theme, or on
  throttled networks. 17 scenarios on the Sky tab (17 WebGL views plus the globe) still render.
- **Physics in the UI** (see the checks below): it agrees with JPL Horizons to the display precision, and the HUD, the cards and the charts agree with each other.
- **The eclipse** (close-up insets of the Sun and the Earth, the red ring at totality, the shaded eclipse bands in the
  charts) and the **enlarged LOLA globe** (`qa2_globe_enlarged.png`) are the strongest visuals. Use them in the hero,
  `og:image` and video.
- **Input validation:** coverage messages (1980 and 2045 are refused with "1966–1976 and 2013–2040"; 1966-01-01 and
  2040-12-31 are accepted), "end before start", the 120-day limit, and a forgiving duration parser ("1 d 6 h", "2,5 d",
  "90 min"; "0", "-5" and "abc" are refused). Longitude 200 becomes −160. A label with HTML in it shows as text.
- **Custom points (`eb3bc45`):** "Loading NASA terrain…" turns into "Real terrain: NASA LOLA via Moon Trek (30 m)" after 2 to 3 s
  (8 s at 5 Mbit). Fast repeated edits start no extra requests.
- **Accessibility basics:** every control has a name, focus rings are visible, About moves focus into the dialog and
  back to its button, the tabs work with the arrow keys, there is a reduced-motion style, `lang="en"`, and no page
  scrolls sideways at any width.
- **Single-instant mode** is clear ("Single instant", the slider is disabled, the cards say "sets in / rises in").

## Measurements

### Physics spot checks (UI against JPL Horizons fixtures in `tests/fixtures/horizons/`)
| Case | Horizons | Moonat UI (HUD and card) |
|---|---|---|
| Chang'e 4 site (45.44° S, 177.59° E), 2026-11-14 12:00 UTC, Earth | az 180.732°, el −48.597°, 76.95 % lit | az 180.7°, el −48.6°, 77 % lit |
| 89.5° S 0° E, 2030-06-01 00:00 UTC, Sun | az 182.241°, el −0.677° | az 182.2°, el −0.7° |
| 89.5° S 0° E, 2026-11-14 12:00 UTC, Sun | az 120.534°, el 1.303° | az 120.5°, el 1.3° |

### Consistency between panels (same instant)
| Case | Compare chart | Sky HUD |
|---|---|---|
| Apollo 11, T+8 h (1969-07-21 04:17 UTC) | Sun el 14.78°, Earth el 59.07°, phase 63.96 % | 14.8°, 59.1°, 64 % lit |
| Apollo 11 at landing | card "10.7° to 21.7°", Earth "58 % to 67 %" | 10.7°, 67 % lit |
| Eclipse, 14 Mar 2025 (site in the penumbra from 05:00:42, total 06:17:25–08:34:23, out at 09:51:11) | card "62 % of the stay with sunlight" (totality 2 h 17 min of 5 h 50 min → 61 %); average 547 W/m² = 40 % of the uneclipsed 1,370 W/m² (flux-weighted expectation about 39 %) | 05:57:30 → 81 % covered; 07:25:00 → 100 %, red ring; 09:27:30 → 24 % |

### Load time (Edge, cold cache, 1366 × 768; seconds from navigation)
| Network | First scenario card | First metric | Globe | First chart | Sky ready after click | Transfer |
|---|---|---|---|---|---|---|
| Unthrottled | 0.7 | 1.1 | 1.6 | 1.6 | 3.4 | 6.9 MB, 51 requests (5.6 MB from Pages, 1.2 MB from jsDelivr) |
| 5 Mbit/s, 150 ms | 1.9 | 3.4 | 5.0 | 9.4 | 5.9 | 6.9 MB |
| Fast 3G (1.44 Mbit/s, 562 ms) | 5.3 | 10.1 | 16.2 | 29.7 | 16.6 | 6.9 MB |

LCP 0.4–0.75 s (unthrottled). CLS 0.12 (1920 × 1080) and 0.21 (1366 × 768): see Q01.

### Frame rate in the sky view (Intel Iris Xe, headless Edge, ANGLE/D3D11; requestAnimationFrame count)
| Case | Idle | Timelapse playing (worst frame) |
|---|---|---|
| 1 view (Apollo 11) | 60.5 fps | 60.1 fps (17 ms) |
| 1 view in Focus mode | 60.2 fps | 60.1 fps (17 ms) |
| 6 views (all Apollo) | 60.4 fps | 26.3 fps (67 ms); QA1 measured 16–17 |
| 10 views | — | 19.2 fps (67 ms) |

## Coverage

- Quick starts: all five (Apollo 11, all Apollo, South pole ridge, Far side, Eclipse), on both tabs and with the Sun/Earth switch.
- Builder: picker search and keyboard, coordinates, map click (south pole, far side, enlarged map), + Add location,
  + Add time, duplicate, remove, "Clear all", End time and Duration modes, invalid inputs, coverage limits.
- Sky: play, pause, speed, scrub, Look at Earth/Sun, Exposure, Close-up, Constellations, Focus, Esc, wheel (page scrolls
  and Ctrl + wheel zooms), drag.
- Globe: Near side, Far side, North pole and South pole presets; enlarge and Esc; zoom buttons, wheel and keyboard.
- Share round trip in a new profile, reload with a hash, Back and Forward, a malformed hash, light and dark themes, About.
- **Not verified:** the Fullscreen API (headless Edge refuses full screen; Focus mode was verified), two-finger pinch
  (no multi-touch synthesis), a real phone GPU, and Safari or Firefox.

## Notes for the fix agents

- The two branches in flight (terrain wiring, rover planner) touch `web/`. Rebase before you fix anything in
  `sky_tab.js`, `main.js` or `scenarios_ui.js`.
- Items tagged **UI (both)** change the product or the visual story. Changing an established decision (e.g. the
  default tab, the quick-start windows or the framing contract C8) needs a flag (skill `raise-flag`). Items tagged
  **Shay** change physics wording or presentation and need his review.
- Q05 and Q07 change what the demo video shows. Check `scripts/video/record_demo.py` after them, because it clicks
  quick starts by position (`#quickstarts .chip:nth-child(n)`), so Q01 (moving the chips) can break it.

## Fix status, part A: first impression, navigation, sharing, content, load

Branch `shay/qa2-fix-a`, 2026-11-14. Checked in Edge (Playwright, a fresh profile each run) at 1920 × 1080, 1366 × 768
and 390 × 844 (`is_mobile`, `has_touch`), in both themes: no console errors or warnings. Screenshots:
`docs/figures/fixa_*.png`. The other items are in part B (other branch).

| ID | Status | What changed, or why not |
|---|---|---|
| Q01 | fixed, as decided | The quick starts stay under the scenario box (team decision in the fix brief). The map box now has the globe's size before the globe loads, so nothing moves: CLS 0.21 → 0.007 (1366 × 768, 5 Mbit/s). The introduction line links the five stories. The chips keep their order and ids (`#quickstarts .chip:nth-child(n)`). |
| Q02 | fixed | A first visit (no hash, or a link without scenarios) opens the Apollo 11 quick start on the **Sky** tab. A small inline script paints that tab before the modules run, so the Compare tab never flashes. A link with scenarios opens exactly what it encodes. |
| Q03 | fixed | One introduction line under the top bar: what Moonat is, and "Try:" links to the stories. Its ✕ hides it for good (`localStorage`, in try/catch, applied in `<head>` so it never jumps). Phones keep its first clause and the links. |
| Q04 | fixed, wording pending Shay | A "✓ Validated" badge next to the title opens a panel: JPL Horizons 0.09″ (Sun) / 0.12″ (Earth) for the code that runs in the page, worst of 20 random cases, with the 0.49″ leap-second case named (`independent_check.md`); 92.7 % vs 92.5 % (Gläser et al. 2014, `terrain.md`); NASA eclipse contacts within 4.2 s (`eclipse.md`); Moon Trek horizons within 0.07–0.37° RMS at 10 of 12 sites, about 1° on the flat Apollo 11 and 16 plains (`terrain-everywhere.md`). Each line links to its report on GitHub; the footer and About link the source code. |
| Q05 | fixed | Quick starts gain `tab`, `xaxis`, `body`, `offsetMs` and `caption`. The eclipse opens on the Sky tab at 05:57:30 UTC: 81 % cover, where the default framing shows both close-ups (at totality the default frame shows only a small red ring). Apollo 11 and Far side open on Sky, All Apollo and South pole on Compare. Each story shows a one-line "What to look for" on its tab; the numbers it quotes are tested (`web/tests/app_quickstarts.test.mjs`). |
| Q09 | fixed | `pushState` for quick starts, tab switches, and adding, duplicating, removing or clearing scenarios (one entry per action); `replaceState` for edits. `popstate` and `hashchange` re-apply the hash; equal scenarios keep their views. Checked: Back and Forward through three stories and a tab switch. |
| Q10 | fixed | The hash adds `t` (time since start, s), `look` (earth / sun) and `v` (azimuth, elevation and field of view of the first view, written once the user turns or zooms it). Checked: a link at T+12 h 58 min with a turned, zoomed camera reopens identically in a new profile. |
| Q15 | fixed | See the table below. The whole static module graph is `modulepreload`ed (it loaded import by import); the opening view's data is preloaded per tab; the globe's full-resolution textures and, on the Sky tab, Plotly wait for the first results. |
| Q25 | fixed in the picker | Same-named entries read "Malapert Massif (Artemis III region)" and "(place of interest)"; places of interest show their one-line description. The names in `sites.json` are unchanged (catalog data, Shahar's domain). |
| Q26 | fixed | Typed coordinates within 1e-4° of a catalog site make it that site again (name and precomputed LOLA horizon). |
| Q27 | fixed | Times also accept `YYYY/MM/DD` and English month names ("20 July 1969 20:17", "Jul 20, 1969"); ambiguous numeric orders are still refused, and the message shows the format. |
| Q28 | fixed | The card lists every problem at once. |
| Q29 | fixed | `#tab=sky` (no scenarios) opens Apollo 11 on the Sky tab; `#tab=compare` on Compare. |
| Q34 | fixed | `og:*` and `twitter:*` tags; `web/assets/og.png` (1200 × 630) is a render of the app's own eclipse sky with a title band (`scripts/make_social_images.py`); an SVG crescent favicon and a 180 × 180 apple-touch-icon. |
| Q35 | fixed (site); repo topics not done | `sky-demo.html` is left out of the Pages artifact (`pages.yml`) and stays in the repo for local work; deployment is Shahar's domain, pending her review. Repo topics are a GitHub setting for the repo owner. |
| Q36 | fixed | The eclipse story sets the Compare axis to UTC. |
| Q37 | fixed | "Clear all" (and removing the last scenario) keeps the times, so a map click gives results at once; both empty states list the quick starts. |

Also fixed on the way: the Compare tab is now drawn when it is shown. Charts drawn while it was hidden came out
narrow (Plotly cannot measure a hidden tab), e.g. after opening a story on the Sky tab and switching to Compare.

**Load after the fixes** (Edge, cold cache, 1366 × 768, CDP throttling; a local HTTP/1.1 server without compression,
so GitHub Pages with HTTP/2 and gzip should be a little faster; "before" is `origin/main` at 083cd87 on the same server):

| Network | What | Before | After |
|---|---|---|---|
| 5 Mbit/s, 150 ms | First visit: sky view drawn | 11.4 s (via a `#tab=sky` link; the first visit opened Compare) | **5.4 s** |
| 5 Mbit/s, 150 ms | Compare link: first metric / first chart | 3.3 s / 9.2 s | 3.1 s / **3.9 s** |
| 5 Mbit/s, 150 ms | CLS | 0.21 | 0.007 |
| Fast 3G (1.44 Mbit/s, 562 ms) | First visit: sky view drawn | 37.6 s (via a `#tab=sky` link) | **20.9 s** |
| Fast 3G (1.44 Mbit/s, 562 ms) | Compare link: first metric / first chart | 11.4 s / 31.1 s | 11.1 s / **13.0 s** |

**Note for the demo video:** `scripts/video/record_demo.py` was not changed. The chips keep their positions and every
story opens on the tab the recorder expects next, but its first frames now show the Sky tab, the introduction line and
a caption. To hide the introduction line in the recording, its init script can set `localStorage` `moonat-intro` to
`off`.
