<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# Website QA (judge's-eye test), 2026-11-14

Tester: the `qa` agent (branch `shay/qa`). The site was served with `uv run python -m http.server -d web 8123` and tested
in the Claude desktop browser pane and in headless Microsoft Edge (Playwright, Intel Iris Xe GPU through ANGLE/D3D11).
Viewports: 1366 × 850, 1920 × 1080 and 390 × 844 (phone). Both themes.

## 1. Bug list

Severity: **H** = a judge would hit it in the first minutes; **M** = visible in normal use; **L** = polish.

| # | Sev | Where | Bug | Status |
|---|---|---|---|---|
| 1 | H | Compare | After any render with only single-instant scenarios (e.g. clearing an end time), the charts never came back: the chart shells were removed but still marked as built. | Fixed (`compare.js`) |
| 2 | H | Sky | The mouse wheel over a sky view zoomed it and blocked page scrolling. With "Compare all Apollo landings" the page was a column of six full-width views, so the page could not be scrolled with the wheel. | Fixed: plain wheel scrolls the page; Ctrl/⌘ + wheel or a trackpad pinch zooms; after a click or drag in a view the wheel zooms it until the pointer leaves. A hint "Ctrl + scroll to zoom" appears. (`sky_tab.js`) |
| 3 | M | Sky | One full-width column of views at 1366 px (each 891 × 500 px): six Apollo views needed ~3500 px of scrolling. | Fixed: two views per row from about 820 px of output width, so from a 1366 px screen up (`app.css`). |
| 4 | M | Sky | A new quick start or shared link kept the previous timelapse position (e.g. Chang'e 4 opened at T+3 h) and the previous "Look at Sun" direction. | Fixed: a completely new set of scenarios starts at T+0 with the default framing (`sky_tab.js`). |
| 5 | M | Sky | Playback speed stayed at 1 h/s, so the 29-day south-pole timelapse took 11.6 min. | Fixed: the speed follows the longest scenario (≤ 90 s playback) until the user picks one (`sky_tab.js`). |
| 6 | M | Sky | "Look at Earth / Sun" called `lookAt(az, max(el, 5°))`, which bypasses the contract framing rule (C8) and showed a lot of empty sky for a low Sun. | Fixed: uses `lookAtBody()` when the view has it (`sky_tab.js`). |
| 7 | M | Copy | Custom points said "terrain not included for custom points (yet)" (scenario card, About), but they now use the coarse LOLA tiles (C5). | Fixed: "approximate terrain (coarse LOLA tiles)", with a tooltip on the Sky card and an About paragraph. |
| 8 | M | Builder | A start date outside the tables (e.g. 1985) with an end in 2019 showed "Please keep a mission under 120 days" instead of the coverage message. | Fixed: coverage is checked first (`state.js`, test added). |
| 9 | M | Picker | Searching "Artemis" found nothing, although nine Artemis III candidate regions are in the catalog. | Fixed: the group is labelled "Artemis III candidate regions" and the group name is searchable (test added). |
| 10 | M | About | No links; the Earth images (Blue Marble), stars and the PDS source were not credited; "1 AU" unexplained. | Fixed: linked sources (JPL Horizons, LOLA via PDS, Moon Trek, Blue Marble, City Lights), plain-language flux text, accuracy statement. All links return HTTP 200. |
| 11 | M | Sky | Phone width: the HUD text overlapped the HUD buttons; the inset caption was cut at the right edge. | Fixed: in views narrower than 560 px the HUD readout (repeated in the card footer) and the exposure toggle hide, captions wrap (`app.css` container query). |
| 12 | L | Builder | "+ Add time" on an unnamed scenario created "Site #1". | Fixed: the source gets its point name, the copy is "#2". |
| 13 | L | Builder | Unnamed scenarios were named by position ("Scenario 3"), so names shifted after a duplicate or remove; editing a catalog site's coordinates kept the mission name on a custom point. | Fixed: typed or clicked coordinates name the point "Point 36.3° S, 119.3° E"; a catalog name is replaced once the point moves. |
| 14 | L | Navigation | Switching tabs kept the scroll depth of the previous tab (the Sky tab opened in the middle of the grid). | Fixed: the new tab opens at the top of the results. |
| 15 | L | Compare | Earth size "(4× the Sun's size)" was hard-coded (it is 3.3–3.8×); "1145 on flat ground" lacked unit and separator; negative angles used a hyphen. | Fixed: computed ratio, "1,145 W/m²", true minus sign. |
| 16 | L | Compare | At 1920 px the six Apollo cards wrapped 5 + 1. | Fixed: wider layout cap (1880 px) and 215 px card minimum (still 3 + 3 at 1366 px). |
| 17 | L | Sky HUD | The Earth close-up said "Earth hidden behind terrain" also when the Earth was 39° below the horizon (far side). | Fixed (`web/js/sky/index.js`, copy only): "Earth below the horizon" when the disk is below the flat horizon. |
| 18 | L | Quick start | The Chang'e 4 tooltip promised "two weeks of lunar daylight", but the Sun sets on day 11. | Fixed: "the first two weeks after Chang'e 4 landed". |

No console errors or failed same-origin requests in any flow. Map tile requests that Leaflet cancels on zoom show as
`ERR_ABORTED`; that is normal Leaflet behaviour, not a failure.

## 2. Flows checked (all pass after the fixes)
- Quick starts: Apollo 11, Compare all Apollo landings, South pole ridge, Far side (Chang'e 4), on both tabs.
- Builder: coordinates, map click (custom point, approximate terrain label), picker search and keyboard, + Add location,
  + Add time, duplicate, remove, end time vs none (single instant: metric cards, look-ahead "sets in / rises in"),
  coverage message (1985, 2041), end before start, > 120-day span.
- Share link round trip (`#tab=sky&s=…`): labels, coordinates, times, colours and tab restored.
- Theme: light and dark, charts re-themed.
- Timelapse: play/pause, speed, slider sync across views, Look at Earth / Sun.

## 3. Physics sanity (no physics code changed)

| Check | Expected | Result |
|---|---|---|
| Apollo 11 at landing, 1969-07-20 20:17:40 UTC | Sun ~10.7° in the east, Earth ~59° in the west | Sun el 10.70°, az 88.8°; Earth el 59.22°, az 272.2°, 67% lit |
| Browser vs JPL Horizons, Apollo 11, 20:17:00 UTC (fixture `tests/fixtures/horizons/apollo11_*_epochs.txt`) | ≤ 1″ | Sun Δel 0.047″, Δaz·cos el 0.009″; Earth Δel −0.040″, Δaz·cos el −0.009″; illuminated fraction Δ −0.0014 % |
| Chang'e 4, 30 days from landing | Earth never up | Earth el ≤ −37.2°, visible 0%; Compare shows the far-side insight |
| South pole (`south_pole`, 90° S) over a month | Sun el within ±1.6°, flicker | Jan 2027: 0.21° to 0.97°, 36% sunlit, 4 rise/set changes; Apr 2027: −1.55° to −1.27° |
| Shackleton rim (89.45° S) | within ±(1.6° + 0.55° colatitude) | −2.08° to +2.06° over 2027; 0 to 8 visibility changes per month |
| Apollo 15 | Hadley Delta high in the south | horizon maximum 13.6° at az 179.5°, 10.4 km away |

### South-pole quick start (changed)
The old window (2027-01-04 → 02-02) is southern summer on the Shackleton rim: Sun 0.05° to 1.52°, 100% sunlit, no
sunset, so the quick start's promise "one ridge decides power" did not show. The new window **2027-02-05 → 03-06**
(same site) has the Sun between −0.79° and +0.64°: 76% sunlit, sunset by terrain on day 14, sunrise on day 20, then
the Sun flickers behind far-off peaks on days 26–28. At T+0 the Sun is 0.6° up, so the ground shows long shadows. A test
pins this (`web/tests/app_catalog_adapter.test.mjs`). Pending review by both humans (demo content), and the `video` work
item should re-check its south-pole clip.

## 4. Responsiveness and performance
- No horizontal overflow at 1366, 1920 or 390 px. At 390 px the layout is one column; the sky HUD adapts (bug 11).
- "Compare all Apollo landings", Sky tab, 1366 × 850, six live 3D views, timelapse playing: 16–17 frames/s, longest frame
  67 ms on Intel Iris Xe. The page stays responsive. Physics per state is negligible; the cost is rendering six WebGL
  views (each update re-renders its shadows).

## 5. Remaining issues, ranked
1. **Timelapse frame rate with many views** (16–17 fps for six views on an integrated GPU). A fix belongs in the sky
   viewer (e.g. refresh shadows less often during playback).
2. **Earth marker under the HUD buttons in small views**: the framing rule puts the top of the Earth 10% below the top
   edge, where the buttons are. Mitigated (bug 11); the close-up inset always shows the Earth.
3. **No pinch-zoom on touch screens** (the sky view zooms with the wheel only).
4. **Date inputs use the browser's locale format** (e.g. "07/20/1969 08:17:40 PM" in a US locale) under a "(UTC)" label.
   The values are UTC; the native control's display format cannot be set.
5. The share link does not store the timelapse position or the camera direction.
6. The highlighted quick-start chip stays highlighted after the user edits the scenarios.

## 6. Screenshots (docs/figures, PNG, provenance in the PNG text chunks)
| File | Content | Size |
|---|---|---|
| `app_compare_apollo.png` | Compare tab, all six Apollo landings (1920 × 1080) | 313 kB |
| `app_sky_apollo11.png` | Sky tab, Apollo 11 at landing, Earth close-up and HUD (1366 × 850) | 274 kB |
| `app_sky_southpole.png` | Sky tab, Shackleton rim at T+0, low Sun and long shadows (1366 × 850) | 382 kB |
| `app_farside_change4.png` | Compare tab, Chang'e 4: Earth never rises (1366 × 850) | 281 kB |
| `app_scenario_builder.png` | Scenario builder with the mission picker open (1366 × 850) | 236 kB |
