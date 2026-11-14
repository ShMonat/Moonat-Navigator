# Terrain validation: horizon profiles (C3) and terrain patches (C4)

> AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
> Producer: agent `terrain` (branch `shay/terrain`). The data pipeline is Shahar's domain (pending her review). The horizon maths is Shay's.
> Reproduce: `uv run python scripts/data/build_terrain.py`, `uv run python scripts/data/validate_terrain.py`,
> `uv run python scripts/data/validate_illumination.py`, `uv run pytest tests/test_terrain.py`.

## 1. What is computed
- **Frame:** MOON_ME. The reference sphere is R = 1737.4 km, and heights come from LOLA products.
- **Site and eye:** the ground point is G = (R + h0)·up. The eye is E = G + 2 m·up. "up" is the radial direction, not the terrain normal.
- **Ray:** for a true azimuth A, the ray is the exact great circle u(θ) = cos θ·up + sin θ·d(A), with d = cos A·north + sin A·east.
  The terrain point is P = (R + h(u))·u.
- **Elevation:** el = atan2(ρ cos θ − r_E, ρ sin θ). This is identical to asin(((P − E)·up)/|P − E|), so the curvature is exact.
- **Horizon:** the horizon is the maximum el along the ray. `dist_km` is R·θ at that point.
- **Steps:** the step along a ray equals one pixel of the DEM layer in use, so no DEM cell is skipped.
- **Stopping rule (exact):** a point (ρ ≤ ρ_max, θ) can exceed the running maximum el\* only if ρ_max·cos(θ + el\*) > r_E·cos(el\*).
  - So each ray stops at θ = acos(r_E cos el\* / ρ_max) − el\*.
  - ρ_max is the highest loaded terrain within 0.25 rad (434 km), plus 300 m.
  - `max_range_km` is the longest stop distance over all rays: about 100–280 km.

| Layer | Source | Band |
|---|---|---|
| Near | LOLA polar stereographic 20 m (80–90°S), 30 m (75–90°S) or 60 m (60–90°S); SLDEM2015 512 px/deg (~59 m) within ±60° latitude | 0–30 km (0–17.5 km for the sites placed in §9) |
| Mid | LOLA polar 240 m (whole file) where \|lat\| ≥ 78°; otherwise LDEM_64 (~474 m) | 30–450 km (polar), 30–150 km |
| Far | LOLA LDEM_16 (~1.9 km, global) | beyond the mid band |

- **Projections:** taken from the PDS catalog files `DSMAP.CAT` and `DSMAP_POLAR.CAT`. Each label is checked: reference radius, offsets, extent and record length.
- **Downloads:**
  - Data comes as HTTP multi-range reads into 256 × 256 px blocks, cached in `data/raw/dem/`.
  - Total so far: see §6.
  - Speed: 0.3–1.5 s per horizon, plus 10–30 s per site for downloading when the cache is empty.

## 2. Synthetic tests (`tests/test_terrain.py`)
| Case | Expected | Result |
|---|---|---|
| Smooth sphere, eye 2 m and 10 m | el = −acos(ρ/(ρ + h)) at every azimuth (−0.0870°, −0.1946°); distance √(2ρh) | within 2e-5°; distance within 21 m |
| Gaussian hill (2 km high, σ = 3 km, 25 km away, bearing 60°) | dense 1-m brute force along the exact ray | within 0.002°; peak at az index 240 (60°); distance within 50 m |
| Stopping rule | just inside the bound a point at ρ_max can exceed el\*; just outside it cannot | exact |
| Polar projection | forward vs the inverse printed in DSMAP_POLAR.CAT; lon 0 up, 90°E right | 1e-9° |
| Terrain patch on a sphere | z = √((R+H)² − s²) − (R+H) (curvature drop 82.9 m at the corner) | within 1 mm |

## 3. Georeferencing against published points
| Check | Published | Ours |
|---|---|---|
| Shackleton floor centre, 89.655°S 129.174°E (Zuber et al. 2012) | −2.77 km (floor radius 1734.63 km) | **−2769 m** (LDEM_75S_240M). The mirrored longitude reads +776 m, which rules out a sign flip. |
| Apollo 11 LM ground, 0.67416°N 23.47314°E (LROC; Wagner et al. 2017) | −1926 m | **−1929.5 m** (SLDEM2015, bilinear); LDEM_16 gives −1921.6 m |

