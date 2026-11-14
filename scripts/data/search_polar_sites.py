# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Pick representative highly-illuminated points for south-polar regions from LOLA terrain.

For each region (an approximate centre and a search radius, or an annulus for a crater rim) we
evaluate candidate points on a grid and keep the one with the highest mean Sun visibility over
one lunar year (2027, 2 h steps):

1. Sun directions in MOON_ME from the Moon's centre (moonat.ephem.direct: skyfield + DE421 +
   MOON_ME). Topocentric parallax over a 30 km region is below 0.001 deg and is ignored here.
2. Horizon of each candidate from our LOLA layers (moonat.terrain.horizon, same geometry as C3):
   near field LOLA 20 m (cached blocks only, falling back to 240 m), mid LOLA 240 m, far LDEM_16.
   Coarse stage: 2 km grid (3 km for searches wider than 22 km), 1 deg azimuth step.
   Refinement: +-(step/2 + 0.5 km) at step/8 around the two best coarse points, 0.5 deg step.
   Rays whose horizon is below -5 deg (far below the Sun, which stays within +-1.6 deg) may stop
   at 434 km without the exact range bound.
3. Visibility score: mean over time of a linear disk-fraction proxy,
   clip((el_sun - h(az_sun)) / (2 rho_sun) + 0.5, 0, 1), rho_sun = 0.2666 deg.
4. Final check: the winner and the original point get the full C3 horizon (0.25 deg) and the
   exact disk fraction from moonat.visibility; both numbers are reported.

