# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Write tests/fixtures/ephem_cases.json: expected sky states for the JavaScript port (physics-js).

Every expected value comes from the table-based Python reference (``moonat.ephem.table``), i.e.
exactly what the JS code must reproduce from web/data/ephem/ (C6 tolerance: az/el 0.001 deg,
phase 0.001). Inputs are test inputs (sites named after the area they sit in), not catalog data.

Usage: uv run python scripts/make_ephem_cases.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from moonat.ephem import table
from moonat.ephem.table import PLANETS, year_start_posix

ROOT = Path(__file__).resolve().parents[1]
GEN = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."

# name, lat_deg, lon_deg, ground_elev_m, observer_height_m, t_utc
FIXED = [
    ("apollo11_landing", 0.67416, 23.47314, 0.0, 2.0, "1969-07-20T20:17:40Z"),
    ("apollo11_area_2026", 0.67416, 23.47314, 0.0, 2.0, "2026-11-14T12:00:00Z"),
    ("apollo15_area_1971", 26.1322, 3.6339, 0.0, 2.0, "1971-07-31T12:00:00Z"),
    ("apollo17_area_1972", 20.1908, 30.7717, 0.0, 2.0, "1972-12-12T06:30:00Z"),
    ("subearth_mean_point", 0.0, 0.0, 0.0, 2.0, "2030-06-01T00:00:00Z"),
    ("south_pole_exact", -90.0, 0.0, 0.0, 2.0, "2026-11-14T12:00:00Z"),
    ("south_pole_exact_lon45", -90.0, 45.0, 0.0, 2.0, "2026-11-14T12:00:00Z"),
    ("north_pole_exact", 90.0, 0.0, 0.0, 2.0, "2027-03-01T00:00:00Z"),
    ("south_polar_89.5S", -89.5, 0.0, 0.0, 2.0, "2026-11-14T12:00:00Z"),
    ("south_polar_ridge_area", -89.45, -137.3, 1500.0, 10.0, "2028-01-15T09:00:00Z"),
    ("north_polar_89.5N", 89.5, -60.0, 0.0, 2.0, "2033-08-20T18:45:00Z"),
    ("chandrayaan3_area", -69.373, 32.319, 0.0, 2.0, "2023-08-23T12:33:00Z"),
    ("change4_area_farside", -45.4446, 177.5991, 0.0, 2.0, "2019-01-03T02:26:00Z"),
    ("farside_antipode", 0.0, 180.0, 0.0, 2.0, "2030-06-01T00:00:00Z"),
    ("limb_east", 0.0, 90.0, 0.0, 2.0, "2024-04-08T18:00:00Z"),
    ("high_mountain_mast", 10.0, -20.0, 5000.0, 100.0, "2015-09-28T02:47:00Z"),
    ("deep_basin", -40.0, -160.0, -6000.0, 2.0, "2020-12-14T16:00:00Z"),
    ("year_boundary_before", 5.0, 5.0, 0.0, 2.0, "2025-12-31T23:59:59.999Z"),
    ("year_boundary_exact", 5.0, 5.0, 0.0, 2.0, "2026-01-01T00:00:00Z"),
    ("leap_second_interval", 5.0, 5.0, 0.0, 2.0, "2016-12-31T22:30:00Z"),
    ("first_interval_1966", -30.0, 60.0, 0.0, 2.0, "1966-01-01T01:15:00Z"),
    ("last_interval_2040", 30.0, -60.0, 0.0, 2.0, "2040-12-31T22:45:00Z"),
]
N_RANDOM = 8


def expected(lat, lon, ge, oh, t) -> dict:
    s = table.sky_state(lat, lon, t, ge, oh)
    f = lambda v: float(np.asarray(v).ravel()[0])  # noqa: E731
    vec = lambda v: [float(x) for x in np.asarray(v)[0]]  # noqa: E731
    out = {}
    for b in ("sun", "earth"):
        d = s[b]
        out[b] = {k: f(d[k]) for k in ("az_deg", "el_deg", "dist_km", "ang_radius_deg")}
        out[b]["enu"] = vec(d["enu"])
    out["earth"]["phase_frac"] = f(s["earth"]["phase_frac"])
    out["earth"]["sun_dir_enu"] = vec(s["earth"]["sun_dir_enu"])
    out["earth"]["era_deg"] = f(s["era_deg"])
    out["r_icrs_to_enu"] = [float(x) for x in s["r_icrs_to_enu"][0].ravel()]
    out["era_deg"] = f(s["era_deg"])
    out["planets"] = [
        {
            "name": p,
            "az_deg": f(s[p]["az_deg"]),
            "el_deg": f(s[p]["el_deg"]),
            "enu": vec(s[p]["enu"]),
        }
        for p in PLANETS
    ]
    return out


def main() -> None:
    from moonat.ephem.topo import posix_to_iso

    rng = np.random.default_rng(2026)
    cases = list(FIXED)
    years = table.default_table().manifest["years"]
    for k in range(N_RANDOM):
        y = int(rng.choice(years))
        p = rng.uniform(year_start_posix(y), year_start_posix(y + 1))
        lat = float(np.degrees(np.arcsin(rng.uniform(-1, 1))))
        lon = float(rng.uniform(-180, 180))
        cases.append(
            (
                f"random_{k}",
                round(lat, 4),
                round(lon, 4),
                round(float(rng.uniform(-3000, 3000)), 1),
                2.0,
                posix_to_iso(round(p)),
            )
        )
    out = {
        "_generated_by": GEN,
        "description": (
            "Expected topocentric sky states from the table-based Python reference "
            "(moonat.ephem.table) using web/data/ephem/. Conventions: docs/CONTRACTS.md §0; "
            "az clockwise from north; ENU up = radial; r_icrs_to_enu row-major; planets have no "
            "topocentric parallax; ang_radius = asin(R/d) with Sun 696000 km, Earth 6378.137 km; "
            "phase_frac = (1+cos a)/2, a = Sun-Earth-observer angle; era_deg from UTC (UT1=UTC)."
        ),
        "tolerances": {"az_el_deg": 0.001, "phase_frac": 0.001, "dist_rel": 1e-6, "matrix": 1e-6},
        "cases": [
            {
                "name": name,
                "inputs": {
                    "lat_deg": lat,
                    "lon_deg": lon,
                    "ground_elev_m": ge,
                    "observer_height_m": oh,
                    "t_utc": t,
                },
                "expected": expected(lat, lon, ge, oh, t),
            }
            for name, lat, lon, ge, oh, t in cases
        ],
    }
    path = ROOT / "tests" / "fixtures" / "ephem_cases.json"
    path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"{len(cases)} cases -> {path}")


if __name__ == "__main__":
    main()
