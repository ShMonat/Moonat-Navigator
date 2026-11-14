# Research: real high-resolution terrain for ANY point on the Moon (static site, no server)

> AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
> Branch `shay/terrain-everywhere`, 2026-11-14. Probes were run live from Israel on that date.
> Domains: the data source and caching are Shahar's (pending her review); the horizon maths is Shay's.
> Validation of what was built: [docs/validation/terrain-everywhere.md](../validation/terrain-everywhere.md).

## Answer in one paragraph
**NASA Moon Trek serves raw LOLA heights to any web page.** Its ArcGIS ImageServer (`exportImage`) returns float32
heights (m above the 1737.4 km sphere) for any box, **resampled by the server into any projection we pass**, with
`Access-Control-Allow-Origin: *`. We ask for three small grids centred on the clicked point in a site-centred
stereographic plane: 20 m (85–90°S) or 30 m (75–90°) near the poles and 118 m elsewhere for the near field, and
coarser levels out to 64–96 km. The shipped C5 tiles still cover the far field. One clicked point costs **0.4–0.75 MB and
about 1–3 s** (up to 4.5 s when the server is busy); the ray march takes under 0.1 s. Against the precomputed C3
horizons, the error drops from 0.5–5.6° RMS (tiles only) to **0.07–0.37° RMS** at 10 of 12 test sites. The other two are
mare and highland sites near the equator (Apollo 11, Apollo 16), where the horizon is set by terrain within 1 km and
SLDEM2015 (59 m) cannot be reached from a browser.

## (a) Which services give raw elevation to a browser?
"CORS" = the response carries `Access-Control-Allow-Origin`, so a script on `shmonat.github.io` may read it.

| Source | What it serves | Raw heights? | CORS | Resolution | Verdict |
|---|---|---|---|---|---|
| **Moon Trek ArcGIS ImageServer** `https://trek.nasa.gov/moon/trekarcgis/rest/services/<layer>/ImageServer/exportImage` | Any bbox, any size up to 15000 × 4100 px, any output projection (WKT); `format=lerc` (LERC 1, lossless to a set tolerance), `bsq` (float32 + validity bitset) or `tiff`; `pixelType=F32` | **yes** (F32 m) | **`*`** | 20 m, 30 m, 100 m polar; 118 m and 237 m global | **chosen** |
| Moon Trek WMTS DEM layers, e.g. `tiles/Moon/EQ/LRO_LOLAKaguya_DEM_60N60S_512ppd/1.0.0/default/default028mm/{z}/{y}/{x}.png` | 256² PNG tiles; matrix `default028mm`: zoom z has 2^(z+1) × 2^z tiles, top-left (−180°, 90°), zoom 0–12 | **no**: 8-bit grey + alpha (a display stretch, about 80 m per grey level) | `*` | — | rejected |
| Moon Trek 3D globe terrain `https://marshub.s3.amazonaws.com/moon_v14/` (found in `trek.nasa.gov/moon/jpl/config/config.json`, key `terrainEndpoint`) | Cesium **quantized-mesh-1.0**, TMS geographic tiling, global to zoom 9 (0.35° tiles), local patches to zoom 15; gzip | yes, but as a **simplified TIN**: 15–98 vertices per 10 km tile at zoom 9, heights in whole metres | `*` (S3) | ~1–2 km effective | rejected for horizons |
| Moon Trek elevation-profile services (`TrekServices/ws/elevationProfile/...`) | Height profile along one line | yes | — | — | 1440 calls per point; not pursued |
| USGS Astrogeology mosaics (`planetarymaps.usgs.gov/mosaic/` → S3 `asc-pds-services`) | `Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif` (8.5 GB BigTIFF, uncompressed int16, one row per strip); `Lunar_safed/LMAP/SouthPolar/ldem_87s_5mpp_cog.tif` (5 m, 87–90°S, a true COG: 512² deflate tiles + 7 overviews down to 640 m) | yes | `*`, byte ranges OK | 118 m; 5 m (pole only) | good static fallback; not needed now. No SLDEM2015 there. |
| NASA PDS Geosciences (LOLA GDR, SLDEM2015) and the MIT `imbrium.mit.edu` SLDEM2015 mirror | IMG files, byte ranges OK | yes | **none** | 20 m – 59 m | not readable from a browser |

