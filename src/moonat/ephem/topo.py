# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Pure-numpy geometry shared by the direct (skyfield) and table-based paths.

This module is the exact recipe the JavaScript port copies (docs/CONTRACTS.md §0, C1, C6).
Conventions:
- Body-fixed frame: MOON_ME (DE421 realisation). Selenographic latitude/longitude on the
  1737.4 km sphere, longitude east-positive.
- Local ENU frame: up = unit vector from the Moon's centre to the site (radial, NOT the terrain
  normal), east = ME +Z x up (normalised), north = up x east. Exactly at a pole
  (|lat| > 89.9999 deg) north is undefined; there north = the horizontal direction toward the
  0 deg meridian (ME +X), and east = north x up.
- Azimuth: clockwise from north toward east, 0..360 deg. Elevation: angle above the plane normal
  to up, deg. No refraction (the Moon has no atmosphere).
- Time: UTC as POSIX seconds (seconds since 1970-01-01T00:00:00Z, no leap seconds, exactly
  like JavaScript ``Date`` milliseconds / 1000).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np

MOON_RADIUS_KM = 1737.4
SUN_RADIUS_KM = 696000.0
EARTH_RADIUS_KM = 6378.137  # equatorial (WGS-84 / IERS)
POLE_LAT_DEG = 89.9999


def to_posix_seconds(t) -> np.ndarray:
    """Convert UTC times to POSIX seconds (float64 array).

    Accepts numbers (already POSIX seconds), ISO-8601 strings (``Z`` suffix optional, treated as
    UTC), ``datetime`` (naive = UTC) or ``numpy.datetime64``; scalars or sequences.
    """
    arr = np.asarray(t)
    if arr.dtype.kind in "iuf":
        return arr.astype(float)
    if arr.dtype.kind == "M":
        return arr.astype("datetime64[ns]").astype(np.int64) / 1e9
    flat = []
    for x in arr.ravel().tolist():
        if isinstance(x, str):
            x = datetime.fromisoformat(x.strip().replace("Z", "+00:00"))
        if x.tzinfo is None:
            x = x.replace(tzinfo=UTC)
        flat.append(x.timestamp())
    return np.asarray(flat, dtype=float).reshape(arr.shape)


def posix_to_iso(posix_s: float) -> str:
    """POSIX seconds -> ISO-8601 UTC string with millisecond precision and a ``Z`` suffix."""
    dt = datetime(1970, 1, 1, tzinfo=UTC) + timedelta(seconds=float(posix_s))
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def era_deg(posix_s) -> np.ndarray:
    """Earth Rotation Angle (IERS Conventions 2010, eq. 5.15) in degrees, 0..360.

    ERA = 2*pi*(0.7790572732640 + 1.00273781191135448 * Du), Du = JD(UT1) - 2451545.0.
    Assumption: UT1 = UTC (|UT1-UTC| < 0.9 s, i.e. < 0.004 deg of Earth rotation). The integer
    part of Du is split off first to keep full float64 precision.
    """
    du = (np.asarray(posix_s, dtype=float) - 946728000.0) / 86400.0  # 2000-01-01T12:00:00Z
    frac = 0.7790572732640 + 0.00273781191135448 * du + np.mod(du, 1.0)
    return np.mod(frac, 1.0) * 360.0


def site_radius_km(ground_elev_m=0.0, observer_height_m=2.0):
    """Distance of the observer's eye from the Moon's centre (km): 1737.4 + elevation + height."""
    return MOON_RADIUS_KM + (np.asarray(ground_elev_m) + np.asarray(observer_height_m)) / 1000.0


def site_vector_me(lat_deg, lon_deg, radius_km) -> np.ndarray:
    """Site position in MOON_ME (km) for selenographic lat/lon (deg, east +) on a sphere."""
    la, lo = np.radians(lat_deg), np.radians(lon_deg)
    c = np.cos(la)
    return np.asarray(radius_km)[..., None] * np.stack(
        [c * np.cos(lo), c * np.sin(lo), np.sin(la) + 0 * lo], axis=-1
    )


def enu_matrix(lat_deg: float, lon_deg: float) -> np.ndarray:
    """Rotation MOON_ME -> local ENU (3x3; rows = east, north, up unit vectors in ME).

    Up is radial. North is the projection of ME +Z on the horizontal plane; exactly at a pole
    (|lat| > 89.9999 deg) north is the horizontal direction toward the 0 deg meridian (ME +X).
    """
    la, lo = np.radians(lat_deg), np.radians(lon_deg)
    up = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
    if abs(lat_deg) > POLE_LAT_DEG:
        up = np.array([0.0, 0.0, np.sign(lat_deg)])
        north = np.array([1.0, 0.0, 0.0])
        east = np.cross(north, up)
    else:
        east = np.array([-np.sin(lo), np.cos(lo), 0.0])
        north = np.cross(up, east)
    return np.vstack([east, north, up])


