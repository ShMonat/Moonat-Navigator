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
