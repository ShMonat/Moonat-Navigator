# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Reference reader for the C1 ``ephem-table`` (web/data/ephem/) and the topocentric transform.

This is the Python twin of the browser code (physics-js): it uses only numpy and the binary
tables, never skyfield. The JavaScript port must reproduce it exactly:

Grid. File ``<Y>.bin`` holds N = (T(Y+1) - T(Y)) / (H*3600) + 1 little-endian records; record k is
at POSIX time T(Y) + k*H*3600 s, where T(Y) = POSIX seconds of Y-01-01T00:00:00Z. POSIX time
ignores leap seconds (same as JS ``Date``); records are computed at those true UTC instants.

Interpolation, for a time t in year Y: u = (t - T(Y)) / (H*3600), i = min(floor(u), N-2),
s = u - i in [0, 1].
- Positions (``sun_me``, ``earth_me`` and the ``planets_icrs`` unit vectors), per component, with
  tangents in per-step units:
    m_k     = (P[k+1] - P[k-1]) / 2                              for 1 <= k <= N-2
    m_0     = (-11 P[0] + 18 P[1] - 9 P[2] + 2 P[3]) / 6
    m_(N-1) = (11 P[N-1] - 18 P[N-2] + 9 P[N-3] - 2 P[N-4]) / 6
    P(s) = (2s^3-3s^2+1) P[i] + (s^3-2s^2+s) m_i + (-2s^3+3s^2) P[i+1] + (s^3-s^2) m_(i+1)
  Planet directions are renormalised after interpolation.
- Quaternion ``q_icrs_to_me`` (w,x,y,z): slerp between q[i] and q[i+1]; if their dot product is
  negative, negate q[i+1] first (q and -q are the same rotation).

Topocentric transform (CONTRACTS §0): site_me = r * (cos lat cos lon, cos lat sin lon, sin lat),
r = 1737.4 km + (ground_elev_m + observer_height_m)/1000; Sun/Earth vector = body_me - site_me;
ENU = enu_matrix(lat, lon) @ vector; planets (unit vectors only, so no parallax: up to ~9 arcsec
for Venus near inferior conjunction) = enu_matrix @ R(q) @ dir_icrs;
r_icrs_to_enu = enu_matrix @ R(q).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

import numpy as np

from . import topo

DEFAULT_DIR = Path(__file__).resolve().parents[3] / "web" / "data" / "ephem"
PLANETS = ("mercury", "venus", "mars", "jupiter", "saturn")
RECORD_LAYOUT = [
    {"name": "sun_me", "dtype": "f8", "count": 3},
    {"name": "earth_me", "dtype": "f8", "count": 3},
    {"name": "q_icrs_to_me", "dtype": "f8", "count": 4},
    {"name": "planets_icrs", "dtype": "f4", "count": 15},
]
RECORD_DTYPE = np.dtype([(f["name"], "<" + f["dtype"], (f["count"],)) for f in RECORD_LAYOUT])


def year_start_posix(year) -> np.ndarray:
    """POSIX seconds of <year>-01-01T00:00:00Z (vectorised)."""
    y = np.asarray(year)
    return (np.asarray(y - 1970, dtype="datetime64[Y]").astype("datetime64[s]")).astype(np.int64)


def year_of(posix_s) -> np.ndarray:
    """UTC calendar year of POSIX seconds (vectorised)."""
    ms = np.floor(np.asarray(posix_s, dtype=float) * 1e3).astype(np.int64).astype("datetime64[ms]")
    return ms.astype("datetime64[Y]").astype(np.int64) + 1970


def n_records(year: int, step_hours: float) -> int:
    """Number of records in a year file: the whole year plus one extra record."""
    span = int(year_start_posix(year + 1) - year_start_posix(year))
    n, rem = divmod(span, int(round(step_hours * 3600)))
    assert rem == 0, "step_hours must divide 24"
    return n + 1


def tangents(p: np.ndarray) -> np.ndarray:
    """Per-step finite-difference tangents of samples ``p`` (N, ...) as in the module docstring."""
    m = np.empty_like(p, dtype=float)
    m[1:-1] = 0.5 * (p[2:] - p[:-2])
    m[0] = (-11 * p[0] + 18 * p[1] - 9 * p[2] + 2 * p[3]) / 6.0
    m[-1] = (11 * p[-1] - 18 * p[-2] + 9 * p[-3] - 2 * p[-4]) / 6.0
    return m


def hermite(p0, m0, p1, m1, s):
    """Cubic Hermite on the unit interval; ``s`` broadcasts against the leading axis."""
    s = np.asarray(s, dtype=float).reshape(-1, *([1] * (np.ndim(p0) - 1)))
    s2, s3 = s * s, s * s * s
    return (
        (2 * s3 - 3 * s2 + 1) * p0
        + (s3 - 2 * s2 + s) * m0
        + (-2 * s3 + 3 * s2) * p1
        + (s3 - s2) * m1
    )


def slerp(q0: np.ndarray, q1: np.ndarray, s) -> np.ndarray:
    """Spherical linear interpolation of unit quaternions (N,4), shortest path."""
    s = np.asarray(s, dtype=float)[:, None]
    d = np.sum(q0 * q1, axis=-1, keepdims=True)
    q1 = np.where(d < 0, -q1, q1)
    d = np.abs(d)
    th = np.arccos(np.clip(d, -1.0, 1.0))
    sin_th = np.sin(th)
    small = sin_th < 1e-12
    w0 = np.where(small, 1.0 - s, np.sin((1.0 - s) * th) / np.where(small, 1.0, sin_th))
    w1 = np.where(small, s, np.sin(s * th) / np.where(small, 1.0, sin_th))
    q = w0 * q0 + w1 * q1
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


