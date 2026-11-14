# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Sun statistics and figure for the on-demand terrain validation (docs/validation/terrain-everywhere.md).

Input: ``outputs/terrain_everywhere/`` from ``node scripts/data/validate_terrain_everywhere.mjs``
(on-demand and tiles-only horizons, timing, bytes). For the polar sites the Sun's topocentric
apparent position (moonat.ephem.direct: skyfield + DE421 + MOON_ME) is sampled every hour over one
synodic month (29.53 d from 2027-01-01 and from 2027-07-01, 00:00 UTC: high and low Sun at the
south pole) and the visible disk fraction
(moonat.visibility) is evaluated for three horizons: the precomputed C3 profile, the on-demand
profile and the tiles-only profile. Reported per horizon:
- ``sun_vis_pct``: share of samples with any part of the disk visible (contract C6 summary);
- ``mean_vis_pct``: time average of the visible disk fraction.
Writes ``docs/validation/terrain_everywhere.json`` and the figure
``docs/figures/terrain_everywhere.png`` (transparent background, mid-grey ink: readable on light and
dark pages).

Usage: ``uv run python scripts/data/validate_terrain_everywhere.py``
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from moonat.ephem import direct
from moonat.terrain import horizon_profile
from moonat.visibility import visible_fraction

ROOT = Path(__file__).resolve().parents[2]
IN = ROOT / "outputs" / "terrain_everywhere"
SYNODIC_D = 29.530589
MONTHS = {"2027-01": datetime(2027, 1, 1, tzinfo=UTC), "2027-07": datetime(2027, 7, 1, tzinfo=UTC)}
STEP_H = 1.0
POLAR = ["shackleton_rim", "malapert_massif", "south_pole", "art_haworth", "degerlache_rim"]
NEAR_SITES = ["apollo11", "apollo16"]
FIG_SITES = ["apollo15", "apollo17", "change4", "shackleton_rim", "malapert_massif", "south_pole"]
GEN = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."


def sun_stats(lat: float, lon: float, ground_m: float, horizon: dict, t0: datetime) -> dict:
    t = t0.timestamp() + np.arange(0.0, SYNODIC_D * 24.0, STEP_H) * 3600.0
    sun = direct.sky_state(lat, lon, t, ground_elev_m=ground_m, bodies=("sun",))["sun"]
    f = np.array(
        [
            visible_fraction(a, e, r, horizon)
            for a, e, r in zip(sun["az_deg"], sun["el_deg"], sun["ang_radius_deg"], strict=True)
        ]
    )
    return {
        "sun_vis_pct": round(100 * float((f > 0).mean()), 1),
        "mean_vis_pct": round(100 * float(f.mean()), 1),
    }


def plot(rows: dict, path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    ink, grid = "#8c8c8c", "#8c8c8c40"
    c_ref, c_new, c_old = "#4a90d9", "#d9822b", "#9a9a9a"
    fig, axes = plt.subplots(3, 2, figsize=(11, 8.2), sharex=True)
    for ax, sid in zip(axes.ravel(), FIG_SITES, strict=True):
        d = json.loads((IN / f"{sid}.json").read_text())
        c3 = json.loads((ROOT / "web" / "data" / "horizons" / f"{sid}.json").read_text())
        az = np.arange(1440) * 0.25
        az_old = np.arange(len(d["tiles_only"]["el_deg"])) * d["tiles_only"]["az_step_deg"]
        ax.plot(
            az_old,
            d["tiles_only"]["el_deg"],
            color=c_old,
            lw=1.0,
            ls="--",
            label="before: C5 tiles only",
        )
        ax.plot(
            az, c3["el_deg"], color=c_ref, lw=1.6, label="precomputed C3 (PDS, 20-60 m near field)"
        )
        ax.plot(
            az,
            d["on_demand"]["el_deg"],
            color=c_new,
            lw=1.1,
            label="on demand: Moon Trek LOLA + tiles",
        )
        r = rows[sid]["on_demand_vs_c3"]
        ax.set_title(
            f"{rows[sid]['name']}   on-demand vs C3: RMS {r['rms']:.2f}°, bias {r['bias']:+.2f}°",
            color=ink,
            fontsize=9,
        )
        ax.axhline(0.0, color=ink, lw=0.6, ls=":")
        ax.set_xlim(0, 360)
        ax.set_xticks(np.arange(0, 361, 90))
        ax.grid(True, color=grid, lw=0.6)
        ax.tick_params(colors=ink, labelsize=8)
        ax.set_facecolor("none")
        for s in ax.spines.values():
            s.set_color(grid)
    for ax in axes[:, 0]:
        ax.set_ylabel("horizon elevation (deg)", color=ink, fontsize=8)
    for ax in axes[-1, :]:
        ax.set_xlabel("true azimuth (deg from north)", color=ink, fontsize=8)
    h, lab = axes[0, 0].get_legend_handles_labels()
    leg = fig.legend(h, lab, loc="upper center", ncol=3, frameon=False, fontsize=9)
    for t in leg.get_texts():
        t.set_color(ink)
    fig.text(
        0.99,
        0.005,
        "LOLA DEMs: NASA PDS; NASA Moon Trek (JPL) ImageServer. Moonat.",
        ha="right",
        va="bottom",
        fontsize=7,
        color=ink,
    )
    fig.tight_layout(rect=(0, 0.01, 1, 0.95))
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=110, transparent=True)
    plt.close(fig)