def az_el_deg(enu: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Azimuth (deg, clockwise from north, 0..360) and elevation (deg) of ENU vectors (..., 3)."""
    e, n, u = enu[..., 0], enu[..., 1], enu[..., 2]
    az = np.mod(np.degrees(np.arctan2(e, n)), 360.0)
    el = np.degrees(np.arctan2(u, np.hypot(e, n)))
    return az, el


def ang_radius_deg(body_radius_km: float, dist_km) -> np.ndarray:
    """Apparent angular radius of a sphere (deg): asin(R / d), half-angle of the tangent cone."""
    return np.degrees(np.arcsin(body_radius_km / np.asarray(dist_km)))


def phase_frac(earth_vec, sun_vec) -> np.ndarray:
    """Illuminated fraction of the Earth's disk, (1 + cos a) / 2.

    ``earth_vec`` and ``sun_vec`` are observer->Earth and observer->Sun vectors (km, any common
    frame). a is the Sun-Earth-observer angle: between Earth->observer (-earth_vec) and
    Earth->Sun (sun_vec - earth_vec).
    """
    to_obs = -np.asarray(earth_vec)
    to_sun = np.asarray(sun_vec) - np.asarray(earth_vec)
    cos_a = np.sum(to_obs * to_sun, axis=-1) / (
        np.linalg.norm(to_obs, axis=-1) * np.linalg.norm(to_sun, axis=-1)
    )
    return 0.5 * (1.0 + cos_a)


def unit(v: np.ndarray) -> np.ndarray:
    """Normalise vectors along the last axis."""
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def quat_to_matrix(q: np.ndarray) -> np.ndarray:
    """Unit quaternion(s) (w, x, y, z), shape (..., 4) -> rotation matrices (..., 3, 3).

    Hamilton convention, active rotation: v' = R v = q v q*.
    """
    w, x, y, z = (q[..., i] for i in range(4))
    return np.stack(
        [
            np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], -1),
            np.stack([2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], -1),
            np.stack([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], -1),
        ],
        -2,
    )


def matrix_to_quat(m: np.ndarray) -> np.ndarray:
    """Rotation matrices (..., 3, 3) -> unit quaternions (w, x, y, z) (Shepperd's method)."""
    m = np.asarray(m, dtype=float)
    shp = m.shape[:-2]
    m = m.reshape(-1, 3, 3)
    q = np.empty((m.shape[0], 4))
    for k, r in enumerate(m):
        tr = r[0, 0] + r[1, 1] + r[2, 2]
        if tr > 0:
            s = 2.0 * np.sqrt(1.0 + tr)
            q[k] = [
                0.25 * s,
                (r[2, 1] - r[1, 2]) / s,
                (r[0, 2] - r[2, 0]) / s,
                (r[1, 0] - r[0, 1]) / s,
            ]
        elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
            s = 2.0 * np.sqrt(1.0 + r[0, 0] - r[1, 1] - r[2, 2])
            q[k] = [
                (r[2, 1] - r[1, 2]) / s,
                0.25 * s,
                (r[0, 1] + r[1, 0]) / s,
                (r[0, 2] + r[2, 0]) / s,
            ]
        elif r[1, 1] > r[2, 2]:
            s = 2.0 * np.sqrt(1.0 + r[1, 1] - r[0, 0] - r[2, 2])
            q[k] = [
                (r[0, 2] - r[2, 0]) / s,
                (r[0, 1] + r[1, 0]) / s,
                0.25 * s,
                (r[1, 2] + r[2, 1]) / s,
            ]
        else:
            s = 2.0 * np.sqrt(1.0 + r[2, 2] - r[0, 0] - r[1, 1])
            q[k] = [
                (r[1, 0] - r[0, 1]) / s,
                (r[0, 2] + r[2, 0]) / s,
                (r[1, 2] + r[2, 1]) / s,
                0.25 * s,
            ]
    q /= np.linalg.norm(q, axis=-1, keepdims=True)
    return q.reshape(*shp, 4)


def angle_between_deg(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Angle between vectors along the last axis (deg), robust for tiny angles (atan2 form)."""
    cr = np.linalg.norm(np.cross(a, b), axis=-1)
    return np.degrees(np.arctan2(cr, np.sum(a * b, axis=-1)))
