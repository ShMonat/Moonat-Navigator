# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Visible fraction of a circular body disk (Sun, Earth) above a terrain horizon profile.

This is the Python reference for the browser code in ``web/js/physics/visibility.js``. Both use
the same deterministic sampling pattern, so they give the same numbers (to floating-point noise).

Frames and conventions (docs/CONTRACTS.md §0):
- The observer's local frame is ENU: x = east, y = north, z = up (up = radial from the Moon's
  centre).
- Azimuth is true azimuth, clockwise from north (0 = N, 90 = E), degrees in 0..360.
- Elevation is the angle above the local horizontal plane, degrees.
- A horizon profile (contract C3) is ``{"az_step_deg": s, "el_deg": [n floats]}``, with sample k at
  azimuth ``k*s``, linear interpolation between samples, periodic in azimuth. ``None`` means the
  smooth horizon: elevation 0 at every azimuth.

Method:
1. The disk is a spherical cap of angular radius rho around the body's unit direction u.
   N points (default 400) sample it uniformly in solid angle with a sunflower (Fibonacci) pattern:
   point i has angular distance alpha_i from u with ``1 - cos(alpha_i) = s_i (1 - cos rho)``,
   ``s_i = (i + 0.5) / N``, and position angle ``theta_i = i * golden_angle``, measured in the
   tangent plane from the direction toward the zenith (e1) toward e2 = e1 x u.
2. Each point is mapped exactly to (az, el) with vector maths. Its visible weight is an
   anti-aliased step: ``clamp(0.5 + (el - h(az)) / delta, 0, 1)``, where
   ``delta = rho * sqrt(pi/N)`` is the mean spacing between points. This makes the fraction a
   continuous function of the body's position, so time series are smooth and set/rise times can
   be refined by bisection.
3. vis_frac is the mean weight. The limb-darkened variant (for solar flux) weights each point by
   the linear law ``I(mu) = 1 - u_ld (1 - mu)``, with ``mu = sqrt(1 - (sin alpha / sin rho)^2)``.
4. Fast paths: if the lowest point of the disk is above the highest horizon sample in the disk's
   azimuth span, the result is exactly 1; if the highest point is below the lowest sample, it is 0.

Accuracy: against the analytic circular-segment area for a straight horizon edge, the error is
below 0.003 for N = 400 (see tests/test_metrics_visibility.py).
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence

import numpy as np

N_DISK_POINTS = 400
GOLDEN_ANGLE = math.pi * (3.0 - math.sqrt(5.0))
LIMB_DARKENING_U = 0.6

Horizon = Mapping[str, object] | None


