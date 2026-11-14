# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""C1 ephem-table: format, fixture regression, and accuracy against direct skyfield."""

import json
from pathlib import Path

import numpy as np
import pytest

from moonat.ephem import table, topo
from moonat.ephem.kernels import kernels_available
from moonat.ephem.table import PLANETS, n_records, year_start_posix

ROOT = Path(__file__).resolve().parents[1]
EPHEM_DIR = ROOT / "web" / "data" / "ephem"
CASES = ROOT / "tests" / "fixtures" / "ephem_cases.json"
needs_kernels = pytest.mark.skipif(not kernels_available(), reason="NAIF kernels not downloaded")


def test_manifest_and_files_match_contract():
    m = json.loads((EPHEM_DIR / "manifest.json").read_text(encoding="utf-8"))
    assert m["frame"] == "MOON_ME_DE421" and m["ephemeris"] == "DE421" and m["time_scale"] == "UTC"
    assert m["record_layout"] == table.RECORD_LAYOUT and m["record_bytes"] == 140
    assert m["planets"] == list(PLANETS) and m["_generated_by"].startswith("AI-generated")
    assert set(range(1966, 1977)) | set(range(2013, 2041)) <= set(m["years"])
    assert m["max_interp_error_arcsec"] <= 1.0
    total = 0
    for y in m["years"]:
        size = (EPHEM_DIR / f"{y}.bin").stat().st_size
        assert size == n_records(y, m["step_hours"]) * 140
        total += size
    assert total <= 25e6


def test_records_are_on_the_grid_and_continuous():
    # The extra last record of year Y is the first record of year Y+1.
    a = np.fromfile(EPHEM_DIR / "2025.bin", dtype=table.RECORD_DTYPE)[-1]
    b = np.fromfile(EPHEM_DIR / "2026.bin", dtype=table.RECORD_DTYPE)[0]
    assert np.allclose(a["sun_me"], b["sun_me"], rtol=0, atol=1e-6)
    assert abs(abs(np.dot(a["q_icrs_to_me"], b["q_icrs_to_me"])) - 1) < 1e-14


def test_fixture_cases_regression():
    """The JS fixtures are reproduced exactly by the current table reader."""
    for c in json.loads(CASES.read_text(encoding="utf-8"))["cases"]:
        i, e = c["inputs"], c["expected"]
        s = table.sky_state(
            i["lat_deg"], i["lon_deg"], i["t_utc"], i["ground_elev_m"], i["observer_height_m"]
        )
        for b in ("sun", "earth"):
            for k in ("az_deg", "el_deg", "dist_km", "ang_radius_deg"):
                assert s[b][k][0] == pytest.approx(e[b][k], rel=1e-12, abs=1e-9), (c["name"], b, k)
        assert s["earth"]["phase_frac"][0] == pytest.approx(e["earth"]["phase_frac"], abs=1e-12)
        assert np.allclose(s["r_icrs_to_enu"][0].ravel(), e["r_icrs_to_enu"], atol=1e-12)
        assert s["era_deg"][0] == pytest.approx(e["era_deg"], abs=1e-9)


@needs_kernels
def test_table_matches_direct_skyfield_200_random():
    """Table-based topocentric az/el within 0.001 deg of direct skyfield (200 times x sites)."""
    from moonat.ephem import direct

    rng = np.random.default_rng(42)
    years = json.loads((EPHEM_DIR / "manifest.json").read_text(encoding="utf-8"))["years"]
    worst = {"sun": 0.0, "earth": 0.0, "planets": 0.0, "phase": 0.0, "dist_rel": 0.0, "R": 0.0}
    for _ in range(200):
        y = int(rng.choice(years))
        t = rng.uniform(year_start_posix(y), year_start_posix(y + 1))
        lat, lon = np.degrees(np.arcsin(rng.uniform(-1, 1))), rng.uniform(-180, 180)
        ge, oh = rng.uniform(-5000, 5000), rng.uniform(0, 100)
        a = table.sky_state(lat, lon, t, ge, oh)
        b = direct.sky_state(lat, lon, t, ge, oh)
        for body in ("sun", "earth"):
            d_az = ((a[body]["az_deg"] - b[body]["az_deg"] + 180) % 360) - 180
            d_az *= np.cos(np.radians(b[body]["el_deg"]))  # az error as a sky angle
            d_el = a[body]["el_deg"] - b[body]["el_deg"]
            worst[body] = max(worst[body], abs(d_az[0]), abs(d_el[0]))
            rel = abs(a[body]["dist_km"][0] / b[body]["dist_km"][0] - 1)
            worst["dist_rel"] = max(worst["dist_rel"], rel)
        worst["phase"] = max(
            worst["phase"], abs(a["earth"]["phase_frac"] - b["earth"]["phase_frac"])[0]
        )
        worst["R"] = max(worst["R"], np.abs(a["r_icrs_to_enu"] - b["r_icrs_to_enu"]).max())
        for p in PLANETS:
            worst["planets"] = max(
                worst["planets"], topo.angle_between_deg(a[p]["enu"], b[p]["enu"])[0]
            )
    print("table vs direct, worst:", worst)
    assert worst["sun"] < 0.001 and worst["earth"] < 0.001
    assert worst["phase"] < 0.001 and worst["dist_rel"] < 1e-6 and worst["R"] < 1e-5
    assert worst["planets"] < 0.003  # planets carry no topocentric parallax (Venus <= ~9")


@needs_kernels
def test_interpolation_error_below_one_arcsec():
    """C1: Moon-centre vectors and rotation within 1 arcsec, incl. year edges."""
    from moonat.ephem import direct

    tb = table.default_table()
    rng = np.random.default_rng(7)
    p = np.concatenate(
        [
            rng.uniform(year_start_posix(1966), year_start_posix(1977), 300),
            rng.uniform(year_start_posix(2013), year_start_posix(2041), 300),
            year_start_posix(np.array([1967, 1977, 2017, 2041])) - 600.0,  # last intervals
            year_start_posix(np.array([1966, 1976, 2013, 2040])) + 600.0,  # first intervals
        ]
    )
    got, ref = tb.moon_centre(p), direct.moon_centre_apparent(p)
    r = ref["r_icrs_to_me"]
    for b in ("sun", "earth"):
        v = np.einsum("nij,nj->ni", r, ref[b])
        assert topo.angle_between_deg(got[f"{b}_me"], v).max() * 3600 < 1.0
    rt = topo.quat_to_matrix(got["q_icrs_to_me"])
    cos = (np.trace(np.einsum("nji,njk->nik", rt, r), axis1=1, axis2=2) - 1) / 2
    assert np.degrees(np.arccos(np.clip(cos, -1, 1))).max() * 3600 < 1.0
