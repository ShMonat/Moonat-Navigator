# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Analytic checks of moonat.visibility (disk vs horizon visible fraction)."""

import math

import numpy as np
import pytest

from moonat.visibility import (
    horizon_el_at,
    make_profile,
    segment_fraction_above,
    visible_fraction,
)

SUN_RHO = 0.2666  # deg, Sun at 1 au
EARTH_RHO = 0.95  # deg, Earth from the Moon
TOL = 0.003  # vs the analytic segment area; the contract tolerance is 0.01


@pytest.mark.parametrize("rho", [SUN_RHO, EARTH_RHO])
@pytest.mark.parametrize("az", [0.0, 47.3, 181.0, 359.9])
def test_flat_horizon_centre_on_horizon_is_half(rho, az):
    assert visible_fraction(az, 0.0, rho) == pytest.approx(0.5, abs=TOL)


@pytest.mark.parametrize("rho", [SUN_RHO, EARTH_RHO])
def test_flat_horizon_two_radii_above_and_below(rho):
    assert visible_fraction(90.0, 2 * rho, rho) == 1.0
    assert visible_fraction(90.0, -2 * rho, rho) == 0.0


@pytest.mark.parametrize("rho", [SUN_RHO, EARTH_RHO])
@pytest.mark.parametrize("x", np.linspace(-1.1, 1.1, 23))
def test_flat_horizon_matches_segment_area(rho, x):
    expected = segment_fraction_above(x)
    assert visible_fraction(123.4, x * rho, rho) == pytest.approx(expected, abs=TOL)


@pytest.mark.parametrize("h0", [-3.0, 0.0, 5.0, 12.5])
@pytest.mark.parametrize("x", [-0.7, 0.0, 0.4, 0.9])
def test_constant_horizon_matches_segment_area(h0, x):
    """A constant raised horizon at h0 behaves like a straight edge in el."""
    hz = make_profile([h0] * 1440, 0.25)
    rho = SUN_RHO
    # A constant-elevation curve is a small circle, not a great circle; at these elevations its
    # curvature over the 0.53 deg disk is negligible.
    got = visible_fraction(200.0, h0 + x * rho, rho, hz)
    assert got == pytest.approx(segment_fraction_above(x), abs=TOL)


def test_step_horizon_in_azimuth_hides_half():
    """A vertical wall at az = 180 deg (high to the east of it) hides the eastern half."""
    step = 0.01
    az = np.arange(0.0, 360.0, step)
    el = np.where((az > 180.0 + 0.5 * step) & (az < 270.0), 30.0, 0.0)
    hz = make_profile(el, step)
    got = visible_fraction(180.0, 5.0, SUN_RHO, hz)
    # The wall rises over one 0.01 deg sample interval; that shifts the edge by < 0.01 deg.
    assert got == pytest.approx(0.5, abs=0.02)
    # Away from the wall the disk is fully visible / fully hidden.
    assert visible_fraction(150.0, 5.0, SUN_RHO, hz) == 1.0
    assert visible_fraction(220.0, 5.0, SUN_RHO, hz) == 0.0
    assert visible_fraction(220.0, 30.0, SUN_RHO, hz) == pytest.approx(0.5, abs=TOL)


def test_limb_darkening_half_disk_is_half():
    """By symmetry, a straight edge through the centre passes half the flux for any law."""
    for az in (10.0, 200.0):
        got = visible_fraction(az, 0.0, SUN_RHO, None, limb_darkening_u=0.6)
        assert got == pytest.approx(0.5, abs=TOL)


def test_limb_darkening_thin_crescent_has_less_flux_than_area():
    """The limb is darker than the centre, so a thin top sliver carries less flux than its area."""
    el = -0.8 * SUN_RHO
    area = visible_fraction(0.0, el, SUN_RHO)
    flux = visible_fraction(0.0, el, SUN_RHO, None, limb_darkening_u=0.6)
    assert 0.0 < flux < area
    assert visible_fraction(0.0, 1.0, SUN_RHO, None, limb_darkening_u=0.6) == 1.0


def test_limb_darkening_u0_equals_area():
    for x in (-0.5, 0.3):
        a = visible_fraction(33.0, x * SUN_RHO, SUN_RHO)
        b = visible_fraction(33.0, x * SUN_RHO, SUN_RHO, None, limb_darkening_u=0.0)
        assert a == pytest.approx(b, abs=1e-12)


def test_disk_at_zenith_vs_high_horizon():
    """Disk centred on the zenith, horizon at 89.8 deg everywhere: only the central cap shows."""
    rho = 0.5
    hz = make_profile([89.8] * 1440, 0.25)
    got = visible_fraction(0.0, 90.0, rho, hz)
    expected = (1 - math.cos(math.radians(0.2))) / (1 - math.cos(math.radians(rho)))
    assert got == pytest.approx(expected, abs=0.01)
    # Nearly at the zenith but not exactly, any azimuth: same answer.
    got2 = visible_fraction(77.0, 90.0 - 1e-7, rho, hz)
    assert got2 == pytest.approx(expected, abs=0.01)
    # A low horizon never hides a disk near the zenith.
    assert visible_fraction(0.0, 89.9, rho, make_profile([10.0] * 1440, 0.25)) == 1.0


def test_azimuth_wraparound_is_rotation_invariant():
    """Rotating the body and the horizon together by any multiple of the step changes nothing."""
    rng = np.random.default_rng(1)
    base = np.cumsum(rng.normal(0, 0.3, 1440))
    base = base - np.linspace(0, base[-1] - base[0], 1440)  # make it periodic
    el = 2.0 + base - base.mean()
    hz = make_profile(el, 0.25)
    shift = 720  # 180 deg
    hz_rot = make_profile(np.roll(el, shift), 0.25)
    for az0 in (0.0, 0.1, 359.9, 359.95):
        h = float(horizon_el_at(hz, az0))
        v_wrap = visible_fraction(az0, h + 0.1, EARTH_RHO, hz)
        v_rot = visible_fraction(az0 + 180.0, h + 0.1, EARTH_RHO, hz_rot)
        assert v_wrap == pytest.approx(v_rot, abs=1e-9)
        assert 0.0 < v_wrap < 1.0


def test_horizon_interpolation_is_periodic_and_linear():
    hz = make_profile([0.0, 4.0, 8.0, 4.0], 90.0)
    assert horizon_el_at(hz, 45.0) == pytest.approx(2.0)
    assert horizon_el_at(hz, 315.0) == pytest.approx(2.0)  # between 270 (4) and 360 = 0 (0)
    assert horizon_el_at(hz, -45.0) == pytest.approx(2.0)
    assert horizon_el_at(hz, 720.0 + 180.0) == pytest.approx(8.0)
    assert horizon_el_at(None, 12.0) == 0.0
