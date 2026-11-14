# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Checks of moonat.metrics: flux, Earth phase, set-time search and summaries."""

import numpy as np
import pytest

from moonat.metrics import (
    AU_KM,
    SOLAR_CONSTANT_WM2,
    earth_phase_frac,
    flux_horiz_wm2,
    flux_normal_wm2,
    next_set_time,
    series_summary,
)


def test_flux_at_one_au():
    assert flux_normal_wm2(AU_KM, 1.0) == pytest.approx(SOLAR_CONSTANT_WM2)
    assert flux_horiz_wm2(AU_KM, 1.0, 90.0) == pytest.approx(1361.0)
    assert flux_horiz_wm2(AU_KM, 1.0, 30.0) == pytest.approx(680.5)
    assert flux_horiz_wm2(AU_KM, 0.5, 30.0) == pytest.approx(340.25)
    assert flux_horiz_wm2(AU_KM, 1.0, -5.0) == 0.0


def test_flux_inverse_square():
    assert flux_normal_wm2(0.5 * AU_KM, 1.0) == pytest.approx(4 * 1361.0)
    # Perihelion / aphelion: about +-3.3 % around 1361.
    assert flux_normal_wm2(0.98329 * AU_KM, 1.0) == pytest.approx(1407.6, abs=0.2)
    assert flux_normal_wm2(1.01671 * AU_KM, 1.0) == pytest.approx(1316.6, abs=0.2)


def test_earth_phase_limits():
    earth = [384_400.0, 0.0, 0.0]
    obs = [0.0, 0.0, 0.0]
    assert earth_phase_frac(earth, [-AU_KM, 0, 0], obs) == pytest.approx(1.0)  # Sun behind us: full
    assert earth_phase_frac(earth, [AU_KM, 0, 0], obs) == pytest.approx(0.0)  # Sun behind Earth
    assert earth_phase_frac(earth, [384_400.0, AU_KM, 0], obs) == pytest.approx(0.5)  # quarter


def _ramp(t_set):
    return lambda t: float(np.clip((t_set - t) / 3.6e6, 0.0, 1.0))


def test_next_set_time_bisection():
    t_set = 1_700_000_123_456.0
    t = np.arange(1_700_000_000_000.0, 1_700_000_000_000.0 + 86_400_000, 600_000.0)
    f = _ramp(t_set)
    vis = [f(x) for x in t]
    got = next_set_time(t, vis, f, tol_ms=1000.0)
    assert abs(got - t_set) <= 1000.0
    assert got >= t_set
    # Without an evaluator: the first sample with vis == 0.
    coarse = next_set_time(t, vis)
    assert coarse == t[np.argmax(np.asarray(vis) == 0.0)]


def test_next_set_time_none_and_first_event():
    t = np.arange(10.0)
    assert next_set_time(t, np.zeros(10)) is None
    assert next_set_time(t, np.ones(10)) is None
    vis = [0, 0, 1, 1, 0, 0, 1, 0, 1, 1]  # rises at 2, sets at 4, sets again at 7
    assert next_set_time(t, vis) == 4.0


def test_series_summary():
    t = np.arange(4) * 600_000.0
    s = series_summary(t, [1, 0.5, 0, 0], [1, 1, 1, 0], [100, 50, 0, 0])
    assert s["sun_vis_pct"] == 50.0
    assert s["earth_vis_pct"] == 75.0
    assert s["next_sunset_ms"] == 1_200_000.0
    assert s["next_earthset_ms"] == 1_800_000.0
    assert s["mean_flux_horiz_wm2"] == 37.5
