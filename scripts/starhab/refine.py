# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""StarHab site study, step 2: refine the best screening candidates with the full pipeline.

1. Candidates from data/cache/starhab/screen.npz (screening score S = (sun_pct + earth_pct) / 2,
   eye 2 m), all at least 2 km apart (greedy non-maximum suppression):
   - the 10 best by S;
   - the 6 best by sunlight alone;
   - up to 6 points of the screening Pareto front (sun_pct vs earth_pct);
   - the best point by S of the inner disk, the ring set and every named feature box (Malapert,
     Mons Mouton, ...), if not already in.
2. Polish: around each candidate, a 9 x 9 grid at 100 m (+-400 m) gets a horizon with the LOLA
   20 m near field (cached blocks, 15 km), 240 m to 450 km and LDEM_16 beyond, at 0.5 deg azimuth,
   for an eye at 2 m and a mast at 10 m; straight-edge fractions every 2 h. The polished point
   maximises the 10 m score (the arrays and the DTE antenna of a buried base stand on masts).
3. Final: at each polished point, the C3 horizon (0.25 deg, ``moonat.terrain.horizon_profile``
   with the same layers) at 2 m and 10 m, and the exact C6 fractions (400-point disks, limb
   darkening, eclipses by the Earth) every 1 h over 2030-01-01 .. 2040-12-31.
4. Site checks: slope of the 20 m DEM in a 100 m box, and the distance to the nearest screening
   point that never sees the Sun in 11 years (a permanently shadowed region, PSR, at the 250 m /
   500 m screening resolution).

Output: data/cache/starhab/refine.json. Usage: uv run python scripts/starhab/refine.py [--workers N]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import starhab_core as C  # noqa: E402

from moonat.ephem.topo import posix_to_iso  # noqa: E402
from moonat.terrain.dem import LayeredDEM  # noqa: E402
from moonat.terrain.horizon import horizon_from_sampler, ray_schedule  # noqa: E402
from moonat.terrain.pds import R_MOON_M, unit_from_latlon  # noqa: E402

SEP_KM = 2.0
POLISH_HALF_M = 400.0
POLISH_STEP_M = 100.0
HEIGHTS = (C.EYE_M, C.MAST_M)


def score(sun_pct, earth_pct):
    """Equal-weight score (%): the mean of the Sun and Earth time averages."""
    return 0.5 * (np.asarray(sun_pct) + np.asarray(earth_pct))


def load_screen() -> dict:
    z = np.load(C.cache_dir() / "screen.npz")
    return {k: z[k] for k in z.files}


