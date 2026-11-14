<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# Validation: browser physics (C6) and the Python reference metrics

What the browser computes, how we test it, and how close it gets. Run the tests with:
`uv run pytest` (Python) and `node --test web/tests/` (JavaScript, Node 20+; no npm packages).

## 1. What is computed
| Quantity | Where | Method |
|---|---|---|
| Sun/Earth/planet state at time t | `web/js/physics/ephem.js` | C1 binary tables, cubic Hermite on positions, slerp on the ICRS→ME quaternion |
| Site position and local frame | `web/js/physics/frames.js` | radius 1737.4 km + DEM height + 2 m eye; ENU with up = radial, north = ME +Z projected |
| Topocentric az/el, distance, angular radius | `web/js/physics/index.js` | body_ME − site_ME, rotated into ENU; ρ = asin(R/d) |
| Visible fraction `vis_frac`, flux fraction `flux_frac` | `visibility.js` = `src/moonat/visibility.py` | 400-point sunflower sampling of the disk (uniform in solid angle), each point mapped exactly to az/el and compared with the horizon profile |
| Flux | `metrics.js` = `src/moonat/metrics.py` | 1361 W/m² · (1 au / r)² · flux_frac (· sin el on the horizontal) |
| Earth phase | same | (1 + cos α)/2, α = Sun–Earth–observer angle |
| Earth Rotation Angle | `frames.js` | IERS 2010 eq. 5.15 with UT1 = UTC |
| Next sunset / Earthset | `metrics.js` | first sample pair vis > 0 → 0, then bisection on the real geometry to 1 s |

The visibility step is "anti-aliased": a point that lies within half a point spacing of the horizon counts
partly. This makes `vis_frac` a smooth function of time, so plots have no stair steps and set times can be
found by bisection.

## 2. Tests and results
| Test | Reference | Result | Tolerance |
|---|---|---|---|
| Disk vs flat horizon, centre at el = x·ρ, x ∈ [−1.1, 1.1] | analytic circular-segment area | max error **0.0025** (Sun and Earth sizes) | 0.003 (contract 0.01) |
| Centre on the horizon | 0.5 by symmetry | 0.4987 | 0.003 |
| Limb-darkened half disk | 0.5 by symmetry | 0.4997 | 0.003 |
| Disk at ±2ρ | 1 / 0 | exact (fast path) | exact |
| Vertical wall through the disk centre (0.01° profile step) | 0.5 | 0.5075 (the wall ramps over one step) | 0.02 |
| Disk on the zenith vs a horizon at 89.8° | cap ratio (1 − cos 0.2°)/(1 − cos 0.5°) = 0.160 | 0.1607 | 0.01 |
| Azimuth wrap-around at 0/360 | same case rotated by 180° | identical | 1e-9 |
| JS visibility vs Python (87 fixture cases) | `tests/fixtures/metrics_cases.json` | max difference **5e-14** | 1e-9 |
| Flux at 1 au, el = 30° | 680.5 W/m² | exact | 1e-9 |
| Earth Rotation Angle at J2000.0 | 280.46061837504° (IERS) | exact | 1e-9° |
| Site frame: altitude of ME +Z pole = latitude; south-pole axes | geometry | exact | 1e-9° |
| Table interpolation, 2 h step (synthetic analytic ephemeris) | the analytic model | max direction error **0.02 arcsec** | 0.5 arcsec |
| Year boundary (Dec 31 → Jan 1) | the analytic model | smooth, < 0.5 arcsec | 0.5 arcsec |
| `series()` vs `skyState()` at the same instants | itself | identical | 1e-12 |
| Refined sunset | vis = 0 at the time, > 0 two seconds before | yes | 1 s |
| Real tables: `skyState` vs `tests/fixtures/ephem_cases.json` (30 cases from `moonat.ephem.table`) | Python reference | Sun/Earth/planets az/el **1e-11°**, phase 5e-14, distance 3e-15 (rel.), `r_icrs_to_enu` 2e-13, ERA 7e-10° | az/el 0.001°, phase 0.001 |

## 3. Performance
`series()` over 30 days at 10-minute steps (4321 samples) at a polar site with a 1440-point terrain horizon:
**18 ms** in Node 26 on the team laptop (target < 1 s). Most samples take the fast path (the whole disk is
clearly above or below the horizon); only samples near rising and setting sample the disk.

## 4. Real ephemeris tables (DE421, 3 h step, 1966–1976 and 2013–2040)
The JS reader follows the manifest's `interpolation_scheme` text exactly (per-year tangents: central
differences inside, third-order one-sided at both ends of each year file; slerp on the quaternion).