Output: docs/validation/polar_sites.json. Usage: uv run python scripts/data/search_polar_sites.py
"""

from __future__ import annotations

import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from moonat.ephem import direct  # noqa: E402
from moonat.terrain.dem import (  # noqa: E402
    Layer,
    LayeredDEM,
    _polar_citation,
    _whole_window,
    global_source,
    polar_source,
    window_around,
)
from moonat.terrain.horizon import horizon_from_sampler, ray_schedule, stop_angle  # noqa: E402
from moonat.terrain.pds import (  # noqa: E402
    R_MOON_M,
    enu_basis,
    latlon_from_unit,
    ps_cell_m,
    unit_from_latlon,
)
from moonat.visibility import visible_fraction  # noqa: E402

GEN = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."
RHO_SUN_DEG = 0.2666
NEAR_BAND_M = 10_000.0
T0, T1, STEP_H = datetime(2027, 1, 1, tzinfo=UTC), datetime(2028, 1, 1, tzinfo=UTC), 2.0

# id: (centre lat, centre lon, r_min_m, r_max_m)
LROC = "https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_ROI_"
# id: (centre lat, centre lon, r_min_m, r_max_m, source of the centre)
# Artemis III region centres come from the LROC NAC low-Sun mosaics made for each candidate region
# (product id P<lat*10>S<lon*10>, e.g. P836S2912 = 83.6 S, 291.2 E).
REGIONS = {
    "degerlache_rim": (-88.5, -87.1, 12_000.0, 22_000.0, "crater centre; rim annulus searched"),
    "art_cabeusb": (-83.6, -68.8, 0.0, 15_000.0, LROC + "CABEUSPKLOA (P836S2912)"),
    "art_haworth": (-86.7, -23.7, 0.0, 15_000.0, LROC + "HAWORTH_LOA (P867S3363)"),
    "art_malapert": (-86.0, 0.3, 0.0, 15_000.0, LROC + "MALAPERTLOA (P860S0003)"),
    "art_mouton_plateau": (-84.3, 30.6, 0.0, 15_000.0, LROC + "MOUTNPLTLO1 (P843S0306)"),
    "art_mouton": (-85.4, 35.3, 0.0, 15_000.0, LROC + "MTMOUTONLOB (P854S0353)"),
    "art_nobile2": (-83.9, 58.7, 0.0, 15_000.0, LROC + "NOBILE02LOA (P839S0587)"),
    # No LROC mosaic found for Nobile Rim 1: best point on the Nobile rim annulus (crater centre
    # -85.2, 53.5; diameter ~73 km), at least 30 km from the Nobile Rim 2 and Mons Mouton points
    # (without that, the annulus edge reaches the Mons Mouton summit, a separate region).
    "art_nobile1": (
        -85.2,
        53.5,
        30_000.0,
        42_000.0,
        "Nobile crater rim annulus (no LROC mosaic found)",
    ),
    "art_degerlache2": (-88.5, -66.7, 0.0, 15_000.0, LROC + "DEGERRIMLO1 (P885S2933)"),
    "art_slater": (
        -88.1,
        111.3,
        0.0,
        15_000.0,
        "Slater crater (-88.08, 111.29); no LROC mosaic found",
    ),
}
EXCLUDE_NEAR = {"art_nobile1": [("art_nobile2", 30_000.0), ("art_mouton", 30_000.0)]}
# Extra refinement seeds: the best points of a first search pass centred on the earlier catalog
# estimates. A 2 km coarse grid can straddle a narrow crest; refining around these as well keeps
# the better of the two passes (only seeds inside the search area are used).
SEEDS = {
    "degerlache_rim": [(-89.0056, -96.6455)],
    "art_malapert": [(-85.9961, 2.0095)],
    "art_mouton": [(-85.2004, 36.5264)],
    "art_degerlache2": [(-88.6706, -68.4328)],
}


def sun_me_units() -> np.ndarray:
    t = np.arange(T0.timestamp(), T1.timestamp(), STEP_H * 3600.0)
    mc = direct.moon_centre_apparent(t, bodies=("sun",))
    v = np.einsum("nij,nj->ni", mc["r_icrs_to_me"], mc["sun"])
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def offset_point(lat, lon, east_m, north_m):
    """Great-circle point at ENU horizontal offset (east_m, north_m) from (lat, lon)."""
    e, n, up = enu_basis(lat, lon)
    s = np.hypot(east_m, north_m)
    if s == 0:
        return lat, lon
    d = (east_m * e + north_m * n) / s
    u = np.cos(s / R_MOON_M) * up + np.sin(s / R_MOON_M) * d
    la, lo = latlon_from_unit(u)
    return float(la), float(lo)


class Region:
    def __init__(self, lat, lon, reach_m):
        src = polar_source("80", "s", "20m")
        near = window_around(
            src,
            lat,
            lon,
            reach_m + NEAR_BAND_M,
            ps_cell_m(src.spec, lat),
            _polar_citation(src.spec.name),
            download=False,
        )
        mid = _whole_window(polar_source("75", "s", "240m"), lat)
        far = _whole_window(global_source(16), lat)
        self.layers = [Layer(near, NEAR_BAND_M), Layer(mid, 450_000.0), Layer(far, np.inf)]
        probe = LayeredDEM(lat, lon, self.layers)
        self.rho_max = R_MOON_M + probe.max_height_m(0.25 + reach_m / R_MOON_M) + 300.0
        self.cells = [near.cell_m, mid.cell_m, far.cell_m]
        self.near_nan_frac = float(np.isnan(near.data).mean())

    def horizon(self, lat, lon, az_step, h_obs=2.0):
        dem = LayeredDEM(lat, lon, self.layers)
        h0 = float(dem.sample(unit_from_latlon(lat, lon)[None, :])[0])
        r_eye = R_MOON_M + h0 + h_obs
        th_cap = min(float(stop_angle(r_eye, np.array([-np.radians(5.0)]), self.rho_max)[0]), 0.25)
        sched = ray_schedule(self.cells, [NEAR_BAND_M, 450_000.0, np.inf], th_cap * R_MOON_M)
        res = horizon_from_sampler(
            lambda u, s: dem.sample(u, s),
            lat,
            lon,
            h0,
            h_obs,
            az_step,
            sched,
            self.rho_max,
            require_termination=False,
        )
        return h0, res["el_deg"]


def score(lat, lon, el_h, az_step, sun):
    e, n, up = enu_basis(lat, lon)
    el = np.degrees(np.arcsin(np.clip(sun @ up, -1, 1)))
    az = np.degrees(np.arctan2(sun @ e, sun @ n)) % 360
    azg = np.arange(len(el_h) + 1) * az_step
    h = np.interp(az, azg, np.append(el_h, el_h[0]))
    return float(np.clip((el - h) / (2 * RHO_SUN_DEG) + 0.5, 0, 1).mean()), el, az


def exact_visibility(lat, lon, region, sun_t):
    """Full 0.25 deg horizon + exact disk fraction with topocentric Sun (moonat.visibility)."""
    h0, el_h = region.horizon(lat, lon, 0.25)
    st = direct.sky_state(lat, lon, sun_t, ground_elev_m=h0, observer_height_m=2.0, bodies=("sun",))
    hz = {"az_step_deg": 0.25, "el_deg": list(map(float, el_h))}
    s = st["sun"]
    f = np.array(
        [
            visible_fraction(a, e, r, hz)
            for a, e, r in zip(s["az_deg"], s["el_deg"], s["ang_radius_deg"], strict=True)
        ]
    )
    return h0, float(f.mean()), float((f > 0).mean())


def search(rid, sun, sun_t, rmax_override=None, done=None):
    clat, clon, rmin, rmax, csrc = REGIONS[rid]
    if rmax_override:
        rmax = rmax_override
    step = 2000.0 if rmax <= 22_000.0 else 3000.0
    half = step / 2 + 500.0
    t0 = time.time()
    reg = Region(clat, clon, rmax + 1500.0)
    # coarse
    g = np.arange(-rmax, rmax + 1, step)
    excl = []
    for other, dmin in EXCLUDE_NEAR.get(rid, []):
        if done and other in done:
            o = done[other]
            excl.append((unit_from_latlon(o["best_lat_deg"], o["best_lon_deg"]), dmin))

    def allowed(la, lo):
        u = unit_from_latlon(la, lo)
        return all(np.arccos(np.clip(u @ v, -1, 1)) * R_MOON_M >= dmin for v, dmin in excl)

    cands = []
    for x in g:
        for y in g:
            r = np.hypot(x, y)
            if rmin <= r <= rmax:
                la, lo = offset_point(clat, clon, x, y)
                if not allowed(la, lo):
                    continue
                h0, elh = reg.horizon(la, lo, 1.0)
                sc, _, _ = score(la, lo, elh, 1.0, sun)
                cands.append((sc, la, lo, x, y, h0))
    cands.sort(reverse=True)
    # refine around the two best coarse points and any seeds inside the search area
    centres = [(c[3], c[4]) for c in cands[:2]]
    e, n, up = enu_basis(clat, clon)
    for sla, slo in SEEDS.get(rid, []):
        v = unit_from_latlon(sla, slo)
        s = np.arccos(np.clip(v @ up, -1, 1)) * R_MOON_M
        a = np.arctan2(v @ e, v @ n)
        if rmin <= s <= rmax:
            centres.append((s * np.sin(a), s * np.cos(a)))
    fine = []
    for x0, y0 in centres:
        for dx in np.arange(-half, half + 1, step / 8):
            for dy in np.arange(-half, half + 1, step / 8):
                if not rmin <= np.hypot(x0 + dx, y0 + dy) <= rmax + 1000.0:
                    continue
                la, lo = offset_point(clat, clon, x0 + dx, y0 + dy)
                if not allowed(la, lo):
                    continue
                h0, elh = reg.horizon(la, lo, 0.5)
                sc, _, _ = score(la, lo, elh, 0.5, sun)
                fine.append((sc, la, lo, x0 + dx, y0 + dy, h0))
    fine.sort(reverse=True)
    best = fine[0]
    h_new, vis_new, lit_new = exact_visibility(best[1], best[2], reg, sun_t)
    h_old, vis_old, lit_old = exact_visibility(clat, clon, reg, sun_t)
    out = {
        "region_centre": [clat, clon],
        "region_centre_source": csrc,
        "search_annulus_m": [rmin, rmax],
        "n_coarse": len(cands),
        "n_fine": len(fine),
        "near_field_nan_frac": round(reg.near_nan_frac, 3),
        "best_lat_deg": round(best[1], 4),
        "best_lon_deg": round(best[2], 4),
        "best_offset_en_m": [round(best[3]), round(best[4])],
        "best_ground_m": round(h_new, 1),
        "best_proxy_vis": round(best[0], 4),
        "best_mean_sun_vis_2027": round(vis_new, 4),
        "best_time_lit_2027": round(lit_new, 4),
        "old_ground_m": round(h_old, 1),
        "old_mean_sun_vis_2027": round(vis_old, 4),
        "old_time_lit_2027": round(lit_old, 4),
        "runtime_s": round(time.time() - t0, 1),
    }
    print(rid, json.dumps(out), flush=True)
    return out


def final_check():
    """Exact 2027 Sun visibility at each chosen point from its published C3 horizon file."""
    p = ROOT / "docs" / "validation" / "polar_sites.json"
    res = json.loads(p.read_text(encoding="utf-8"))
    sun_t = np.arange(T0.timestamp(), T1.timestamp(), STEP_H * 3600.0)
    for rid, row in res["regions"].items():
        hz = json.loads((ROOT / "web" / "data" / "horizons" / f"{rid}.json").read_text("utf-8"))
        assert abs(hz["lat_deg"] - row["best_lat_deg"]) < 1e-9, rid
        st = direct.sky_state(
            hz["lat_deg"],
            hz["lon_deg"],
            sun_t,
            ground_elev_m=hz["ground_elev_m"],
            observer_height_m=2.0,
            bodies=("sun",),
        )
        s = st["sun"]
        f = np.array(
            [
                visible_fraction(a, e, r, hz)
                for a, e, r in zip(s["az_deg"], s["el_deg"], s["ang_radius_deg"], strict=True)
            ]
        )
        row["c3_ground_m"] = hz["ground_elev_m"]
        row["c3_mean_sun_vis_2027"] = round(float(f.mean()), 4)
        row["c3_time_lit_2027"] = round(float((f > 0).mean()), 4)
        print(rid, row["c3_mean_sun_vis_2027"], flush=True)
    p.write_text(json.dumps(res, indent=1), encoding="utf-8")


def main():
    if sys.argv[1:] == ["--final"]:
        final_check()
        return
    ids = sys.argv[1:] or list(REGIONS)
    sun = sun_me_units()
    sun_t = np.arange(T0.timestamp(), T1.timestamp(), STEP_H * 3600.0)
    p = ROOT / "docs" / "validation" / "polar_sites.json"
    res = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    res.setdefault("method", __doc__.split("\n\n")[1].strip())
    res["_generated_by"] = GEN
    res.setdefault("regions", {})
    for arg in ids:
        rid, _, rkm = arg.partition(":")
        rmax = float(rkm) * 1000.0 if rkm else None
        res["regions"][rid] = search(rid, sun, sun_t, rmax, res["regions"])
        p.write_text(json.dumps(res, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
