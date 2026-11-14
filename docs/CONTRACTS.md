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
    "id": "apollo11", "name": "Apollo 11 (Tranquility Base)", "kind": "mission" | "candidate" | "poi",
    "agency": "NASA", "lander": "Eagle", "crew": ["Neil Armstrong", "Buzz Aldrin"] | null,
    "lat_deg": 0.67416, "lon_deg": 23.47314,
    "t_start_utc": "1969-07-20T20:17:40Z", "t_end_utc": "1969-07-21T17:54:00Z" | null,
    "blurb": "one or two plain sentences for the public",
    "sources": ["https://..."] } ] }`
- `t_start_utc`/`t_end_utc` for missions = landing → liftoff (or end of surface operations). Candidates and POIs have none.
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
  sun:   {az_deg, el_deg, dist_km, ang_radius_deg, vis_frac, flux_frac, enu:[3]},
  earth: {az_deg, el_deg, dist_km, ang_radius_deg, vis_frac, phase_frac, enu:[3],
          sun_dir_enu:[3],   // unit vector from the Earth toward the Sun, in site ENU (for shading)
          era_deg},          // Earth Rotation Angle; Earth body frame = R_icrs_to_enu · Rz(era)
  planets: [{name, az_deg, el_deg, enu:[3]}],
  r_icrs_to_enu: [9],        // row-major 3×3; stars: enu = R · icrs_unit
}
await series(site, t0Ms, t1Ms, stepMs) -> {     // arrays, same length
  t_ms, sun_el, sun_az, sun_vis, flux_horiz_wm2, flux_normal_wm2,
  earth_el, earth_az, earth_vis, earth_phase, earth_ang_diam_deg,
  summary: {sun_vis_pct, earth_vis_pct, next_sunset_ms|null, next_earthset_ms|null, mean_flux_horiz_wm2}
}
```
- `vis_frac` = solid-angle fraction of the body's disk above the horizon profile (0..1). `flux_frac` = the same weighted by
  solar limb darkening (linear, u = 0.6). `phase_frac` = illuminated fraction of the Earth's disk = (1 + cos α)/2, with α the
  Sun–Earth–observer angle.
- `flux_horiz_wm2` = 1361 · (1 AU / r)² · flux_frac · max(0, sin el). `flux_normal_wm2` = 1361 · (1 AU / r)² · flux_frac.
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
```
- **Opening view:** the first `update()` always shows both the horizon and the Earth (Shay's vision: the view opens toward
  the Earth). Yaw = the Earth's azimuth. First the "photo" rule: the horizon line sits 20% of the frame height above the
  bottom edge, with FOV = `fovDeg`; if the top of the Earth's disk is then above 8% below the top edge, the FOV widens up to
  80° (`fitPhotoView` in `web/js/sky/math.js`). An Earth too high for that (e.g. Apollo 11, Earth at 59° in a 16:9 frame) gets
  the body rule below (`lookAtBody("earth")`). If the user turns away, an edge marker ("▲ Earth 59.2°", click = look up)
  points to an Earth above the frame. If the Earth is below the horizon: FOV = `fovDeg`, horizon at one third of the height,
  and the HUD notes "Earth is below the horizon".
- `lookAtBody("earth" | "sun")` ("Look at Earth", "Look at Sun") uses the photo rule when the body fits, and otherwise the
  body rule: horizon about 10% above the bottom edge and the top of the disk about 10% below the top edge, the FOV widening up
  to 100°; at 100° the horizon may slide to the bottom edge, and if both still cannot fit the body stays in frame
  (`fitBodyView`). `lookAt(az, el)` aimed within 0.5° of the Earth or the Sun does the same; any other `lookAt` only turns
  the camera. The user drags to look around the whole hemisphere and scrolls to zoom. After a resize, a view that the user
  has not turned or zoomed is framed again for the new aspect ratio.
- Extras beyond C8 used by the app's focus mode: `setPixelBudget(px | null)` (drawing-buffer size; pixel ratio ≤ 2) and
  `setTallFrames(on)`: a body too high for the container's aspect gets a centred, taller frame (down to 3:4) in which the
  photo rule fits both the horizon and the body, like a square Apollo Hasselblad photo.
- Renders on demand (no continuous loop) so many views can coexist. Missing data degrades gracefully (no terrain patch →
  horizon silhouette only; no stars file → no stars).
- **Import map** (owned by `web-app` in `web/index.html`): `"three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"`,
  `"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"`; Plotly `plotly.js-dist-min@2.35.2`; Leaflet `leaflet@1.9.4`.
- ENU → three.js mapping: three.x = east, three.y = up, three.z = −north (right-handed). Units: metres near the site.

## C7 `scenario` (producer: `web-app`; internal to the UI)
`{ id, label, color, site_id | null, lat_deg, lon_deg, t_start_utc, t_end_utc | null }`. No limit on the number of scenarios.
No end time = a single instant. Scenarios may share or differ in times.
