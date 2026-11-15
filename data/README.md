# data/

- `data/raw/` – downloaded source data (LOLA DEMs, ephemeris kernels, ...). **Not committed** (too large).
- `data/cache/` – intermediate/derived results. **Not committed**.
- Small curated files (e.g. a landing-site list as CSV/JSON) may be committed directly in `data/`.

Every dataset that goes in `raw/` must have a download script (or exact URL + instructions) in the repo,
so the other laptop can reproduce it with one command.

## LOLA DEMs (`data/raw/dem/`, terrain layer)
`uv run python scripts/data/build_terrain.py` downloads what it needs from the NASA PDS Geosciences Node: two small whole
files (LDEM_16, 33 MB; LDEM_75S_240M, 29 MB) and byte-range windows (256 x 256 px blocks cached as `.npy`) of the big
rasters (SLDEM2015, LDEM_64, polar 20/30/60 m). In a git worktree the folder of the main checkout is used, so all
worktrees share one cache; override with `MOONAT_DEM_DIR`. Bytes fetched are logged in `data/raw/dem/download_log.json`;
the budget is 500 MB (`MOONAT_DEM_BUDGET_MB`).

## Globe map textures (`data/raw/moonmap/`, location picker)
`uv run python scripts/data/build_moonmap.py` downloads 128 NASA Moon Trek WMTS tiles of the LRO WAC global mosaic
(zoom 3, about 4 MB, cached in `data/raw/moonmap/wac_z3/`) and reuses LDEM_16 and LDEM_75S_240M from `data/raw/dem/`
(run `build_terrain.py` first if they are missing). It writes the globe textures (about 4.2 MB of JPEG) and
`moonmap.json` to `web/data/moonmap/`.

## Globe map layers (`data/raw/illumination/`, permanent shadow and most sunlit ground)
`uv run python scripts/data/build_map_layers.py` reads NASA's polar illumination maps (GSFC PGDA product 69, release
201608, Mazarico et al. 2011 method) from http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/: `LPSR_*` (permanent
shadow) and `AVGVISIB_*` (share of time lit) for `65S_240M`, `65N_240M` and `85S_060M`. It fetches only the pole-centred
crop rows with HTTP multi-range requests (about 70 MB in all), caches them as `.npy` in `data/raw/illumination/` (in a
worktree, the main checkout's folder) and logs the bytes in `data/raw/illumination/download_log.json` (cap 150 MB,
separate from the DEM budget). It writes three 2-bit PNG layer images and `overlays.json` (about 280 kB) to
`web/data/overlays/`, and the sanity checks to `docs/validation/map_layers.json`. A rerun downloads nothing.

## Globe base maps and contour lines (LOLA, no download)
`uv run python scripts/data/build_base_maps.py` reads LDEM_16 and LDEM_75S_240M from `data/raw/dem/` (run
`build_terrain.py` first if they are missing) and writes the "Elevation" (viridis height tint times hillshade) and
"Plain" (grey, light hillshade) base maps as JPEGs in the globe's projections (equirectangular 2048 x 1024 plus the polar
caps of moonmap.json), the contour lines as 2-bit PNGs (global 4096 x 2048 every 1 km, index 5 km; polar caps 2048 x
2048 poleward of 80°, every 250 m, index 1 km) and `basemaps.json` (with the AI note) to `web/data/basemaps/`, about
3 MB in all. `--preview` also writes `outputs/base_maps_preview.png`. Browser check: `scripts/check_base_maps.py`.
