# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Cross-check our south-pole horizons against published illumination statistics.

For each reference point we compute the horizon (moonat.terrain), the Sun's topocentric apparent
position (moonat.ephem.direct: skyfield + DE421 + MOON_ME) every ``STEP_H`` hours, and the visible
fraction of the solar disk (moonat.visibility). Reported:
- avg_illumination_pct: time average of the visible disk fraction (Glaser et al. 2014 "average
  illumination", Sun as an extended disk);
- time_lit_pct: share of time with any part of the disk visible;
- longest_dark_days: longest continuous period with the disk fully hidden.

Reference values (Glaser et al. 2014, EPSC2014-136-1 and Icarus 243, 20 m LOLA DTM, 1 h steps,
about 19-20 years): connecting ridge spot 1 (89.4395 S, 222.8066 E, 2 m): 88.1 % average, 92 % lit;
spot 3 (89.4516 S, 222.7581 E, 10 m): 92.5 % average, 95.6 % lit.

Usage: uv run python scripts/data/validate_illumination.py
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from moonat.ephem import direct  # noqa: E402
from moonat.terrain import horizon_profile  # noqa: E402
from moonat.visibility import visible_fraction  # noqa: E402

STEP_H = 2.0
T0, T1 = datetime(2020, 1, 1, tzinfo=UTC), datetime(2038, 7, 1, tzinfo=UTC)  # 18.5 yr

POINTS = [
    # id, lat, lon (east, -180..180), eye height (m), published avg %, published lit %, source
    ("glaser_cr1_spot1", -89.4395, 222.8066 - 360, 2.0, 88.1, 92.0, "Glaser 2014 EPSC, spot 1"),
    ("glaser_cr1_spot3", -89.4516, 222.7581 - 360, 10.0, 92.5, 95.6, "Glaser 2014 EPSC, spot 3"),
    ("catalog_shackleton_rim", -89.45, -137.3, 2.0, None, None, "catalog POI"),
]


def run_point(lat, lon, h_obs, min_dist_m=0.0):
    hp = horizon_profile(lat, lon, observer_height_m=h_obs, min_dist_m=min_dist_m)
    t = np.arange(T0.timestamp(), T1.timestamp(), STEP_H * 3600.0)
    st = direct.sky_state(
        lat, lon, t, ground_elev_m=hp["ground_elev_m"], observer_height_m=h_obs, bodies=("sun",)
    )
    sun = st["sun"]
    f = np.array(
        [
            visible_fraction(a, e, r, hp)
            for a, e, r in zip(sun["az_deg"], sun["el_deg"], sun["ang_radius_deg"], strict=True)
        ]
    )
    dark = f <= 0.0
    longest = run = 0
    for d in dark:
        run = run + 1 if d else 0
        longest = max(longest, run)
    return {
        "avg_illumination_pct": round(100 * float(f.mean()), 1),
        "time_lit_pct": round(100 * float((f > 0).mean()), 1),
        "longest_dark_days": round(longest * STEP_H / 24.0, 2),
        "sun_el_range_deg": [
            round(float(sun["el_deg"].min()), 2),
            round(float(sun["el_deg"].max()), 2),
        ],
        "horizon_min_mean_max_deg": [
            round(min(hp["el_deg"]), 2),
            round(float(np.mean(hp["el_deg"])), 2),
            round(max(hp["el_deg"]), 2),
        ],
        "ground_elev_m": hp["ground_elev_m"],
    }


def main():
    out = {"period_utc": [T0.isoformat(), T1.isoformat()], "step_h": STEP_H, "points": {}}
    for pid, lat, lon, h, pub_avg, pub_lit, src in POINTS:
        row = {
            "lat_deg": lat,
            "lon_deg": round(lon, 4),
            "eye_m": h,
            "source": src,
            "published_avg_pct": pub_avg,
            "published_lit_pct": pub_lit,
        }
        row["ours_all_terrain"] = run_point(lat, lon, h)
        row["ours_ignore_lt_100m"] = run_point(lat, lon, h, min_dist_m=100.0)
        out["points"][pid] = row
        print(pid, json.dumps(row), flush=True)
    p = ROOT / "docs" / "validation" / "terrain_illumination.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    out["_generated_by"] = (
        "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."
    )
    p.write_text(json.dumps(out, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
