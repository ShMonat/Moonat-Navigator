# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Validation against JPL Horizons topocentric lunar sites (cached responses, runs offline).

Sites: Apollo 11 (0.674N 23.473E), south polar (89.5S 0E), Chang'e 4 (45.44S 177.59E).
Epochs: 1969-07-20T20:17Z, 2026-11-14T12:00Z, 2030-06-01T00:00Z, plus a one-month series at 12 h.
Bodies: Sun and Earth (all sites), Mercury..Saturn (Apollo 11, the three epochs).
Target from the brief: < 0.01 deg. Achieved: ~1.5e-5 deg, so the asserts are much tighter.
"""

import numpy as np
import pytest

from moonat.ephem import horizons
from moonat.ephem.kernels import kernels_available

needs_kernels = pytest.mark.skipif(not kernels_available(), reason="NAIF kernels not downloaded")


def test_fixtures_are_like_for_like():
    """Every cached response uses MEAN_ME, a 1737.4 km sphere and airless apparent az/el."""
    files = sorted(horizons.FIXTURES.glob("*.txt"))
    assert len(files) == 17
    for f in files:
        text = f.read_text(encoding="utf-8")
        assert "Center pole/equ : MEAN_ME" in text
        assert "Center radii    : 1737.4, 1737.4, 1737.4 km" in text
        assert "Atmos refraction: NO (AIRLESS)" in text


def _check(rows, planet_tol_deg):
    for r in rows:
        cos_el = np.cos(np.radians(r["h_el_deg"]))
        if r["body"] in ("sun", "earth"):
            assert r["d_sep_deg"] < 1e-4, r
            assert abs(r["d_el_deg"]) < 1e-4 and abs(r["d_az_deg"]) * cos_el < 1e-4, r
            # Same radii as Horizons (Sun 695700 km, IAU 2015): only its 0.001" rounding is left.
            assert abs(r["d_ang_diam_arcsec"]) < 0.005, r
        else:
            assert r["d_sep_deg"] < planet_tol_deg, r


@needs_kernels
def test_direct_matches_horizons():
    rows = horizons.compare("direct")
    _check(rows, planet_tol_deg=1e-4)
    for r in rows:
        if r["body"] in ("sun", "earth"):
            assert abs(r["d_dist_km"]) < 0.05, r
        if r["body"] == "earth":
            assert abs(r["d_phase"]) < 1e-4 and abs(r["d_sto_deg"]) < 1e-3, r
    s = horizons.summarize(rows)["all"]
    print("direct vs Horizons:", s)
    assert s["n"] == 399


def test_table_matches_horizons():
    """The browser tables alone (no kernels) also match Horizons."""
    rows = horizons.compare("table")
    _check(rows, planet_tol_deg=0.003)  # planets: no topocentric parallax in the table
    print("table vs Horizons:", horizons.summarize(rows)["all"])