**The Moon Trek layers we use** (all LOLA; MOON_ME latitude/longitude; heights in metres above the 1737.4 km sphere; the
service spatial reference is `GCS_Moon_2000`, a sphere of radius 1737400 m):

| Key | Layer id | Pixel | Coverage | Notes |
|---|---|---|---|---|
| `south20` | `ldem_85s_20m_Spole_float_SP` | 20 m | ±151.68 km around the S pole (≈ 85–90°S) | same 20 m LOLA family as our C3 polar near field |
| `south30` / `north30` | `LRO_LOLA_DEM_SPole75_30mp_v04` / `..._NPole75_30mp_v04` | 30 m | ±457 km (≈ 75–90°) | |
| `global118` | `LRO_LOLA_DEM_Global_256ppd_v06` | 1/256° ≈ 118 m | global | the layer Moon Trek's own tools query |
| `global237` | `LRO_LOLA_DEM_Global_128ppd_v04` | 1/128° ≈ 237 m | global | = PDS LDEM_128 |

Not used: `ldem_85s_20m_Spole_float` (without `_SP`) returned wrong heights when reprojected (−2439 m at the Shackleton
rim instead of +1958 m); `LRO_LOLA_DEM_SPole875_5mp_v04` (5 m, 87.5–90°S) and the 100 m polar layers work but add nothing at
our grid sizes. SLDEM2015 (`LRO_LOLAKaguya_DEM_60N60S_512ppd`) exists only as the 8-bit WMTS layer and has **no** ImageServer.

**Checks of units, datum and georeferencing** (details in the validation doc):
- Ground height at the Shackleton rim: 1958.46 m (Moon Trek 20 m) vs 1957.99 m (our PDS LDEM_80S_20M). At Apollo 11:
  −1926.6 m (Moon Trek 118 m) vs −1929.5 m (SLDEM2015) and −1926 m published (Wagner et al. 2017).
- The Moon Trek grids match our C4 patches with a **best-fit shift of 0 m** at the Shackleton rim and the exact south pole
  (1.1–1.4 m RMS, 20 m vs 20 m data), and −10 m at Apollo 15. A wrong orientation, sign or half-pixel convention would
  shift or decorrelate them.

**Speed and size** (fresh points, 401 × 401 px per grid, LERC with 0.02–0.05 m tolerance):
- **Size:** each grid is 0.2–0.27 MB, or 1.3–1.7 bytes per pixel. The same grid as raw float32 (`bsq`) is 0.64 MB.
- **Server time:**
  - 0.6–1.3 s per grid at quiet times, 3–4.5 s at busy times (earlier on 2026-11-14).
  - The grids are fetched in parallel, so a point costs about the time of its slowest grid.
  - Wide boxes from the 20 m or 118 m layers are the slow ones. The plan therefore takes the outer level from the 30 m polar layers or from LDEM_128.
- **Failures:** two requests failed. Both were wide boxes from the 118 m layer near the pole (±256 km took 27 s, then an error JSON). The plan avoids such boxes.

**Terms.**
- **What we found:** the Trek API page publishes no API terms or rate limits. NASA data and imagery are generally not
  copyrighted. LOLA products are public domain (NASA PDS).
- **What we do:**
  - We credit "NASA Solar System Treks (Moon Trek), NASA/JPL-Caltech" and "LRO LOLA (NASA GSFC)" in `dem_sources` and in docs/REFERENCES.md.
  - We send 2–3 requests per clicked point and cache the results.
- **Risk:** the service has no SLA. If it fails or times out, `terrainAt` falls back to the shipped tiles and labels the horizon "approximate" (`meta.fallback`).

## (b) The alternative: ship more data on GitHub Pages
- **How it was measured:** the tiles were cut from rasters already in the shared cache (`data/raw/dem`; nothing was downloaded).
  - Script: `uv run python scripts/data/measure_dem_ship_sizes.py`; raw numbers in `outputs/dem_ship_sizes.json`.
  - Format: int16 metres in 256² tiles, gzip −9.
  - "dz" means a horizontal delta plus zigzag before gzip. That encoding saves 20–45 %.
