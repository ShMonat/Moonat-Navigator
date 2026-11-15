# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""StarHab site study, step 3: rank the refined candidates, write the site file and the figures.

Ranking: score = (sun_pct + earth_pct) / 2 at the 10 m mast height (StarHab's arrays and DTE
antenna stand on masts above the buried hull), from the full-quality step (C3 horizon with LOLA
20 m near field, exact C6 fractions, 1 h, 2030-2040). Candidates whose 20 m near field is not
cached (> 5 % missing) are reported but not recommended. Alternatives: the best site by sunlight,
the best site in another area (> 10 km away), and the best by simultaneous Sun + Earth time,
each at least 5 km from the sites already picked (at most 3).

Outputs:
- data/starhab_site.json: recommended site and alternatives (MOON_ME lat/lon, ground height,
  metrics at 2 m and 10 m, slope, distance to permanent shadow);
- docs/figures/starhab_sunlight_map.png, starhab_earth_map.png, starhab_pareto.png,
  starhab_context.png (light card background with dark ink, readable in light and dark pages);
- data/cache/starhab/report_table.md: the full results table (pasted into the report).

Usage: uv run python scripts/starhab/report.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.colors import LightSource  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import starhab_core as C  # noqa: E402
import validate as V  # noqa: E402

from moonat.terrain.dem import _whole_window, polar_source  # noqa: E402
from moonat.terrain.pds import grid_rowcol, unit_from_latlon  # noqa: E402

FIG = C.ROOT / "docs" / "figures"
SITE_JSON = C.ROOT / "data" / "starhab_site.json"
SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
ACCENT, ALT = "#d1495b", "#2e86ab"
WATERMARK = "Moonat · AI-generated with Claude Code · LOLA DEMs, JPL DE421"
MAX_MISSING_NEAR = 0.05

# Named places for labels: (name, lat, lon, rim radius km or 0 for a point, tolerance km)
PLACES = [
    ("Connecting ridge", -89.4679, -137.411, 0.0, 5.0),  # De Rosa et al. 2012 CR1
    ("Shackleton rim", -89.655, 129.174, 10.5, 3.5),  # crater centre (Zuber et al. 2012)
    ("Shackleton-vicinity peak", -88.8247, 124.1359, 0.0, 6.0),  # De Rosa SV1
    ("de Gerlache rim", -88.5, -87.1, 16.5, 6.0),  # crater centre, diameter ~33 km
    ("Malapert massif", -86.0, 1.0, 0.0, 25.0),
    # Potential Artemis sites (NASA's candidate regions; catalog points, docs/validation/terrain.md §9)
    ("Mons Mouton", -85.4798, 31.3216, 0.0, 30.0),
    ("Mons Mouton plateau", -84.2237, 29.0434, 0.0, 12.0),
    ("Nobile rim 1", -84.3661, 44.35, 0.0, 15.0),
    ("Nobile rim 2", -84.1053, 59.6634, 0.0, 12.0),
    ("Haworth rim", -86.9555, -24.1657, 0.0, 15.0),
    ("Cabeus B", -83.6164, -68.5775, 0.0, 15.0),
    ("Slater plain", -87.6901, 107.2054, 0.0, 20.0),
]
MAP_LABELS = [
    ("Shackleton", -89.655, 129.174),
    ("de Gerlache", -88.5, -87.1),
    ("Malapert", -86.0, 1.0),
    ("Mons Mouton", -85.4, 33.0),
    ("Nobile", -85.2, 53.5),
    ("Haworth", -87.45, -5.0),
    ("Cabeus", -84.9, -35.5),
    ("Faustini", -87.3, 77.0),
]


def region_name(lat: float, lon: float) -> str:
    best, name = np.inf, f"{lat:.3f}, {lon:.3f}"
    for n, la, lo, rim, tol in PLACES:
        d = float(C.great_circle_m(lat, lon, la, lo)) / 1000.0
        off = abs(d - rim) if rim else d
        if off <= tol and off < best:
            best, name = off, n
    return name