## 4. Independent far-field check: point cloud vs ray marching
- **What it does:** every pixel of the mid layer between 5 and 120 km is placed in 3-D with the *inverse* projection.
  - The inverse is written separately in `validate_terrain.py` from the PDS text.
  - Each pixel is binned by azimuth over its angular footprint. The bin maxima are then compared with the ray-marched horizon of the same layer and band.
- **What it catches:** a wrong azimuth convention, a wrong frame or a sign error. These would show up as a lag or as a loss of correlation.

| Site (layer) | Pixels | Correlation | Median diff | 5–95 % | Best lag | Correlation if azimuth mirrored |
|---|---|---|---|---|---|---|
| apollo11 (LDEM_64) | 201,219 | 0.9995 | +0.006° | −0.02…+0.04° | 0.5° | −0.50 |
| shackleton_rim (LDEM_75S_240M) | 784,696 | 0.9997 | +0.004° | −0.01…+0.04° | 0.0° | +0.12 |

## 5. Illumination against published values (south pole)
- **How we computed it:**
  - Sun position: `moonat.ephem.direct` (skyfield + DE421 + MOON_ME), every 2 h from 2020-01-01 to 2038-07-01 (18.5 yr).
  - Visible solar-disk fraction above our horizon: `moonat.visibility` (400-point disk).
- **Reference:** Gläser et al. 2014 used 20 m LOLA DTMs, 1 h steps over about 19–20 yr, and the Sun as a disk.

| Point | Eye | Published avg illum. / time lit | **Ours** avg / lit | Ours, longest dark |
|---|---|---|---|---|
| CR1 spot 1, 89.4395°S 222.8066°E | 2 m | 88.1 % / 92 % | **86.0 % / 90.6 %** | 9.6 d |
| CR1 spot 3, 89.4516°S 222.7581°E | 10 m | 92.5 % / 95.6 % | **92.7 % / 95.8 %** | 3.1 d (spot 4 published: 3.17 d) |
| catalog `shackleton_rim`, 89.45°S 137.3°W | 2 m | n/a | 71.8 % / 77.3 % (80.6 % if terrain < 100 m is ignored) | 11.1 d |

**Result:**
- At 10 m we agree with Gläser within 0.2 percentage points.
- At 2 m we are 2 points lower. This is expected, because the near-field DEM texture matters more for a low eye (§7).
- The catalog POI uses rounded coordinates. It lies a few hundred metres off the ridge crest, and that costs about 15 points of illumination.
- **Done on branch `shay/polar-sites`:** `shackleton_rim` now uses Gläser's CR1 spot 1, **−89.4395, −137.1934**. The change is pending Shahar's review; see §9.

## 6. Real-site sanity (all catalog sites)
See the table below (generated in `docs/validation/terrain_sites.json`) and the figures `docs/figures/horizon_<id>.png`.
Highlights:
- **Apollo 11 (mare):** −0.44…+2.43°, mean +1.17°.
  - The mare is flat. The positive mean comes from the site sitting about 3 m below its 150–1000 m surroundings, on a 0.9° regional slope. That is at the DEM noise level (see §7).
  - Ignoring terrain closer than 500 m gives −0.52…+1.62°, mean 0.43°.
- **Apollo 15:** the maximum is 13.6° at az 179.5° (due south), 10.4 km away. This is **Hadley Delta**.
  The second peak is 11.2° at about az 45° (NE), 20 km away. This is **Mons Hadley**. To the west (Hadley Rille) the horizon is low, at 1–2°.
- **Apollo 17:** the maximum is 14.2° at az 1° (north), 6.4 km away. This is the **North Massif** of the Taurus-Littrow valley.
- **Apollo 16:** the maximum is 5.4° at az 164°, 5.7 km away, toward Stone Mountain.
- **Chang'e 4:** the maximum is 3.0° at 50 km. This is the rim of Von Kármán crater.
- **IM-1 Odysseus:** 11° at 100 m. The site lies on a steep local slope; Odysseus tipped over on landing on a slope.
- **de Gerlache rim:** the old catalog coordinates (−88.5, −87.1) were the **crater centre**.
  - There the ground read −1010 m, and the horizon was 2.7–10.6° (the crater walls).
  - The POI has moved to a rim-crest point, and the Artemis candidates have moved as well (§9).

