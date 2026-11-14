# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Tests for the StarHab site study (scripts/starhab/starhab_core.py).

Closed-form cases: the horizon of a smooth spherical Moon, the Earth's parallax at the pole,
straight-edge disk fractions, run lengths, plane slopes and the polar-stereographic map. The
exact-series test compares the vectorised C6 evaluation with the reference ``moonat.eclipse`` /
``moonat.visibility`` code on the committed C1 ephemeris tables (no kernels, no network).
"""

import math
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "starhab"))

import starhab_core as C  # noqa: E402

from moonat import eclipse  # noqa: E402
from moonat.terrain.pds import R_MOON_M, RasterSpec, grid_rowcol, unit_from_latlon  # noqa: E402
from moonat.visibility import disk_fractions, make_profile, segment_fraction_above  # noqa: E402


def _flat_pyramid(n=3812, scale=240.0, height=0.0):
    spec = RasterSpec(
        name="SYNTH_PS",
        url="",
        lines=n,
        samples=n,
        record_bytes=2 * n,
        dtype="<i2",
        to_metres=0.5,
        projection="ps",
        pole=-1,
        scale_m=scale,
        row0=(n - 1) / 2,
        col0=(n - 1) / 2,
    )
    return C.PolarPyramid(np.full((n, n), height, dtype=np.float32), spec)


@pytest.mark.parametrize("eye_m", [2.0, 10.0])
def test_smooth_moon_horizon_is_the_analytic_dip(eye_m):
    """On a bare sphere the skyline is the tangent cone: el = -acos(R / (R + h)) everywhere."""
    pyr = _flat_pyramid()
    h0, el = pyr.horizon(-89.5, 40.0, eye_m, az_step=5.0)
    assert h0 == 0.0
    expected = -math.degrees(math.acos(R_MOON_M / (R_MOON_M + eye_m)))  # -0.0870 / -0.1946 deg
    assert np.max(np.abs(el - expected)) < 2e-4


def test_horizon_of_a_ring_wall_against_brute_force():
    """Pole inside a Gaussian ring wall (1 km high, radius 20 km, sigma 3 km): the skyline equals
    a dense (1 m) march along the exact great circle with the analytic height."""
    pyr = _flat_pyramid()
    x = (np.arange(3812) - 1905.5) * 240.0
    r_map = np.hypot(x[None, :], x[:, None])
    big_h, d0, sig = 1000.0, 20_000.0, 3000.0
    data = (big_h * np.exp(-(((r_map - d0) / sig) ** 2))).astype(np.float32)
    pyr = C.PolarPyramid(data, pyr.spec)
    _, el = pyr.horizon(-90.0, 0.0, 2.0, az_step=15.0)
    s = np.arange(1.0, 60_000.0, 1.0)
    th = s / R_MOON_M
    rho = R_MOON_M + big_h * np.exp(-(((2 * R_MOON_M * np.tan(th / 2) - d0) / sig) ** 2))
    r_e = R_MOON_M + 2.0
    expected = np.degrees(np.max(np.arctan2(rho * np.cos(th) - r_e, rho * np.sin(th))))
    assert 2.0 < expected < 2.9  # about atan(1 km / 20 km) = 2.86 deg, minus the curvature drop
    assert np.max(np.abs(el - expected)) < 0.01


def test_earth_parallax_at_the_south_pole():
    """Earth on the lunar equator plane, seen from the south pole: it sits atan(r/d) LOW."""
    d = 384_400.0
    r_m = R_MOON_M + 2.0
    v = np.array([[d, 0.0, 0.0]])
    t = C.topocentric(v, -90.0, 0.0, r_m, C.EARTH_RADIUS_KM)
    assert t["el"][0] == pytest.approx(-math.degrees(math.atan2(r_m / 1000.0, d)), abs=1e-9)
    assert t["el"][0] == pytest.approx(-0.2590, abs=5e-4)
    assert t["az"][0] == pytest.approx(0.0, abs=1e-9)  # at the pole "north" is the 0 meridian
    assert t["rho"][0] == pytest.approx(
        math.degrees(math.asin(6378.137 / math.hypot(d, r_m / 1000))), rel=1e-12
    )


def test_straight_edge_fractions():
    x = np.linspace(-1.2, 1.2, 49)
    uni = C.uniform_fraction_above(x)
    ref = np.array([segment_fraction_above(v) for v in x])
    assert np.max(np.abs(uni - ref)) < 1e-12
    ld = C.ld_fraction_above(x)
    assert C.ld_fraction_above(0.0) == pytest.approx(0.5, abs=1e-6)
    assert np.max(np.abs(ld + ld[::-1] - 1.0)) < 1e-6  # symmetric
    mid = (x > 0.05) & (x < 0.95)
    assert np.all(ld[mid] > uni[mid])  # limb darkening concentrates the light toward the centre
    assert np.max(np.abs(C.ld_fraction_above(x, u=0.0) - uni)) < 2e-3


@pytest.mark.parametrize("offset", [-0.6, -0.2, 0.0, 0.3, 0.7])
def test_straight_edge_matches_the_c6_disk_sampler(offset):
    """Against moonat.visibility (400-point disk) for a level skyline just below the Sun."""
    rho = 0.2666
    h = make_profile([0.5] * 1440, 0.25)
    vis, flux, _ = disk_fractions(120.0, 0.5 + offset * rho, rho, h, limb_darkening_u=0.6)
    assert C.uniform_fraction_above(offset) == pytest.approx(vis, abs=0.01)
    assert C.ld_fraction_above(offset) == pytest.approx(flux, abs=0.01)


def test_longest_run_and_metrics():
    m = np.array([0, 1, 1, 0, 1, 1, 1, 0, 1], dtype=bool)
    assert C.longest_run(m) == 3
    assert C.longest_run(np.zeros(5, dtype=bool)) == 0
    assert C.longest_run(np.ones(4, dtype=bool)) == 4
    sun = np.array([1.0, 0.5, 0.0, 0.0, 1.0, 1.0])
    earth = np.array([0.0, 1.0, 1.0, 0.0, 0.0, 1.0])
    s = C.series_metrics(sun, sun, earth, step_h=12.0)
    assert s["sun_pct"] == pytest.approx(100 * 3.5 / 6)
    assert s["dark_max_d"] == pytest.approx(1.0)  # two 12 h samples
    assert s["blackout_max_d"] == pytest.approx(1.0)
    assert s["both_pct"] == pytest.approx(100 * 2 / 6)
    assert s["both_min_pct"] == pytest.approx(100 * 1.5 / 6)


def test_plane_slope():
    cell = 20.0
    yy, xx = np.mgrid[0:5, 0:5] * cell
    z = xx * math.tan(math.radians(10.0)) + 3.0
    tilt, mean_slope, rms = C.plane_slope_deg(z, cell)
    assert tilt == pytest.approx(10.0, abs=1e-9)
    assert mean_slope == pytest.approx(10.0, abs=1e-9)
    assert rms == pytest.approx(0.0, abs=1e-9)


def test_polar_stereographic_map():
    lat = np.array([-89.4395, -85.9961, -84.2])
    lon = np.array([-137.1934, 2.0095, 29.0])
    x, y = C.ps_xy_km(lat, lon)
    la, lo = C.ps_latlon(x, y)
    assert np.max(np.abs(la - lat)) < 1e-9 and np.max(np.abs(lo - lon)) < 1e-9
    # the same map as the LOLA rasters: x = (col - col0) * scale, y = (row0 - row) * scale
    spec = _flat_pyramid().spec
    row, col = grid_rowcol(spec, unit_from_latlon(lat, lon))
    assert np.allclose((col - spec.col0) * 0.24, x, atol=1e-6)
    assert np.allclose((spec.row0 - row) * 0.24, y, atol=1e-6)
    # Malapert lies toward the Earth (lon 0, map up); the south pole is the origin
    assert y[1] > 115 and abs(x[1]) < 5
    assert C.great_circle_m(-90.0, 0.0, -89.0, 0.0) == pytest.approx(R_MOON_M * math.pi / 180)


def _table():
    from moonat.ephem import table

    if not (table.DEFAULT_DIR / "manifest.json").exists():
        pytest.skip("C1 ephemeris tables not built")
    return table.default_table()


def _eph_from_table(tab, t):
    mc = tab.moon_centre(t)
    return {"t": t, "sun": mc["sun_me"], "earth": mc["earth_me"]}


def test_exact_series_matches_the_reference_polar():
    """Polar site, synthetic skyline, 2 h steps: equal to moonat.eclipse.site_sun_state."""
    tab = _table()
    t = C.time_grid(
        2.0, C.datetime(2027, 1, 1, tzinfo=C.UTC), C.datetime(2027, 2, 15, tzinfo=C.UTC)
    )
    az = np.arange(1440) * 0.25
    el_h = 0.6 * np.sin(np.radians(3 * az)) - 0.4 + 0.3 * np.cos(np.radians(7 * az))
    hz = {
        "lat_deg": -89.44,
        "lon_deg": -137.19,
        "ground_elev_m": 1950.0,
        "observer_height_m": 2.0,
        "az_step_deg": 0.25,
        "el_deg": el_h,
    }
    got = C.exact_series(hz, _eph_from_table(tab, t))
    ref = eclipse.site_sun_state(-89.44, -137.19, t, hz, 1950.0, 2.0, table=tab)
    assert np.max(np.abs(got["sun_flux"] - ref["flux_frac"])) < 1e-12
    assert np.max(np.abs(got["sun_disk"] - ref["vis_frac"])) < 1e-12
    assert 0.05 < np.mean(got["sun_disk"] > 0) < 0.995  # the case exercises rises and sets
    from moonat.ephem import table as tb

    st = tb.sky_state(-89.44, -137.19, t, 1950.0, 2.0, tab)["earth"]
    ev = [
        disk_fractions(a, e, r, hz)[0]
        for a, e, r in zip(st["az_deg"], st["el_deg"], st["ang_radius_deg"], strict=True)
    ]
    assert np.max(np.abs(got["earth_vis"] - np.array(ev))) < 1e-12


def test_exact_series_handles_an_eclipse():
    """Blue Ghost, 14 March 2025 total eclipse (docs/validation/eclipse.md): flux goes to 0."""
    tab = _table()
    t0 = C.datetime(2025, 3, 14, 4, 0, tzinfo=C.UTC)
    t = C.time_grid(1 / 6, t0, C.datetime(2025, 3, 14, 11, 0, tzinfo=C.UTC))
    hz = {
        "lat_deg": 18.5623,
        "lon_deg": 61.8103,
        "ground_elev_m": -3651.0,
        "observer_height_m": 2.0,
        "az_step_deg": 0.25,
        "el_deg": np.zeros(1440),
    }
    got = C.exact_series(hz, _eph_from_table(tab, t))
    ref = eclipse.site_sun_state(18.5623, 61.8103, t, hz, -3651.0, 2.0, table=tab)
    assert np.max(np.abs(got["sun_flux"] - ref["flux_frac"])) < 1e-12
    assert got["sun_flux"].min() == 0.0 and got["eclipse"].max() == 1.0
