# Architecture: Moonat (draft v0.1, 2026-11-07)

> Status: **proposed**. Items marked **[DECIDE]** must be settled by Shay and Shahar before Saturday 09:00, or in the
> first 15 minutes of kickoff. Physics choices: Shay decides. Data, infra and stack choices: Shahar decides. UI: both.

## 0. Decisions at kickoff (2026-11-14) — these override the [DECIDE] items below
Shay and Shahar are mostly unavailable this weekend. Shay authorised his orchestrating agent to decide and build autonomously.
Decisions in Shahar's domain are marked *(pending Shahar's review)*.
1. **Ephemeris:** `skyfield` + JPL **DE421** + the lunar PA kernel `moon_pa_de421_1900-2050.bpc` → frame `MOON_ME_DE421`
   (consistent with LOLA). Validation: **JPL Horizons** topocentric lunar sites (a challenge resource).
2. **App = static website on GitHub Pages** *(pending Shahar's review)*: plain HTML + ES modules, no build step, libraries
   from CDN (three.js, Plotly). No server, no new accounts, instant for judges. Python runs **offline** to precompute
   data (ephemeris tables, horizon profiles, terrain patches) and to validate the physics. The browser does the light
   geometry (topocentric transform, visibility, metrics) from precomputed tables, so **any site and any time** works.
3. **Terrain:** LOLA DEMs from PDS (and Moon Trek where useful). Only small windows around sites are downloaded
   (byte-range reads); total download budget ≈ 1 GB including packages. Precomputed high-quality horizon profiles and 3D terrain
   patches for catalog sites; a smooth horizon (clearly labelled) for custom sites until `dem-tiles` exists.
4. **Map:** a three.js **Moon globe** picker (`web/js/globe/`, orthographic camera, presets Near side / Far side /
   North pole / South pole, drag / wheel / pinch, click returns MOON_ME latitude and east longitude). Textures are
   precomputed by `scripts/data/build_moonmap.py` into `web/data/moonmap/` (about 4.2 MB): the LRO WAC global mosaic
   stitched from **Moon Trek** WMTS tiles (a challenge resource), with LOLA hillshade polar caps (to 68° from LDEM_16 and
   LDEM_75S_240M, plus a 193 m/px south cap poleward of 83.5° S) so the poles look right top-down. Replaces the earlier
   Leaflet map with live Moon Trek tiles, which was too small and could not show the poles *(UI change by Shay's agent,
   pending Shahar's review)*. It works like a web map (2026-11-14, Shay's request): click markers to select several
   places (click a selected pin to remove it, click the ground to drop a pin, drag a dropped pin), a "Search the Moon"
   box with Home (StarHab), missions (with the flag of the nation that flew them), potential Artemis sites, places
   and typed coordinates, a place card, and a globe API for routes, fly-to and fit-to-points (contract C8b,
   `web/js/app/globe_api.js`).
5. **Observer eye height:** 2 m. **Azimuth:** true azimuth everywhere (see docs/CONTRACTS.md §0).
   **Rover traverses (advanced mode):** `web/js/rover/` plans a drive between two points (≤ 60 km) on one live Moon Trek
   LOLA grid (A* on travel time with slope limits, VIPER-class / Apollo LRV presets) and runs the C6 physics along it,
   with a horizon every 100–250 m (contract C10, docs/validation/rover.md) *(speed model approved by Shay, 2026-11-14;
   network use pending Shahar's review)*.
   **Suggested dates:** `web/js/suggest/` ranks mission dates for a site (best solar, Earth-contact and combined
   windows, eclipses of the Sun by the Earth, Earthrises) from one C6 series pass in a module worker (contract C11,
   docs/validation/suggest.md) *(definitions pending Shay's review; not yet wired into the UI)*.
6. **UI: one flow** (2026-11-14, Shay's request after using the app on his phone; replaces the two tabs of the Main Tab
   verdict) *(pending Shahar's review: board flag `single-flow-layout`)*. The page reads in the order a visitor needs it:
   the place (the globe, with catalog sites coloured by kind) and the time (scenario cards; the Start and End fields
   open a date picker with "✨ Suggested for this place", C11; a "Trip" toggle next to the place plans a rover trip
   through stops, C10), or a story (the quick starts, right under the scenario box); then the sky from there (one view per scenario,
   drag to look around, the timelapse bar under the views, a hint when the window holds an eclipse or an Earthrise);
   then **one switch "☀ Sun | 🌍 Earth"** that aims every view at that body and shows its cards, the side-by-side
   table and the charts (with a time cursor at the sky's moment). Phones read it top to bottom; tablets put the globe
   beside the cards; from 1100 px the inputs and the results are two columns. Rare view toggles (close-up,
   constellations, camera exposure, the full readout) sit in each view's "⋯" menu; the sky HUD is minimal and the
   card footer under each view has the full readout.
7. **Data contracts:** `docs/CONTRACTS.md` (binding).

## 1. Big picture
```
 Scenario(s) ──► ephem ──────────────► metrics ──► data panels (plots)
 (site, t0, t1)   (true positions,       ▲  │
                   lunar orientation)    │  └────► sky scene ──► sky viewer (the wow)
                         terrain ────────┘           ▲
                   (DEM -> horizon profile)          │
                         catalog ────────────────────┘
                   (missions, stars, constellations, textures)
```
The physics core is pure Python and testable without any UI. The UI calls a thin API layer. The sky viewer is a
JavaScript component that renders a **SkyScene** JSON. It doesn't compute physics.

## 2. Physics pipeline (Shay's domain, the accuracy requirements)
Shay's principles (2026-11-07):
- **Do not port the old Earth View geometry.** It was patchy. Build the chain cleanly from standard frames.
- **Raw numbers first, rendering later.** The first deliverable is Sun and Earth visibility data, not images.
- **One fixed inertial frame:** the **ICRF** (the International Celestial Reference Frame, the standard astronomers use;
  barycentric, and JPL DE ephemerides are expressed in it). Ephemerides plus the orientation models of the Earth and Moon give a full 3D
  snapshot of the solar system at each instant.
- The **local horizontal plane** is normal to the Moon-centre→observer vector. It is *not* the terrain slope. Before
  occlusion, the only terrain input is the observer's elevation, i.e. its distance from the Moon's centre.
- Terrain occlusion uses the **same method for the Sun and Earth**: what fraction of the body's disk (the cone from the observer)
  is unobstructed. The method is still open. The research brief is `docs/research/terrain-visibility-question.md`, and its answer
  sets steps 5–6 below.

1. **Ephemeris.** JPL DE440 (or DE421 to match the lunar frame kernel; Shay decides) for the Sun, Earth, Moon and planets.
   **Apparent** positions (light-time and aberration) as seen from the site.
2. **Lunar orientation.** The high-accuracy lunar body frame from the JPL binary PCK (`moon_pa_de421_1900-2050.bpc`) plus the
   frame kernel `moon_080317.tf`. LOLA coordinates are in the **MOON_ME** (mean Earth/polar axis) frame. The PA→ME
   offset is about 0.03°, which is hundreds of metres on the surface, so the site must be placed in ME, consistently with the DEM. This is how
   physical libration enters "for free".
3. **Site.** Selenographic lat/lon (ME) and the DEM elevation give a body-fixed position, from which we build a local ENU frame.
4. **Topocentric az/el** of each body, plus distance and angular radius (Sun ≈ 0.27°, Earth ≈ 0.95°).
5. **Terrain horizon.** For each azimuth (e.g. 0.25°–1° steps), the max elevation angle of the terrain along the ray.
   It accounts for lunar curvature, and reaches far (polar horizons can be set by massifs 100+ km away). A multi-resolution DEM
   is used: high-res near field, coarse far field.
6. **Line of sight.** The visible fraction of the body's disk above the horizon profile (disk vs. local horizon curve). 0 means
   hidden, 1 means fully visible.
7. **Derived:** solar flux S = 1361 W/m² · (1 AU/r)² · visible fraction · cos(incidence) for the chosen surface; Earth
   phase from the Sun–Earth–site phase angle; event detection (Earth occulting the Sun, i.e. an eclipse seen from the Moon:
   angular separation < sum of radii); time to the next set or rise by root-finding on the elevation-minus-horizon
   function.
8. **Validation.** JPL Horizons supports topocentric observers **on the Moon** (site coordinates on body 301). Every
   ephemeris function gets pytest checks against Horizons values at several sites and times (an Apollo site, a polar site,
   a far-side site).

Library candidates (Shay and Shahar): `skyfield` (loads DE440 + the lunar PA frame; simple API) or `spiceypy`
(the SPICE standard; frames are exact by construction). **[DECIDE]** Recommendation: `skyfield` for speed of development,
unless the PA→ME handling turns out awkward, in which case `spiceypy`.

## 3. Data (Shahar's domain; the physics of the horizon is Shay's)
> **Eligibility:** at least one NASA dataset must come from the challenge's Resources tab, which is published Fri 2026-11-13. Re-check this
> table against that list on Friday evening (docs/SUBMISSION.md).

| Need | Source (public, NASA PDS / USGS) | Notes |
|---|---|---|
| South pole DEM | LOLA `LDEM_80S_20M` (20 m/px, polar stereographic) | high-res near field for polar sites |
| Mid/low-latitude DEM | `SLDEM2015` (LOLA + Kaguya, ±60°, 512 px/deg ≈ 59 m) | Apollo and most historical sites |
| Global coarse DEM | LOLA `LDEM_16`/`LDEM_64` (~1.9 km / ~0.47 km) | far-field horizon, any map click |
| Moon map textures | NASA Moon Trek WMTS (LRO WAC global mosaic, zoom 3) + LOLA polar hillshade, precomputed into `web/data/moonmap/` | globe location picker |
| Ephemerides and frames | NAIF: DE440/DE421, `moon_pa_de421_1900-2050.bpc`, `moon_080317.tf` | small |
| Stars | Yale Bright Star Catalog or Hipparcos (via skyfield) | mag ≤ 6 is about 9k stars |
| Constellation lines | d3-celestial data (BSD) or similar, **check the licence** | |
| Earth texture | NASA Blue Marble (public domain) | day; optional clouds and night lights |
| Missions | curated JSON; every value **verified with a cited source** | lat/lon (ME), landing UTC, end UTC |

The data pipeline downloads by script into `data/raw/`, derives tiles and horizon caches into `data/cache/`, and commits
nothing large. Horizon profiles for catalog sites can be **precomputed**. Custom sites are computed on demand, and must be fast enough
or show a progress state. **[DECIDE]** the DEM resolution vs. speed trade-off (Shahar + Shay).

## 4. App stack **[DECIDE: Shahar has the say on infra, both on UI]**
| Option | Pros | Cons |
|---|---|---|
| **A. Streamlit shell + custom JS sky component** (three.js) + Plotly | one Python app; fastest to build with agents; free deploy (Streamlit Community Cloud) | limited layout control; the custom component adds bridge code |
| **B. FastAPI backend + single-page front end** (Vite, three.js, Plotly.js, Leaflet) | full UX control, smooth 3D, a cleaner "product" feel | two codebases; more integration work in one day |

Recommendation: **A** for the hackathon. The sky viewer is built as a standalone JS module consuming SkyScene JSON, so it can
move to B later without a rewrite. Hosting must be decided before the deadline (a public URL for judges).

## 5. Layers, folders and owners
| Layer | Folder | Lead (directs the agents) | Domain authority |
|---|---|---|---|
| ephem: true positions, lunar frame, topocentric az/el | `src/moonat/ephem/` | Shay | Shay |
| terrain: DEM acquisition, tiling, caching | `src/moonat/terrain/`, `scripts/data/` | Shahar | Shahar (data) / Shay (horizon math) |
| horizon: horizon profile from DEM | `src/moonat/terrain/horizon.py` | Shahar's agent builds it, Shay validates | Shay |
| catalog: missions, stars, constellations, textures | `src/moonat/catalog/`, `data/` | Shahar | Shahar (data); Shay (mission facts) |
| metrics: LOS, flux, phase, windows, events | `src/moonat/metrics/` | Shay | Shay |
| scene: builds SkyScene + time series for the UI | `src/moonat/scene/` | Shay | both |
| app: scenario builder, map, mission picker, panels | `app/` | Shahar | both |
| sky viewer: three.js renderer of SkyScene | `app/sky_viewer/` | Shay | both |

## 6. Draft contracts (created on the board at kickoff, starting as `assumed`)
All times are UTC as ISO-8601 strings at the API edge and `numpy.datetime64[ns]` or skyfield Time inside. Angles are in degrees. Azimuth
is clockwise from north (0 = N, 90 = E). Elevation is relative to the local **geometric** horizontal plane.

- **`scenario`**: `{id, label, lat_deg, lon_deg, t_start, t_end|null, step_s, source: "coords"|"map"|"mission:<id>"}`.
  lat/lon are selenographic ME, with lon east-positive in −180..180.
- **`body-track`**: `ephem.track(site, times, bodies) -> dict[body, DataFrame]`. Columns: `time, az_deg, el_deg,
  dist_km, ang_radius_deg`. Bodies are `sun, earth`, plus planets (`venus, mars, jupiter, saturn, mercury`) as optional extras.
- **`sky-frame`**: `ephem.icrs_to_enu(site, times) -> (N,3,3)` rotation matrices, used to place stars or any ICRS direction.
- **`horizon-profile`**: `terrain.horizon_profile(lat_deg, lon_deg) -> {az_deg: float[N], el_deg: float[N],
  site_elev_m: float, dem: str, max_range_km: float}`, with N = 360/step and az ascending from 0.
- **`mission-catalog`**: `data/missions.json` is a list of `{id, name, agency, lander, lat_deg, lon_deg, t_land, t_end,
  crew|null, notes, sources: [url]}`.
- **`metrics-series`**: `metrics.compute(scenario) -> DataFrame`. Columns: `time, met_s, sun_el, sun_az, sun_vis_frac,
  flux_horiz_wm2, flux_normal_wm2, earth_el, earth_az, earth_vis_frac, earth_phase_frac, earth_ang_diam_deg`, plus a
  scalar summary dict (`% sunlit`, `% Earth visible`, next sunset or Earthset, ...).
- **`sky-scene`**: the JSON consumed by the viewer: `{site, horizon_profile, frames: [{t, sun:{az,el,r}, earth:{az,el,r,
  phase, sub_observer_lon, sub_observer_lat, sun_dir}, planets:[...], icrs_to_enu: [[...]]}], stars_ref: "<url of
  star JSON>", events: [...]}`.

## 7. Non-goals for the hackathon
User accounts; mobile-native apps; anything not demoable by Saturday evening.