def style():
    plt.rcParams.update(
        {
            "font.size": 9.5,
            "text.color": INK,
            "axes.labelcolor": INK,
            "xtick.color": INK2,
            "ytick.color": INK2,
            "axes.edgecolor": INK2,
            "axes.titlesize": 10.5,
            "figure.facecolor": SURFACE,
            "axes.facecolor": SURFACE,
            "savefig.facecolor": SURFACE,
        }
    )


def watermark(fig):
    fig.text(0.995, 0.005, WATERMARK, ha="right", va="bottom", fontsize=7, color=INK2)


# ------------------------------------------------------------------------------------------------
# Ranking
# ------------------------------------------------------------------------------------------------


def build_rows(ref: dict) -> list[dict]:
    rows = []
    for i, c in enumerate(ref["candidates"]):
        f2, f10 = c["final"]["2m"], c["final"][f"{C.MAST_M:g}m"]
        rows.append(
            {
                "i": i,
                "why": c["why"],
                "region": region_name(c["lat_final"], c["lon_final"]),
                "lat": c["lat_final"],
                "lon": c["lon_final"],
                "ground_m": f2["ground_m"],
                "m2": f2["metrics"],
                "m10": f10["metrics"],
                "s2": f2["metrics"]["score"],
                "s10": f10["metrics"]["score"],
                "missing_near": f2["near_20m_missing_frac"],
                "slope": c["slope_100m"],
                "psr_km": c["psr_distance_km"],
                "polish_shift_m": round(
                    float(C.great_circle_m(c["lat"], c["lon"], c["lat_final"], c["lon_final"])), 0
                ),
                "hz2": f2["horizon_el_deg"],
                "hz10": f10["horizon_el_deg"],
                "screen": c["screen"],
            }
        )
    return rows


def far_from(r, picked, km):
    return all(
        C.great_circle_m(r["lat"], r["lon"], p["lat"], p["lon"]) >= km * 1000 for p in picked
    )


def choose(rows: list[dict]) -> tuple[dict, list[tuple[str, dict]]]:
    ok = [r for r in rows if r["missing_near"] <= MAX_MISSING_NEAR]
    rec = max(ok, key=lambda r: r["s10"])
    picked, alts = [rec], []
    rules = [
        ("most sunlight", lambda r: r["m10"]["sun_pct"], 5.0),
        ("best score in another area", lambda r: r["s10"], 10.0),
        ("next best for Sun and Earth at the same time", lambda r: r["m10"]["both_pct"], 5.0),
    ]
    for label, key, km in rules:
        cands = [r for r in ok if far_from(r, picked, km)]
        if cands:
            a = max(cands, key=key)
            picked.append(a)
            alts.append((label, a))
    return rec, alts


def weight_sweep(rows: list[dict]) -> list[dict]:
    """Winner of w * sun + (1 - w) * earth (10 m) for w in 0..1, as intervals of w."""
    ok = [r for r in rows if r["missing_near"] <= MAX_MISSING_NEAR]
    out = []
    for w in np.round(np.arange(0.0, 1.0001, 0.01), 2):
        best = max(ok, key=lambda r: w * r["m10"]["sun_pct"] + (1 - w) * r["m10"]["earth_pct"])
        if out and out[-1]["i"] == best["i"]:
            out[-1]["w_max"] = float(w)
        else:
            out.append(
                {"i": best["i"], "region": best["region"], "w_min": float(w), "w_max": float(w)}
            )
    return out


def tradeoff_text(r: dict) -> str:
    m = r["m10"]
    return (
        f"At a {C.MAST_M:g} m mast: Sun {m['sun_pct']:.1f} % (longest dark {m['dark_max_d']:.1f} d), "
        f"Earth {m['earth_pct']:.1f} % (longest blackout {m['blackout_max_d']:.1f} d), "
        f"both {m['both_pct']:.1f} % of the time."
    )