def main() -> None:
    summary = json.loads((IN / "summary.json").read_text())
    rows = {r["id"]: r for r in summary["sites"]}
    sun = {}
    for sid in POLAR:
        if sid not in rows:
            continue
        d = json.loads((IN / f"{sid}.json").read_text())
        c3 = json.loads((ROOT / "web" / "data" / "horizons" / f"{sid}.json").read_text())
        lat, lon = c3["lat_deg"], c3["lon_deg"]
        old = {"az_step_deg": d["tiles_only"]["az_step_deg"], "el_deg": d["tiles_only"]["el_deg"]}
        new = {"az_step_deg": 0.25, "el_deg": d["on_demand"]["el_deg"]}
        sun[sid] = {
            m: {
                "c3": sun_stats(lat, lon, c3["ground_elev_m"], c3, t0),
                "on_demand": sun_stats(lat, lon, d["on_demand"]["ground_elev_m"], new, t0),
                "tiles_only": sun_stats(lat, lon, d["tiles_only"]["ground_elev_m"], old, t0),
            }
            for m, t0 in MONTHS.items()
        }
        print(sid, json.dumps(sun[sid]), flush=True)
    near = {}
    for sid in NEAR_SITES:
        d = json.loads((IN / f"{sid}.json").read_text())
        if "on_demand_min500" not in d:
            continue
        ref = horizon_profile(d["lat_deg"], d["lon_deg"], min_dist_m=500.0)
        a, b = np.array(d["on_demand_min500"]["el_deg"]), np.array(ref["el_deg"])
        near[sid] = {
            "ignoring_terrain_closer_than_m": 500,
            "on_demand_vs_c3": {
                "rms": round(float(np.sqrt(np.mean((a - b) ** 2))), 3),
                "bias": round(float(np.mean(a - b)), 3),
                "max": round(float(np.max(np.abs(a - b))), 3),
            },
            "mean_el_deg": {
                "on_demand": round(float(a.mean()), 2),
                "c3": round(float(b.mean()), 2),
            },
        }
        print(sid, "min 500 m", json.dumps(near[sid]), flush=True)
    out = {
        "_generated_by": GEN,
        "sun_periods_utc": {m: [t0.isoformat(), f"+{SYNODIC_D} d"] for m, t0 in MONTHS.items()},
        "sun_step_h": STEP_H,
        "sun": sun,
        "near_field_cutoff": near,
        **summary,
    }
    (ROOT / "docs" / "validation" / "terrain_everywhere.json").write_text(
        json.dumps(out, indent=1), encoding="utf-8"
    )
    plot(rows, ROOT / "docs" / "figures" / "terrain_everywhere.png")
    print("wrote docs/validation/terrain_everywhere.json and docs/figures/terrain_everywhere.png")


if __name__ == "__main__":
    main()
