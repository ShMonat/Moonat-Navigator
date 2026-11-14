# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Builds tests/fixtures/custom_horizon_cases.json: horizons from the C5 DEM tiles computed by the
Python reference (moonat.terrain.horizon on moonat.terrain.tiles.tiles_dem), which the browser
port web/js/physics/terrain.js must reproduce. The test checks the committed file is current.

Regenerate:  uv run python tests/test_custom_horizon_fixtures.py
"""

import json
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "custom_horizon_cases.json"
DEM_DIR = ROOT / "web" / "data" / "dem"
GENERATED_BY = (
    "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."
)
AZ_STEP = 0.5
# (name, C3 site id or None, lat, lon). Catalog sites use the coordinates of their C3 file.
SITES = [
    ("apollo11", "apollo11"),  # equatorial mare
    ("apollo16", "apollo16"),  # Descartes highlands
    ("apollo17", "apollo17"),  # Taurus-Littrow valley
    ("change4", "change4"),  # far side, Von Karman crater
    ("art_haworth", "art_haworth"),  # 87.5 S
    ("shackleton_rim", "shackleton_rim"),  # 89.45 S
    ("south_pole", "south_pole"),  # exactly -90
    ("north80", None, 80.0, 30.0),  # high north: global8 only, polar step
]


def _site_coords(entry):
    if entry[1] is None:
        return entry[2], entry[3]
    h = json.loads((ROOT / "web" / "data" / "horizons" / f"{entry[1]}.json").read_text("utf-8"))
    return float(h["lat_deg"]), float(h["lon_deg"])


def build_cases() -> dict:
    from moonat.terrain.horizon import horizon_profile
    from moonat.terrain.tiles import tiles_dem

    cases = []
    for entry in SITES:
        lat, lon = _site_coords(entry)
        prof = horizon_profile(
            lat, lon, observer_height_m=2.0, az_step_deg=AZ_STEP, dem=tiles_dem(lat, lon, DEM_DIR)
        )
        cases.append(
            {
                "name": entry[0],
                "c3_id": entry[1],
                "lat_deg": lat,
                "lon_deg": lon,
                "ground_elev_m": prof["ground_elev_m"],
                "max_range_km": prof["max_range_km"],
                "el_deg": prof["el_deg"],
                "dist_km": prof["dist_km"],
            }
        )
    return {
        "_generated_by": GENERATED_BY,
        "description": "Terrain horizons from the C5 DEM tiles (web/data/dem) by the Python "
        "reference moonat.terrain.horizon.horizon_profile(dem=moonat.terrain.tiles.tiles_dem(...))"
        "; observer 2 m, az step 0.5 deg (true azimuth from north).",
        "observer_height_m": 2.0,
        "az_step_deg": AZ_STEP,
        "cases": cases,
    }


@pytest.mark.skipif(not (DEM_DIR / "manifest.json").exists(), reason="DEM tiles not present")
def test_committed_fixture_matches_python_reference():
    committed = json.loads(FIXTURE.read_text("utf-8"))
    fresh = build_cases()
    assert [c["name"] for c in committed["cases"]] == [c["name"] for c in fresh["cases"]]
    for c, f in zip(committed["cases"], fresh["cases"], strict=True):
        assert abs(c["ground_elev_m"] - f["ground_elev_m"]) < 0.01
        assert np.max(np.abs(np.subtract(c["el_deg"], f["el_deg"]))) < 1e-3


if __name__ == "__main__":
    FIXTURE.write_text(json.dumps(build_cases(), separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {FIXTURE}")
