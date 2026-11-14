# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Build horizon profiles (C3) and terrain patches (C4) for the catalog sites.

Usage:
    uv run python scripts/data/build_terrain.py                 # all sites in web/data/sites.json
    uv run python scripts/data/build_terrain.py apollo11 shackleton_rim
    uv run python scripts/data/build_terrain.py --no-patch --figures all

Idempotent: outputs are pure functions of the catalog coordinates and the LOLA files, so a rerun
rewrites identical files. LOLA windows are downloaded once into data/raw/dem/ (shared by all
worktrees); the total download is logged in data/raw/dem/download_log.json.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from moonat.terrain import build_layers, horizon_profile, write_terrain_patch  # noqa: E402
from moonat.terrain.dem import NEAR_RADIUS_M  # noqa: E402
from moonat.terrain.fetch import bytes_fetched  # noqa: E402
from moonat.terrain.tiles import build_tiles  # noqa: E402

SITES = ROOT / "web" / "data" / "sites.json"
OUT_H = ROOT / "web" / "data" / "horizons"
OUT_T = ROOT / "web" / "data" / "terrain"
FIG = ROOT / "docs" / "figures"

PRIORITY = [
    "apollo11",
    "shackleton_rim",
    "apollo12",
    "apollo14",
    "apollo15",
    "apollo16",
    "apollo17",
    "change4",
    "chandrayaan3",
    "im1",
    "malapert_massif",
    "degerlache_rim",
    "south_pole",
]
# Sites placed by scripts/data/search_polar_sites.py use a 17.5 km LOLA 20 m near field (240 m
# beyond) to stay inside the 500 MB download budget; 17.5 km still covers the whole +-12 km terrain
# patch. All other sites use NEAR_RADIUS_M (30 km).
NEAR_RADIUS_BY_SITE = {
    sid: 17_500.0
    for sid in (
        "degerlache_rim",
        "art_cabeusb",
        "art_haworth",
        "art_malapert",
        "art_mouton_plateau",
        "art_mouton",
        "art_nobile1",
        "art_nobile2",
        "art_degerlache2",
        "art_slater",
    )
}
FIGURE_SITES = [
    "apollo11",
    "apollo15",
    "apollo17",
    "change4",
    "chandrayaan3",
    "im1",
    "shackleton_rim",
    "malapert_massif",
    "degerlache_rim",
    "south_pole",
]