class EphemTable:
    """Lazy reader of the per-year binary tables described by ``manifest.json``."""

    def __init__(self, base_dir: Path | str = DEFAULT_DIR):
        self.base_dir = Path(base_dir)
        self.manifest = json.loads((self.base_dir / "manifest.json").read_text(encoding="utf-8"))
        self.step_s = float(self.manifest["step_hours"]) * 3600.0
        self.years = set(self.manifest["years"])
        self._cache: dict[int, tuple] = {}

    def _year(self, year: int):
        if year not in self._cache:
            if year not in self.years:
                raise ValueError(f"year {year} is not in the ephemeris table")
            rec = np.fromfile(self.base_dir / f"{year}.bin", dtype=RECORD_DTYPE)
            assert len(rec) == n_records(year, self.manifest["step_hours"])
            sun, earth = rec["sun_me"].astype(float), rec["earth_me"].astype(float)
            pl = rec["planets_icrs"].astype(float)
            self._cache[year] = (
                sun,
                tangents(sun),
                earth,
                tangents(earth),
                pl,
                tangents(pl),
                rec["q_icrs_to_me"],
            )
        return self._cache[year]

    def moon_centre(self, posix_s) -> dict:
        """Interpolated table state at UTC POSIX times: Moon-centre apparent vectors.

        Returns ``sun_me``, ``earth_me`` (N,3) km in MOON_ME; ``q_icrs_to_me`` (N,4);
        ``planets_icrs`` (N,5,3) unit vectors in ICRS.
        """
        p = np.atleast_1d(np.asarray(posix_s, dtype=float))
        out = {
            "sun_me": np.empty((p.size, 3)),
            "earth_me": np.empty((p.size, 3)),
            "q_icrs_to_me": np.empty((p.size, 4)),
            "planets_icrs": np.empty((p.size, 5, 3)),
        }
        years = year_of(p)
        for y in np.unique(years):
            sel = years == y
            sun, msun, earth, mearth, pl, mpl, q = self._year(int(y))
            u = (p[sel] - year_start_posix(y)) / self.step_s
            i = np.minimum(np.floor(u).astype(int), len(sun) - 2)
            s = u - i
            out["sun_me"][sel] = hermite(sun[i], msun[i], sun[i + 1], msun[i + 1], s)
            out["earth_me"][sel] = hermite(earth[i], mearth[i], earth[i + 1], mearth[i + 1], s)
            d = hermite(pl[i], mpl[i], pl[i + 1], mpl[i + 1], s).reshape(-1, 5, 3)
            out["planets_icrs"][sel] = topo.unit(d)
            out["q_icrs_to_me"][sel] = slerp(q[i], q[i + 1], s)
        return out


@lru_cache(maxsize=4)
def default_table(base_dir: str = str(DEFAULT_DIR)) -> EphemTable:
    """Shared table instance (cached per directory)."""
    return EphemTable(base_dir)


def sky_state(
    lat_deg: float,
    lon_deg: float,
    t_utc,
    ground_elev_m: float = 0.0,
    observer_height_m: float = 2.0,
    table: EphemTable | None = None,
) -> dict:
    """Topocentric Sun, Earth and planets from the C1 tables (same output keys as ``direct``).

    Inputs: selenographic ``lat_deg``/``lon_deg`` (MOON_ME, deg, east +); ground elevation and eye
    height (m); ``t_utc`` in any form :func:`topo.to_posix_seconds` accepts (scalar or array).
    Output arrays have length N (number of times). See the module docstring for the recipe.
    """
    table = table or default_table()
    p = np.atleast_1d(topo.to_posix_seconds(t_utc)).astype(float)
    mc = table.moon_centre(p)
    site = topo.site_vector_me(
        lat_deg, lon_deg, topo.site_radius_km(ground_elev_m, observer_height_m)
    )
    m_enu = topo.enu_matrix(lat_deg, lon_deg)
    r_icrs_me = topo.quat_to_matrix(mc["q_icrs_to_me"])
    r_enu = m_enu @ r_icrs_me
    out = {"t_posix": p, "r_icrs_to_enu": r_enu, "era_deg": topo.era_deg(p)}
    vec = {}
    for b, radius_km in (("sun", topo.SUN_RADIUS_KM), ("earth", topo.EARTH_RADIUS_KM)):
        v = mc[f"{b}_me"] - site
        enu = v @ m_enu.T
        vec[b] = enu
        az, el = topo.az_el_deg(enu)
        d = np.linalg.norm(enu, axis=-1)
        out[b] = {
            "az_deg": az,
            "el_deg": el,
            "dist_km": d,
            "ang_radius_deg": topo.ang_radius_deg(radius_km, d),
            "enu": enu / d[:, None],
        }
    out["earth"]["phase_frac"] = topo.phase_frac(vec["earth"], vec["sun"])
    out["earth"]["sun_dir_enu"] = topo.unit(vec["sun"] - vec["earth"])
    for k, name in enumerate(PLANETS):
        enu = np.einsum("nij,nj->ni", r_enu, mc["planets_icrs"][:, k])
        az, el = topo.az_el_deg(enu)
        out[name] = {"az_deg": az, "el_deg": el, "enu": enu}
    return out


def utc_now_iso() -> str:
    """Current UTC time as an ISO string (for generated-file metadata)."""
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
