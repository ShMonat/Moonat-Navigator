# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Independent check: browser physics (web/js/physics, run in Node) vs JPL Horizons.

No Python ephemeris code is involved: scripts/validate_horizons_js.py runs the JS skyState() and
series() and compares them with Horizons responses cached in tests/fixtures/horizons_cache/. It runs
offline from the cache. It is skipped when Node.js is missing, or when a response is not cached and
Horizons cannot be reached. Report: docs/validation/independent_check.md.
"""

import importlib.util
import math
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "validate_horizons_js.py"
_spec = importlib.util.spec_from_file_location("validate_horizons_js", SCRIPT)
xc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(xc)


@pytest.fixture(scope="module")
def data():
    if not xc.find_node():
        pytest.skip("Node.js not found (set MOONAT_NODE)")
    try:
        return xc.collect(online=True)
    except xc.HorizonsUnavailable as e:
        pytest.skip(f"Horizons response not cached and Horizons unreachable: {e}")


@pytest.fixture(scope="module")
def rows(data):
    return xc.compare_cases(data)


def test_cases_cover_the_requested_ranges():
    cases = xc.make_cases()
    assert len(cases) == 20
    assert cases == xc.make_cases()  # fixed seed
    lats = [c["lat_deg"] for c in cases]
    lons = [c["lon_deg"] for c in cases]
    assert sum(lat > 85 for lat in lats) >= 2 and sum(lat < -85 for lat in lats) >= 2
    assert any(abs(lon) < 70 and abs(lat) < 60 for lat, lon in zip(lats, lons, strict=True))
    assert any(abs(lon) > 110 and abs(lat) < 60 for lat, lon in zip(lats, lons, strict=True))
    years = [int(c["t_utc"][:4]) for c in cases]
    assert all(1966 <= y <= 1976 or 2013 <= y <= 2040 for y in years)
    assert sum(y <= 1976 for y in years) >= 5 and sum(y >= 2013 for y in years) >= 5
    kinds = {c["time_kind"] for c in cases}
    assert {"year boundary", "3-h node", "mid-interval", "random"} <= kinds


def test_horizons_site_is_like_for_like(data):
    """Every response: MEAN_ME, 1737.4 km sphere, airless; the echoed site is the one we meant."""
    errs = xc.site_echo_errors(data)
    assert len(errs) == 2 * (20 + len(xc.ECLIPSES))
    for e in errs:
        assert e["mean_me"] and e["sphere_1737_4"] and e["airless"], e
        assert abs(e["d_lat_deg"]) < 1e-6 and abs(e["d_lon_deg"]) < 1e-6, e
        assert abs(e["d_alt_km"]) < 1e-5, e


def test_directions_match_horizons(rows):
    """Sun and Earth apparent az/el: sub-arcsecond everywhere (target 36 arcsec)."""
    for r in rows:
        assert r["d_sky_as"] < 0.7, r
        assert abs(r["d_el_as"]) < 0.7 and abs(r["d_az_cos_as"]) < 0.7, r
    noted = {c["id"] for c in xc.make_cases() if c["note"]}  # leap-second intervals
    assert xc.stats(rows, "d_sky_as", "sun", skip=noted)["max"] < 0.2
    assert xc.stats(rows, "d_sky_as", "earth", skip=noted)["max"] < 0.25


def test_differences_are_explained(rows):
    """With the computed terms removed (report §6), only the ~0.05 arcsec ephemeris floor is left.

    Sun: table interpolation on a circle, leap seconds included. Earth: the centre-to-site term
    of the C1 design (apparent vector from the Moon's centre, length = light-time distance).
    """
    for r in rows:
        assert r["d_sky_corr_as"] < 0.08, r
        assert abs(r["d_dist_corr_km"]) < (0.3 if r["body"] == "sun" else 0.02), r
    leap = next(r for r in rows if r["body"] == "sun" and r["slip_s"] > 0.9)
    assert leap["d_sky_as"] > 0.4  # 2016-12-31 23:59:30, ~1 s of the Sun's motion
    assert abs(abs(leap["pred_interp_along_as"]) - leap["d_sky_as"]) < 0.05, leap
    earth = [r for r in rows if r["body"] == "earth"]
    assert max(r["d_sky_corr_as"] for r in earth) < 0.6 * max(r["d_sky_as"] for r in earth)


def test_range_size_phase_light_time(rows):
    for r in rows:
        if r["body"] == "sun":
            assert abs(r["d_dist_km"]) < 3.0, r  # table interpolation, <= 2.1 km (manifest)
            # Both sides use R_sun = 695700 km (IAU 2015): only Horizons' 0.001" rounding is left.
            assert abs(r["d_rho_as"]) < 0.005, r
            assert abs(r["d_rho_like_as"]) < 1e-4, r  # our range at Horizons' range: <= 2 km
            assert abs(r["d_lt_ms"]) < 0.02, r
        else:
            assert abs(r["d_dist_km"]) < 0.3, r
            assert abs(r["d_rho_as"]) < 0.005, r
            assert abs(r["d_phase"]) < 1e-4, r
            assert abs(r["d_lt_ms"]) < 0.002, r
        assert r["series_vs_sky_deg"] < 1e-12, r  # series() and skyState() agree


def test_eclipse_separation_matches_horizons(data):
    ecl = xc.compare_eclipses(data)
    assert len(ecl) == 14
    for r in ecl:
        assert abs(r["d_sep_as"]) < 0.3, r
        if not math.isnan(r["margin_js_as"]):
            # The site contacts from eclipse.md: the contact condition holds within 1 s of motion.
            assert abs(r["margin_js_as"]) < 1.0 and abs(r["margin_h_as"]) < 1.0, r
        if "totality" in r["label"] or "greatest" in r["label"]:
            assert r["ecl_frac_js"] == pytest.approx(1.0, abs=1e-9), r


def test_light_time_and_aberration(data):
    """JS = light time + aberration: matches Horizons LT+S, not the geometric or LT-only vectors."""
    vec = xc.compare_vectors(data)
    assert len(vec) == 2 * len(data["vec_ids"])
    for r in vec:
        assert r["js_vs_lts_as"] < 0.2, r
        # JS differs from light-time-only by exactly Horizons' stellar aberration (Sun ~20 arcsec).
        assert abs(r["js_vs_lt_as"] - r["h_lts_vs_lt_as"]) < 0.2, r
        if r["body"] == "sun":
            assert r["js_vs_lt_as"] > 10.0, r
        assert abs(r["lt_js_s"] - r["lt_h_s"]) < 2e-5 * max(1.0, r["lt_h_s"]), r
        # First-order planetary aberration v_perp/c explains Horizons' own geometric-apparent gap.
        assert abs(r["h_lts_vs_geom_as"] - r["theory_vperp_over_c_as"]) < 0.05, r
        if r["body"] == "earth":
            assert 1.2 < r["lt_h_s"] < 1.4, r
            assert r["js_vs_geom_as"] < 1.0, r  # light time and aberration nearly cancel
        else:
            assert r["js_vs_geom_as"] > 10.0, r