def plot_horizon(hp: dict, name: str, path: Path) -> None:
    """el vs az (top) and distance of the horizon-setting terrain (bottom); transparent PNG with
    neutral grey ink so it reads on light and dark backgrounds."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    ink, grid, col = "#8c8c8c", "#8c8c8c40", "#d9822b"
    az = np.arange(len(hp["el_deg"])) * hp["az_step_deg"]
    el = np.array(hp["el_deg"])
    dk = np.array(hp["dist_km"])
    fig, (a1, a2) = plt.subplots(
        2, 1, figsize=(9, 5.2), sharex=True, gridspec_kw={"height_ratios": [2.2, 1]}
    )
    lo = min(-1.0, el.min() - 0.5)
    a1.fill_between(az, lo, el, color=col, alpha=0.30, linewidth=0)
    a1.plot(az, el, color=col, linewidth=1.6)
    a1.axhline(0.0, color=ink, linewidth=0.8, linestyle="--")
    a1.set_ylim(lo, max(1.0, el.max() + 0.5 + 0.15 * (el.max() - lo)))
    a1.set_ylabel("horizon elevation (deg)")
    k = int(el.argmax())
    a1.plot([az[k]], [el[k]], "o", color=col, markersize=5)
    a1.text(
        0.01,
        0.97,
        f"max {el[k]:.2f} deg at az {az[k]:.1f}, {dk[k]:.1f} km   |   "
        f"min {el.min():.2f}, mean {el.mean():.2f} deg",
        transform=a1.transAxes,
        va="top",
        color=ink,
        fontsize=8,
    )
    a1.set_title(
        f"{name}: terrain horizon from the eye ({hp['observer_height_m']:.0f} m above "
        f"ground, {hp['lat_deg']:.4f}, {hp['lon_deg']:.4f}; ground "
        f"{hp['ground_elev_m']:.0f} m)",
        color=ink,
        fontsize=10,
    )
    a2.semilogy(az, np.maximum(dk, 0.01), color=ink, linewidth=1.0)
    a2.set_ylabel("distance (km)")
    a2.set_xlabel("true azimuth (deg from north, clockwise)")
    a2.set_xlim(0, 360)
    a2.set_xticks(np.arange(0, 361, 45))
    for a in (a1, a2):
        a.grid(True, color=grid, linewidth=0.6)
        a.tick_params(colors=ink, labelsize=8)
        a.yaxis.label.set_color(ink)
        a.xaxis.label.set_color(ink)
        a.set_facecolor("none")
        for s in a.spines.values():
            s.set_color(grid)
    fig.text(
        0.99, 0.005, "LOLA DEMs (NASA PDS); Moonat", ha="right", va="bottom", fontsize=7, color=ink
    )
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=110, transparent=True)
    plt.close(fig)


def build_site(site: dict, patch: bool, figure: bool) -> dict:
    sid, lat, lon = site["id"], float(site["lat_deg"]), float(site["lon_deg"])
    t0 = time.time()
    dem = build_layers(lat, lon, near_radius_m=NEAR_RADIUS_BY_SITE.get(sid, NEAR_RADIUS_M))
    t1 = time.time()
    hp = horizon_profile(lat, lon, site_id=sid, dem=dem)
    t2 = time.time()
    OUT_H.mkdir(parents=True, exist_ok=True)
    (OUT_H / f"{sid}.json").write_text(json.dumps(hp, separators=(",", ":")), encoding="utf-8")
    if patch:
        write_terrain_patch(sid, lat, lon, OUT_T, dem=dem)
    if figure:
        plot_horizon(hp, site.get("name", sid), FIG / f"horizon_{sid}.png")
    el = np.array(hp["el_deg"])
    dk = np.array(hp["dist_km"])
    k = int(el.argmax())
    row = {
        "id": sid,
        "lat": lat,
        "lon": lon,
        "ground_m": hp["ground_elev_m"],
        "el_min": float(el.min()),
        "el_mean": float(el.mean()),
        "el_max": float(el.max()),
        "az_max": k * hp["az_step_deg"],
        "dist_max_km": float(dk[k]),
        "range_km": hp["max_range_km"],
        "near_dem": hp["dem_sources"][0].split(" (")[0],
        "t_load_s": round(t1 - t0, 1),
        "t_horizon_s": round(t2 - t1, 2),
    }
    print(
        f"{sid:18s} ground {row['ground_m']:8.1f} m  el {row['el_min']:6.2f} .. "
        f"{row['el_max']:6.2f} (mean {row['el_mean']:5.2f}) max at az {row['az_max']:6.2f} "
        f"{row['dist_max_km']:6.1f} km  range {row['range_km']:5.0f} km  "
        f"[{row['near_dem']}] load {row['t_load_s']}s horizon {row['t_horizon_s']}s",
        flush=True,
    )
    return row


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("ids", nargs="*", help="site ids (default: all, priority order)")
    ap.add_argument("--no-patch", action="store_true", help="skip terrain patches")
    ap.add_argument(
        "--tiles", action="store_true", help="also rebuild C5 tiles (default: all-site runs)"
    )
    ap.add_argument("--figures", choices=["key", "all", "none"], default="key")
    ap.add_argument("--summary", default=str(ROOT / "docs" / "validation" / "terrain_sites.json"))
    args = ap.parse_args()

    sites = {s["id"]: s for s in json.loads(SITES.read_text(encoding="utf-8"))["sites"]}
    ids = args.ids or (PRIORITY + [i for i in sites if i not in PRIORITY])
    rows = []
    for sid in ids:
        if sid not in sites:
            print(f"{sid}: not in catalog, skipped")
            continue
        fig = args.figures == "all" or (args.figures == "key" and sid in FIGURE_SITES)
        try:
            rows.append(build_site(sites[sid], not args.no_patch, fig))
        except Exception as e:  # keep going; report at the end
            print(f"{sid}: FAILED {type(e).__name__}: {e}", flush=True)
    if args.tiles or not args.ids:
        build_tiles(ROOT / "web" / "data" / "dem")
        print("C5 tiles written to web/data/dem/")
    print(f"DEM bytes fetched so far (all runs): {bytes_fetched() / 1e6:.1f} MB")
    if rows and not args.ids:
        p = Path(args.summary)
        p.parent.mkdir(parents=True, exist_ok=True)
        rows_sorted = sorted(rows, key=lambda r: ids.index(r["id"]))
        for r in rows_sorted:
            r.pop("t_load_s")
            r.pop("t_horizon_s")  # timings vary between runs; printed only
            for key in ("el_min", "el_mean", "el_max", "dist_max_km"):
                r[key] = round(r[key], 3)
        p.write_text(
            json.dumps(
                {
                    "_generated_by": "AI-generated with Claude Code (Anthropic), directed and reviewed "
                    "by the Moonat team.",
                    "sites": rows_sorted,
                },
                indent=1,
            ),
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