**Cross-check against the `ephem` Python table reader** (`moonat.ephem.table.sky_state`, same tables):
288 cases = 6 sites (Apollo 11, 89.9° S, the exact south pole, Chang'e 4, 33° N 170° W, 89.95° N)
× 48 times (random over all years, plus year starts and ends, a leap day and a leap-second day).

| Quantity | Worst JS − Python |
|---|---|
| Sun, Earth az·cos(el) and el | 3e-11° |
| Planets az·cos(el) and el | 4e-11° |
| Sun / Earth distance | 2e-7 km / 1e-8 km |
| Earth phase | 2e-13 |
| `r_icrs_to_enu` elements | 5e-13 |
| ERA | 7e-10° |

So the browser reproduces the Python reference to floating-point noise. The accuracy of the tables themselves
against JPL Horizons is validated by the `ephem` work item (its manifest reports an interpolation error
≤ 0.52 arcsec vs direct skyfield). The formal test `web/tests/physics_ephem.test.mjs` checks every field of the 30 cases in
`tests/fixtures/ephem_cases.json` (results in §2).

**Sanity, Apollo 11 landing** (1969-07-20 20:17:40 UTC, 0.67416° N 23.47314° E): Sun az 88.8°, el **10.70°**
(the mission planned a ~10.8° Sun angle for landing); Earth az 272.2° (west), el 59.2°, apparent diameter 1.88°,
phase 0.67 (waning gibbous Earth while the Moon was a waxing crescent seen from Earth).

**Speed on the real tables:** a 30-day, 10-minute series takes 9 ms, including the first load of the year file
(409 kB).

## 5. Known limits
- UT1 is taken as UTC (≤ 0.9 s, i.e. ≤ 0.004° of Earth rotation): only affects the drawn Earth globe.
- The Earth's body frame is R_icrs_to_enu · Rz(ERA); precession–nutation (~0.36° in 2026) is ignored. Only the
  drawn Earth globe uses it.
- Body radii come from the ephemeris manifest (`body_radii_km`): Sun 695 700 km (IAU 2015 nominal, as JPL Horizons), Earth 6 378.137 km (equatorial;
  the Earth's 0.3 % flattening is ignored).
- The horizon profile is assumed single-valued in azimuth (true for any heightfield DEM).

## 6. Horizons for custom (map-clicked) points from the DEM tiles (C5)
`horizonFromTiles(lat, lon)` in `web/js/physics/terrain.js` is a line-by-line port of `moonat.terrain.horizon` run on
`moonat.terrain.tiles.tiles_dem`. It uses the same layers (south480 within 450 km for |lat| ≥ 78°, else global8), the same
ray schedule, bilinear sampling, region maximum height and stopping rule. The one intended difference: longitude wraps
across 0°/360°, where the Python reader leaves a 0.125° gap.

**JS vs Python** (`tests/fixtures/custom_horizon_cases.json`, az step 0.5°, eye 2 m):

| Site | Kind | JS − Python, max | Tiles fetched (cold) | Compute (Node) |
|---|---|---|---|---|
| apollo11 | equatorial mare | 0 (identical at 1e-4°) | 4 (0.46 MB) | 24 ms |
| apollo16 | Descartes highlands | 0 | 4 (shared with Apollo 11) | 10 ms |
| apollo17 | Taurus-Littrow valley | 0 | 2 more | 5 ms |
| change4 | far side | 0 | 4 (0.46 MB) | 12 ms |
| art_haworth | 87.5° S | 0 | 35 (4.5 MB: 23 polar + 12 global) | 53 ms |
| shackleton_rim | 89.45° S | 0 | (same tiles) | 41 ms |
| south_pole | exactly 90° S | 0 | (same tiles) | 58 ms |
| 80° N, 30° E | high north | 0 | 12 (1.4 MB) | 20 ms |

The browser time is dominated by the download (0.5 MB for most sites, up to 4.5 MB the first time near the south pole).
Tiles and results are cached, so the next point in the same region costs only the compute time.

**Tiles vs the full-resolution C3 profiles** (the missing near field, `web/tests/physics_terrain.test.mjs`):

| Site | Tiles − C3: RMS (bias) | Flat horizon − C3: RMS |
|---|---|---|
| apollo11 | 1.31° (−1.20°) | 1.45° |
| apollo16 | 1.71° (−1.37°) | 2.87° |
| apollo17 | 1.76° (−1.40°) | 7.51° |
| change4 | 0.47° (−0.36°) | 1.54° |
| art_haworth | 0.03° (−0.02°) | 7.14° |
| shackleton_rim | 1.33° (−1.06°) | 1.26° |
| south_pole | 5.62° (−3.93°) | 5.78° |

Tile horizons read **about 1–1.4° low** at typical sites, because the relief within the first few km is below the tile
resolution. Where the far field sets the horizon (valleys, crater walls: Apollo 17, Haworth), they are 4× to 200×
better than a flat horizon. On rims and peaks (Shackleton, the south pole), the near field dominates and tiles do not help.
The UI labels these horizons "approximate terrain (coarse)".