def site_entry(sid, role, r, why=None) -> dict:
    keep = (
        "sun_pct",
        "sun_lit_pct",
        "sun_disk_pct",
        "dark_max_d",
        "dark_max_start",
        "earth_pct",
        "earth_any_pct",
        "blackout_max_d",
        "blackout_max_start",
        "both_pct",
        "both_min_pct",
        "score",
    )
    return {
        "id": sid,
        "role": role,
        "why": why,
        "name": r["region"],
        "lat_deg": round(r["lat"], 5),
        "lon_deg": round(r["lon"], 5),
        "ground_elev_m": r["ground_m"],
        "mast_height_m": C.MAST_M,
        "metrics_2m": {k: r["m2"][k] for k in keep if k in r["m2"]},
        "metrics_mast": {k: r["m10"][k] for k in keep if k in r["m10"]},
        "slope_100m": r["slope"],
        "psr_distance_km": {
            "nasa_pgda_60m": V.pgda_psr_distance(r["lat"], r["lon"]),
            "moonat_screening": r["psr_km"],
            "note": (
                "nasa_pgda_60m: nearest permanently shadowed pixel of NASA's 60 m average-solar-"
                "visibility map (Mazarico et al. 2011 method, 18.6 yr), and of a shadowed area of at "
                "least 1 km^2; moonat_screening: nearest screening point (250/500 m grid, 240 m DEM, "
                "eye 2 m) never sunlit in 2030-2040"
            ),
        },
        "near_field_20m_missing_frac": r["missing_near"],
        "summary": tradeoff_text(r),
    }


def write_site_json(rec, alts, sweep, rows):
    sites = [
        site_entry(
            "starhab_recommended", "recommended", rec, f"highest score at the {C.MAST_M:g} m mast"
        )
    ]
    for k, (label, a) in enumerate(alts, 1):
        sites.append(site_entry(f"starhab_alt{k}", "alternative", a, label))
    out = {
        "_generated_by": C.GEN,
        "description": (
            "StarHab (horizontal, regolith-buried Starship HLS) site study: the best south-polar "
            "site for sunlight plus direct-to-Earth line of sight, 2030-01-01 to 2040-12-31. "
            "Method and caveats: docs/research/starhab_site.md."
        ),
        "frame": "MOON_ME (DE421): planetocentric lat/lon in deg, longitude east-positive",
        "ground_elev_m": "LOLA LDEM_80S_20M height above the 1737.4 km sphere (bilinear)",
        "period_utc": ["2030-01-01T00:00:00Z", "2040-12-31T23:00:00Z"],
        "time_step_h": 1.0,
        "eye_heights_m": [C.EYE_M, C.MAST_M],
        "score": "(sun_pct + earth_pct) / 2 at the mast height",
        "metric_definitions": {
            "sun_pct": "mean visible share of the Sun's limb-darkened flux (terrain + Earth eclipses), %",
            "sun_lit_pct": "% of time with any sunlight",
            "sun_disk_pct": "mean visible fraction of the solar disk (Glaser's average illumination), %",
            "dark_max_d": "longest stretch with no sunlight at all, days",
            "earth_pct": "mean visible fraction of the Earth's disk, %",
            "earth_any_pct": "% of time with any part of the Earth's disk visible",
            "blackout_max_d": "longest stretch with the Earth fully hidden, days",
            "both_pct": "% of time with some sunlight and some of the Earth's disk visible",
            "both_min_pct": "mean of min(Sun flux share, Earth disk share), %",
        },
        "recommended": sites[0]["id"],
        "sites": sites,
        "weight_sweep_mast": [
            {
                "site": rows[s["i"]]["region"],
                "lat_deg": rows[s["i"]]["lat"],
                "lon_deg": rows[s["i"]]["lon"],
                "w_sun_from": s["w_min"],
                "w_sun_to": s["w_max"],
            }
            for s in sweep
        ],
    }
    SITE_JSON.write_text(json.dumps(out, indent=1), encoding="utf-8")
    return sites


