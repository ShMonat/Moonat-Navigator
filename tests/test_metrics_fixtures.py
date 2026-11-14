# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Builds tests/fixtures/metrics_cases.json (Python reference values for the JS port) and checks
that the committed file still matches the Python reference.

Regenerate:  uv run python tests/test_metrics_fixtures.py
"""

import json
import math
from pathlib import Path

import numpy as np

from moonat.metrics import AU_KM, earth_phase_frac, flux_horiz_wm2, flux_normal_wm2
from moonat.visibility import LIMB_DARKENING_U, horizon_el_at, make_profile, visible_fraction

FIXTURE = Path(__file__).parent / "fixtures" / "metrics_cases.json"
GENERATED_BY = (
    "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."
)
SUN_RHO = 0.2666
EARTH_RHO = 0.95


def _horizons() -> dict:
    az = np.arange(1440) * 0.25
    a = np.radians(az)
    rugged = (
        2.0
        + 1.5 * np.sin(a)
        + 0.8 * np.sin(3 * a + 1.0)
        + 0.4 * np.sin(17 * a + 0.3)
        + 3.0 * np.exp(-(((az - 150.0) / 1.5) ** 2))  # a narrow peak
    )
    rugged[(az >= 300.0) & (az < 303.0)] += 2.5  # a sharp-edged block
    wall = np.where((az > 90.0) & (az < 180.0), 8.0, 0.5)
    high = np.full(1440, 89.8)
    return {
        "flat": None,
        "rugged": make_profile(np.round(rugged, 4), 0.25),
        "wall": make_profile(wall, 0.25),
        "high": make_profile(high, 0.25),
    }


def build_cases() -> dict:
    rng = np.random.default_rng(20261114)
    horizons = _horizons()
    cases = []

    def add(name, az, el, rho):
        hz = horizons[name]
        cases.append(
            {
                "horizon": name,
                "az_deg": float(az),
                "el_deg": float(el),
                "ang_radius_deg": float(rho),
                "vis_frac": visible_fraction(az, el, rho, hz),
                "flux_frac": visible_fraction(az, el, rho, hz, limb_darkening_u=LIMB_DARKENING_U),
            }
        )

    for name in ("flat", "rugged", "wall"):
        for rho in (SUN_RHO, EARTH_RHO):
            for _ in range(12):
                az = float(rng.uniform(0.0, 360.0))
                h = float(horizon_el_at(horizons[name], az))
                add(name, az, h + float(rng.uniform(-1.4, 1.4)) * rho, rho)
    # Azimuth wrap-around at 0/360, the wall's edges, the narrow peak and the block.
    for az in (359.95, 0.02, 0.4, 359.6):
        add("rugged", az, float(horizon_el_at(horizons["rugged"], az)) + 0.1, EARTH_RHO)
    for az in (90.0, 180.0):
        add("wall", az, 4.0, EARTH_RHO)
        add("wall", az, 4.0, SUN_RHO)
    add("rugged", 150.0, 4.6, SUN_RHO)
    add("rugged", 301.5, 5.0, EARTH_RHO)
    # Near and at the zenith.
    add("high", 0.0, 90.0, 0.5)
    add("high", 123.0, 89.7, 0.5)
    add("flat", 10.0, 89.9, EARTH_RHO)
    # Fully above / below.
    add("flat", 45.0, 2 * SUN_RHO, SUN_RHO)
    add("flat", 45.0, -2 * SUN_RHO, SUN_RHO)

    flux = []
    flux_inputs = ((1.0, 1.0, 90.0), (0.9833, 0.7, 12.0), (1.0167, 0.25, 1.5), (1.0, 1.0, -3))
    for dist_au, ff, el in flux_inputs:
        d = dist_au * AU_KM
        flux.append(
            {
                "dist_km": d,
                "flux_frac": ff,
                "el_deg": el,
                "flux_horiz_wm2": float(flux_horiz_wm2(d, ff, el)),
                "flux_normal_wm2": float(flux_normal_wm2(d, ff)),
            }
        )
    phase = []
    for ang in (0.0, 30.0, 90.0, 135.0, 180.0):
        a = math.radians(ang)
        earth = [384_400.0, 1000.0, -2000.0]
        sun = [earth[0] - AU_KM * math.cos(a), earth[1] + AU_KM * math.sin(a), earth[2]]
        obs = [10.0, 1737.4, 3.0]
        phase.append(
            {
                "earth_km": earth,
                "sun_km": sun,
                "observer_km": obs,
                "phase_frac": earth_phase_frac(earth, sun, obs),
            }
        )

    return {
        "_generated_by": GENERATED_BY,
        "description": "Python reference (moonat.visibility, moonat.metrics) values for the JS "
        "port. "
        "Horizons are C3-shaped (az_step_deg, el_deg); null = smooth horizon.",
        "limb_darkening_u": LIMB_DARKENING_U,
        "n_disk_points": 400,
        "horizons": horizons,
        "visibility": cases,
        "flux": flux,
        "phase": phase,
    }


def test_committed_fixture_matches_python_reference():
    committed = json.loads(FIXTURE.read_text())
    fresh = build_cases()
    assert len(committed["visibility"]) == len(fresh["visibility"])
    for c, f in zip(committed["visibility"], fresh["visibility"], strict=True):
        assert c["horizon"] == f["horizon"]
        assert abs(c["vis_frac"] - f["vis_frac"]) < 1e-9
        assert abs(c["flux_frac"] - f["flux_frac"]) < 1e-9
    for c, f in zip(committed["flux"], fresh["flux"], strict=True):
        assert abs(c["flux_horiz_wm2"] - f["flux_horiz_wm2"]) < 1e-9
    for c, f in zip(committed["phase"], fresh["phase"], strict=True):
        assert abs(c["phase_frac"] - f["phase_frac"]) < 1e-12
    # The fixture exercises partial, full and zero visibility.
    v = [c["vis_frac"] for c in fresh["visibility"]]
    assert min(v) == 0.0 and max(v) == 1.0 and sum(0.05 < x < 0.95 for x in v) >= 30


if __name__ == "__main__":
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(build_cases(), indent=1) + "\n")
    print(f"wrote {FIXTURE}")