| Site | lat, lon | Ground (m) | Horizon min / mean / max (deg) | Max at az (deg), dist (km) | Range (km) | Near-field DEM |
|---|---|---|---|---|---|---|
| apollo11 | 0.6741, 23.4730 | -1930 | -0.44 / 1.17 / 2.43 | 206.50, 0.4 | 152 | SLDEM2015 LOLA+SELENE TC |
| shackleton_rim | -89.4395, -137.1934 | 1958 | -2.62 / -1.56 / -0.43 | 182.00, 0.3 | 237 | LOLA LDEM_80S_20M |
| apollo12 | -3.0124, -23.4216 | -1424 | -0.55 / 0.38 / 2.08 | 64.75, 0.1 | 106 | SLDEM2015 LOLA+SELENE TC |
| apollo14 | -3.6453, -17.4714 | -1063 | 0.26 / 1.85 / 4.34 | 75.00, 1.4 | 104 | SLDEM2015 LOLA+SELENE TC |
| apollo15 | 26.1322, 3.6339 | -1928 | 0.36 / 5.05 / 13.60 | 179.50, 10.4 | 129 | SLDEM2015 LOLA+SELENE TC |
| apollo16 | -8.9730, 15.5002 | 12 | -0.03 / 2.45 / 5.43 | 164.25, 5.7 | 131 | SLDEM2015 LOLA+SELENE TC |
| apollo17 | 20.1908, 30.7717 | -2627 | 0.25 / 6.55 / 14.19 | 1.00, 6.4 | 123 | SLDEM2015 LOLA+SELENE TC |
| change4 | -45.4561, 177.5885 | -5929 | 0.01 / 1.30 / 2.97 | 160.75, 49.9 | 153 | SLDEM2015 LOLA+SELENE TC |
| chandrayaan3 | -69.3730, 32.3190 | 529 | 0.53 / 1.36 / 2.48 | 349.25, 16.1 | 127 | LOLA LDEM_60S_60M |
| im1 | -80.1286, 1.4376 | 2588 | -0.24 / 4.86 / 11.04 | 122.00, 0.1 | 136 | LOLA LDEM_75S_30M |
| malapert_massif | -85.9900, 0.1200 | 4843 | -4.00 / 0.00 / 4.76 | 90.50, 3.6 | 274 | LOLA LDEM_80S_20M |
| degerlache_rim | -89.0056, -96.6455 | 1551 | -3.75 / -1.05 / 1.45 | 68.00, 0.1 | 295 | LOLA LDEM_80S_20M |
| south_pole | -90.0000, 0.0000 | 1290 | -1.96 / 3.87 / 11.26 | 260.50, 0.2 | 216 | LOLA LDEM_80S_20M |
| luna9 | 7.0800, -64.3700 | -1343 | -1.22 / 4.22 / 8.75 | 251.25, 3.0 | 162 | SLDEM2015 LOLA+SELENE TC |
| luna13 | 18.8700, -62.0500 | -2175 | 0.13 / 0.94 / 2.89 | 159.75, 0.2 | 111 | SLDEM2015 LOLA+SELENE TC |
| luna16 | -0.6800, 56.3000 | -2466 | -0.35 / 0.63 / 1.62 | 39.25, 0.2 | 135 | SLDEM2015 LOLA+SELENE TC |
| luna17 | 38.2800, -35.0000 | -2468 | -0.13 / 0.67 / 1.82 | 82.00, 0.1 | 118 | SLDEM2015 LOLA+SELENE TC |
| luna20 | 3.5700, 56.5500 | -1801 | -0.65 / 2.65 / 8.85 | 289.50, 6.4 | 138 | SLDEM2015 LOLA+SELENE TC |
| luna21 | 25.8500, 30.4500 | -2674 | -0.16 / 2.22 / 5.73 | 123.25, 25.1 | 136 | SLDEM2015 LOLA+SELENE TC |
| luna24 | 12.7500, 62.2000 | -3686 | 0.40 / 1.44 / 2.78 | 11.25, 3.3 | 142 | SLDEM2015 LOLA+SELENE TC |
| surveyor1 | -2.4740, -43.3390 | -1886 | -0.22 / 0.42 / 1.39 | 21.00, 0.2 | 103 | SLDEM2015 LOLA+SELENE TC |
| surveyor3 | -3.0150, -23.4180 | -1424 | -0.54 / 0.33 / 2.16 | 14.75, 0.1 | 106 | SLDEM2015 LOLA+SELENE TC |
| surveyor5 | 1.4610, 23.1950 | -2052 | -0.20 / 0.67 / 1.81 | 195.75, 0.3 | 146 | SLDEM2015 LOLA+SELENE TC |
| surveyor6 | 0.4743, -1.4275 | -765 | 0.16 / 1.01 / 2.44 | 84.75, 0.4 | 124 | SLDEM2015 LOLA+SELENE TC |
| surveyor7 | -40.9800, -11.5140 | 70 | 0.96 / 3.46 / 6.09 | 237.00, 0.2 | 67 | SLDEM2015 LOLA+SELENE TC |
| change3 | 44.1200, -19.5100 | -2632 | -0.41 / 0.67 / 3.62 | 344.25, 0.1 | 130 | SLDEM2015 LOLA+SELENE TC |
| change5 | 43.0576, -51.9161 | -2544 | -0.34 / 0.15 / 2.03 | 200.00, 12.7 | 126 | SLDEM2015 LOLA+SELENE TC |
| change6 | -41.6385, -153.9852 | -5256 | -0.07 / 0.87 / 3.27 | 184.75, 43.3 | 205 | SLDEM2015 LOLA+SELENE TC |
| slim | -13.3160, 25.2510 | -912 | 0.47 / 5.42 / 9.70 | 1.25, 2.7 | 128 | SLDEM2015 LOLA+SELENE TC |
| blueghost1 | 18.5623, 61.8103 | -3651 | 0.02 / 0.91 / 2.48 | 36.50, 0.1 | 155 | SLDEM2015 LOLA+SELENE TC |
| im2 | -84.7906, 29.1957 | 5322 | -1.47 / 1.17 / 4.07 | 117.25, 16.5 | 139 | LOLA LDEM_80S_20M |
| art_cabeusb | -83.6164, -68.5775 | 4587 | -4.81 / -1.20 / 3.13 | 309.25, 0.1 | 321 | LOLA LDEM_80S_20M |
| art_haworth | -86.9555, -24.1657 | 1809 | -3.39 / -0.27 / 2.97 | 6.00, 17.7 | 275 | LOLA LDEM_80S_20M |
| art_malapert | -85.9961, 2.0095 | 5163 | -5.05 / -1.24 / 1.96 | 6.00, 0.1 | 329 | LOLA LDEM_80S_20M |
| art_mouton_plateau | -84.2237, 29.0434 | 5189 | -3.86 / 0.15 / 5.54 | 150.00, 0.3 | 262 | LOLA LDEM_80S_20M |
| art_mouton | -85.4798, 31.3216 | 6301 | -5.32 / -0.83 / 3.80 | 24.25, 2.3 | 333 | LOLA LDEM_80S_20M |
| art_nobile1 | -84.3661, 44.3500 | 6166 | -4.49 / -1.01 / 2.63 | 234.50, 16.8 | 286 | LOLA LDEM_80S_20M |
| art_nobile2 | -84.1053, 59.6634 | 1427 | -2.49 / 0.61 / 5.49 | 256.00, 37.4 | 237 | LOLA LDEM_80S_20M |
| art_degerlache2 | -88.7036, -68.4769 | 1780 | -3.49 / -1.17 / 1.78 | 4.25, 1.0 | 280 | LOLA LDEM_80S_20M |
| art_slater | -87.6901, 107.2054 | 3 | -1.46 / 0.50 / 1.98 | 260.50, 13.9 | 210 | LOLA LDEM_80S_20M |