def pareto_front(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Indices of the points not dominated in (a, b), both to be maximised."""
    order = np.lexsort((-b, -a))  # by a descending, then b descending
    front, best_b = [], -np.inf
    for i in order:
        if b[i] > best_b:
            front.append(i)
            best_b = b[i]
    return np.array(front, dtype=int)


def nms(order, x, y, sep_km, limit, taken=()):
    """Greedy selection along ``order``, keeping points at least ``sep_km`` from every pick."""
    picks = list(taken)
    out = []
    for i in order:
        if all(np.hypot(x[i] - x[j], y[i] - y[j]) >= sep_km for j in picks):
            picks.append(i)
            out.append(int(i))
            if len(out) >= limit:
                break
    return out


def select_candidates(sc: dict) -> list[dict]:
    s = score(sc["sun_pct"], sc["earth_pct"])
    x, y = sc["x_km"], sc["y_km"]
    top = nms(np.argsort(-s), x, y, SEP_KM, 10)
    sun = nms(np.argsort(-sc["sun_pct"]), x, y, SEP_KM, 6, top)
    front = pareto_front(sc["sun_pct"], sc["earth_pct"])
    par = nms(front[np.argsort(-s[front])], x, y, SEP_KM, 6, top + sun)
    chosen = top + sun + par
    names = [str(n) for n in sc["feature_names"]]
    per_feature = []
    for tag in range(len(names)):
        idx = np.flatnonzero(sc["tag"] == tag)
        if idx.size:
            best = idx[np.argmax(s[idx])]
            got = nms([best], x, y, SEP_KM, 1, chosen)
            chosen += got
            per_feature += [(g, names[tag]) for g in got]
    why = {i: "top score" for i in top} | {i: "top sunlight" for i in sun}
    why |= {i: "Pareto front" for i in par} | {i: f"best in: {n}" for i, n in per_feature}
    return [
        {
            "screen_index": i,
            "why": why[i],
            "feature": names[int(sc["tag"][i])],
            "lat": float(sc["lat"][i]),
            "lon": float(sc["lon"][i]),
            "screen": {
                k: round(float(sc[k][i]), 3)
                for k in ("sun_pct", "earth_pct", "dark_max_d", "blackout_max_d", "both_pct")
            }
            | {"ground_m": round(float(sc["ground_m"][i]), 1), "score": round(float(s[i]), 3)},
        }
        for i in chosen
    ]


# ------------------------------------------------------------------------------------------------
# Workers
# ------------------------------------------------------------------------------------------------

_W: dict = {}


def _init():
    _W["eph2"] = C.body_vectors_me(2.0)
    _W["eph1"] = C.body_vectors_me(1.0)


def _polish(task):
    """Straight-edge scores at 2 m and 10 m for a block of offsets around one candidate."""
    k, lat0, lon0, offsets = task
    layers_dem, nan_frac = C.refined_layers(lat0, lon0, C.NEAR_M + POLISH_HALF_M * 2)
    rho_max = R_MOON_M + layers_dem.max_height_m(0.26) + 300.0
    cells = [ly.window.cell_m for ly in layers_dem.layers]
    sched = ray_schedule(cells, [C.NEAR_M, C.MID_M, np.inf], 0.25 * R_MOON_M)
    x0, y0 = C.ps_xy_km(lat0, lon0)
    rows = []
    for dx, dy in offsets:
        lat, lon = C.ps_latlon(x0 + dx / 1000.0, y0 + dy / 1000.0)
        lat, lon = float(lat), float(lon)
        dem = LayeredDEM(lat, lon, layers_dem.layers)
        h0 = float(dem.sample(unit_from_latlon(lat, lon)[None, :])[0])
        row = {"k": k, "dx": dx, "dy": dy, "lat": lat, "lon": lon, "ground_m": h0}
        for h in HEIGHTS:
            res = horizon_from_sampler(
                lambda u, s, d=dem: d.sample(u, s), lat, lon, h0, h, 0.5, sched, rho_max, False
            )
            ser = C.screening_series(res["el_deg"], 0.5, lat, lon, R_MOON_M + h0 + h, _W["eph2"])
            m = C.series_metrics(ser["sun_flux"], ser["sun_disk"], ser["earth_vis"], 2.0)
            row[f"S_{h:g}m"] = float(score(m["sun_pct"], m["earth_pct"]))
            row[f"sun_{h:g}m"] = m["sun_pct"]
            row[f"earth_{h:g}m"] = m["earth_pct"]
        rows.append(row)
    return rows


def _final(task):
    """Full-quality metrics (C3 horizon, exact C6 fractions, 1 h) at one point and height."""
    k, lat, lon, h = task
    dem, nan_frac = C.refined_layers(lat, lon)
    hz = C.refined_horizon(lat, lon, h, 0.25, dem)
    ser = C.exact_series(hz, _W["eph1"])
    m = C.series_metrics(ser["sun_flux"], ser["sun_disk"], ser["earth_vis"], 1.0)
    t = _W["eph1"]["t"]
    for name, mask in (("dark", ser["sun_flux"] <= 0.0), ("blackout", ser["earth_vis"] <= 0.0)):
        mm = np.concatenate([[False], mask, [False]]).astype(np.int8)
        st, en = np.flatnonzero(np.diff(mm) == 1), np.flatnonzero(np.diff(mm) == -1)
        if st.size:
            j = int(np.argmax(en - st))
            m[f"{name}_max_start"] = posix_to_iso(t[st[j]])[:13] + "Z"
    m["eclipse_hours"] = float((ser["eclipse"] > 0).sum())
    m["score"] = float(score(m["sun_pct"], m["earth_pct"]))
    m = {a: (round(b, 3) if isinstance(b, float) else b) for a, b in m.items()}
    return {
        "k": k,
        "h": h,
        "metrics": m,
        "ground_m": hz["ground_elev_m"],
        "near_20m_missing_frac": round(nan_frac, 4),
        "max_range_km": hz["max_range_km"],
        "el_deg": hz["el_deg"],
        "dist_km": hz["dist_km"],
        "dem_sources": hz["dem_sources"],
    }


# ------------------------------------------------------------------------------------------------


def psr_distance_km(sc: dict, lat: float, lon: float) -> float | None:
    """Ground distance (km) to the nearest screening point that is never sunlit in 2030-2040."""
    dark = sc["sun_lit_pct"] <= 0.0
    if not dark.any():
        return None
    d = C.great_circle_m(lat, lon, sc["lat"][dark], sc["lon"][dark])
    return round(float(d.min()) / 1000.0, 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=12)
    args = ap.parse_args()
    t0 = time.time()
    sc = load_screen()
    cands = select_candidates(sc)
    print(f"{len(cands)} candidates", flush=True)
    for i, c in enumerate(cands):
        print(f"  {i:2d} {c['why']:<40s} {c['lat']:.4f} {c['lon']:.4f} {c['screen']}", flush=True)
    C.body_vectors_me(1.0)  # build the 1 h ephemeris cache once
    g = np.arange(-POLISH_HALF_M, POLISH_HALF_M + 1e-9, POLISH_STEP_M)
    tasks = []
    for k, c in enumerate(cands):
        for dy in g:
            tasks.append((k, c["lat"], c["lon"], [(float(dx), float(dy)) for dx in g]))
    polish_path = C.cache_dir() / "polish.json"
    key = [[c["lat"], c["lon"]] for c in cands]
    rows = None
    if polish_path.exists():
        saved = json.loads(polish_path.read_text(encoding="utf-8"))
        if saved["candidates"] == key:
            rows = saved["rows"]
            print("polish results reused from cache", flush=True)
    if rows is None:
        rows = []
        with Pool(args.workers, initializer=_init) as pool:
            for n, r in enumerate(pool.imap_unordered(_polish, tasks)):
                rows += r
                if n % 25 == 0:
                    print(f"  polish {n + 1}/{len(tasks)}  {time.time() - t0:.0f} s", flush=True)
        polish_path.write_text(json.dumps({"candidates": key, "rows": rows}), encoding="utf-8")
    # The C3 horizon's terrain-height bound scans whole DEM files (~1 GB of temporaries per
    # process), so the final step runs on fewer processes.
    with Pool(min(args.workers, 6), initializer=_init) as pool:
        for k, c in enumerate(cands):
            mine = [r for r in rows if r["k"] == k]
            best = max(mine, key=lambda r: r[f"S_{C.MAST_M:g}m"])
            centre = next(r for r in mine if r["dx"] == 0 and r["dy"] == 0)
            c["polish"] = {
                "best": {a: (round(b, 4) if isinstance(b, float) else b) for a, b in best.items()},
                "centre": {
                    a: (round(b, 4) if isinstance(b, float) else b) for a, b in centre.items()
                },
                "S10_range": [
                    round(min(r[f"S_{C.MAST_M:g}m"] for r in mine), 2),
                    round(max(r[f"S_{C.MAST_M:g}m"] for r in mine), 2),
                ],
            }
            c["lat_final"] = round(best["lat"], 5)
            c["lon_final"] = round(best["lon"], 5)
        print(f"polish done {time.time() - t0:.0f} s", flush=True)
        ftasks = [
            (k, c["lat_final"], c["lon_final"], h) for k, c in enumerate(cands) for h in HEIGHTS
        ]
        for r in pool.imap_unordered(_final, ftasks):
            c = cands[r["k"]]
            c.setdefault("final", {})[f"{r['h']:g}m"] = {
                "metrics": r["metrics"],
                "ground_m": r["ground_m"],
                "near_20m_missing_frac": r["near_20m_missing_frac"],
                "max_range_km": r["max_range_km"],
                "horizon_el_deg": r["el_deg"],
                "horizon_dist_km": r["dist_km"],
                "dem_sources": r["dem_sources"],
            }
            print(f"  final {r['k']} {r['h']:g} m {r['metrics']}", flush=True)
    for c in cands:
        c["slope_100m"] = C.local_slope(c["lat_final"], c["lon_final"], 100.0)
        c["psr_distance_km"] = psr_distance_km(sc, c["lat_final"], c["lon_final"])
    out = {
        "_generated_by": C.GEN,
        "period_utc": [C.T_START.isoformat(), C.T_END.isoformat()],
        "candidates": cands,
        "runtime_s": round(time.time() - t0, 1),
    }
    (C.cache_dir() / "refine.json").write_text(json.dumps(out), encoding="utf-8")
    print(f"done {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main()
