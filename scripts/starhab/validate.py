# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""StarHab site study, step 4: checks against the literature, NASA's maps and the 18.6-yr cycle.

A. Glaser et al. 2014 (EPSC2014-136; Icarus 243): connecting-ridge spots 1-4 (20 m LOLA DTM,
   1 h steps, about 19-20 years, the Sun as a disk). Ours: the refinement pipeline (C3 horizon
   at 0.25 deg with LOLA 20 m near field, exact disk fractions), 1 h steps, 2021-01-01 ..
   2039-12-31 (19 yr). Compared: average illumination (time mean of the visible disk fraction,
   no limb darkening), % of time with any sunlight, longest complete darkness.
B. NASA PGDA maps by Mazarico et al. (2011 method, product 201608): AVGVISIB_85S_060M_201608
   (Sun) and ..._EARTH: the share of hourly time steps over 18.6 years in which ANY part of the
   disk is visible, from LOLA LDEM_85S_060M. Read by HTTP byte ranges (a +-31 km window around
   the pole, about 2 MB per map, plus 11 x 11 px at points outside it). Compared with our
   screening values (250 m grid, 240 m DEM, 2 m eye) over 89-90 S and with our final sites.
C. Nodal-cycle check: the final sites again over 2022-05-01 .. 2040-12-31 (18.67 yr, one full
   18.6-yr nodal cycle), against the 2030-2040 study period. Mast sweep: the recommended site and
   the first alternative at eye heights 2-20 m (2030-2040).
D. North pole (footnote): the same screening on LOLA LDEM_16 only (about 1.9 km) for 85-90 N and,
   for a like-with-like comparison, 85-90 S (2 km grid, eye 2 m, 2030-2040, 2 h).

