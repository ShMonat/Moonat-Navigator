# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""StarHab site study, step 1: screen the south polar region (85-90 S) for sunlight and Earth.

Candidate points (south polar stereographic map, x toward 90 E, y toward lon 0 = the Earth side):
- inner disk 89-90 S: every point of a 250 m grid (about one LOLA 240 m pixel);
- 85-89 S: a 1 km grid, keeping the top 10 % of elevations within each 0.5 deg latitude ring
  ("elevated terrain": in a ring the Sun and the Earth follow the same elevation range, so height
  above the ring's terrain is the first-order predictor of a low skyline);
- named massifs and rims (Malapert, Leibnitz beta / Mons Mouton and its plateau, Nobile rim,
  Haworth, de Gerlache rim, Shackleton vicinity, Cabeus B, Slater): every point of a 500 m grid
  in a box around each (some reach 83.6-84 S, the Artemis III regions there).

Each point gets a screening horizon (starhab_core.PolarPyramid: LOLA 240 m with pooled far field,
1 deg azimuth step, eye 2 m) and the straight-edge Sun/Earth fractions every 2 h over
2030-01-01 .. 2040-12-31, with per-site topocentric Sun and Earth directions.

Output: data/cache/starhab/screen.npz (points, metrics, horizons). Runtime: a few minutes on
~12 processes. Usage: uv run python scripts/starhab/screen.py [--workers N]
"""

from __future__ import annotations

import argparse
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import starhab_core as C  # noqa: E402

STEP_H = 2.0
AZ_STEP = 1.0
METRICS = (
    "sun_pct",
    "sun_lit_pct",
    "sun_disk_pct",
    "dark_max_d",
    "earth_pct",
    "earth_any_pct",
    "blackout_max_d",
    "both_pct",
    "both_min_pct",
)
# name: (lat, lon, half-width of the box in km)
FEATURES = {
    "Malapert massif": (-86.0, 1.0, 14.0),
    "Mons Mouton (Leibnitz beta)": (-85.4, 33.0, 20.0),
    "Mons Mouton plateau": (-84.25, 29.5, 12.0),
    "Nobile rim 1": (-84.4, 44.4, 12.0),
    "Nobile rim 2": (-84.1, 59.7, 12.0),
    "Haworth": (-86.95, -24.2, 12.0),
    "de Gerlache rim 2": (-88.7, -68.5, 12.0),
    "Shackleton vicinity": (-88.82, 124.1, 12.0),
    "Cabeus B": (-83.62, -68.6, 12.0),
    "Slater plain": (-87.7, 107.2, 10.0),
}


def candidate_points(pyr: C.PolarPyramid) -> dict:
    """Screening points: lat, lon (deg), map x, y (km) and a source tag per point."""
    pts_x, pts_y, tag = [], [], []
    r89 = float(np.hypot(*C.ps_xy_km(-89.0, 0.0)))
    r85 = float(np.hypot(*C.ps_xy_km(-85.0, 0.0)))
    # inner disk, 250 m
    g = np.arange(-r89, r89 + 1e-9, 0.25)
    xx, yy = np.meshgrid(g, g)
    m = np.hypot(xx, yy) <= r89
    pts_x.append(xx[m])
    pts_y.append(yy[m])
    tag.append(np.zeros(m.sum(), dtype=np.int8))
    # 85-89 S, 1 km, top 10 % of elevation per 0.5 deg ring
    g = np.arange(-r85, r85 + 1e-9, 1.0)
    xx, yy = np.meshgrid(g, g)
    r = np.hypot(xx, yy)
    m = (r > r89) & (r <= r85)
    x1, y1 = xx[m], yy[m]
    lat1, lon1 = C.ps_latlon(x1, y1)
    h1 = np.array([pyr.ground(a, b) for a, b in zip(lat1, lon1, strict=True)])
    ring = np.floor((lat1 + 90.0) / 0.5).astype(int)
    keep = np.zeros(x1.size, dtype=bool)
    for k in np.unique(ring):
        sel = ring == k
        keep[sel] = h1[sel] >= np.percentile(h1[sel], 90.0)
    pts_x.append(x1[keep])
    pts_y.append(y1[keep])
    tag.append(np.ones(keep.sum(), dtype=np.int8))
    # named features, 500 m boxes
    for i, (la, lo, hw) in enumerate(FEATURES.values()):
        cx, cy = C.ps_xy_km(la, lo)
        g = np.arange(-hw, hw + 1e-9, 0.5)
        xx, yy = np.meshgrid(cx + g, cy + g)
        pts_x.append(xx.ravel())
        pts_y.append(yy.ravel())
        tag.append(np.full(xx.size, 2 + i, dtype=np.int8))
    x = np.concatenate(pts_x)
    y = np.concatenate(pts_y)
    t = np.concatenate(tag)
    # drop duplicates (boxes overlapping the grids), keep the first tag
    key = np.round(x * 4).astype(np.int64) * 10_000_000 + np.round(y * 4).astype(np.int64)
    _, first = np.unique(key, return_index=True)
    first.sort()
    x, y, t = x[first], y[first], t[first]
    lat, lon = C.ps_latlon(x, y)
    return {"lat": lat, "lon": lon, "x_km": x, "y_km": y, "tag": t}


_W: dict = {}


def _init():
    _W["pyr"] = C.PolarPyramid()
    _W["eph"] = C.body_vectors_me(STEP_H)


def _work(args):
    lat, lon = args
    pyr, eph = _W["pyr"], _W["eph"]
    n = lat.size
    met = np.empty((n, len(METRICS)), dtype=np.float32)
    h0s = np.empty(n, dtype=np.float32)
    hz = np.empty((n, int(round(360 / AZ_STEP))), dtype=np.int16)
    for i in range(n):
        h0, el = pyr.horizon(float(lat[i]), float(lon[i]), C.EYE_M, AZ_STEP)
        s = C.screening_series(
            el, AZ_STEP, float(lat[i]), float(lon[i]), C.R_MOON_M + h0 + C.EYE_M, eph
        )
        m = C.series_metrics(s["sun_flux"], s["sun_disk"], s["earth_vis"], STEP_H)
        met[i] = [m[k] for k in METRICS]
        h0s[i] = h0
        hz[i] = np.clip(np.round(el * 100.0), -32000, 32000)
    return met, h0s, hz


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--chunk", type=int, default=250)
    args = ap.parse_args()
    t0 = time.time()
    C.body_vectors_me(STEP_H)  # build the ephemeris cache once, before the workers start
    pyr = C.PolarPyramid()
    pts = candidate_points(pyr)
    n = pts["lat"].size
    print(f"{n} screening points ({np.bincount(pts['tag'])})", flush=True)
    chunks = [
        (pts["lat"][i : i + args.chunk], pts["lon"][i : i + args.chunk])
        for i in range(0, n, args.chunk)
    ]
    res = []
    with Pool(args.workers, initializer=_init) as pool:
        for k, r in enumerate(pool.imap(_work, chunks)):
            res.append(r)
            if k % 20 == 0:
                print(f"  {min((k + 1) * args.chunk, n)}/{n}  {time.time() - t0:.0f} s", flush=True)
    met = np.concatenate([r[0] for r in res])
    out = {k: met[:, j] for j, k in enumerate(METRICS)}
    out.update(pts)
    out["ground_m"] = np.concatenate([r[1] for r in res])
    out["horizon_cdeg"] = np.concatenate([r[2] for r in res])
    out["feature_names"] = np.array(["inner 89-90S", "ring top10%"] + list(FEATURES))
    np.savez_compressed(C.cache_dir() / "screen.npz", **out)
    print(f"done in {time.time() - t0:.0f} s -> {C.cache_dir() / 'screen.npz'}", flush=True)


if __name__ == "__main__":
    main()