## 7. Error budget and the open question (for Shay)
- **DEM vertical error:**
  - About 1–3 m locally (LOLA polar 20 m; SLDEM2015 has residuals of about 3–5 m).
  - At distance d, an error δh gives δel ≈ δh/d. This is 0.1° at 1.7 km for 3 m, and under 0.01° beyond 20 km.
- **Near field:**
  - With a 2 m eye, terrain within about 500 m that sits 1–3 m above the bilinear ground point can raise the horizon by up to about 1°.
    Examples: shackleton_rim mean −0.88° with all terrain, −1.26° ignoring < 100 m, −1.74° ignoring < 500 m.
  - It is physically real *for the DEM surface*. But it sits at the DEM noise level, and it is very sensitive to the exact site position (±150 m for 0.01° coordinates).
  - C3 keeps all terrain, as the contract defines. `horizon_profile(min_dist_m=...)` and `observer_height_m` let Shay choose a cutoff or a mast height.
  - The 10 m case matches the published illumination best.
- **Far field:** the DEM resolution limits it (240 m to 1.9 km). The point-cloud check bounds the sampling error at about 0.04° (95 %).
- **Azimuth sampling:** 0.25° steps; consumers interpolate linearly between steps.

## 8. C5 DEM tiles (browser horizons for clicked sites)
- **What they are:** `web/data/dem/` holds two levels, 11.7 MB in total (format in docs/CONTRACTS.md C5):
  - `global8`: 8 px/deg, about 3.8 km;
  - `south480`: 480 m, 80–90°S.