Output: data/cache/starhab/validate.json. Usage: uv run python scripts/starhab/validate.py [part]
"""

from __future__ import annotations

import json
import sys
import time
from datetime import UTC, datetime
from multiprocessing import Pool
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import starhab_core as C  # noqa: E402

from moonat.terrain import fetch  # noqa: E402
from moonat.terrain.dem import _whole_window, bilinear, global_source  # noqa: E402
from moonat.terrain.horizon import horizon_from_sampler, ray_schedule  # noqa: E402
from moonat.terrain.pds import R_MOON_M  # noqa: E402

GLASER = [
    # id, lat, lon (-180..180), eye m, avg illum %, time lit %, longest dark d (EPSC2014-136-1)
    ("Glaser CR1 spot 1", -89.4395, 222.8066 - 360.0, 2.0, 88.1, 92.0, 4.58),
    ("Glaser CR1 spot 2", -89.4399, 222.8524 - 360.0, 2.0, 87.9, 92.3, 4.62),
    ("Glaser CR1 spot 3", -89.4516, 222.7581 - 360.0, 10.0, 92.5, 95.6, 3.08),
    ("Glaser CR1 spot 4", -89.4544, 222.8445 - 360.0, 10.0, 91.9, 95.66, 3.17),
]
VAL_T0, VAL_T1 = datetime(2021, 1, 1, tzinfo=UTC), datetime(2040, 1, 1, tzinfo=UTC)
CYC_T0, CYC_T1 = datetime(2022, 5, 1, tzinfo=UTC), datetime(2041, 1, 1, tzinfo=UTC)
MAST_SWEEP_M = (2.0, 3.0, 5.0, 7.5, 10.0, 15.0, 20.0)

PGDA = "http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/AVGVISIB_85S_060M_201608{}.IMG"
PGDA_N, PGDA_C0, PGDA_SCALE, PGDA_DN = 5058, 2528.5, 60.0, 0.00004


def _out_path() -> Path:
    return C.cache_dir() / "validate.json"


def _save(part: str, value) -> None:
    p = _out_path()
    d = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"_generated_by": C.GEN}
    d[part] = value
    p.write_text(json.dumps(d, indent=1), encoding="utf-8")


def _site_metrics(task):
    name, lat, lon, h, t0, t1 = task
    eph = C.body_vectors_me(1.0, t0, t1)
    dem, nan_frac = C.refined_layers(lat, lon)
    hz = C.refined_horizon(lat, lon, h, 0.25, dem)
    ser = C.exact_series(hz, eph)
    m = C.series_metrics(ser["sun_flux"], ser["sun_disk"], ser["earth_vis"], 1.0)
    m = {k: round(v, 3) for k, v in m.items()}
    return name, h, hz["ground_elev_m"], round(nan_frac, 4), m


# ------------------------------------------------------------------------------------------------
# A. Glaser 2014
# ------------------------------------------------------------------------------------------------


def part_glaser(pool):
    tasks = [(g[0], g[1], g[2], g[3], VAL_T0, VAL_T1) for g in GLASER]
    tasks += [(g[0] + " (2030-2040)", g[1], g[2], g[3], C.T_START, C.T_END) for g in GLASER]
    rows = []
    for name, h, g0, nanf, m in pool.imap(_site_metrics, tasks):
        pub = next(g for g in GLASER if name.startswith(g[0]))
        row = {
            "point": name,
            "lat": pub[1],
            "lon": round(pub[2], 4),
            "eye_m": h,
            "ground_m": g0,
            "near_20m_missing_frac": nanf,
            "published": {"avg_illum_pct": pub[4], "time_lit_pct": pub[5], "dark_max_d": pub[6]},
            "ours": {
                "avg_illum_pct": m["sun_disk_pct"],
                "time_lit_pct": m["sun_lit_pct"],
                "dark_max_d": m["dark_max_d"],
                "earth_any_pct": m["earth_any_pct"],
                "earth_pct": m["earth_pct"],
            },
        }
        rows.append(row)
        print(json.dumps(row), flush=True)
    _save("glaser2014", rows)


# ------------------------------------------------------------------------------------------------
# B. NASA PGDA maps (Mazarico et al.)
# ------------------------------------------------------------------------------------------------


def pgda_window(kind: str, r0: int, r1: int, c0: int, c1: int) -> np.ndarray:
    """Rows [r0, r1) x cols [c0, c1) of a PGDA 60 m south-polar map as fractions 0..1 (cached).

    The map is 5058 x 5058 px (+-151.7 km, i.e. to 85 S along the axes); outside it: NaN.
    """
    out = np.full((r1 - r0, c1 - c0), np.nan)
    a0, a1, b0, b1 = max(r0, 0), min(r1, PGDA_N), max(c0, 0), min(c1, PGDA_N)
    if a0 >= a1 or b0 >= b1:
        return out
    suffix = "_EARTH" if kind == "earth" else ""
    path = C.cache_dir() / f"pgda{suffix.lower()}_{a0}_{a1}_{b0}_{b1}.npy"
    if path.exists():
        a = np.load(path)
    else:
        url = PGDA.format(suffix)
        rb = PGDA_N * 2
        ranges = [(r * rb + b0 * 2, r * rb + b1 * 2 - 1) for r in range(a0, a1)]
        fetch._check_budget(len(ranges) * (b1 - b0) * 2)
        parts = []
        for i in range(0, len(ranges), fetch.MAX_RANGES_PER_REQUEST):
            parts += fetch.fetch_ranges(
                url, ranges[i : i + fetch.MAX_RANGES_PER_REQUEST], "PGDA_AVGVISIB_85S_060M" + suffix
            )
        a = np.frombuffer(b"".join(parts), dtype="<i2").reshape(a1 - a0, b1 - b0) * PGDA_DN
        np.save(path, a)
    out[a0 - r0 : a1 - r0, b0 - c0 : b1 - c0] = a
    return out


def _components(mask: np.ndarray) -> np.ndarray:
    """4-connected component labels of a boolean image (0 = background), iterative flood fill."""
    lab = np.zeros(mask.shape, dtype=np.int32)
    n = 0
    for r0, c0 in zip(*np.nonzero(mask), strict=True):
        if lab[r0, c0]:
            continue
        n += 1
        stack = [(r0, c0)]
        lab[r0, c0] = n
        while stack:
            r, c = stack.pop()
            for rr, cc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if 0 <= rr < mask.shape[0] and 0 <= cc < mask.shape[1]:
                    if mask[rr, cc] and not lab[rr, cc]:
                        lab[rr, cc] = n
                        stack.append((rr, cc))
    return lab


def pgda_psr_distance(lat: float, lon: float, radius_km: float = 25.0) -> dict:
    """Distance (km) from a point to NASA's permanently shadowed pixels (PGDA 60 m Sun map = 0).

    Returns the nearest PSR pixel of any size and the nearest pixel of a PSR of at least 1 km^2
    (4-connected, >= 278 pixels of 60 m), searched within ``radius_km``; None if none is found or
    the point is outside the map.
    """
    row, col = pgda_rowcol(lat, lon)
    k = int(radius_km * 1000 / PGDA_SCALE)
    ri, ci = int(round(float(row))), int(round(float(col)))
    w = pgda_window("sun", ri - k, ri + k + 1, ci - k, ci + k + 1)
    if np.isnan(w[k, k]):
        return {"nearest_km": None, "nearest_1km2_km": None, "search_km": radius_km}
    psr = w == 0.0
    rr, cc = np.mgrid[-k : k + 1, -k : k + 1]
    dist = np.hypot(rr - (row - ri), cc - (col - ci)) * PGDA_SCALE / 1000.0
    res = {"search_km": radius_km, "nearest_km": None, "nearest_1km2_km": None}
    if psr.any():
        res["nearest_km"] = round(float(dist[psr].min()), 2)
        lab = _components(psr)
        sizes = np.bincount(lab.ravel())
        big = np.isin(lab, np.flatnonzero(sizes >= 1e6 / PGDA_SCALE**2)) & psr
        if big.any():
            res["nearest_1km2_km"] = round(float(dist[big].min()), 2)
    return res


def pgda_rowcol(lat, lon):
    x, y = C.ps_xy_km(lat, lon)
    return PGDA_C0 - np.asarray(y) * 1000.0 / PGDA_SCALE, PGDA_C0 + np.asarray(
        x
    ) * 1000.0 / PGDA_SCALE


def pgda_at(kind: str, lat, lon) -> dict:
    """Bilinear value and the min/max of the 3 x 3 neighbourhood (60 m pixels) at points."""
    row, col = pgda_rowcol(np.atleast_1d(lat), np.atleast_1d(lon))
    out = {"value": [], "min3": [], "max3": []}
    for r, c in zip(row, col, strict=True):
        ri, ci = int(np.floor(r)), int(np.floor(c))
        w = pgda_window(kind, ri - 5, ri + 6, ci - 5, ci + 6)
        out["value"].append(float(bilinear(w, np.array([r - ri + 5]), np.array([c - ci + 5]))[0]))
        out["min3"].append(float(np.min(w[4:7, 4:7])))
        out["max3"].append(float(np.max(w[4:7, 4:7])))
    return out


def part_pgda():
    sc = np.load(C.cache_dir() / "screen.npz")
    half = 520
    r0, r1 = int(PGDA_C0) - half, int(PGDA_C0) + half + 2
    maps = {k: pgda_window(k, r0, r1, r0, r1) for k in ("sun", "earth")}
    inner = sc["tag"] == 0
    row, col = pgda_rowcol(sc["lat"][inner], sc["lon"][inner])
    res = {"window_rows": [r0, r1]}
    for k, ours in (("sun", "sun_lit_pct"), ("earth", "earth_any_pct")):
        v = 100.0 * bilinear(maps[k], row - r0, col - r0)
        o = sc[ours][inner].astype(float)
        ok = np.isfinite(v)
        d = o[ok] - v[ok]
        res[k] = {
            "n": int(ok.sum()),
            "corr": round(float(np.corrcoef(o[ok], v[ok])[0, 1]), 4),
            "median_diff_pts": round(float(np.median(d)), 2),
            "p05_p95_diff_pts": [
                round(float(np.percentile(d, 5)), 2),
                round(float(np.percentile(d, 95)), 2),
            ],
            "max_ours": round(float(o[ok].max()), 2),
            "max_pgda": round(float(v[ok].max()), 2),
        }
        np.save(C.cache_dir() / f"pgda_vs_screen_{k}.npy", np.stack([o[ok], v[ok]]))
    site = json.loads((C.ROOT / "data" / "starhab_site.json").read_text(encoding="utf-8"))
    pts = [(s["id"], s["lat_deg"], s["lon_deg"], s["metrics_2m"]) for s in site["sites"]]
    pts += [(g[0], g[1], g[2], None) for g in GLASER]
    res["points"] = []
    for name, lat, lon, m in pts:
        row_ = {"point": name, "lat": lat, "lon": lon}
        for k in ("sun", "earth"):
            p = pgda_at(k, lat, lon)
            pct = [
                None if np.isnan(v) else round(100 * v, 1)
                for v in (p["value"][0], p["min3"][0], p["max3"][0])
            ]
            row_[f"pgda_{k}_pct"] = pct[0]
            row_[f"pgda_{k}_3x3_pct"] = pct[1:]
        if m:
            row_["ours_sun_lit_pct_2m"] = m["sun_lit_pct"]
            row_["ours_earth_any_pct_2m"] = m["earth_any_pct"]
        res["points"].append(row_)
        print(json.dumps(row_), flush=True)
    print(json.dumps({k: v for k, v in res.items() if k != "points"}), flush=True)
    _save("pgda", res)


# ------------------------------------------------------------------------------------------------
# C. Nodal cycle
# ------------------------------------------------------------------------------------------------


def part_cycle(pool):
    site = json.loads((C.ROOT / "data" / "starhab_site.json").read_text(encoding="utf-8"))
    tasks = []
    for s in site["sites"]:
        for h in (C.EYE_M, C.MAST_M):
            tasks.append((s["id"], s["lat_deg"], s["lon_deg"], h, CYC_T0, CYC_T1))
    rows = []
    for name, h, _, _, m in pool.imap(_site_metrics, tasks):
        s = next(s for s in site["sites"] if s["id"] == name)
        ref = s["metrics_2m"] if h == C.EYE_M else s["metrics_mast"]
        rows.append({"site": name, "eye_m": h, "cycle_18p67yr": m, "study_2030_2040": ref})
        print(name, h, json.dumps(m), flush=True)
    _save("nodal_cycle", rows)


def part_mast(pool):
    """Mast-height sweep at the recommended site and the first alternative (2030-2040)."""
    site = json.loads((C.ROOT / "data" / "starhab_site.json").read_text(encoding="utf-8"))
    tasks = [
        (s["id"], s["lat_deg"], s["lon_deg"], h, C.T_START, C.T_END)
        for s in site["sites"][:2]
        for h in MAST_SWEEP_M
    ]
    rows = []
    for name, h, g0, _, m in pool.imap(_site_metrics, tasks):
        rows.append({"site": name, "eye_m": h, "ground_m": g0, "metrics": m})
        print(name, h, json.dumps(m), flush=True)
    _save("mast_sweep", rows)


# ------------------------------------------------------------------------------------------------
# D. North vs south on LDEM_16
# ------------------------------------------------------------------------------------------------

_W: dict = {}


def _init16():
    _W["far"] = _whole_window(global_source(16), 89.0)
    _W["eph"] = C.body_vectors_me(2.0)
    f = _W["far"].data
    lat = 90.0 - (np.arange(f.shape[0]) + 0.5) / _W["far"].spec.res_ppd
    _W["hmax"] = {+1: float(np.nanmax(f[lat > 60])), -1: float(np.nanmax(f[lat < -60]))}


def _coarse(task):
    lat, lon = task
    far = _W["far"]
    out = []
    for la, lo in zip(lat, lon, strict=True):
        u = np.array([C.unit_from_latlon(la, lo)])
        h0 = float(far.sample(u)[0])
        rho_max = R_MOON_M + _W["hmax"][1 if la > 0 else -1] + 300.0
        sched = ray_schedule([far.cell_m], [np.inf], 0.25 * R_MOON_M)
        res = horizon_from_sampler(
            lambda uu, s: far.sample(uu),
            float(la),
            float(lo),
            h0,
            C.EYE_M,
            1.0,
            sched,
            rho_max,
            False,
        )
        ser = C.screening_series(
            res["el_deg"], 1.0, float(la), float(lo), R_MOON_M + h0 + C.EYE_M, _W["eph"]
        )
        m = C.series_metrics(ser["sun_flux"], ser["sun_disk"], ser["earth_vis"], 2.0)
        out.append([la, lo, h0, m["sun_pct"], m["earth_pct"], m["dark_max_d"], m["blackout_max_d"]])
    return out


def part_north(pool):
    r85 = float(np.hypot(*C.ps_xy_km(-85.0, 0.0)))
    g = np.arange(-r85, r85 + 1e-9, 2.0)
    xx, yy = np.meshgrid(g, g)
    m = np.hypot(xx, yy) <= r85
    lat_s, lon_s = C.ps_latlon(xx[m], yy[m])
    res = {}
    for pole, lat in (("south", lat_s), ("north", -lat_s)):
        lon = lon_s
        chunks = [(lat[i : i + 200], lon[i : i + 200]) for i in range(0, lat.size, 200)]
        rows = np.array([r for ch in pool.imap(_coarse, chunks) for r in ch])
        # LDEM_16 has no pixel centre within 1/32 deg of the pole: drop those few points
        rows = rows[np.isfinite(rows).all(axis=1)]
        s = 0.5 * (rows[:, 3] + rows[:, 4])
        best = {
            "score": rows[np.argmax(s)].round(3).tolist(),
            "sun": rows[np.argmax(rows[:, 3])].round(3).tolist(),
            "earth": rows[np.argmax(rows[:, 4])].round(3).tolist(),
        }
        res[pole] = {
            "n": int(rows.shape[0]),
            "columns": "lat lon ground_m sun_pct earth_pct dark_max_d blackout_max_d",
            "best": best,
        }
        np.save(C.cache_dir() / f"ldem16_{pole}.npy", rows)
        print(pole, json.dumps(res[pole]), flush=True)
    _save("north_vs_south_ldem16", res)


def main():
    parts = sys.argv[1:] or ["glaser", "pgda", "cycle", "mast", "north"]
    t0 = time.time()
    # The C3 horizon's terrain-height bound needs ~1 GB of temporaries per process: 6 processes.
    with Pool(6, initializer=_init16 if "north" in parts else None) as pool:
        if "glaser" in parts:
            part_glaser(pool)
        if "pgda" in parts:
            part_pgda()
        if "cycle" in parts:
            part_cycle(pool)
        if "mast" in parts:
            part_mast(pool)
        if "north" in parts:
            part_north(pool)
    print(f"done {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main()
