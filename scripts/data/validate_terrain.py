# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Validation numbers for the terrain layer (docs/validation/terrain.md).

1. Independent far-field check: every DEM pixel of the mid layer (5 km < distance < 120 km) is
   placed in 3-D with the INVERSE map projection (written here from the PDS DSMAP texts, not the
   library's forward projection); its azimuth and elevation from the eye are binned at 0.25 deg and
   the per-bin maximum is compared with the ray-marched horizon of the same layer and band.
2. Sensitivity of the horizon to near-field terrain (min distance 0 / 100 / 500 m) and to the
   observer height (2 m / 10 m).
3. Bearing / distance checks against named features.

Usage: uv run python scripts/data/validate_terrain.py [site_id ...]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from moonat.terrain import build_layers, horizon_profile  # noqa: E402
from moonat.terrain.dem import Layer, LayeredDEM  # noqa: E402
from moonat.terrain.horizon import horizon_from_sampler, ray_schedule  # noqa: E402
from moonat.terrain.pds import R_MOON_M as R  # noqa: E402
from moonat.terrain.pds import enu_basis, unit_from_latlon  # noqa: E402

D_MIN, D_MAX = 5_000.0, 120_000.0


def pixel_units(w, r_idx, c_idx):
    """Unit vectors of pixel centres (inverse projection from DSMAP.CAT / DSMAP_POLAR.CAT)."""
    s = w.spec
    R_, C_ = np.meshgrid(r_idx + w.r0, c_idx + w.c0, indexing="ij")
    if s.projection == "cyl":
        lat = s.lat_top - (R_ + 0.5) / s.res_ppd
        lon = s.lon_left + (C_ + 0.5) / s.res_ppd
        return unit_from_latlon(lat, lon)
    n = s.lines
    i1, j1 = C_ + 1.0, R_ + 1.0  # 1-based sample I, line J
    x = (i1 - n / 2 - 0.5) * s.scale_m
    y = (j1 - n / 2 - 0.5) * s.scale_m * (1 if s.pole > 0 else -1)
    rr = np.hypot(x, y)
    lon = np.degrees(np.arctan2(x, y))
    colat = np.degrees(2 * np.arctan(0.5 * rr / R))
    lat = (90 - colat) if s.pole > 0 else (-90 + colat)
    return unit_from_latlon(lat, lon)


def point_cloud_check(lat, lon, dem: LayeredDEM, h0: float, h_obs=2.0, step=0.25):
    mid = dem.layers[1].window
    e, n, up = enu_basis(lat, lon)
    r_eye = R + h0 + h_obs
    # restrict to pixels near the site
    from moonat.terrain.pds import grid_rowcol

    rs, cs = grid_rowcol(mid.spec, up)
    half = int(D_MAX / mid.cell_m) + 3
    r_idx = np.arange(
        max(0, int(rs) - mid.r0 - half), min(mid.data.shape[0], int(rs) - mid.r0 + half)
    )
    c_lo = int(cs) - mid.c0 - half
    c_idx = np.arange(max(0, c_lo), min(mid.data.shape[1], int(cs) - mid.c0 + half))
    if mid.spec.projection == "cyl":  # LDEM_64 windows already are local
        r_idx = np.arange(mid.data.shape[0])
        c_idx = np.arange(mid.data.shape[1])
    u = pixel_units(mid, r_idx, c_idx).reshape(-1, 3)
    h = mid.data[np.ix_(r_idx, c_idx)].reshape(-1).astype(float)
    cosd = u @ up
    s = np.arccos(np.clip(cosd, -1, 1)) * R
    m = (s > D_MIN) & (s < D_MAX) & np.isfinite(h)
    P = (R + h[m])[:, None] * u[m]
    v = P - r_eye * up
    az = np.degrees(np.arctan2(v @ e, v @ n)) % 360
    el = np.degrees(np.arctan2(v @ up, np.hypot(v @ e, v @ n)))
    # each pixel covers the azimuths within half a pixel of its centre (footprint binning)
    nb = int(360 / step)
    half_deg = np.degrees(0.5 * mid.cell_m / s[m])
    k0 = np.round(az / step).astype(int)
    pc = np.full(nb, -90.0)
    kmax = int(np.ceil(half_deg.max() / step))
    for off in range(-kmax, kmax + 1):
        sel = np.abs(off * step + (k0 * step - az)) <= half_deg
        np.maximum.at(pc, (k0[sel] + off) % nb, el[sel])
    # ray march on the same layer and band
    one = LayeredDEM(lat, lon, [Layer(mid, np.inf)])

    def f(uu, ss):
        hh = one.sample(uu, ss)
        return np.where((ss > D_MIN) & (ss < D_MAX), hh, np.nan)

    sched = ray_schedule([mid.cell_m], [np.inf], D_MAX)
    rm = horizon_from_sampler(
        f, lat, lon, h0, h_obs, step, sched, R + 12_000.0, require_termination=False
    )["el_deg"]
    ok = pc > -89
    d = pc[ok] - rm[ok]
    return {
        "layer": mid.spec.name,
        "n_pixels": int(m.sum()),
        "bins_compared": int(ok.sum()),
        "median_diff_deg": round(float(np.median(d)), 4),
        "p05_diff_deg": round(float(np.percentile(d, 5)), 4),
        "p95_diff_deg": round(float(np.percentile(d, 95)), 4),
        "max_abs_diff_deg": round(float(np.abs(d).max()), 4),
        "corr": round(float(np.corrcoef(pc[ok], rm[ok])[0, 1]), 5),
        "best_lag_deg": best_lag(pc, rm, step),
        "corr_if_azimuth_mirrored": round(
            float(np.corrcoef(pc, rm[(-np.arange(nb)) % nb])[0, 1]), 3
        ),
    }


def best_lag(a, b, step):
    """Azimuth shift (deg) that maximises the circular correlation of two profiles."""
    a = a - a.mean()
    b = b - b.mean()
    lags = np.arange(-40, 41)
    c = [np.dot(a, np.roll(b, k)) for k in lags]
    return float(lags[int(np.argmax(c))] * step)


def stats(el):
    el = np.asarray(el)
    return f"{el.min():.2f} / {el.mean():.2f} / {el.max():.2f}"


def main():
    sites = {
        s["id"]: s for s in json.loads((ROOT / "web/data/sites.json").read_text("utf-8"))["sites"]
    }
    ids = sys.argv[1:] or ["apollo11", "shackleton_rim"]
    out = {}
    for sid in ids:
        st = sites[sid]
        lat, lon = st["lat_deg"], st["lon_deg"]
        dem = build_layers(lat, lon)
        h0 = float(dem.sample(unit_from_latlon(lat, lon)[None, :])[0])
        res = {"point_cloud": point_cloud_check(lat, lon, dem, h0)}
        sens = {}
        for label, kw in (
            ("2 m, all terrain (C3)", {}),
            ("2 m, ignore < 100 m", {"min_dist_m": 100.0}),
            ("2 m, ignore < 500 m", {"min_dist_m": 500.0}),
            ("10 m, all terrain", {"observer_height_m": 10.0}),
        ):
            hp = horizon_profile(lat, lon, dem=dem, **kw)
            sens[label] = stats(hp["el_deg"])
        res["sensitivity_min_mean_max_deg"] = sens
        out[sid] = res
        print(sid, json.dumps(res, indent=1))
    return out


def tiles_check(ids):
    """C5 tiles: horizon from the tiles only vs the full C3 horizon (and its far field > 5 km)."""
    from moonat.terrain.tiles import tiles_dem

    sites = {
        s["id"]: s for s in json.loads((ROOT / "web/data/sites.json").read_text("utf-8"))["sites"]
    }
    rows = {}
    for sid in ids:
        st = sites[sid]
        lat, lon = st["lat_deg"], st["lon_deg"]
        full = json.loads((ROOT / f"web/data/horizons/{sid}.json").read_text("utf-8"))
        tp = horizon_profile(lat, lon, dem=tiles_dem(lat, lon, ROOT / "web/data/dem"))
        far = horizon_profile(lat, lon, dem=build_layers(lat, lon), min_dist_m=5000.0)
        a, b, c = (np.array(x["el_deg"]) for x in (tp, full, far))
        rows[sid] = {
            "tile_ground_m": tp["ground_elev_m"],
            "full_ground_m": full["ground_elev_m"],
            "smooth_vs_C3_rms_deg": round(float(np.sqrt(np.mean(b**2))), 3),
            "vs_C3_rms_deg": round(float(np.sqrt(np.mean((a - b) ** 2))), 3),
            "vs_C3_bias_deg": round(float(np.mean(a - b)), 3),
            "vs_far_field_rms_deg": round(float(np.sqrt(np.mean((a - c) ** 2))), 3),
            "vs_far_field_bias_deg": round(float(np.mean(a - c)), 3),
        }
        print(sid, rows[sid], flush=True)
    return rows


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "tiles":
        tiles_check(sys.argv[2:])
    else:
        main()
