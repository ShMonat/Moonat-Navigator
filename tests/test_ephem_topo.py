# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Geometry tests for moonat.ephem.topo against hand-derived values (no kernels needed)."""

import numpy as np
import pytest

from moonat.ephem import topo


def test_enu_is_right_handed_orthonormal():
    for lat, lon in [(0, 0), (23.5, 23.47), (-45.44, 177.59), (-89.5, 0), (89.99999, 12), (-90, 0)]:
        m = topo.enu_matrix(lat, lon)
        assert np.allclose(m @ m.T, np.eye(3), atol=1e-14)
        assert np.isclose(np.linalg.det(m), 1.0)


def test_enu_axes_at_equator_lon0():
    # At (0, 0): up = +X, east = +Y, north = +Z (ME).
    m = topo.enu_matrix(0.0, 0.0)
    assert np.allclose(m, [[0, 1, 0], [0, 0, 1], [1, 0, 0]], atol=1e-15)


def test_pole_rule_north_toward_prime_meridian():
    # Exactly at a pole, north = ME +X (toward the 0 deg meridian); up = +-Z.
    for lat in (-90.0, 90.0):
        e, n, u = topo.enu_matrix(lat, 37.0)
        assert np.allclose(n, [1, 0, 0]) and np.allclose(u, [0, 0, np.sign(lat)])
    # Near (not at) the south pole on the 0 deg meridian the regular rule gives the same north.
    assert np.allclose(topo.enu_matrix(-89.9, 0.0)[1], [1, 0, 0], atol=2e-3)


def test_az_el_conventions():
    az, el = topo.az_el_deg(np.array([[0, 1, 0], [1, 0, 0], [0, -1, 0], [-1, 0, 0], [0, 1, 1]]))
    assert np.allclose(az, [0, 90, 180, 270, 0]) and np.allclose(el, [0, 0, 0, 0, 45])


def test_site_vector_radius_and_direction():
    v = topo.site_vector_me(0.0, 90.0, topo.site_radius_km(1000.0, 2.0))
    assert np.allclose(v, [0, 1737.4 + 1.002, 0], atol=1e-9)


def test_era_reference_values():
    # IERS: ERA(J2000.0 UT1) = 0.7790572732640 rev = 280.46061837504 deg.
    assert topo.era_deg(946728000.0) == pytest.approx(280.46061837504, abs=1e-9)
    # One UT1 day later the Earth has turned 1.00273781191135448 rev.
    assert topo.era_deg(946728000.0 + 86400) == pytest.approx(
        (280.46061837504 + 0.00273781191135448 * 360) % 360, abs=1e-9
    )


def test_era_matches_skyfield():
    from skyfield.earthlib import earth_rotation_angle

    p = np.array([-1e8, 0.0, 1.0e9, 1.79e9, 2.2e9])
    jd = 2440587.5 + p / 86400.0
    sf = np.asarray(earth_rotation_angle(jd)) * 360.0
    assert np.allclose(((topo.era_deg(p) - sf + 180) % 360) - 180, 0, atol=1e-7)


def test_phase_full_new_quarter():
    sun = np.array([1.5e8, 0, 0])
    assert topo.phase_frac(np.array([-4e5, 0, 0]), sun) == pytest.approx(1.0)  # full Earth
    assert topo.phase_frac(np.array([4e5, 0, 0]), sun) == pytest.approx(0.0, abs=1e-6)  # new
    assert topo.phase_frac(np.array([0, 4e5, 0]), sun) == pytest.approx(0.5, abs=2e-3)  # ~quarter


def test_ang_radius():
    assert topo.ang_radius_deg(1.0, 2.0) == pytest.approx(30.0)


def test_quaternion_roundtrip():
    rng = np.random.default_rng(3)
    q = topo.unit(rng.normal(size=(50, 4)))
    r = topo.quat_to_matrix(q)
    q2 = topo.matrix_to_quat(r)
    assert np.allclose(np.abs(np.sum(q * q2, axis=1)), 1.0)
    assert np.allclose(topo.quat_to_matrix(q2), r, atol=1e-12)
    # 90 deg about +z maps +x to +y (active rotation).
    qz = np.array([np.cos(np.pi / 4), 0, 0, np.sin(np.pi / 4)])
    assert np.allclose(topo.quat_to_matrix(qz) @ [1, 0, 0], [0, 1, 0])


def test_time_parsing():
    assert topo.to_posix_seconds("1970-01-01T00:00:00Z") == 0.0
    assert topo.to_posix_seconds("1969-07-20T20:17:40Z") == -14182940.0
    assert topo.posix_to_iso(-14182940.0) == "1969-07-20T20:17:40.000Z"
    assert topo.to_posix_seconds(np.datetime64("2026-11-14T12:00:00")) == 1794657600.0