def disk_pattern(n: int = N_DISK_POINTS) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return the unit sunflower pattern used to sample a disk.

    Returns ``(s, cos_theta, sin_theta)``, arrays of length n. ``s_i = (i + 0.5) / n`` is the
    solid-angle fraction inside the ring of point i, and ``theta_i = i * golden_angle`` (rad) is
    its position angle. Dimensionless; no frame.
    """
    i = np.arange(n, dtype=float)
    s = (i + 0.5) / n
    theta = i * GOLDEN_ANGLE
    return s, np.cos(theta), np.sin(theta)


def azel_to_enu(az_deg: float, el_deg: float) -> np.ndarray:
    """Unit ENU vector (east, north, up) for a true azimuth and an elevation, both in degrees."""
    az = math.radians(az_deg)
    el = math.radians(el_deg)
    return np.array([math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)])


def horizon_el_at(horizon: Horizon, az_deg: np.ndarray | float) -> np.ndarray:
    """Horizon elevation (deg) at true azimuth(s) ``az_deg`` (deg), periodic linear interpolation.

    ``horizon`` is a C3 profile (``az_step_deg``, ``el_deg``) or None (smooth horizon, 0 deg).
    """
    az = np.asarray(az_deg, dtype=float)
    if horizon is None:
        return np.zeros_like(az)
    step = float(horizon["az_step_deg"])
    el = np.asarray(horizon["el_deg"], dtype=float)
    n = el.size
    x = np.mod(az, 360.0) / step
    k0 = np.floor(x).astype(int)
    f = x - k0
    k0 = np.mod(k0, n)
    k1 = np.mod(k0 + 1, n)
    return el[k0] * (1.0 - f) + el[k1] * f


def _horizon_range(horizon: Horizon, az_lo: float, az_hi: float) -> tuple[float, float]:
    """Min and max horizon elevation (deg) over the azimuth interval [az_lo, az_hi] (deg).

    Uses every sample index from floor(az_lo/step) to ceil(az_hi/step), which bounds the
    linearly interpolated curve on the interval.
    """
    if horizon is None:
        return 0.0, 0.0
    step = float(horizon["az_step_deg"])
    el = np.asarray(horizon["el_deg"], dtype=float)
    n = el.size
    k_lo = math.floor(az_lo / step)
    k_hi = math.ceil(az_hi / step)
    if k_hi - k_lo + 1 >= n:
        return float(el.min()), float(el.max())
    idx = np.mod(np.arange(k_lo, k_hi + 1), n)
    sel = el[idx]
    return float(sel.min()), float(sel.max())


def disk_fractions(
    az_deg: float,
    el_deg: float,
    ang_radius_deg: float,
    horizon: Horizon = None,
    limb_darkening_u: float | None = None,
    occulter: tuple[Sequence[float], float] | None = None,
    n: int = N_DISK_POINTS,
) -> tuple[float, float, float]:
    """Visible fractions of a circular body disk above a horizon: ``(vis, flux, flux_lit)``.

    Args:
        az_deg: true azimuth of the disk centre (deg, clockwise from north).
        el_deg: elevation of the disk centre above the local horizontal plane (deg).
        ang_radius_deg: angular radius of the disk (deg), > 0.
        horizon: C3 horizon profile (``az_step_deg``, ``el_deg``) or None for the smooth horizon.
        limb_darkening_u: None for no limb darkening (then flux = flux_lit = vis); a coefficient u
            for the linear law I(mu) = 1 - u (1 - mu) (the Sun uses u = 0.6).
        occulter: optional opaque disk in front of this one, ``(unit ENU centre, angular radius
            deg)`` (the Earth in front of the Sun). Used only with limb darkening.
        n: number of sample points.

    Returns:
        vis: solid-angle fraction above the horizon (0..1).
        flux: the same weighted by limb darkening.
        flux_lit: the share of the flux NOT hidden by ``occulter`` that clears the terrain (each
            sample also weighted by an anti-aliased "outside the occulter" step); = flux without an
            occulter. See ``moonat.eclipse.combined_flux_frac``.

    Assumptions: the disk is a perfect circle (a sphere seen from outside); the horizon profile is
    a single-valued function of azimuth (true for a heightfield DEM); no refraction (no atmosphere).
    """
    rho = math.radians(ang_radius_deg)
    delta_deg = ang_radius_deg * math.sqrt(math.pi / n)
    half_ramp = 0.5 * delta_deg + 1e-9

    # Fast paths on the disk's elevation and azimuth bounds.
    lo = el_deg - ang_radius_deg
    hi = min(el_deg + ang_radius_deg, 90.0)
    cos_el = math.cos(math.radians(el_deg))
    if el_deg + ang_radius_deg >= 90.0 or math.sin(rho) >= cos_el:
        h_min, h_max = _horizon_range(horizon, 0.0, 360.0)
    else:
        daz = math.degrees(math.asin(math.sin(rho) / cos_el))
        h_min, h_max = _horizon_range(horizon, az_deg - daz, az_deg + daz)
    if lo - half_ramp > h_max:
        return 1.0, 1.0, 1.0
    if hi + half_ramp < h_min:
        return 0.0, 0.0, 0.0

    # Tangent-plane basis at the body direction u: e1 toward the zenith, e2 = e1 x u.
    u = azel_to_enu(az_deg, el_deg)
    zen = np.array([0.0, 0.0, 1.0])
    e1 = zen - u[2] * u
    norm = np.linalg.norm(e1)
    if norm < 1e-9:
        e1 = np.array([0.0, 1.0, 0.0]) - u[1] * u
        norm = np.linalg.norm(e1)
    e1 = e1 / norm
    e2 = np.cross(e1, u)

    s, ct, st = disk_pattern(n)
    one_minus_cos = s * (1.0 - math.cos(rho))
    cos_a = 1.0 - one_minus_cos
    sin_a = np.sqrt(one_minus_cos * (2.0 - one_minus_cos))
    pts = (
        cos_a[:, None] * u[None, :]
        + (sin_a * ct)[:, None] * e1[None, :]
        + (sin_a * st)[:, None] * e2[None, :]
    )
    el_p = np.degrees(np.arcsin(np.clip(pts[:, 2], -1.0, 1.0)))
    az_p = np.mod(np.degrees(np.arctan2(pts[:, 0], pts[:, 1])), 360.0)
    h_p = horizon_el_at(horizon, az_p)
    w_vis = np.clip(0.5 + (el_p - h_p) / delta_deg, 0.0, 1.0)
    vis = float(w_vis.mean())

    if limb_darkening_u is None:
        return vis, vis, vis
    r_norm = np.clip(sin_a / math.sin(rho), 0.0, 1.0)
    mu = np.sqrt(1.0 - r_norm * r_norm)
    w_ld = 1.0 - limb_darkening_u * (1.0 - mu)
    flux = float((w_ld * w_vis).sum() / w_ld.sum())
    if occulter is None:
        return vis, flux, flux
    o_dir = np.asarray(occulter[0], dtype=float)
    d_deg = np.degrees(np.arccos(np.clip(pts @ o_dir, -1.0, 1.0)))
    w_out = np.clip(0.5 + (d_deg - float(occulter[1])) / delta_deg, 0.0, 1.0)
    den = float((w_ld * w_out).sum())
    flux_lit = float((w_ld * w_vis * w_out).sum() / den) if den > 0 else flux
    return vis, flux, flux_lit


def visible_fraction(
    az_deg: float,
    el_deg: float,
    ang_radius_deg: float,
    horizon: Horizon = None,
    limb_darkening_u: float | None = None,
    n: int = N_DISK_POINTS,
) -> float:
    """Fraction (0..1) of a circular body disk that lies above the horizon profile.

    Args:
        az_deg: true azimuth of the disk centre (deg, clockwise from north).
        el_deg: elevation of the disk centre above the local horizontal plane (deg).
        ang_radius_deg: angular radius of the disk (deg), > 0.
        horizon: C3 horizon profile (``az_step_deg``, ``el_deg``) or None for the smooth horizon.
        limb_darkening_u: None for the plain solid-angle fraction (vis_frac); a coefficient u for
            the linear limb-darkening law I(mu) = 1 - u (1 - mu), giving the flux fraction
            (flux_frac; the Sun uses u = 0.6).
        n: number of sample points.

    Assumptions: as ``disk_fractions``.
    """
    vis, flux, _ = disk_fractions(
        az_deg, el_deg, ang_radius_deg, horizon, limb_darkening_u, None, n
    )
    return vis if limb_darkening_u is None else flux


def flux_fraction(
    az_deg: float,
    el_deg: float,
    ang_radius_deg: float,
    horizon: Horizon = None,
    u: float = LIMB_DARKENING_U,
) -> float:
    """Limb-darkened visible fraction of the solar disk (0..1); see ``visible_fraction``."""
    return visible_fraction(az_deg, el_deg, ang_radius_deg, horizon, limb_darkening_u=u)


def segment_fraction_above(offset_over_radius: float) -> float:
    """Analytic area fraction of a flat disk above a straight edge (reference for tests).

    ``offset_over_radius`` = (signed distance of the disk centre above the edge) / radius.
    Dimensionless. Exact for a flat disk; for a small spherical cap cut by a great circle the
    difference is of order rho^2.
    """
    x = max(-1.0, min(1.0, offset_over_radius))
    below = (math.acos(x) - x * math.sqrt(1.0 - x * x)) / math.pi
    return 1.0 - below


def make_profile(el_deg: Sequence[float], az_step_deg: float) -> dict:
    """Wrap an elevation array into a minimal C3-shaped horizon dict (for tests and fixtures)."""
    return {"az_step_deg": float(az_step_deg), "el_deg": list(map(float, el_deg))}
