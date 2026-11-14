# Contracts: the shapes that let agents build in parallel

> Status: **agreed** (2026-11-14 kickoff, set by Shay's orchestrating agent on behalf of both humans; Shahar may review).
> Every producer builds exactly these shapes. Every consumer may use a placeholder in exactly these shapes until the
> producer marks the contract `implemented` on the board. Changing a shape = `status: changed` on the board + update here.

## 0. Conventions (all contracts)
- **Frame:** `MOON_ME` (Mean Earth / polar axis, as realised by `MOON_ME_DE421`). LOLA topography uses it.
- **Selenographic coordinates:** latitude in −90..90 deg; longitude **east-positive**, in −180..180 deg; heights relative to the
  **1737.4 km** reference sphere.
- **Site:** the ground point is at radius 1737.4 km + DEM height. The **observer eye is 2.0 m above the ground** (default; a parameter).
- **Local frame ENU** at the site: x = east, y = north, z = up, where **up = the unit vector from the Moon's centre to the site**
  (NOT the terrain normal). The local horizontal plane is normal to `up`.
- **Elevation:** the angle above the local horizontal plane (deg; negative = below).
  **Azimuth:** true azimuth, clockwise from local north toward east (0 = N, 90 = E), in 0..360 deg.
  North = the projection of the Moon's north spin axis (ME +Z) on the horizontal plane. Only exactly at a pole
  (|lat| > 89.9999°) is north undefined; there, use the direction toward the 0° meridian.
- **Time:** UTC everywhere at interfaces (ISO-8601 strings, or JS epoch milliseconds). UT1 ≈ UTC for rendering.
- **Angles:** degrees at interfaces; radians only inside code.
- **AI metadata:** every generated JSON has `"_generated_by": "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."`

## C1 `ephem-table` (producer: `ephem`; consumers: `physics-js`)
Precomputed solar-system state for the browser, one binary file per year.
- `web/data/ephem/manifest.json`:
  `{ "years": [..], "step_hours": H, "frame": "MOON_ME_DE421", "ephemeris": "DE421", "time_scale": "UTC",
     "record_layout": [ {"name": "...", "dtype": "f8|f4", "count": n}, ... ], "record_bytes": B,
     "interpolation": "cubic Hermite (C1) on positions; slerp on quaternion", "max_interp_error_arcsec": x,
     "planets": ["mercury","venus","mars","jupiter","saturn"], "_generated_by": "..." }`
- `web/data/ephem/<YYYY>.bin`: little-endian records, record *i* is at `YYYY-01-01T00:00:00Z + i·H` hours, covering the whole
  year plus one extra record (for interpolation across the year boundary). Record fields, in order:
  1. `sun_me` f8×3 — apparent position of the Sun as seen from the Moon's centre, in MOON_ME, km (light-time + aberration
     applied to the direction; length = light-time distance).
  2. `earth_me` f8×3 — the same for the Earth's centre.
  3. `q_icrs_to_me` f8×4 — unit quaternion (w, x, y, z) rotating ICRS vectors into MOON_ME.
  4. `planets_icrs` f4×15 — apparent unit direction vectors in ICRS (5 planets × xyz), as seen from the Moon's centre.
- Years: at least 1966–1976 and 2013–2040. Total committed size ≤ 25 MB. Interpolation error ≤ 1 arcsec (verified by a test).
- Python reference reader + topocentric transform: `moonat.ephem` (validated against **JPL Horizons** topocentric lunar sites).

## C2 `site-catalog` (producer: `catalog`; consumers: `web-app`, `terrain`)
- `web/data/sites.json`: `{ "_generated_by": "...", "sites": [ {
    "id": "apollo11", "name": "Apollo 11 (Tranquility Base)", "kind": "mission" | "candidate" | "poi" | "home",
    "agency": "NASA", "lander": "Eagle", "crew": ["Neil Armstrong", "Buzz Aldrin"] | null,
    "lat_deg": 0.67416, "lon_deg": 23.47314,
    "t_start_utc": "1969-07-20T20:17:40Z", "t_end_utc": "1969-07-21T17:54:00Z" | null,
    "blurb": "one or two plain sentences for the public",
    "sources": ["https://..."] } ] }`
