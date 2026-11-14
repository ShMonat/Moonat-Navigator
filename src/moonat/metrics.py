# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Derived metrics for a lunar site: solar flux, Earth phase, time-series summaries and set times.

This is the Python reference for ``web/js/physics/metrics.js`` (contract C6, docs/CONTRACTS.md).
Units: distances in km, angles in degrees at interfaces, times in UTC epoch milliseconds,
fluxes in W/m^2.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

import numpy as np

SOLAR_CONSTANT_WM2 = 1361.0  # total solar irradiance at 1 au (Kopp & Lean 2011; IAU 2015 B3)
AU_KM = 149_597_870.7  # IAU 2012 B2


def flux_normal_wm2(dist_km: np.ndarray | float, flux_frac: np.ndarray | float) -> np.ndarray:
    """Solar irradiance on a surface facing the Sun (W/m^2).

    ``1361 * (1 au / r)^2 * flux_frac``, with r the observer-Sun distance (km) and flux_frac the
    limb-darkened visible fraction of the disk (0..1). Assumes a constant total solar irradiance and
    no atmosphere.
    """
    r = np.asarray(dist_km, dtype=float)
    return SOLAR_CONSTANT_WM2 * (AU_KM / r) ** 2 * np.asarray(flux_frac, dtype=float)


def flux_horiz_wm2(
    dist_km: np.ndarray | float, flux_frac: np.ndarray | float, el_deg: np.ndarray | float
) -> np.ndarray:
    """Solar irradiance on the local horizontal plane (W/m^2).

    ``flux_normal * max(0, sin el)``, with el the elevation (deg) of the Sun's centre above the
    local horizontal plane (normal to the Moon-centre-to-site vector, not the terrain slope).
    """
    s = np.maximum(0.0, np.sin(np.radians(np.asarray(el_deg, dtype=float))))
    return flux_normal_wm2(dist_km, flux_frac) * s


def earth_phase_frac(
    earth_pos: Sequence[float], sun_pos: Sequence[float], observer_pos: Sequence[float]
) -> float:
    """Illuminated fraction of the Earth's disk seen by the observer: (1 + cos alpha) / 2.

    alpha is the Sun-Earth-observer angle. The three positions are in any one common Cartesian
    frame and unit (e.g. MOON_ME, km). 1 = full Earth, 0 = new Earth.
    """
    e = np.asarray(earth_pos, dtype=float)
    to_sun = np.asarray(sun_pos, dtype=float) - e
    to_obs = np.asarray(observer_pos, dtype=float) - e
    cos_a = to_sun @ to_obs / (np.linalg.norm(to_sun) * np.linalg.norm(to_obs))
    return float(0.5 * (1.0 + np.clip(cos_a, -1.0, 1.0)))


def next_set_time(
    t_ms: Sequence[float],
    vis: Sequence[float],
    evaluate: Callable[[float], float] | None = None,
    tol_ms: float = 1000.0,
) -> float | None:
    """Time (UTC epoch ms) when the visible fraction first drops from > 0 to 0, or None.

    The first sample pair (i, i+1) with ``vis[i] > 0`` and ``vis[i+1] == 0`` brackets the event.
    With ``evaluate`` (a function t_ms -> visible fraction), the bracket is refined by bisection to
    ``tol_ms``, and the returned time is the earliest time found with vis == 0. Without it, the
    time of sample i+1 is returned (an upper bound).
    """
    t = np.asarray(t_ms, dtype=float)
    v = np.asarray(vis, dtype=float)
    idx = np.nonzero((v[:-1] > 0.0) & (v[1:] <= 0.0))[0]
    if idx.size == 0:
        return None
    a, b = float(t[idx[0]]), float(t[idx[0] + 1])
    if evaluate is None:
        return b
    while b - a > tol_ms:
        m = 0.5 * (a + b)
        if evaluate(m) > 0.0:
            a = m
        else:
            b = m
    return b


def series_summary(
    t_ms: Sequence[float],
    sun_vis: Sequence[float],
    earth_vis: Sequence[float],
    flux_horiz: Sequence[float],
    evaluate_sun: Callable[[float], float] | None = None,
    evaluate_earth: Callable[[float], float] | None = None,
) -> dict:
    """Summary of a sampled time series (contract C6 ``series().summary``).

    Returns ``sun_vis_pct`` and ``earth_vis_pct`` (percent of samples with vis > 0),
    ``next_sunset_ms`` and ``next_earthset_ms`` (see ``next_set_time``; None if no set occurs in
    the series) and ``mean_flux_horiz_wm2`` (sample mean, W/m^2). Samples are assumed evenly spaced.
    """
    sv = np.asarray(sun_vis, dtype=float)
    ev = np.asarray(earth_vis, dtype=float)
    fh = np.asarray(flux_horiz, dtype=float)
    return {
        "sun_vis_pct": float(100.0 * np.mean(sv > 0.0)) if sv.size else 0.0,
        "earth_vis_pct": float(100.0 * np.mean(ev > 0.0)) if ev.size else 0.0,
        "next_sunset_ms": next_set_time(t_ms, sv, evaluate_sun),
        "next_earthset_ms": next_set_time(t_ms, ev, evaluate_earth),
        "mean_flux_horiz_wm2": float(fh.mean()) if fh.size else 0.0,
    }