def write_table(rows, rec, alts):
    tag = {rec["i"]: "**REC**"} | {a["i"]: f"alt {k}" for k, (_, a) in enumerate(alts, 1)}
    lines = [
        "| # | Site | Region | lat, lon | Ground (m) | Sun % 2/10 m | Lit % 10 m | Dark max d 2/10 m"
        " | Earth % 2/10 m | Blackout max d 2/10 m | Both % 2/10 m | Score 2/10 m | Slope 100 m (deg)"
        " | PSR (km) | 20 m missing |",
        "|---" * 15 + "|",
    ]
    for r in sorted(rows, key=lambda r: -r["s10"]):
        a, b = r["m2"], r["m10"]
        sl = r["slope"]["tilt_deg"]
        lines.append(
            f"| {r['i']} | {tag.get(r['i'], '')} | {r['region']} | {r['lat']:.4f}, {r['lon']:.4f} | "
            f"{r['ground_m']:.0f} | {a['sun_pct']:.1f} / {b['sun_pct']:.1f} | {b['sun_lit_pct']:.1f} | "
            f"{a['dark_max_d']:.1f} / {b['dark_max_d']:.1f} | {a['earth_pct']:.1f} / {b['earth_pct']:.1f} | "
            f"{a['blackout_max_d']:.1f} / {b['blackout_max_d']:.1f} | {a['both_pct']:.1f} / {b['both_pct']:.1f} | "
            f"{r['s2']:.1f} / {r['s10']:.1f} | {sl if sl is not None else 'n/a'} | {r['psr_km']} | "
            f"{100 * r['missing_near']:.0f} % |"
        )
    (C.cache_dir() / "report_table.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


# ------------------------------------------------------------------------------------------------
# Figures
# ------------------------------------------------------------------------------------------------


def dem240():
    w = _whole_window(polar_source("75", "s", "240m"), -89.0)
    a = np.asarray(w.data, dtype=float)
    n = a.shape[0]
    c0 = w.spec.row0
    ext = np.array([-0.5 - c0, n - 0.5 - c0, c0 - (n - 0.5), c0 + 0.5]) * w.spec.scale_m / 1000.0
    return a, ext, w.spec


def hillshade(a, cell_m):
    ls = LightSource(azdeg=315, altdeg=35)
    return ls.hillshade(a, vert_exag=2.0, dx=cell_m, dy=cell_m)


def crop(a, ext, half_km, scale_km):
    n = a.shape[0]
    c0 = (n - 1) / 2
    k = int(half_km / scale_km)
    sl = slice(int(c0 - k), int(c0 + k) + 1)
    sub = a[sl, sl]
    x0 = (sl.start - c0 - 0.5) * scale_km
    x1 = (sl.stop - 1 - c0 + 0.5) * scale_km
    return sub, [x0, x1, -x1, -x0]


def sites_xy(rows):
    x, y = C.ps_xy_km([r["lat"] for r in rows], [r["lon"] for r in rows])
    return np.asarray(x), np.asarray(y)


def plot_sites(ax, rows, rec, alts, labels=True, size=1.0):
    x, y = sites_xy(rows)
    ax.scatter(x, y, s=14 * size, facecolor="none", edgecolor=INK, lw=0.8, zorder=5)
    for k, (_, a) in enumerate(alts, 1):
        ax.scatter(
            *C.ps_xy_km(a["lat"], a["lon"]),
            s=80 * size,
            marker="D",
            color=ALT,
            edgecolor="white",
            lw=0.8,
            zorder=6,
        )
        if labels:
            ax.annotate(
                f"alt {k}",
                C.ps_xy_km(a["lat"], a["lon"]),
                xytext=(6, 4),
                textcoords="offset points",
                color=ALT,
                fontsize=8.5,
                weight="bold",
                zorder=7,
            )
    ax.scatter(
        *C.ps_xy_km(rec["lat"], rec["lon"]),
        s=260 * size,
        marker="*",
        color=ACCENT,
        edgecolor="white",
        lw=0.8,
        zorder=8,
    )
    if labels:
        ax.annotate(
            "StarHab",
            C.ps_xy_km(rec["lat"], rec["lon"]),
            xytext=(7, -12),
            textcoords="offset points",
            color=ACCENT,
            fontsize=9,
            weight="bold",
            zorder=9,
        )


def feature_labels(ax):
    """Crater and massif names, set below their reference points so site markers stay visible."""
    for n, la, lo in MAP_LABELS:
        ax.annotate(
            n,
            C.ps_xy_km(la, lo),
            xytext=(0, -16),
            textcoords="offset points",
            fontsize=7.5,
            color=INK,
            ha="center",
            zorder=4,
            bbox={"boxstyle": "round,pad=0.15", "fc": SURFACE, "ec": "none", "alpha": 0.75},
        )


def lat_circles(ax, lats, half):
    for la in lats:
        r = float(np.hypot(*C.ps_xy_km(la, 0.0)))
        if r < half * 1.42:
            ax.add_patch(plt.Circle((0, 0), r, fill=False, color=INK2, lw=0.5, ls=":", zorder=3))
            ax.text(r * 0.707, -r * 0.707, f"{abs(la):g}°S", fontsize=7, color=INK2, zorder=3)


def map_axes(ax, half, title):
    ax.set_xlim(-half, half)
    ax.set_ylim(-half, half)
    ax.set_aspect("equal")
    ax.set_title(title)
    ax.set_xlabel("km toward 90°E")
    ax.set_ylabel("km toward 0°E (Earth side)")


def fig_heatmap(sc, rows, rec, alts, key, label, cmap, fname, vmin, vmax):
    a, ext, spec = dem240()
    hs = hillshade(a, 240.0)
    fig, axes = plt.subplots(1, 2, figsize=(13.2, 6.3), layout="constrained")
    # left: whole region
    half = 190.0
    sub, e = crop(hs, ext, half + 5, 0.24)
    ax = axes[0]
    ax.imshow(sub, extent=e, cmap="gray", vmin=0, vmax=1, alpha=0.75, zorder=0)
    m = sc["tag"] != 0
    order = np.argsort(sc[key][m])
    sca = ax.scatter(
        sc["x_km"][m][order],
        sc["y_km"][m][order],
        c=sc[key][m][order],
        s=1.5,
        cmap=cmap,
        vmin=vmin,
        vmax=vmax,
        lw=0,
        zorder=2,
    )
    inner = sc["tag"] == 0
    ax.scatter(
        sc["x_km"][inner],
        sc["y_km"][inner],
        c=sc[key][inner],
        s=0.3,
        cmap=cmap,
        vmin=vmin,
        vmax=vmax,
        lw=0,
        zorder=2,
    )
    lat_circles(ax, [85, 86, 87, 88, 89], half)
    feature_labels(ax)
    plot_sites(ax, rows, rec, alts, labels=True, size=0.8)
    map_axes(ax, half, f"{label}: elevated terrain 84–90°S (screening, eye 2 m)")
    # right: 89-90 S raster
    ax = axes[1]
    half2 = 31.5
    sub, e = crop(hs, ext, half2 + 1, 0.24)
    ax.imshow(sub, extent=e, cmap="gray", vmin=0, vmax=1, zorder=0)
    ix = np.round(sc["x_km"][inner] / 0.25).astype(int)
    iy = np.round(sc["y_km"][inner] / 0.25).astype(int)
    k = int(ix.max())
    img = np.full((2 * k + 1, 2 * k + 1), np.nan)
    img[k - iy, ix + k] = sc[key][inner]
    ax.imshow(
        img,
        extent=[-(k + 0.5) * 0.25, (k + 0.5) * 0.25, -(k + 0.5) * 0.25, (k + 0.5) * 0.25],
        cmap=cmap,
        vmin=vmin,
        vmax=vmax,
        alpha=0.85,
        zorder=1,
        interpolation="nearest",
    )
    plot_sites(ax, rows, rec, alts, labels=True)  # markers outside the panel are clipped
    ax.annotate("Shackleton", C.ps_xy_km(-89.655, 129.174), ha="center", fontsize=8, color="white")
    ax.annotate("de Gerlache", C.ps_xy_km(-88.75, -80.0), ha="center", fontsize=8, color="white")
    map_axes(ax, half2, f"{label}: 89–90°S, every 250 m (screening, eye 2 m)")
    cb = fig.colorbar(sca, ax=axes, shrink=0.85, pad=0.02)
    cb.set_label(f"{label} 2030–2040 (%)")
    watermark(fig)
    fig.savefig(FIG / fname, dpi=105)
    plt.close(fig)


def fig_pareto(sc, rows, rec, alts):
    fig, ax = plt.subplots(figsize=(9.6, 6.6))
    ax.hexbin(
        sc["sun_pct"],
        sc["earth_pct"],
        gridsize=90,
        bins="log",
        cmap="Greys",
        mincnt=1,
        linewidths=0,
        alpha=0.55,
        zorder=1,
    )
    for s in (50, 60, 70, 80, 90):
        xs = np.array([0, 100])
        ax.plot(xs, 2 * s - xs, color=GRID, lw=0.8, zorder=0)
        ax.text(
            min(99, 2 * s - 32),
            32 if 2 * s - 32 <= 99 else 2 * s - 99,
            f"score {s}",
            fontsize=7,
            color=INK2,
            rotation=-45,
        )
    for r in rows:
        ax.plot(
            [r["m2"]["sun_pct"], r["m10"]["sun_pct"]],
            [r["m2"]["earth_pct"], r["m10"]["earth_pct"]],
            color=INK2,
            lw=0.6,
            zorder=2,
        )
    s2 = ax.scatter(
        [r["m2"]["sun_pct"] for r in rows],
        [r["m2"]["earth_pct"] for r in rows],
        s=22,
        facecolor=SURFACE,
        edgecolor=INK,
        lw=0.9,
        zorder=3,
        label="refined, eye 2 m",
    )
    s10 = ax.scatter(
        [r["m10"]["sun_pct"] for r in rows],
        [r["m10"]["earth_pct"] for r in rows],
        s=22,
        color=INK,
        zorder=3,
        label=f"refined, mast {C.MAST_M:g} m",
    )
    # Pareto front of the mast-height results
    pts = np.array([[r["m10"]["sun_pct"], r["m10"]["earth_pct"]] for r in rows])
    order = np.lexsort((-pts[:, 1], -pts[:, 0]))
    front, best = [], -1
    for i in order:
        if pts[i, 1] > best:
            front.append(i)
            best = pts[i, 1]
    fp = pts[front]
    ax.step(
        fp[:, 0],
        fp[:, 1],
        where="post",
        color=ACCENT,
        lw=1.2,
        alpha=0.6,
        zorder=2,
        label=f"Pareto front ({C.MAST_M:g} m)",
    )
    for k, (_, a) in enumerate(alts, 1):
        ax.scatter(
            a["m10"]["sun_pct"],
            a["m10"]["earth_pct"],
            s=90,
            marker="D",
            color=ALT,
            edgecolor="white",
            zorder=5,
        )
        ax.annotate(
            f"alt {k}: {a['region']}",
            (a["m10"]["sun_pct"], a["m10"]["earth_pct"]),
            xytext=(6, -12),
            textcoords="offset points",
            fontsize=8.5,
            color=ALT,
            weight="bold",
        )
    ax.scatter(
        rec["m10"]["sun_pct"],
        rec["m10"]["earth_pct"],
        s=320,
        marker="*",
        color=ACCENT,
        edgecolor="white",
        zorder=6,
    )
    ax.annotate(
        f"StarHab: {rec['region']}",
        (rec["m10"]["sun_pct"], rec["m10"]["earth_pct"]),
        xytext=(8, 6),
        textcoords="offset points",
        fontsize=9,
        color=ACCENT,
        weight="bold",
    )
    ax.set_xlim(30, 100)
    ax.set_ylim(30, 101)
    ax.set_xlabel("Sunlight: mean visible share of the Sun's flux, 2030–2040 (%)")
    ax.set_ylabel("Earth in view: mean visible share of the Earth's disk (%)")
    ax.set_title(
        "Sunlight vs direct-to-Earth line of sight at the lunar south pole\n"
        "grey: 80 648 screening points (240 m DEM, eye 2 m); dots: refined candidates"
    )
    ax.grid(color=GRID, lw=0.5)
    ax.legend(handles=[s2, s10], loc="lower left", frameon=False)
    watermark(fig)
    fig.tight_layout()
    fig.savefig(FIG / "starhab_pareto.png", dpi=130)
    plt.close(fig)


def fig_context(sc, rows, rec, alts, eph):
    a, ext, spec = dem240()
    hs = hillshade(a, 240.0)
    fig = plt.figure(figsize=(13.5, 9.2))
    gs = fig.add_gridspec(2, 2, height_ratios=[1.25, 1], width_ratios=[1.15, 1])
    # (1) region
    ax = fig.add_subplot(gs[0, 0])
    half = 175.0
    sub, e = crop(hs, ext, half + 5, 0.24)
    ax.imshow(sub, extent=e, cmap="gray", vmin=0, vmax=1, zorder=0)
    lat_circles(ax, [85, 86, 87, 88, 89], half)
    feature_labels(ax)
    plot_sites(ax, rows, rec, alts, labels=True)
    ax.annotate("toward Earth ↑", (0, half * 0.93), ha="center", fontsize=8, color=INK2)
    map_axes(ax, half, "Recommended site and alternatives (LOLA 240 m hillshade)")
    # (2) zoom on the recommended site, LOLA 20 m
    ax = fig.add_subplot(gs[0, 1])
    src = polar_source("80", "s", "20m")
    row, col = grid_rowcol(src.spec, unit_from_latlon(rec["lat"], rec["lon"])[None, :])
    r0, c0 = int(round(float(row[0]))), int(round(float(col[0])))
    k = 125  # +-2.5 km
    z = src.read(r0 - k, r0 + k + 1, c0 - k, c0 + k + 1, download=False).astype(float)
    xc = (c0 - src.spec.col0) * 0.02
    yc = (src.spec.row0 - r0) * 0.02
    ex = [
        xc - (k + 0.5) * 0.02,
        xc + (k + 0.5) * 0.02,
        yc - (k + 0.5) * 0.02,
        yc + (k + 0.5) * 0.02,
    ]
    zz = np.where(np.isfinite(z), z, np.nanmean(z))
    ax.imshow(hillshade(zz, 20.0), extent=ex, cmap="gray", vmin=0, vmax=1, zorder=0)
    cs = ax.contour(
        np.linspace(ex[0], ex[1], zz.shape[1]),
        np.linspace(ex[3], ex[2], zz.shape[0]),
        zz,
        levels=np.arange(np.floor(zz.min() / 50) * 50, zz.max() + 50, 50),
        colors=ALT,
        linewidths=0.5,
        alpha=0.7,
        zorder=1,
    )
    ax.clabel(cs, cs.levels[::4], fontsize=6.5, fmt="%d m")
    px, py = C.ps_xy_km(rec["lat"], rec["lon"])
    ax.add_patch(
        plt.Rectangle((px - 0.05, py - 0.05), 0.1, 0.1, fill=False, color=ACCENT, lw=1.2, zorder=3)
    )
    ax.add_patch(
        plt.Rectangle(
            (px - 0.4, py - 0.4), 0.8, 0.8, fill=False, color=INK2, lw=0.7, ls="--", zorder=3
        )
    )
    ax.scatter(px, py, s=200, marker="*", color=ACCENT, edgecolor="white", zorder=4)
    dark = sc["sun_lit_pct"] <= 0
    inview = (
        dark
        & (sc["x_km"] > ex[0])
        & (sc["x_km"] < ex[1])
        & (sc["y_km"] > ex[2])
        & (sc["y_km"] < ex[3])
    )
    if inview.any():
        ax.scatter(
            sc["x_km"][inview],
            sc["y_km"][inview],
            s=10,
            color="#5b2a86",
            marker="s",
            zorder=2,
            label="never sunlit 2030–2040 (screening)",
        )
        ax.legend(loc="lower left", fontsize=7.5, frameon=True, facecolor=SURFACE)
    ax.set_xlim(ex[0], ex[1])
    ax.set_ylim(ex[2], ex[3])
    ax.set_aspect("equal")
    ax.set_title(
        f"StarHab site {rec['lat']:.4f}°, {rec['lon']:.4f}°E, ground {rec['ground_m']:.0f} m\n"
        "LOLA 20 m; red box 100 m (slope), dashed ±400 m (polish), 50 m contours"
    )
    ax.set_xlabel("km toward 90°E")
    ax.set_ylabel("km toward 0°E (Earth side)")
    # (3) horizon with the Sun's and the Earth's sky tracks
    ax = fig.add_subplot(gs[1, :])
    az = np.arange(1440) * 0.25
    r_eye = C.R_MOON_M + rec["ground_m"] + C.MAST_M
    s = C.topocentric(eph["sun"], rec["lat"], rec["lon"], r_eye, C.SUN_RADIUS_KM)
    e = C.topocentric(eph["earth"], rec["lat"], rec["lon"], r_eye, C.EARTH_RADIUS_KM)
    ax.scatter(
        e["az"][::3],
        e["el"][::3],
        s=0.4,
        color=ALT,
        alpha=0.25,
        lw=0,
        label="Earth centre, 2030–2040",
    )
    ax.scatter(
        s["az"][::3],
        s["el"][::3],
        s=0.4,
        color="#e9a03b",
        alpha=0.25,
        lw=0,
        label="Sun centre, 2030–2040",
    )
    ax.plot(az, rec["hz2"], color=INK2, lw=0.9, label="skyline, eye 2 m")
    ax.fill_between(az, -10, rec["hz10"], color=INK, alpha=0.35, lw=0)
    ax.plot(az, rec["hz10"], color=INK, lw=1.2, label=f"skyline, mast {C.MAST_M:g} m")
    ax.axhline(0, color=GRID, lw=0.8)
    ax.set_xlim(0, 360)
    lo = min(np.min(rec["hz10"]), np.min(s["el"]), np.min(e["el"])) - 0.5
    hi = max(np.max(rec["hz2"]), np.max(s["el"]), np.max(e["el"])) + 0.5
    ax.set_ylim(lo, hi)
    ax.set_xticks(np.arange(0, 361, 45))
    ax.set_xlabel(
        "Azimuth (deg, clockwise from local north = away from the pole along the meridian)"
    )
    ax.set_ylabel("Elevation (deg)")
    ax.set_title("Skyline at the StarHab site and where the Sun and the Earth travel in its sky")
    leg = ax.legend(
        loc="upper right", fontsize=8, frameon=True, facecolor=SURFACE, markerscale=12, ncol=2
    )
    for h in leg.legend_handles:
        h.set_alpha(1)
    watermark(fig)
    fig.tight_layout()
    fig.savefig(FIG / "starhab_context.png", dpi=110)
    plt.close(fig)


def main():
    style()
    sc = np.load(C.cache_dir() / "screen.npz")
    sc = {k: sc[k] for k in sc.files}
    ref = json.loads((C.cache_dir() / "refine.json").read_text(encoding="utf-8"))
    rows = build_rows(ref)
    rec, alts = choose(rows)
    sweep = weight_sweep(rows)
    write_site_json(rec, alts, sweep, rows)
    write_table(rows, rec, alts)
    print(
        "recommended",
        rec["region"],
        rec["lat"],
        rec["lon"],
        rec["m2"],
        rec["m10"],
        rec["slope"],
        rec["psr_km"],
    )
    for label, a in alts:
        print("alt", label, a["region"], a["lat"], a["lon"], a["m10"])
    print("sweep", [(rows[s["i"]]["region"], s["w_min"], s["w_max"]) for s in sweep])
    fig_heatmap(
        sc, rows, rec, alts, "sun_pct", "Sunlight", "magma", "starhab_sunlight_map.png", 0, 90
    )
    fig_heatmap(
        sc,
        rows,
        rec,
        alts,
        "earth_pct",
        "Earth in view",
        "viridis",
        "starhab_earth_map.png",
        0,
        100,
    )
    fig_pareto(sc, rows, rec, alts)
    fig_context(sc, rows, rec, alts, C.body_vectors_me(2.0))
    print("figures written", flush=True)


if __name__ == "__main__":
    main()