- **How we tested them:** we computed horizons from the tiles alone with the same algorithm, and compared them with the full C3 horizon. Run `validate_terrain.py tiles <ids>`.
  The "smooth" column is the error of the fallback without tiles (el = 0 everywhere).

| Site | Smooth vs C3, RMS | **Tiles vs C3, RMS (bias)** | Tiles vs C3 far field > 5 km, RMS (bias) |
|---|---|---|---|
| apollo11 | 1.45° | 1.31° (−1.20°) | 0.22° (−0.18°) |
| apollo15 | 6.29° | **1.21°** (−1.01°) | 1.11° (−0.79°) |
| apollo17 | 7.51° | **1.76°** (−1.40°) | 1.76° (−1.39°) |
| change4 | 1.54° | 0.47° (−0.36°) | 0.23° (−0.19°) |
| chandrayaan3 | 1.45° | 0.51° (−0.41°) | 0.36° (−0.31°) |
| shackleton_rim | 1.26° | 1.33° (−1.06°) | 0.64° (+0.25°) |
| south_pole | 5.78° | 5.62° (−3.93°) | 1.03° (+0.34°) |
| malapert_massif | 2.46° | 2.26° (−1.08°) | 1.45° (+1.13°) |

**Reading the table:**
- Tiles recover the big far-field features, such as valley walls and crater rims. They cut the error 4–5× at Apollo 15 and 17.
- They cannot reproduce near-field relief (the first 1–5 km). Tile horizons are therefore biased low wherever the near field sets the horizon.
- The UI should label tile-based horizons as approximate.

## 9. South-pole site placement (branch `shay/polar-sites`; catalog data, pending Shahar's review)
**Why:** the earlier catalog points for the polar POIs and the Artemis III candidates were rough estimates.
Several of them landed on crater floors. For example, de Gerlache and Haworth were placed at the crater centres, and the Cabeus B point was about 100 km off.

**What changed:**
- **`shackleton_rim`:** set to Gläser et al. 2014 CR1 spot 1, −89.4395, −137.1934. Our 18.5-yr check there gives 86.0 % against 88.1 % published (§5).
- **`degerlache_rim`:** the Moonat point with the highest mean Sun visibility on the rim annulus 12–22 km from the crater centre.
- **Artemis III candidate regions (`kind = candidate`):** each now uses a representative highly illuminated point chosen by Moonat from LOLA terrain. The regions themselves are NASA's (Oct 2024).
  - Region centres come from the LROC NAC low-Sun mosaics made for each region. The product id encodes the centre, e.g. `P836S2912` = 83.6°S, 291.2°E.
  - We found no mosaic for Nobile Rim 1 or Slater Plain:
    - Nobile Rim 1 is the best point on the Nobile rim annulus, at least 30 km from the Nobile Rim 2 point;
    - Slater Plain is searched around Slater crater.

