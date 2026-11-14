# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""The Earth eclipsing the Sun, seen from a lunar site (on Earth: a lunar eclipse).

This is the Python reference for ``web/js/physics/eclipse.js`` (same quadrature and constants, so
the numbers match to rounding). Validation: ``docs/validation/eclipse.md``.

Geometry and assumptions:
- The Sun and the Earth are circular disks on the site's sky. Directions are the apparent ones
  of the C1 table (light-time + aberration, seen from the Moon's centre, then shifted to the site),
  which is what the camera on a lander sees. Angular radii are ``asin(R / d)``.
- The Earth is an opaque disk of its solid-body equatorial radius, 6378.137 km (IERS / WGS-84),
  the radius that also sizes the Earth in the sky view. Its oblateness (polar radius 6356.752 km)
  and its atmosphere are ignored. NASA's lunar-eclipse predictions (Espenak, Danjon's rule) instead
  enlarge the Earth's radius by a factor 1.01 = 1 + 1/85 - 1/594: +1/85 for an opaque atmosphere
  layer of about 75 km, -1/594 for the oblateness at 45 deg latitude. ``DANJON_FACTOR`` gives that
  variant for comparison.
- The overlap is computed in the plane of the sky. The angles are below 1.3 deg, so the error from
  the curvature of the sky is of order rho^2 (5e-4 relative); the contact times are exact.
- Solar limb darkening: linear, ``I(mu) = 1 - u (1 - mu)`` with u = 0.6 (as ``moonat.visibility``).

Whole-Moon contacts (P1, U1, U2, U3, U4, P4): ``moon_shadow_contacts`` reproduces NASA's method
(angular distance of the Moon's centre from the shadow axis, seen from the Earth's centre, against
the Danjon radii ``Rp = 1.01 pi_M + s_S + pi_S`` and ``Ru = 1.01 pi_M - s_S + pi_S``) with this
project's ephemeris, to check it against the published times.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

import numpy as np

from .ephem import table as ephem_table
from .ephem import topo
from .visibility import LIMB_DARKENING_U, disk_fractions

EARTH_RADIUS_KM = topo.EARTH_RADIUS_KM  # 6378.137 km, solid-body equatorial radius
SUN_RADIUS_KM = topo.SUN_RADIUS_KM  # 695700 km, IAU 2015 nominal
MOON_RADIUS_KM = topo.MOON_RADIUS_KM  # 1737.4 km
# Danjon's enlargement of the Earth's radius, 1 + 1/85 - 1/594 (Espenak & Meeus, Five Millennium
# Canon of Lunar Eclipses: eclipse.gsfc.nasa.gov/LEcat5/shadow.html).
DANJON_FACTOR = 1.01
ECLIPSE_NODES = 24
MAX_SEP_RATE_DEG_PER_S = 0.75 / 3600.0  # bound on d(separation)/dt (the Sun moves 0.51 deg/h)


def _band_nodes(n: int = ECLIPSE_NODES) -> tuple[np.ndarray, np.ndarray]:
    """Nodes x in [0, 1] and weights dx for the partly covered band.

    ``x = (1 - cos theta) / 2`` with theta in [0, pi] at Gauss-Legendre nodes; ``dx = sin(theta)/2
    dtheta``. The substitution removes the square-root behaviour of the covered arc at both ends of
    the band and of the limb-darkening law at the solar limb.
    """
    xi, wi = np.polynomial.legendre.leggauss(n)
    th = 0.5 * math.pi * (xi + 1.0)
    return 0.5 * (1.0 - np.cos(th)), 0.25 * math.pi * wi * np.sin(th)


_NX, _NW = _band_nodes()


def _inner_flux(r_max: float, u: float) -> float:
    """Integral of I(r) 2r dr from 0 to r_max (solar radii, r_max <= 1), linear limb darkening."""
    s = r_max * r_max
    return (1.0 - u) * s + (2.0 * u / 3.0) * (1.0 - (1.0 - s) ** 1.5)