- `t_start_utc`/`t_end_utc` for missions = landing → liftoff (or end of surface operations). Candidates and POIs have none.
- **Added 2026-11-14:** kind `"home"`: one site, the home base `starhab` (StarHab, Shay's lunar base concept, IAC 2021),
  shown as the "Home" entry of the globe search and the globe's Home button (`HOME_SITE_ID` in web/js/app/catalog.js). No
  times. Its coordinates are a placeholder until Shay sets them: the Shackleton rim reference point (`shackleton_rim`),
  set by the one constant `STARHAB_LAT_LON` in scripts/catalog/build_sites.py (`PLACEHOLDER[starhab-coords]`); after a
  change, run that script and `scripts/data/build_terrain.py starhab`.
- Every coordinate and time is sourced (NSSDCA, LROC, mission pages). Coordinates in MOON_ME (LROC-measured where available).

## C3 `horizon-profile` (producer: `terrain`; consumers: `physics-js`, `sky-viewer`)
- `web/data/horizons/<site_id>.json`:
  `{ "id", "lat_deg", "lon_deg", "ground_elev_m", "observer_height_m": 2.0, "az_step_deg": 0.25,
     "el_deg": [1440 floats], "dist_km": [1440 floats], "max_range_km", "dem_sources": ["..."], "_generated_by" }`
- `el_deg[k]` = the maximum elevation angle of terrain seen from the **eye** along true azimuth `k·az_step_deg`, including
  lunar curvature. `dist_km[k]` = ground distance to the point that sets it. Linear interpolation between samples.
- Python reference: `moonat.terrain.horizon_profile(lat_deg, lon_deg, observer_height_m=2.0) -> dict` (same keys).

## C4 `terrain-patch` (producer: `terrain`; consumers: `sky-viewer`)
- `web/data/terrain/<site_id>.json` + `<site_id>.bin`:
  `{ "id", "grid_n": N, "spacing_m": d, "half_extent_m": h, "encoding": "float32 LE, row-major, row 0 = north edge, col 0 = west edge",
     "values": "z_up_m: ENU up-coordinate of the terrain surface relative to the GROUND point (includes curvature drop)",
     "albedo": null, "dem_sources": ["..."], "_generated_by" }`
- Grid cell (r, c) sits at ENU x = −h + c·d (east), y = +h − r·d (north). Suggested h ≈ 10–15 km, N ≤ 513.

## C5 `dem-tiles` (producer: `terrain`; consumers: `physics-js`) — **Should tier**
Coarse-to-medium DEM tiles so the browser can compute a horizon for any clicked site. The format is defined by `terrain` in
`web/data/dem/manifest.json` (projection, bounds, size, dtype, scale/offset, URL per tile) and documented here when built.
Until then, custom sites use a **smooth horizon** (`el_deg` all 0) and the UI labels them "terrain not included".

**Built (format `moonat-dem-tiles/1`, branch `shay/terrain`):**
- **`web/data/dem/manifest.json`:** `{ format, frame: "MOON_ME_DE421", reference_radius_m: 1737400, dtype: "int16",
  byte_order: "little", value: "height_m", nodata: -32768, levels: [...] }`.
- **Each tile** is `tile_size × tile_size` int16 values, row-major. Tile `(tr, tc)` is at `level.url` with `{tr}`/`{tc}`
  substituted, and holds image rows `tr·tile_size…` and cols `tc·tile_size…`. Edge tiles are padded with nodata.
- **Level `global8`** (simple cylindrical, 8 px/deg, about 3.8 km, 1440 × 2880 px, 72 tiles of 240², 8.3 MB in total):
  - pixel centre: `lat = 90 − (row + 0.5)/8`, `lon_east = (col + 0.5)/8` (0–360, periodic);
  - source: LOLA LDEM_16, 2 × 2 mean.
- **Level `south480`** (south polar stereographic, 480 m/px, 1300 × 1300 px, ±312 km around the pole, so about 80–90°S; 25 tiles of 260², 3.4 MB):
  - for a unit vector u in MOON_ME, with s = −1: `k = 2R/(1 + s·uz)`, `x = k·uy`, `y_up = −s·k·ux`, `row = row0 − y_up/480`,
    `col = col0 + x/480`, where `row0 = col0 = 649.5`;
  - source: LOLA LDEM_75S_240M, 2 × 2 mean.
- **Algorithm:** the same as C3 (`moonat.terrain.horizon`). For each ray sample, use the finest level that covers it
  (`south480`, then `global8`). Bilinear interpolation; ray step = level cell; same stopping rule.
- **Limits:** the near field (the first few km) is not represented, so tile horizons are a far-field approximation. The UI should
  label them "terrain: coarse (LOLA tiles)". Python reference: `moonat.terrain.tiles.tiles_dem()` + `horizon_profile(dem=...)`.
- **Browser reader** (`physics-js`): `await horizonFromTiles(lat_deg, lon_deg, {observer_height_m = 2, az_step_deg = 0.5,
  baseUrl = "data/dem"})`, exported from `web/js/physics/index.js`. Returns a C3-shaped object plus `source: "dem-tiles"`,
  `approximate: true`, `label: "approximate terrain (coarse)"`. It fetches only the tiles within the 0.25 rad search region.
  It matches the Python reference to the 1e-4° output rounding (docs/validation/physics.md §6).
  Accuracy against the full C3 horizons is in docs/validation/terrain.md §8.

## C6 `sky-state` (producer: `physics-js`; consumers: `web-app`, `sky-viewer`) — JS ES module API
`web/js/physics/index.js` exports:
```js
await loadEphem(baseUrl)                       // fetches the manifest; years load lazily
makeSite({lat_deg, lon_deg, ground_elev_m = 0, observer_height_m = 2, horizon = null})  // horizon: C3 object or null
await skyState(site, tMs) -> {
  t_ms,
  sun:   {az_deg, el_deg, dist_km, ang_radius_deg, vis_frac, flux_frac, eclipse_frac, enu:[3]},
  earth: {az_deg, el_deg, dist_km, ang_radius_deg, vis_frac, phase_frac, enu:[3],
          sun_dir_enu:[3],   // unit vector from the Earth toward the Sun, in site ENU (for shading)
          era_deg},          // Earth Rotation Angle; Earth body frame = R_icrs_to_enu · Rz(era)
  planets: [{name, az_deg, el_deg, enu:[3]}],
  r_icrs_to_enu: [9],        // row-major 3×3; stars: enu = R · icrs_unit
}
await series(site, t0Ms, t1Ms, stepMs) -> {     // arrays, same length
  t_ms, sun_el, sun_az, sun_vis, flux_horiz_wm2, flux_normal_wm2,
  earth_el, earth_az, earth_vis, earth_phase, earth_ang_diam_deg,
  sun_eclipse, sun_flux_frac,                    // eclipse_frac and flux_frac per sample
  eclipses: [{start_ms|null, max_ms, end_ms|null, max_frac, total_start_ms|null, total_end_ms|null, sun_vis_at_max}],
  summary: {sun_vis_pct, earth_vis_pct, next_sunset_ms|null, next_earthset_ms|null, mean_flux_horiz_wm2}
}
```
- `vis_frac` = solid-angle fraction of the body's disk above the horizon profile (0..1), terrain only. `flux_frac` = the
  visible share of the Sun's flux, weighted by solar limb darkening (linear, u = 0.6), with both the terrain and the Earth
  in the way. `eclipse_frac` = the share of the Sun's limb-darkened flux behind the Earth's disk, terrain ignored
  (0 except during an eclipse of the Sun by the Earth, i.e. a lunar eclipse on Earth). The Earth is an opaque disk of
  radius 6378.137 km (solid body, no atmosphere; **Shay's decision, 2026-11-14**). The documented alternative is
  Danjon's enlarged Earth, radius × (1 + 1/85 − 1/594) = 1.01, as in NASA's eclipse tables: at the site the Sun would
  disappear 64–87 s earlier and reappear 64–87 s later. Apparent directions as in C1. When the terrain and the Earth
  both cut the disk, `flux_frac` = (1 − eclipse_frac) × the terrain-visible share of the uncovered flux
  (docs/validation/eclipse.md). `phase_frac` = illuminated fraction of the Earth's disk = (1 + cos α)/2, with α the
  Sun–Earth–observer angle.
- **Body radii** (manifest `body_radii_km`): Sun **695 700 km** (IAU 2015 Resolution B3 nominal, the value JPL Horizons
  uses; Shay's decision, 2026-11-14), Earth 6378.137 km (equatorial). `ang_radius_deg` = asin(R / dist_km).
- `flux_horiz_wm2` = 1361 · (1 AU / r)² · flux_frac · max(0, sin el). `flux_normal_wm2` = 1361 · (1 AU / r)² · flux_frac.
- `series().eclipses`: one entry per eclipse in the window: first and last contact at the site (`start_ms`, `end_ms`: the
  site enters and leaves the Earth's penumbra), totality (`total_*`: the site in the umbra; null if partial), greatest
  eclipse at the site (`max_ms`: minimum Sun–Earth separation) and `max_frac`; null = outside the window. Times are refined
  to 1 s, and events between samples are found. `summary.sun_vis_pct` counts samples with sunlight (`sun_flux_frac` > 0),
  so a total eclipse counts as dark; set times follow the terrain-only `sun_vis`.
- With a horizon of `null`, the horizon is the smooth local horizontal plane (el = 0), with no terrain.
- Python reference implementations live in `moonat.metrics` / `moonat.visibility`. JS results must match Python
  fixtures (`tests/fixtures/*.json`) within: az/el 0.001°, vis_frac 0.01, phase 0.001.

## C8 `sky-view` (producer: `sky-viewer`; consumer: `web-app`) — JS ES module API
`web/js/sky/index.js` exports:
```js
await createSkyView(container /* HTMLElement */, {
  site,                       // object from makeSite() (C6), includes horizon (C3) or null
  terrainPatchUrl = null,     // base URL without extension of a C4 patch, e.g. "data/terrain/apollo11", or null
  starsUrl = "data/stars/stars.json", constellationsUrl = "data/stars/constellations.json",
  earthTextureUrl = "assets/earth_daymap.jpg",
  fovDeg = 70,                // horizontal field of view; the aspect ratio follows the container (default 16:9 box)
}) -> { update(skyState /* C6 */), lookAt(az_deg, el_deg), lookAtBody("earth" | "sun"), setFov(deg), resize(), dispose() }
// extras below: setTerrain, setHudLevel, setOption/getOptions, setPixelBudget, setTallFrames, setTrack/getTrack
```
- **Opening view:** the first `update()` always shows both the horizon and the Earth (Shay's vision: the view opens toward
  the Earth). Yaw = the Earth's azimuth. First the "photo" rule: the horizon line sits 20% of the frame height above the
  bottom edge, with FOV = `fovDeg`; if the top of the Earth's disk is then above 8% below the top edge, the FOV widens up to
  80° (`fitPhotoView` in `web/js/sky/math.js`). An Earth too high for that (e.g. Apollo 11, Earth at 59° in a 16:9 frame) gets
  the body rule below (`lookAtBody("earth")`). If the user turns away, the body markers (below) show where it is.
  If the Earth is below the horizon: FOV = `fovDeg`, horizon at one third of the height,
  and the HUD notes "Earth is below the horizon". Wording (web/js/sky/words.js): "below the horizon" only when the whole disk
  is below the local horizontal plane (el + r < 0); a hidden body with part of its disk above that plane is "hidden behind
  terrain (skyline +x°)". An Earth more than 5° below the plane gets a text message instead of a close-up ("Earth is below
  your feet … it never rises here" at sites more than 105° from the mean sub-Earth point, where libration can never lift it).
  The wording rule and the 105° threshold were approved by Shay (2026-11-14).
- `lookAtBody("earth" | "sun")` ("Look at Earth", "Look at Sun") uses the photo rule when the body fits, and otherwise the
  body rule: horizon about 10% above the bottom edge and the top of the disk about 10% below the top edge, the FOV widening up
  to 100°; at 100° the horizon may slide to the bottom edge, and if both still cannot fit the body stays in frame
  (`fitBodyView`). `lookAt(az, el)` aimed within 0.5° of the Earth or the Sun does the same; any other `lookAt` only turns
  the camera. The user drags to look around the whole hemisphere and scrolls to zoom. After a resize, a view that the user
  has not turned or zoomed is framed again for the new aspect ratio.
- **Body markers** (where the Sun and the Earth are when the frame does not show them; `bodyMarker` in math.js, wording
  in words.js): a body whose disk centre is in the frame but hidden gets a thin dashed outline at its true place and size,
  labelled "Earth · behind terrain" or "Earth · below the horizon (−7.5°)" (the wording rule above). A body out of the
  frame in any direction gets a small arrow button on that edge, pointing at it: "Sun · 35° right" / "· 35° left" (the
  azimuth turn, wrapped to ±180°; exactly behind = right) or "Earth · 44° up" / "· 55° down" (the elevation change; the
  great-circle angle where that does not describe the turn). A body in front of the camera is pointed at along the ray
  from the centre to its projected position; one behind it (or nearly at right angles) along (azimuth turn × cos el,
  elevation change), so it lands on a side edge. A click or tap calls `lookAtBody`. Hidden bodies get a dashed border.
  The arrows slide along their edge off the HUD buttons (bottom left in the app's narrow views), the readout, the
  close-ups and the other body's disk, and they stay above the compass strip.
- Terrain extras: `createSkyView(..., { terrainPatch: { meta, data: Float32Array } })` takes an in-memory C4 patch instead of
  `terrainPatchUrl`, and `view.setTerrain({ horizon, patch })` swaps the skyline and/or the patch in place (camera, sky and
  textures stay; an omitted key keeps its value; `horizon: null` = the patch's own skyline).
- Extras beyond C8 used by the app's focus mode: `setPixelBudget(px | null)` (drawing-buffer size; pixel ratio ≤ 2) and
  `setTallFrames(on)` (the app turns it on for every view): `lookAtBody` keeps the full width whenever the body rule fits the
  horizon and the body with its margins; only a body too high for that gets a centred, taller frame (down to 3:4), as wide
  as the body rule allows at 100° (`bodyFitAspect` in math.js). The side bands show the same view stretched, blurred and
  dimmed, so the sky and the ground continue past the frame.
- More extras: option `onNotes(notes)` gets the HUD notes (`[{ id, text }]`, most useful first; the HUD shows the first two
  on one line) whenever they change, so the app can show them in a narrow card's footer. The container takes keyboard
  focus: arrow keys turn the view (1/12 of the field per press), `+`/`−` zoom. With the constellation lines on, the names of
  18 well-known constellations sit at the centre of their lines (`constellationCentroid` in math.js).
- **HUD level and view options** (for a page that shows the numbers elsewhere and offers the toggles in its own menu):
  - `setHudLevel("minimal" | "full")` (also option `hudLevel` of `createSkyView`, default `"full"`). Full: the current
    readout (time; Sun and Earth height and direction; what hides them; phase; eclipse). Minimal: the time and at most one
    short status line, the eclipse ("Earth eclipses the Sun · 81 %") when there is one. The sky labels, body markers,
    badge, notes and close-up captions stay in both levels.
  - `setOption(name, value)` → the options after the change; `getOptions()` → `{ exposure: "eye" | "camera",
    constellations: bool, closeUp: bool, hudLevel: "full" | "minimal", buttons: bool }`. `buttons` shows or hides the
    HUD's own toggle buttons (exposure, close-up, constellations); a page with its own "View options" menu sets it to
    false. Same names as options of `createSkyView` (`exposure`, `showConstellations`, `closeUp`, `hudLevel`, `buttons`).
    An unknown name is ignored with a console warning. `setExposure`, `setCloseUp` and `setConstellations` remain as
    shorthands. Option `onOptions(options)` is called whenever an option changes (HUD button or `setOption`), so a
    menu can stay in step. `view.info.hasConstellations` says whether the constellations option is worth offering.
  - The 2D fallback (`web/js/app/sky_fallback.js`, no WebGL) does not have these: call them with `?.`.
- **Tracking** (for the timelapse; maths in `web/js/sky/track.js`, tests `web/tests/sky_track.test.mjs`):
  `setTrack(target, { resume = false } = {})` → `getTrack()`. `target`: `"sun" | "earth"` (every `update()` frames that
  body by the `lookAtBody` rule above, tall frames included), `{ az_deg, el_deg }` (deg, the local horizon frame of the
  view's site: the camera centre aims there and keeps its field of view; the app may call it every frame, e.g. a rover's
  direction of travel), or `null` (off; the camera stays where it is). The camera eases toward each new target
  (exponential, τ = 350 ms, frame-rate independent) after a feed-forward of the body's own motion, so a fast body (the
  Sun circling the pole at 1 month/s) is not left behind while a change of framing (another body, the body setting
  behind the skyline, a new frame shape) glides instead of jumping; a direction that turns ≤ 0.5° per call is followed
  without lag, a sharper turn eases. The user can still zoom: the field of view is then kept, and the aim follows the
  same rules at that field (`aimAtFov`). A drag or an arrow key pauses tracking until `setTrack` is called again (a
  direction updated every frame keeps the pause unless `{ resume: true }`); a click on the tracked body's edge arrow
  resumes it, one on the other body's arrow pauses it and turns there. A hidden body is aimed at its true azimuth; the
  dashed outline or the edge arrow shows it. `getTrack()` and option `onTrack(info)` (called on every change, a drag's
  pause included) give `{ mode: "body" | "direction" | null, body, paused }`. The 2D fallback has a simple version (no
  easing); call with `?.`. In the app, the timelapse bar's "🎯 Track" button and a rover route's "Look ahead" share one
  mode (`web/js/app/sky_panel.js`: `setTrackMode("body" | "ahead" | null)`, `getTrackMode()`,
  `onTrackModeChange(cb)`, `setLookAheadSource(fn(item, tMs, ride) → { az_deg, el_deg } | null)`): the last one
  chosen wins, the button shows which one is on ("🎯 Track Sun", "🚙 Look ahead", "· paused"), and pressing it while
  paused resumes, while on stops.
- **Eclipses** (C6 `sun.eclipse_frac` > 0): render order Earth (opaque, renderOrder −1, distance 20 000) → stars →
  Sun quad (additive, distance 30 000, depth-tested, so the Earth hides the part of the disk and glow behind it) → an
  eclipse overlay at the Earth (additive, no depth test, renderOrder 6). The glare scales with the visible flux and is
  centred on the visible crescent; the overlay draws the refraction ring of the Earth's atmosphere (bright and orange
  toward the Sun, redder and fainter round the limb, none where the needed deviation exceeds ~1.2°) and, near second and
  third contact, the "diamond" as a saturated point-spread function. Direct light on the terrain scales with the
  uncovered flux; near totality the ground gets a faint red fill from the ring, the stars come out, and the HUD shows
  "Earth eclipses the Sun · N % covered". During the partial phases the close-up adds a Sun loupe. The refraction ring
  is an illustration, not a computation (Shay's decision: keep it, labelled): during an eclipse the Earth close-up's
  caption carries a small "ring illustrative" note whose tooltip reads "Sunlight refracted by Earth's atmosphere; drawn
  for illustration, not computed." (a tap opens the same sentence on touch screens).
- Renders on demand (no continuous loop) so many views can coexist. Missing data degrades gracefully (no terrain patch →
  horizon silhouette only; no stars file → no stars).
- **Import map** (owned by `web-app` in `web/index.html`): `"three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"`,
  `"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"`; Plotly `plotly.js-dist-min@2.35.2`.
- ENU → three.js mapping: three.x = east, three.y = up, three.z = −north (right-handed). Units: metres near the site.

## C8b `globe-view` (producer: `web-app` globe; consumers: `rover`, trip planner) — JS ES module API — **implemented**
Route lines, fly-to and fit-to-points on the Moon globe (web/js/globe/). Import from `web/js/app/globe_api.js` (no
imports of its own; calls made before the globe has loaded are kept and applied when it arrives: every route is drawn
and the last move is played). Points are `{ lat_deg, lon_deg }` (MOON_ME, east-positive, §0).
```js
import { showRoute, clearRoute, fitTo, flyTo, setMarker, clearMarker, globeReady } from "../app/globe_api.js";
showRoute(id, [{ lat_deg, lon_deg }, ...], { color, width })  // draw or replace route `id`
clearRoute(id)
fitTo([{ lat_deg, lon_deg }, ...], { padding, maxZoom })      // turn and zoom so all points are in view
flyTo(lat_deg, lon_deg, zoom)                                 // zoom 1 = the whole disc; omitted = keep the zoom
setMarker(id, { lat, lon, color, label, ahead: { lat, lon } | null })  // a moving dot, e.g. the rover
clearMarker(id)
await globeReady()                                            // the globe object below, once it exists
```
- `showRoute`: a polyline along the great circles between consecutive points (densified to ≤ 0.5° steps), drawn
  0.001 Moon radii (1.7 km) above the reference sphere, hidden where it passes behind the Moon (`greatCirclePath`,
  `visibleRuns` in web/js/globe/geo.js). `color`: any CSS colour (default the theme accent); `width`: CSS px (default 4).
  It is drawn on a dark casing, under the markers and pins. A route stays until `clearRoute` (or `showRoute` again with
  the same id); routes do not follow the scenarios by themselves.
- `fitTo`: like a web map's "fit bounds": the centre and zoom that put every point inside `padding` (CSS px, a number
  or `{ top, right, bottom, left }`; default: clear of the search box, the tools and an open place card), north up
  (top-down poleward of 75°), animated. One point: a fly-to at max(current zoom, 4). `maxZoom` default 60, the
  globe's limit (about 60 km across). Points that cannot all face the camera give the whole disc (`fitView` in geo.js;
  tested near the poles, across 180° and with asymmetric padding in web/tests/globe_routes.test.mjs).
- `setMarker`: a dot in `color` with a white ring, above the pins, not clickable; with `ahead` (a point further on) a
  small arrow on it points that way on screen. Call it again to move it. `lat_deg`/`lon_deg` work too.
- `flyTo`: a smooth turn and zoom (0.45–1.6 s, zooming out half-way on a long hop, `flightZoom`/`flightMs` in geo.js).
  `prefers-reduced-motion` jumps instead.
- The globe object (`createGlobe` in web/js/globe/globe.js, also returned by `globeReady`) has the same six functions
  plus `setSites`, `setPins`, `showPoints`, `goTo`, `setPreset`, `addTool`, `slots` (top and bottom elements for the
  page's own controls), `getView`, `setView`. Its view is centred in the map frame below the top bar, so an overlay
  that projects points itself with geo.js `projectPx(view, v, width, height)` on the whole canvas is off by that inset:
  use `setMarker` and `showRoute` instead. The app wires it in web/js/app/map.js (pins = scenarios) and
  web/js/app/places.js (search box, place card, Home).
- The view is centred in the **map frame**: the canvas minus the top bar (search box, preset chips) and the credit line;
  zoom 1 fits the whole disc in it.

## C9 `terrain-at` (producer: `terrain-everywhere`; consumers: `web-app`, `sky-viewer`, `rover`) — **implemented**
Real LOLA terrain for any point, computed in the browser. Research and validation: docs/research/terrain-everywhere.md,
docs/validation/terrain-everywhere.md. `web/js/terrain/index.js` exports (stable API; add options, never change these):
```js
await terrainAt(lat_deg, lon_deg, {
  radius_km,                 // outer half-width of the on-demand data (default: the level plan, 64–96 km)
  observer_height_m = 2, az_step_deg = 0.25,
  patch = true,              // also build the C4-shaped patch (±12 km, 385 × 385)
  online = true,             // false: shipped C5 tiles only (no network beyond the site)
  demBaseUrl = "data/dem", worker = true,
  signal,                    // AbortSignal: cancels the Moon Trek requests; the promise rejects with an AbortError
}) -> {
  horizon,  // C3 object (az_step 0.25, el_deg[1440], dist_km[1440], ground_elev_m, max_range_km, dem_sources)
            // + source: "moon-trek+dem-tiles" | "dem-tiles", approximate (true only for the tiles fallback), label
  patch,    // C4 fields + z_up_m: Float32Array(grid_n²) in site ENU, row 0 = north, col 0 = west, or null
  meta: { sources, resolution_m, ms, timing_ms, bytes, levels: [{layer, half_km, cell_m, n, bytes, ms}], errors, fallback }
}
```
- Near and mid field: site-centred stereographic LOLA grids (401 × 401, LERC) from the NASA Moon Trek ImageServer:
  20/80/320 m (85–90°S), 30/120/480 m (75–90°), 118/474 m elsewhere. Far field: the C5 tiles. Same ray march as C3/C5
  (`horizonFromTiles` now runs on the same code: web/js/terrain/tiles.js + march.js).
- Runs in a module Web Worker. Cold load 1–5 s in Edge (server-dependent) and 0.5–0.75 MB per point. Each grid has a 12 s
  timeout and one retry. Results are cached per (lat, lon, options) for the page's lifetime.
- If Moon Trek cannot be reached the promise still resolves: tiles-only horizon, `approximate: true`, `patch: null`,
  `meta.fallback` says why.
- **App wiring** (`web/js/app/terrain_live.js`): custom points only (catalog sites keep their C3/C4 files). Points are
  keyed to ~9 m, start after 350 ms of stability, and are cancelled when no scenario uses them any more. The tiles horizon
  shows at once; when real terrain arrives the scenario is recomputed and the sky view swaps it in with `setTerrain`.
  Status text: "Loading NASA terrain…" → "Real terrain: NASA LOLA via Moon Trek (N m)" or "Approximate horizon (coarse tiles)".

## C7 `scenario` (producer: `web-app`; internal to the UI)
`{ id, label, color, site_id | null, lat_deg, lon_deg, t_start_utc, t_end_utc | null }`. No limit on the number of scenarios.
No end time = a single instant. Scenarios may share or differ in times.
- **Places on the globe (2026-11-14, web/js/app/places.js):** each selected place is one scenario. A catalog marker or a
  search result adds its site (missions bring their times, other places take the selected scenario's times; an empty
  card is filled first); a click on a selected pin removes its scenario (the last one leaves an empty card, as "Clear
  all"; the toast offers Undo); a click on the ground adds a custom point; a dragged custom pin moves it. The map adds
  at most 6 places (one per palette colour); "+ Add location" in the cards keeps no limit.
- **Rover traverses** (C10) add `route: { end_lat_deg, end_lon_deg, preset: "viper" | "lrv" | "custom", speed_mps,
  max_slope_deg, max_cross_deg, stop_every_km, stop_h }`; `lat_deg`/`lon_deg` is the start, and no end time = end on
  arrival. URL hash rows get an 8th element `[end_lat, end_lon, preset, speed, max_slope, max_cross, stop_km, stop_h]`
  (older links have 7 and stay valid); `x=dist` selects the distance axis.
- **Share links** (`web/js/app/state.js` encodeHash / decodeHash): `#b=earth&x=utc&t=5250&v=258.9,12.5,40&s=<rows>`,
  every key optional. `b` = the Sun | Earth switch (the body every sky view is aimed at and whose data shows; default
  Sun), `x` = the charts' time axis (`utc` | `dist`; default time since start), `t` = the sky's moment (s after the
  scenarios' start), `v` = the first view's camera (az, el, horizontal FOV, deg), `s` = base64url JSON rows
  `[label, lat, lon, start, end|0, site_id|0, color(, route)]`. **Changed 2026-11-14 (one-flow layout):** the page no
  longer writes `tab` and `look`. Links from the tab era still open: `tab=sky` opens on its `look` body (none: the
  Earth, the opening view it showed), any other link on its `b` (`hashBody`); `#tab=sky` without scenarios opens the
  first-visit story, Apollo 11.

## C10 `rover-traverse` (producer: `rover`; consumer: `web-app`) — **implemented** (advanced mode)
Plan a rover drive between two points from real terrain, then follow the Sun and Earth along it
(branch `shay/rover`; validation: docs/validation/rover.md). `web/js/rover/index.js` exports:
```js
await planRoute(start {lat_deg, lon_deg}, end {lat_deg, lon_deg},
                rover {preset, speed_mps, max_slope_deg, max_cross_deg},
                {onProgress(stage, frac), worker = true, demBaseUrl = "data/dem"}) -> {   // cached per request
  start, end, centre,                 // centre = great-circle midpoint (the local stereographic plane's tangent point)
  rover,                              // roverParams(): speed_mps, max_slope_deg, max_cross_deg, mu, power_margin
  path: { lat[], lon[], x[], y[],     // vertices (grid-cell centres), plane metres (x east, y north at the centre)
          elev_m[], slope_deg[],      // height above the 1737.4 km sphere; terrain slope of the cell (Horn 3×3)
          dist_m[], time_s[],         // cumulative surface distance and driving time
          along_deg[], cross_deg[], speed_mps[] },   // per segment (index i = segment ending at vertex i)
  samples: { dist_m[], lat[], lon[], elev_m[], horizons[] },   // every 100–250 m; horizons: C3 objects (0.5° step)
  stats: { length_m, straight_m, drive_s, mean_speed_mps, max_along_deg, max_cross_deg, max_slope_deg,
           climb_m, descent_m, snapped_start_m, snapped_end_m },
  preview: { width, height, rgba, x0, x1, y0, y1 },   // hillshade (no-go cells tinted), plane extent of the image
  terrain: { fine: {half_m, cell_m, n, data}, coarse },   // the route grids (for the sky patches)
  meta: { sources, bytes, grid_n, fine_cell_m, coarse_cell_m, expanded, ms: {terrain, plan, horizons, total} }
}
await routeSeries(route, t0Ms, t1Ms, stepMs, {stop_every_km, stop_h}) -> C6 series() fields + {
  distance_km[], position[{lat, lon}], sample_index[], sun_hz_el[], earth_hz_el[],
  route: { arrival_ms, length_km, stops } }
```
- **Terrain:** one Moon Trek LOLA grid (C9 layers and projection) covering both points plus max(3 km, 30 %) of margin, in
  the stereographic plane at the midpoint; ≤ 1001² px (20 m south of 85°S, 30 m poleward of 75°, 118 m elsewhere;
  coarser cells for long polar routes), and at least the C9 near-field extent (401 px). Plus a 401² mid-field grid out to
  max(2.2 × the half-width, 64 km polar / 95 km elsewhere), and the C5 tiles beyond. Straight-line length ≤ 60 km.
- **Planner:** A* on travel time, 16-connected (a move may not cross or cut the corner of a no-go cell). No-go: terrain
  slope > max slope; per move: |along-track slope| ≤ max slope and cross slope ≤ max cross slope. Speed: level and
  downhill = `speed_mps`; uphill power-limited, v = speed · min(1, power_margin · μ / (μ cos θ + sin θ)), μ = 0.1.
  Ends on a no-go cell move to the nearest drivable cell within 300 m (reported as `snapped_*_m`).
- **Sky along the route:** at each time step the rover's distance follows the drive timeline (stops optional; parked at
  the end after arrival) and the step uses the horizon sample nearest to it (makeSite + series per run of steps at the
  same sample, so a zero-length route equals the static series). Eclipse contacts come from the route centre.
- **Presets:** VIPER-class 0.2 m/s, 15° (NASA VIPER pages); Apollo LRV 2.5 m/s, 20° (Jacob et al., LPSC 2026). Editable.
- **Runtime:** a module Web Worker fetches the terrain and plans; the horizons are spread over up to 4 short-lived
  workers. 2–7 s in the browser for 6–20 km routes; 0.9–6 MB downloaded (including C5 tiles on a first visit).
- **App wiring:** `web/js/rover/app.js` `routeCore(s)` (called by the app's compute for scenarios with `route`), route
  card `ui.js`, globe two-step pick `pick.js`, Sky-tab ride `sky_ride.js` (sky, skyline and ±8 km ground per station).

## C11 `suggest-dates` (producer: `suggest`; consumer: `web-app`) — **implemented**
Suggested mission dates for one site: the best windows for solar power, direct-to-Earth contact or both, and special
events (eclipses of the Sun by the Earth, Earthrises). Definitions and validation: docs/validation/suggest.md.
`web/js/suggest/index.js` exports (stable API; add options and fields, never change these):
```js
await suggestDates({ lat_deg, lon_deg, horizon /* C3 or null */, ground_elev_m?, observer_height_m? }, {
  from, to,               // Date | epoch ms | ISO; default today 00:00 UTC → +2 calendar years; clipped to the
                          // ephemeris coverage (1966–1976, 2013–2040); RangeError if nothing is covered
  durationMs,             // window length for sun/earth/both; default LUNAR_DAY_MS (14.77 d)
  kinds,                  // subset of ["sun", "earth", "both", "eclipse", "earthrise"] (default all, in this order)
  limit = 5,              // items per kind
  signal,                 // AbortSignal: rejects with an AbortError
  onProgress,             // (0..1) while sampling
  stepMs, ephemBaseUrl = "data/ephem", worker = true,
}) -> [{
  kind, rank,             // rank 1 = best within its kind; items come in the order of `kinds`
  t_start_utc, t_end_utc, // ISO-8601 UTC; window, or eclipse first/last contact at the site, or Earthrise bracket;
                          // null for a far-side note
  t_max_utc?,             // eclipse: greatest eclipse at the site; earthrise: half the Earth's disk visible
  score,                  // 0..1, per kind (below)
  title, detail,          // English text for the UI ("14.8 d of continuous sunlight from 19 Jan 2027")
  note?,                  // true: a statement about the whole range, not a window (near side, far side, no sunlight)
  stats,                  // numbers behind the text, per kind
}]                        // + non-enumerable `meta`: {from_utc, to_utc, step_ms, duration_ms, samples, ms}
```
- **Sampling:** one C6 `series()` pass every 10 min (≤ 110 000 samples; 3 h when only eclipses are asked for).
- **Scores:** `sun` = mean `flux_frac` (terrain + Earth, C6) over the window; `earth` = mean Earth `vis_frac`;
  `both` = mean of min(`flux_frac`, Earth `vis_frac`) (power and link at the same moment); `eclipse` = largest
  covered share of the Sun's flux while the Sun is above the skyline; `earthrise` = Earth phase × Sun `flux_frac` at
  the half-disk moment. Windows do not overlap; scores within 0.005 count as equal and are listed soonest first.
- **Notes:** near side → one `earth` note "Earth always in view"; far side → one `earth` and one `both` note with
  `stats.reason` ("far-side" | "terrain"); Earthrises only where the Earth crosses the skyline.
- **Eclipses:** every event where the Earth covers part of the Sun as seen from the site with the Sun above the
  terrain skyline; contacts to 1 s from `physics/eclipse.js` (solid Earth, as C6). `stats.type` "total" | "partial".
- **Runtime:** a module Web Worker (inline in Node or without Worker). Cached per site and options; a new
  `durationMs` reuses the samples. Two years at a polar site: ~0.8–0.9 s in Edge, ~0.1 s at low latitudes.