- **Note:** GitHub Pages does not gzip `.bin` files, so the tiles would be stored pre-compressed and inflated with `DecompressionStream`.

| Product | Pixels | Raw int16 | gzip | **dz + gzip** | Basis of the estimate |
|---|---|---|---|---|---|
| global8 (current C5, 3.8 km) | 4.1 M | 8.3 MB | 6.8 MB | **5.8 MB** | whole product |
| LDEM_16 (1.9 km) | 16.6 M | 33 MB | 26 MB | **21 MB** | whole product |
| LDEM_64 (474 m) | 265 M | 531 MB | 322 MB | **248 MB** | 286 cached blocks (18.7 M px) |
| LDEM_128 (237 m) | 1062 M | 2.1 GB | 1.1 GB | **0.92 GB** | SLDEM blocks, 4× mean |
| 118 m global | 4247 M | 8.5 GB | 4.1 GB | **3.2 GB** | SLDEM blocks, 2× mean |
| South polar 60 m beyond 80°S | 103 M | 205 MB | 127 MB | **72 MB** | LDEM_80S_20M blocks, 3× mean |
| South polar 120 m beyond 80°S | 26 M | 51 MB | 37 MB | **24 MB** | LDEM_80S_20M blocks, 6× mean |
| LDEM_75S_240M (whole) | 14.5 M | 29 MB | 21 MB | **15 MB** | whole product |

- **The limit:** the Pages site limit is about 1 GB. Even LDEM_64 (474 m) would take a quarter of it.
- **What the near field needs:** to match C3, the near field needs 20–120 m, and globally that is 1–3 GB. Shipping can therefore
  give **better far-field data** (LDEM_16 for 21 MB) and **one polar near-field set** (60 m south polar for 72 MB, both poles
  for about 145 MB), but never a 100 m near field everywhere.

## (c) Recommendation and the design built
**On-demand Moon Trek grids for the near and mid field, plus the shipped C5 tiles for the far field.** It was built as
`web/js/terrain/` (not wired into the app yet).

1. **Levels.** Each level is an n × n grid (n = 401, odd, so the site sits on a pixel centre) in the **site-centred
   stereographic plane**. The WKT is Esri `Stereographic` on the 1737.4 km sphere, with `Latitude_Of_Origin` = site latitude and
   `Central_Meridian` = site longitude (0° at the exact south pole, 180° at the exact north pole). Along a ray of azimuth A and
   central angle θ the plane point is x = r sin A, y = r cos A with r = 2R tan(θ/2). The poles need no special case, and no
   longitude seam is crossed.

   | Site | L0 | L1 | L2 |
   |---|---|---|---|
   | 85–90°S | 20 m, ±4 km (`south20`) | 80 m, ±16 km (`south20`) | 320 m, ±64 km (`south30`) |
   | 75–85° N/S | 30 m, ±6 km | 120 m, ±24 km | 480 m, ±96 km (30 m layer, or LDEM_128 if not covered) |
   | elsewhere | 118 m, ±23.7 km (`global118`) | 474 m, ±95 km (`global237`) | — |

2. **Far field.** The existing C5 tiles are used (south480 within 450 km for southern sites at |lat| ≥ 78°, global8 elsewhere).
   They are read with the same code path as `horizonFromTiles`. A test shows that marching over the tiles alone reproduces
   `horizonFromTiles` exactly.
3. **Ray march.** It uses the same maths as C3/C5:
   - exact great-circle rays and exact curvature;
   - steps of one cell of the finest source that covers the distance;
   - the rigorous stop rule, with ρ_max taken from the tiles and the grids, plus a 300 m margin.

   A grid with no data at a sample falls through to the next level.
4. **Patch.** A C4-shaped grid (±12 km, 385²) is built from the same grids. It is in memory (`z_up_m` is a Float32Array), not a file.
5. **Fallback.** If Moon Trek fails, the horizon comes from the tiles only and carries `approximate: true` (as today).

**Possible upgrades (not done):**
- Ship LDEM_16 (21 MB) as the far field. It replaces global8 beyond 95 km, but the far-field error is already 0.02–0.19° RMS.
- Use the USGS 5 m COG at 87–90°S as a static, server-free polar near field.
- Persist fetched grids with the Cache API.