def occulted_flux_fraction(z: float, p: float, u: float = LIMB_DARKENING_U) -> float:
    """Fraction (0..1) of a limb-darkened solar disk's flux hidden by an opaque circular disk.

    Args:
        z: centre separation / solar angular radius (dimensionless).
        p: occulter angular radius / solar angular radius (dimensionless).
        u: linear limb-darkening coefficient (0 = uniform disk).

    Method: the solar disk is cut into rings of radius r (solar radii). The covered share of a ring
    is ``acos((r^2 + z^2 - p^2) / (2 r z)) / pi``. Rings entirely behind the occulter
    (r < p - z) are integrated analytically; the partly covered band |z - p| < r < min(1, z + p)
    with ECLIPSE_NODES Gauss-Legendre nodes in theta (r = a + (b - a)(1 - cos theta)/2).
    The total flux is ``1 - u/3`` (in units of pi I(1)).
    """
    if not z < 1.0 + p:
        return 0.0
    if z <= p - 1.0:
        return 1.0
    r_in = min(1.0, max(0.0, p - z))
    a = abs(z - p)
    b = min(1.0, z + p)
    f = _inner_flux(r_in, u)
    if a < b:
        w = b - a
        r = a + w * _NX
        c = (r * r + (z * z - p * p)) / (2.0 * r * z)
        cov = np.where(
            c >= 1.0, 0.0, np.where(c <= -1.0, 1.0, np.arccos(np.clip(c, -1.0, 1.0)) / math.pi)
        )
        mu = np.sqrt(np.maximum(1.0 - r * r, 0.0))
        f += float(np.sum((1.0 - u * (1.0 - mu)) * cov * 2.0 * r * _NW)) * w
    return min(1.0, max(0.0, f / (1.0 - u / 3.0)))


def lens_area_fraction(z: float, p: float) -> float:
    """Analytic covered area fraction of a uniform unit disk by a disk of radius p at distance z.

    Exact plane geometry (the lens area of two circles); reference for the u = 0 case in the tests.
    """
    if z >= 1.0 + p:
        return 0.0
    if z <= abs(1.0 - p):
        return min(1.0, p * p)
    a = math.acos((z * z + 1.0 - p * p) / (2.0 * z))
    b = p * p * math.acos((z * z + p * p - 1.0) / (2.0 * z * p))
    c = 0.5 * math.sqrt((-z + 1.0 + p) * (z + 1.0 - p) * (z - 1.0 + p) * (z + 1.0 + p))
    return (a + b - c) / math.pi