**Method** (`scripts/data/search_polar_sites.py`):
- **Sun:** directions for 2027 at 2 h steps, from skyfield + DE421 + MOON_ME.
- **Coarse stage:** every candidate on a 2 km grid (3 km for the wide Nobile rim annulus) gets a horizon from our layers at 1° azimuth steps.
- **Refinement:** ±1.5 km at 250 m around the two best coarse points, at 0.5° azimuth steps.
- **Score:** the mean of a linear disk-fraction proxy.
- **Near-field data:** LOLA 20 m where already cached, otherwise 240 m. This kept the search inside the 500 MB download budget.
- **Final number:** the "C3" column below is the exact `moonat.visibility` disk fraction, using the published 0.25° horizon file of the chosen point and a topocentric Sun.
- **Near field of the published files:** these sites use a 17.5 km LOLA 20 m near field, with 240 m beyond. That still covers the whole ±12 km terrain patch.

| Site | Region centre (source) | Search | Chosen point | Ground (m) | Sun vis. 2027, search | **Sun vis. 2027, C3** | At the region centre |
|---|---|---|---|---|---|---|---|
| degerlache_rim | -88.5, -87.1 (crater centre; rim annulus searched) | 12-22 km | -89.0056, -96.6455 | 1551 | 70.9 % | **70.7 %** (lit 76 %) | 0.0 % |
| art_cabeusb | -83.6, -68.8 (LROC CABEUSPKLOA (P836S2912)) | <= 15 km | -83.6164, -68.5775 | 4587 | 63.4 % | **58.0 %** (lit 61 %) | 51.3 % |
| art_haworth | -86.7, -23.7 (LROC HAWORTH_LOA (P867S3363)) | <= 15 km | -86.9555, -24.1657 | 1809 | 60.0 % | **57.0 %** (lit 64 %) | 31.9 % |
| art_malapert | -86.0, 0.3 (LROC MALAPERTLOA (P860S0003)) | <= 15 km | -85.9961, 2.0095 | 5163 | 75.9 % | **75.9 %** (lit 79 %) | 31.7 % |
| art_mouton_plateau | -84.3, 30.6 (LROC MOUTNPLTLO1 (P843S0306)) | <= 15 km | -84.2237, 29.0434 | 5189 | 51.4 % | **51.4 %** (lit 52 %) | 23.8 % |
| art_mouton | -85.4, 35.3 (LROC MTMOUTONLOB (P854S0353)) | <= 15 km | -85.4798, 31.3216 | 6301 | 72.7 % | **72.3 %** (lit 78 %) | 12.9 % |
| art_nobile2 | -83.9, 58.7 (LROC NOBILE02LOA (P839S0587)) | <= 15 km | -84.1053, 59.6634 | 1427 | 52.0 % | **52.0 %** (lit 53 %) | 33.8 % |
| art_nobile1 | -85.2, 53.5 (Nobile crater rim annulus (no LROC mosaic found)) | 30-42 km | -84.3661, 44.35 | 6166 | 64.9 % | **61.3 %** (lit 64 %) | 32.2 % |
| art_degerlache2 | -88.5, -66.7 (LROC DEGERRIMLO1 (P885S2933)) | <= 15 km | -88.7036, -68.4769 | 1780 | 74.4 % | **74.4 %** (lit 80 %) | 32.0 % |
| art_slater | -88.1, 111.3 (Slater crater (-88.08, 111.29); no LROC mosaic found) | <= 15 km | -87.6901, 107.2054 | 3 | 40.5 % | **40.5 %** (lit 46 %) | 0.0 % |

Sections 4 and 8 were computed at the earlier `shackleton_rim` point (−89.45, −137.3).

**Independent cross-checks:**
- **de Gerlache Rim 2:** a first search centred on the old catalog guess converged to −88.67, −68.43. That is about 5 km from the LROC mosaic centre (−88.5, −66.7), which we did not know about at that point. The final point, −88.70, −68.48, is 1 km from it.
- **Malapert:** our point (85.996°S, 2.01°E, ground +5163 m) has a mean Sun visibility of 75.9 % over 2027. Bussey et al. 2010 give 74 % over a lunar year for their Malapert point M1 at 86.04°S, 2.7°E, about 2.5 km away.
- **Search vs C3 column:** the two agree within 0–5 points. The largest gaps are at Cabeus B and Haworth, where no 20 m blocks were cached during the search, so 240 m was used for the near field there.
- **Download:** the near fields for the new points added 21 MB; the terrain layer total is now 471 MB (budget 500 MB).
