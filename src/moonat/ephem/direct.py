# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Direct skyfield ephemeris: topocentric apparent Sun, Earth and planets from a lunar site.

Chain (all rigorous, no table): JPL DE421 (ICRF, barycentric) -> observer = Moon centre + site
fixed in MOON_ME_DE421 (lunar PA kernel + fixed PA->ME rotation of moon_080317.tf) -> skyfield
``observe().apparent()`` from the site itself (light-time iteration, gravitational deflection by
the Sun/Jupiter/Saturn, stellar aberration with the site's barycentric velocity including lunar
rotation) -> rotate the apparent ICRS vector into MOON_ME at the observation time -> ENU (radial
up) -> az/el. No refraction (airless).

Time: UTC in, converted to TT with the official TAI-UTC (including the pre-1972 "rubber second"
formula, which skyfield does not model) and TT = TAI + 32.184 s.
"""

from __future__ import annotations

import numpy as np

from . import topo
from .kernels import load_kernels

PLANETS = ("mercury", "venus", "mars", "jupiter", "saturn")
# DE421 holds Jupiter and Saturn only as system barycentres; the planet-barycentre offset is
# below 0.1 arcsec as seen from the Moon.
_TARGET = {
    "sun": "sun",
    "earth": "earth",
    "mercury": "mercury",
    "venus": "venus",
    "mars": "mars",
    "jupiter": "jupiter barycenter",
    "saturn": "saturn barycenter",
}

# USNO tai-utc.dat, 1966-01-01 .. 1972-01-01: TAI-UTC = A + (MJD - 39126) * 0.002592 s.
_PRE1972 = ((-126230400.0, 4.3131700), (-60307200.0, 4.2131700))  # (start POSIX s, A)
_UTC1972 = 63072000.0  # 1972-01-01T00:00:00Z


def tai_minus_utc_pre1972(posix_s) -> np.ndarray:
    """TAI-UTC (s) for 1966-01-01..1971-12-31 from the official linear formulas.

    Before 1966 the 1966 formula is extrapolated (error < 1 s). Undefined after 1972 (NaN).
    """
    p = np.asarray(posix_s, dtype=float)
    mjd = p / 86400.0 + 40587.0
    a = np.where(p < _PRE1972[1][0], _PRE1972[0][1], _PRE1972[1][1])
    return np.where(p < _UTC1972, a + (mjd - 39126.0) * 0.002592, np.nan)


def skyfield_time(posix_s):
    """skyfield ``Time`` for UTC POSIX seconds (scalar or array).

    From 1972 on, skyfield's leap-second table is used. Before 1972 skyfield assumes
    TAI-UTC = 10 s, so the time is shifted by (true TAI-UTC - 10 s), up to 2.4 s in 1969.
    """
    ts = load_kernels().ts
    p = np.asarray(posix_s, dtype=float)
    days = np.floor(p / 86400.0)
    # skyfield looks up TAI-UTC at the calendar day given, so pass the real day number.
    t = ts.utc(1970, 1, 1 + days.astype(np.int64), 0, 0, p - days * 86400.0)
    corr = np.nan_to_num(tai_minus_utc_pre1972(p) - 10.0)
    if not np.any(corr):
        return t
    return ts.tt_jd(t.whole, t.tt_fraction + corr / 86400.0)


def _rot_icrs_to_me(t) -> np.ndarray:
    """MOON_ME_DE421 rotation matrices at skyfield time ``t``: shape (N, 3, 3), v_me = R v_icrs."""
    return np.moveaxis(load_kernels().frame.rotation_at(t), -1, 0)


def moon_centre_apparent(posix_s, bodies=("sun", "earth", *PLANETS)) -> dict:
    """Apparent vectors seen from the Moon's centre (the C1 table content).

    Returns ``{body: (N,3) km in ICRS}`` (light-time + deflection + aberration; length =
    light-time distance) plus ``"r_icrs_to_me": (N,3,3)``.
    """
    k = load_kernels()
    t = skyfield_time(np.atleast_1d(posix_s))
    obs = k.eph["moon"].at(t)
    out = {b: obs.observe(k.eph[_TARGET[b]]).apparent().position.km.T for b in bodies}
    out["r_icrs_to_me"] = _rot_icrs_to_me(t)
    return out


def sky_state(
    lat_deg: float,
    lon_deg: float,
    t_utc,
    ground_elev_m: float = 0.0,
    observer_height_m: float = 2.0,
    bodies=("sun", "earth", *PLANETS),
) -> dict:
    """Topocentric apparent positions for one site at one or many UTC times (direct skyfield).

    Inputs: selenographic ``lat_deg``/``lon_deg`` (MOON_ME, deg, east +); ground elevation and eye
    height (m) above the ground; the eye radius is 1737.4 km + ground_elev_m + observer_height_m.
    ``t_utc``: anything :func:`topo.to_posix_seconds` accepts.

    Returns arrays over time (length N): ``t_posix``; per body ``{az_deg, el_deg, dist_km, enu
    (N,3 unit)}``, plus ``ang_radius_deg`` for the Sun and Earth, and for the Earth
    ``phase_frac`` and ``sun_dir_enu`` (unit Earth->Sun in ENU); ``r_icrs_to_enu`` (N,3,3);
    ``era_deg`` (N,).
    """
    from skyfield.planetarylib import PlanetTopos
    from skyfield.units import Angle, Distance

    k = load_kernels()
    p = np.atleast_1d(topo.to_posix_seconds(t_utc)).astype(float)
    t = skyfield_time(p)
    radius = float(topo.site_radius_km(ground_elev_m, observer_height_m))
    site = PlanetTopos.from_latlon_distance(
        k.frame, Angle(degrees=lat_deg), Angle(degrees=lon_deg), Distance(km=radius)
    )
    obs = (k.eph["moon"] + site).at(t)
    r_me = _rot_icrs_to_me(t)
    r_enu = topo.enu_matrix(lat_deg, lon_deg) @ r_me  # (N,3,3) ICRS -> ENU
    out = {"t_posix": p, "r_icrs_to_enu": r_enu, "era_deg": topo.era_deg(p)}
    vec = {}
    for b in bodies:
        v_icrs = obs.observe(k.eph[_TARGET[b]]).apparent().position.km.T  # (N,3)
        enu = np.einsum("nij,nj->ni", r_enu, v_icrs)
        vec[b] = enu
        az, el = topo.az_el_deg(enu)
        d = np.linalg.norm(enu, axis=-1)
        out[b] = {"az_deg": az, "el_deg": el, "dist_km": d, "enu": enu / d[:, None]}
    for b, radius_km in (("sun", topo.SUN_RADIUS_KM), ("earth", topo.EARTH_RADIUS_KM)):
        if b in out:
            out[b]["ang_radius_deg"] = topo.ang_radius_deg(radius_km, out[b]["dist_km"])
    if "sun" in vec and "earth" in vec:
        out["earth"]["phase_frac"] = topo.phase_frac(vec["earth"], vec["sun"])
        out["earth"]["sun_dir_enu"] = topo.unit(vec["sun"] - vec["earth"])
    return out