def sep_rad(a: Sequence[float], b: Sequence[float]) -> float:
    """Angle (rad) between two unit vectors (atan2 form, accurate for small angles)."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    return math.atan2(float(np.linalg.norm(np.cross(a, b))), float(a @ b))


def sun_eclipse_frac(
    sun_enu: Sequence[float], rho_sun_deg: float, earth_enu: Sequence[float], rho_earth_deg: float
) -> float:
    """Share (0..1) of the Sun's limb-darkened flux hidden by the Earth's disk, terrain ignored.

    ``sun_enu``/``earth_enu``: unit apparent directions in one frame (site ENU); radii in deg.
    Returns 0 without overlap work when the separation exceeds the sum of the radii.
    """
    rs, re = math.radians(rho_sun_deg), math.radians(rho_earth_deg)
    c = float(np.dot(sun_enu, earth_enu))
    if c <= math.cos(rs + re):
        return 0.0
    return occulted_flux_fraction(sep_rad(sun_enu, earth_enu) / rs, re / rs)


def combined_flux_frac(vis: float, flux: float, flux_lit: float, ecl: float) -> float:
    """Visible share of the Sun's flux with both the terrain and the Earth in the way.

    ``vis``, ``flux``, ``flux_lit`` from ``visibility.disk_fractions`` (with the Earth as occulter);
    ``ecl`` from ``sun_eclipse_frac``. Returns ``(1 - ecl) * flux_lit``, which is exactly the
    terrain-only flux when ecl = 0 and 1 - ecl when the whole disk clears the terrain.
    """
    if not ecl > 0.0:
        return flux
    if ecl >= 1.0 or vis <= 0.0:
        return 0.0
    if vis >= 1.0:
        return 1.0 - ecl
    return (1.0 - ecl) * flux_lit


def site_sun_state(
    lat_deg: float,
    lon_deg: float,
    t_utc,
    horizon=None,
    ground_elev_m: float = 0.0,
    observer_height_m: float = 2.0,
    earth_radius_km: float = EARTH_RADIUS_KM,
    table: ephem_table.EphemTable | None = None,
) -> dict:
    """Sun visibility, eclipse and flux fractions at a site for UTC time(s) (C6 ``sun`` fields).

    Inputs: selenographic MOON_ME lat/lon (deg, east +), a C3 horizon or None (smooth), heights
    in m, times as accepted by ``topo.to_posix_seconds``. ``earth_radius_km`` sets the occulting
    radius (default: the solid-body equatorial radius). Returns arrays (one per time):
    ``eclipse_frac``, ``vis_frac`` (terrain only), ``flux_frac`` (terrain and Earth),
    ``sep_deg`` (Sun-Earth centre separation), ``rho_sun_deg``, ``rho_earth_deg``,
    ``sun_el_deg``, ``sun_az_deg``.
    """
    st = ephem_table.sky_state(lat_deg, lon_deg, t_utc, ground_elev_m, observer_height_m, table)
    sun, earth = st["sun"], st["earth"]
    n = sun["az_deg"].size
    out = {k: np.empty(n) for k in ("eclipse_frac", "vis_frac", "flux_frac", "sep_deg")}
    out["rho_sun_deg"] = topo.ang_radius_deg(SUN_RADIUS_KM, sun["dist_km"])
    out["rho_earth_deg"] = topo.ang_radius_deg(earth_radius_km, earth["dist_km"])
    out["sun_el_deg"] = sun["el_deg"]
    out["sun_az_deg"] = sun["az_deg"]
    for i in range(n):
        su, eu = sun["enu"][i], earth["enu"][i]
        rs, re = float(out["rho_sun_deg"][i]), float(out["rho_earth_deg"][i])
        ecl = sun_eclipse_frac(su, rs, eu, re)
        vis, flux, lit = disk_fractions(
            float(sun["az_deg"][i]),
            float(sun["el_deg"][i]),
            rs,
            horizon,
            LIMB_DARKENING_U,
            (eu, re) if ecl > 0 else None,
        )
        out["eclipse_frac"][i] = ecl
        out["vis_frac"][i] = vis
        out["flux_frac"][i] = combined_flux_frac(vis, flux, lit, ecl)
        out["sep_deg"][i] = math.degrees(sep_rad(su, eu))
    return out


def _crossing(f: Callable[[float], float], a: float, b: float, tol_s: float) -> float:
    """Bisection for the sign change of f between a and b; returns the end on the f(b) side."""
    fa = f(a) > 0.0
    while abs(b - a) > tol_s:
        m = 0.5 * (a + b)
        if (f(m) > 0.0) == fa:
            a = m
        else:
            b = m
    return b


def _golden_min(f: Callable[[float], float], a: float, b: float, tol_s: float) -> float:
    """Golden-section minimum of a unimodal f on [a, b], to tol_s."""
    g = (math.sqrt(5.0) - 1.0) / 2.0
    c, d = b - g * (b - a), a + g * (b - a)
    fc, fd = f(c), f(d)
    while b - a > tol_s:
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - g * (b - a)
            fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a + g * (b - a)
            fd = f(d)
    return 0.5 * (a + b)


def site_contacts(
    lat_deg: float,
    lon_deg: float,
    t0_utc,
    t1_utc,
    step_s: float = 300.0,
    earth_radius_km: float = EARTH_RADIUS_KM,
    ground_elev_m: float = 0.0,
    observer_height_m: float = 2.0,
    tol_s: float = 0.5,
    table: ephem_table.EphemTable | None = None,
) -> dict | None:
    """Contacts of the eclipse of the Sun by the Earth at a site, between two UTC times.

    The window must hold one eclipse (an eclipse season's full Moon). Returns POSIX seconds:
    ``c1`` (first contact: the site enters the penumbra), ``c2`` (the Sun fully hidden: the site
    enters the umbra), ``max`` (minimum Sun-Earth separation), ``c3``, ``c4``; ``max_frac`` and
    ``min_sep_deg``. c2/c3 are None for a partial eclipse. Returns None without an eclipse.
    Terrain is ignored (the event is geometric). ``earth_radius_km`` sets the occulting radius.
    Site: selenographic MOON_ME lat/lon (deg), ground elevation and eye height (m), as in C6; a
    3 km height change moves the contacts by about 3 s (topocentric parallax of the Earth).
    """
    table = table or ephem_table.default_table()
    p0 = float(topo.to_posix_seconds(t0_utc))
    p1 = float(topo.to_posix_seconds(t1_utc))

    def geom(t: float) -> tuple[float, float, float]:
        st = ephem_table.sky_state(lat_deg, lon_deg, t, ground_elev_m, observer_height_m, table)
        s, e = st["sun"], st["earth"]
        sep = math.degrees(sep_rad(s["enu"][0], e["enu"][0]))
        rs = float(topo.ang_radius_deg(SUN_RADIUS_KM, s["dist_km"][0]))
        re = float(topo.ang_radius_deg(earth_radius_km, e["dist_km"][0]))
        return sep, rs, re

    def m_part(t: float) -> float:
        sep, rs, re = geom(t)
        return sep - (rs + re)

    def m_tot(t: float) -> float:
        sep, rs, re = geom(t)
        return sep - (re - rs)

    grid = np.arange(p0, p1 + 0.5 * step_s, step_s)
    m = np.array([m_part(float(t)) for t in grid])
    k = int(np.argmin(m))
    t_max = _golden_min(
        m_part, float(grid[max(0, k - 1)]), float(grid[min(grid.size - 1, k + 1)]), tol_s
    )
    if m_part(t_max) >= 0.0:
        return None
    sep, rs, re = geom(t_max)
    out = {
        "max": t_max,
        "min_sep_deg": sep,
        "max_frac": occulted_flux_fraction(math.radians(sep) / math.radians(rs), re / rs),
        "c1": _crossing(m_part, p0, t_max, tol_s) if m[0] > 0 else None,
        "c4": _crossing(m_part, p1, t_max, tol_s) if m[-1] > 0 else None,
        "c2": None,
        "c3": None,
    }
    if m_tot(t_max) <= 0.0:
        out["c2"] = _crossing(m_tot, out["c1"] or p0, t_max, tol_s)
        out["c3"] = _crossing(m_tot, out["c4"] or p1, t_max, tol_s)
    return out


def moon_shadow_contacts(
    t0_utc,
    t1_utc,
    enlargement: float = DANJON_FACTOR,
    step_s: float = 300.0,
    tol_s: float = 0.5,
    table: ephem_table.EphemTable | None = None,
    sun_radius_km: float | None = None,
) -> dict | None:
    """Whole-Moon lunar-eclipse contacts in NASA's convention, from this project's ephemeris.

    Seen from the Earth's centre: theta = angle between the Moon's centre and the shadow axis (the
    anti-Sun direction); s_M = asin(R_moon / d_M); pi_M = asin(R_earth / d_M) (equatorial horizontal
    parallax); s_S = asin(R_sun / d_S); pi_S = asin(R_earth / d_S). R_sun = ``sun_radius_km``
    (km; default SUN_RADIUS_KM, the IAU 2015 nominal 695700 km; the classical solar semi-diameter
    959.63 arcsec at 1 au corresponds to about 696000 km). Shadow radii (Danjon, with
    ``enlargement`` = 1.01): Rp = enlargement pi_M + s_S + pi_S, Ru = enlargement pi_M - s_S + pi_S.
    Contacts: P1/P4 at theta = Rp + s_M, U1/U4 at Ru + s_M, U2/U3 at Ru - s_M; greatest eclipse at
    the minimum of theta. P2/P3 (theta = Rp - s_M: the whole Moon inside the penumbra) are not in
    NASA's tables but bound the first and last contacts of every near-side site.
    Geocentric vectors from the C1 table: Moon = -earth_me, Sun = sun_me - earth_me (both apparent;
    the aberration difference between the Moon and the Earth, < 1 arcsec, is ignored).
    Returns POSIX seconds for p1, p2, u1, u2, greatest, u3, u4, p3, p4 (None when not reached) and
    the umbral magnitude ``(Ru + s_M - theta_min) / (2 s_M)``.
    """
    table = table or ephem_table.default_table()
    p0 = float(topo.to_posix_seconds(t0_utc))
    p1 = float(topo.to_posix_seconds(t1_utc))
    r_e = EARTH_RADIUS_KM
    r_s = SUN_RADIUS_KM if sun_radius_km is None else sun_radius_km

    def geom(t: float) -> dict:
        mc = table.moon_centre(t)
        moon = -mc["earth_me"][0]
        sun = mc["sun_me"][0] - mc["earth_me"][0]
        dm, ds = float(np.linalg.norm(moon)), float(np.linalg.norm(sun))
        theta = math.degrees(sep_rad(moon / dm, -sun / ds))
        s_m = math.degrees(math.asin(MOON_RADIUS_KM / dm))
        pi_m = math.degrees(math.asin(r_e / dm))
        s_s = math.degrees(math.asin(r_s / ds))
        pi_s = math.degrees(math.asin(r_e / ds))
        return {
            "theta": theta,
            "s_m": s_m,
            "rp": enlargement * pi_m + s_s + pi_s,
            "ru": enlargement * pi_m - s_s + pi_s,
        }

    fns = {
        "p": lambda t: (lambda g: g["theta"] - (g["rp"] + g["s_m"]))(geom(t)),
        "u": lambda t: (lambda g: g["theta"] - (g["ru"] + g["s_m"]))(geom(t)),
        "u_in": lambda t: (lambda g: g["theta"] - (g["ru"] - g["s_m"]))(geom(t)),
        "p_in": lambda t: (lambda g: g["theta"] - (g["rp"] - g["s_m"]))(geom(t)),
    }
    grid = np.arange(p0, p1 + 0.5 * step_s, step_s)
    th = np.array([geom(float(t))["theta"] for t in grid])
    k = int(np.argmin(th))
    t_g = _golden_min(
        lambda t: geom(t)["theta"],
        float(grid[max(0, k - 1)]),
        float(grid[min(grid.size - 1, k + 1)]),
        tol_s,
    )
    g = geom(t_g)
    out = {"greatest": t_g, "umbral_magnitude": (g["ru"] + g["s_m"] - g["theta"]) / (2 * g["s_m"])}
    for key, (f, a, b) in {
        "p1": (fns["p"], p0, t_g),
        "p2": (fns["p_in"], p0, t_g),
        "u1": (fns["u"], p0, t_g),
        "u2": (fns["u_in"], p0, t_g),
        "u3": (fns["u_in"], p1, t_g),
        "u4": (fns["u"], p1, t_g),
        "p3": (fns["p_in"], p1, t_g),
        "p4": (fns["p"], p1, t_g),
    }.items():
        out[key] = _crossing(f, a, b, tol_s) if f(a) > 0.0 >= f(b) else None
    return out
