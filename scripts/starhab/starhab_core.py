# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""StarHab site study: shared geometry, ephemeris, horizons and visibility metrics.

Question: where at the lunar south pole should StarHab (a horizontally placed, regolith-buried
Starship HLS) stand to get the most sunlight AND the most direct-to-Earth (DTE) line of sight over
2030-01-01 .. 2040-12-31 (UTC)?

Frames, units and conventions (docs/CONTRACTS.md §0):
- Body-fixed frame MOON_ME (DE421 realisation). Selenographic latitude / east longitude in deg on the
  1737.4 km reference sphere. Heights in m above that sphere (LOLA convention).
- Local frame ENU at the site, up = radial (Moon centre -> site), azimuth clockwise from north,
  elevation above the plane normal to up. No refraction (airless).
- Sun and Earth: apparent vectors (light time + aberration) from the Moon's centre in MOON_ME, km,
  from skyfield + DE421 + the lunar PA kernel (``moonat.ephem.direct``), computed once per time
  step. Each site then subtracts its own position vector (eye radius), which applies the
  topocentric parallax exactly: up to 0.26 deg for the Earth, 2.4 arcsec for the Sun (C1 recipe).
- Disk sizes: Sun radius 695 700 km, Earth radius 6378.137 km (CONTRACTS C6); angular radius
  asin(R / d).
- Time: UTC POSIX seconds; the study period is [2030-01-01, 2041-01-01).

Horizons (C3 geometry, ``moonat.terrain.horizon``): exact great-circle rays on a spherical Moon
with a height field, elevation from the eye (ground + observer height), maximum along the ray,
rigorous stopping rule. Two DEM set-ups:
- screening (``PolarPyramid``): LOLA LDEM_75S_240M, mean-pooled to 480 / 960 / 1920 m for ray
  distances beyond 30 / 60 / 120 km, LDEM_16 outside the 240 m file; 1 deg azimuth step;
- refinement (``refined_layers``): LOLA LDEM_80S_20M near field (cached blocks only, up to
  ``NEAR_M``), LDEM_75S_240M to 450 km, LDEM_16 beyond; 0.25 deg azimuth step (as C3).

Visible fractions:
- screening: the horizon is treated as a straight edge across the disk at the disk centre's
  azimuth; the area fraction (Earth) or the limb-darkened flux fraction (Sun, linear law u = 0.6)
  above that edge comes from a closed form / a lookup table. Eclipses are ignored (< 0.1 % of time).
- refinement: the exact C6 reference (``moonat.visibility.disk_fractions`` with 400 disk points,
  and ``moonat.eclipse`` for the Earth hiding the Sun), called only for samples where the disk may
  touch the skyline; elsewhere the reference's own fast paths are applied in vectorised form.

Metrics per site (time averages over the period):
- ``sun_pct``: mean limb-darkened visible share of the Sun's flux (C6 ``flux_frac``), in %;
- ``sun_lit_pct``: % of time with any sunlight (flux_frac > 0);
- ``sun_disk_pct``: mean visible disk fraction without limb darkening (Glaser's "average
  illumination"), in %;
- ``dark_max_d``: longest continuous stretch with no sunlight at all, days;
- ``earth_pct``: mean visible fraction of the Earth's disk, in %;
- ``earth_any_pct``: % of time with any part of the Earth's disk above the skyline (Mazarico's
  Earth-visibility definition);
- ``blackout_max_d``: longest continuous stretch with the Earth fully hidden, days;
- ``both_pct``: % of time with some sunlight AND some of the Earth's disk visible;
- ``both_min_pct``: mean of min(flux_frac, earth_vis) (the C11 ``both`` score).
"""

from __future__ import annotations

import math
import os
import sys
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from moonat import eclipse as ecl  # noqa: E402
from moonat.terrain.dem import (  # noqa: E402
    Layer,
    LayeredDEM,
    _polar_citation,
    _whole_window,
    bilinear,
    global_source,
    polar_source,
    window_around,
)
from moonat.terrain.horizon import (  # noqa: E402
    horizon_from_sampler,
    horizon_profile,
    ray_schedule,
)
from moonat.terrain.pds import R_MOON_M, enu_basis, grid_rowcol, unit_from_latlon  # noqa: E402
from moonat.visibility import LIMB_DARKENING_U, disk_fractions  # noqa: E402

GEN = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."
SUN_RADIUS_KM = 695_700.0
EARTH_RADIUS_KM = 6378.137
R_KM = R_MOON_M / 1000.0

T_START = datetime(2030, 1, 1, tzinfo=UTC)
T_END = datetime(2041, 1, 1, tzinfo=UTC)  # exclusive: the period is 2030-01-01 .. 2040-12-31

NEAR_M = 15_000.0  # 20 m near-field radius for the refinement horizons
MID_M = 450_000.0
EYE_M = 2.0  # project standard eye height (CONTRACTS §0)
MAST_M = 10.0  # mast height for arrays and the DTE antenna


def cache_dir() -> Path:
    """Folder for intermediate results (``$MOONAT_STARHAB_CACHE`` or ``data/cache/starhab``)."""
    p = Path(os.environ.get("MOONAT_STARHAB_CACHE", ROOT / "data" / "cache" / "starhab"))
    p.mkdir(parents=True, exist_ok=True)
    return p


# ------------------------------------------------------------------------------------------------
# Ephemeris
# ------------------------------------------------------------------------------------------------


def time_grid(step_h: float, t0: datetime = T_START, t1: datetime = T_END) -> np.ndarray:
    """UTC POSIX seconds from t0 (inclusive) to t1 (exclusive) every ``step_h`` hours."""
    return np.arange(t0.timestamp(), t1.timestamp(), step_h * 3600.0)


def body_vectors_me(step_h: float, t0: datetime = T_START, t1: datetime = T_END) -> dict:
    """Apparent Sun and Earth vectors from the Moon's centre in MOON_ME (km), cached on disk.

    Returns ``{"t": (N,) POSIX s, "sun": (N,3) km, "earth": (N,3) km}``. Source:
    ``moonat.ephem.direct.moon_centre_apparent`` (skyfield, DE421, MOON_ME_DE421), i.e. light time,
    gravitational deflection and aberration from the Moon's centre, then rotated to MOON_ME.
    """
    tag = f"eph_{t0:%Y%m%d}_{t1:%Y%m%d}_{step_h:g}h.npz"
    path = cache_dir() / tag
    if path.exists():
        z = np.load(path)
        return {k: z[k] for k in ("t", "sun", "earth")}
    from moonat.ephem import direct

    t = time_grid(step_h, t0, t1)
    out = {"t": t, "sun": np.empty((t.size, 3)), "earth": np.empty((t.size, 3))}
    for i in range(0, t.size, 20_000):
        mc = direct.moon_centre_apparent(t[i : i + 20_000], bodies=("sun", "earth"))
        for b in ("sun", "earth"):
            out[b][i : i + 20_000] = np.einsum("nij,nj->ni", mc["r_icrs_to_me"], mc[b])
    np.savez(path, **out)
    return out


# ------------------------------------------------------------------------------------------------
# Site geometry
# ------------------------------------------------------------------------------------------------


def site_vector_km(lat_deg: float, lon_deg: float, radius_m: float) -> np.ndarray:
    """Position of a point in MOON_ME (km) at selenographic lat/lon (deg) and radius (m)."""
    return unit_from_latlon(lat_deg, lon_deg) * (radius_m / 1000.0)


def topocentric(
    v_me: np.ndarray, lat_deg: float, lon_deg: float, eye_radius_m: float, body_radius_km: float
) -> dict:
    """Azimuth, elevation and angular radius of a body seen from a site.

    ``v_me``: (N,3) vectors Moon centre -> body in MOON_ME (km). The site's eye is at
    ``eye_radius_m`` from the Moon's centre. Returns ``az`` (deg, clockwise from north, 0..360),
    ``el`` (deg), ``rho`` (angular radius, deg), ``enu`` (N,3 unit vectors), ``dist_km``.
    Exact vector subtraction, so the parallax (0.26 deg for the Earth) is included.
    """
    east, north, up = enu_basis(lat_deg, lon_deg)
    v = v_me - site_vector_km(lat_deg, lon_deg, eye_radius_m)[None, :]
    d = np.linalg.norm(v, axis=1)
    u = v / d[:, None]
    enu = np.stack([u @ east, u @ north, u @ up], axis=1)
    az = np.mod(np.degrees(np.arctan2(enu[:, 0], enu[:, 1])), 360.0)
    el = np.degrees(np.arcsin(np.clip(enu[:, 2], -1.0, 1.0)))
    rho = np.degrees(np.arcsin(body_radius_km / d))
    return {"az": az, "el": el, "rho": rho, "enu": enu, "dist_km": d}


# ------------------------------------------------------------------------------------------------
# Straight-edge disk fractions (screening)
# ------------------------------------------------------------------------------------------------


def uniform_fraction_above(x: np.ndarray) -> np.ndarray:
    """Area fraction of a uniform disk above a straight edge.

    ``x`` = (elevation of the disk centre - edge elevation) / angular radius (dimensionless).
    Closed form: 1 - (acos x - x sqrt(1 - x^2)) / pi, clipped to 0 (x <= -1) and 1 (x >= 1).
    """
    x = np.clip(np.asarray(x, dtype=float), -1.0, 1.0)
    return 1.0 - (np.arccos(x) - x * np.sqrt(1.0 - x * x)) / np.pi


@lru_cache(maxsize=4)
def _ld_table(u: float = LIMB_DARKENING_U, n: int = 4001) -> tuple[np.ndarray, np.ndarray]:
    """Lookup table of the limb-darkened flux fraction above a straight edge (see below)."""
    y = np.linspace(-1.0, 1.0, n)  # chord position (solar radii), edge at y = -x
    z = np.linspace(-1.0, 1.0, 2001)
    r2 = y[:, None] ** 2 + z[None, :] ** 2
    inside = r2 <= 1.0
    mu = np.sqrt(np.clip(1.0 - r2, 0.0, 1.0))
    w = np.where(inside, 1.0 - u * (1.0 - mu), 0.0).sum(axis=1)  # flux of each chord strip
    cum = np.concatenate([[0.0], np.cumsum(0.5 * (w[1:] + w[:-1]))])
    frac_below = cum / cum[-1]  # flux share with chord coordinate < y
    x = -y[::-1]
    return x, 1.0 - frac_below[::-1]


def ld_fraction_above(x: np.ndarray, u: float = LIMB_DARKENING_U) -> np.ndarray:
    """Limb-darkened flux fraction of the solar disk above a straight edge.

    ``x`` as in :func:`uniform_fraction_above`. Linear law I(mu) = 1 - u (1 - mu); numerical
    integration over chords (4001 x 2001 grid), interpolated. u = 0 reproduces the uniform case.
    """
    xt, ft = _ld_table(u)
    return np.interp(np.asarray(x, dtype=float), xt, ft, left=0.0, right=1.0)


def horizon_at(el_h: np.ndarray, az_step: float, az_deg: np.ndarray) -> np.ndarray:
    """Horizon elevation (deg) at azimuths ``az_deg`` by periodic linear interpolation."""
    n = el_h.size
    x = np.mod(az_deg, 360.0) / az_step
    k0 = np.floor(x).astype(np.int64)
    f = x - k0
    return el_h[k0 % n] * (1.0 - f) + el_h[(k0 + 1) % n] * f


# ------------------------------------------------------------------------------------------------
# Time-series metrics
# ------------------------------------------------------------------------------------------------


def longest_run(mask: np.ndarray) -> int:
    """Length (samples) of the longest run of consecutive True values in a 1-D boolean array."""
    m = np.concatenate([[False], np.asarray(mask, dtype=bool), [False]])
    d = np.diff(m.astype(np.int8))
    starts = np.flatnonzero(d == 1)
    ends = np.flatnonzero(d == -1)
    return int((ends - starts).max()) if starts.size else 0


def series_metrics(sun_flux, sun_disk, earth_vis, step_h: float) -> dict:
    """Summary metrics (see module docstring) from per-sample fractions (0..1)."""
    sun_flux = np.asarray(sun_flux)
    earth_vis = np.asarray(earth_vis)
    lit = sun_flux > 0.0
    eon = earth_vis > 0.0
    return {
        "sun_pct": 100.0 * float(sun_flux.mean()),
        "sun_lit_pct": 100.0 * float(lit.mean()),
        "sun_disk_pct": 100.0 * float(np.mean(sun_disk)),
        "dark_max_d": longest_run(~lit) * step_h / 24.0,
        "earth_pct": 100.0 * float(earth_vis.mean()),
        "earth_any_pct": 100.0 * float(eon.mean()),
        "blackout_max_d": longest_run(~eon) * step_h / 24.0,
        "both_pct": 100.0 * float((lit & eon).mean()),
        "both_min_pct": 100.0 * float(np.minimum(sun_flux, earth_vis).mean()),
    }


def screening_series(el_h, az_step, lat, lon, eye_radius_m, eph) -> dict:
    """Straight-edge Sun flux, Sun disk and Earth disk fractions over the ephemeris samples."""
    s = topocentric(eph["sun"], lat, lon, eye_radius_m, SUN_RADIUS_KM)
    e = topocentric(eph["earth"], lat, lon, eye_radius_m, EARTH_RADIUS_KM)
    xs = (s["el"] - horizon_at(el_h, az_step, s["az"])) / s["rho"]
    xe = (e["el"] - horizon_at(el_h, az_step, e["az"])) / e["rho"]
    return {
        "sun_flux": ld_fraction_above(xs),
        "sun_disk": uniform_fraction_above(xs),
        "earth_vis": uniform_fraction_above(xe),
    }


# ------------------------------------------------------------------------------------------------
# Screening horizons: LOLA 240 m pyramid
# ------------------------------------------------------------------------------------------------


class PolarPyramid:
    """LDEM_75S_240M at 240 m and mean-pooled 480 / 960 / 1920 m, LDEM_16 outside.

    ``sample(u, s)`` returns heights (m) at unit vectors ``u`` (..., 3) in MOON_ME, choosing the
    level by the ground distance ``s`` from the site (m): 240 m to 30 km, 480 m to 60 km, 960 m to
    120 km, 1920 m beyond. Pooled pixel i covers full-resolution pixels i*f .. i*f + f - 1.
    """

    BANDS_M = (30_000.0, 60_000.0, 120_000.0, np.inf)

    def __init__(self, data: np.ndarray | None = None, spec=None, far=None):
        """Load LDEM_75S_240M and LDEM_16, or use a given polar-stereographic ``data``/``spec``
        (heights in m) with an optional far-field Window ``far`` (tests use synthetic terrain)."""
        if data is None:
            w = _whole_window(polar_source("75", "s", "240m"), -89.0)
            spec, data = w.spec, w.data
            far = _whole_window(global_source(16), -89.0)
        self.spec = spec
        self.far = far
        self.levels = []
        a = np.asarray(data, dtype=np.float32)
        for f in (1, 2, 4, 8):
            n = (a.shape[0] // f) * f
            lv = a[:n, :n].reshape(n // f, f, n // f, f).mean(axis=(1, 3)) if f > 1 else a
            self.levels.append((f, np.ascontiguousarray(lv)))
        self.cells_m = [self.spec.scale_m * f for f, _ in self.levels]
        # highest terrain the rays can meet: the polar file and LDEM_16 south of 60 S
        self.max_h_m = float(np.nanmax(a))
        if far is not None:
            f16 = far.data
            lat16 = 90.0 - (np.arange(f16.shape[0]) + 0.5) / far.spec.res_ppd
            self.max_h_m = max(self.max_h_m, float(np.nanmax(f16[lat16 < -60.0])))

    def height_at_rowcol(self, row: np.ndarray, col: np.ndarray, level: int = 0) -> np.ndarray:
        f, a = self.levels[level]
        return bilinear(a, (row - (f - 1) / 2.0) / f, (col - (f - 1) / 2.0) / f)

    def sample(self, u: np.ndarray, s_m: np.ndarray) -> np.ndarray:
        row, col = grid_rowcol(self.spec, u)
        s_m = np.broadcast_to(s_m, row.shape)
        h = np.full(row.shape, np.nan)
        lo = 0.0
        for k, hi in enumerate(self.BANDS_M):
            sel = (s_m >= lo) & (s_m < hi) if k else (s_m < hi)
            if sel.any():
                h[sel] = self.height_at_rowcol(row[sel], col[sel], k)
            lo = hi
        bad = np.isnan(h)
        if bad.any() and self.far is not None:
            h[bad] = self.far.sample(u[bad])
        return h

    def ground(self, lat: float, lon: float) -> float:
        """Bilinear 240 m height (m) at a point."""
        row, col = grid_rowcol(self.spec, unit_from_latlon(lat, lon)[None, :])
        return float(self.height_at_rowcol(row, col, 0)[0])

    def horizon(self, lat: float, lon: float, h_obs: float, az_step: float = 1.0):
        """Screening horizon: (ground height m, el_deg array) with C3 geometry."""
        h0 = self.ground(lat, lon)
        rho_max = R_MOON_M + self.max_h_m + 300.0
        sched = ray_schedule(self.cells_m, list(self.BANDS_M), 0.25 * R_MOON_M)
        res = horizon_from_sampler(
            self.sample, lat, lon, h0, h_obs, az_step, sched, rho_max, require_termination=False
        )
        return h0, res["el_deg"]


# ------------------------------------------------------------------------------------------------
# Refinement horizons: LOLA 20 m near field
# ------------------------------------------------------------------------------------------------


def refined_layers(lat: float, lon: float, near_m: float = NEAR_M) -> tuple[LayeredDEM, float]:
    """LayeredDEM with the cached LOLA 20 m blocks near the site (no download), 240 m, LDEM_16.

    Returns the layers and the share of the 20 m window that is not cached (NaN), where the
    240 m layer is used instead.
    """
    src = polar_source("80", "s", "20m")
    from moonat.terrain.pds import ps_cell_m

    near = window_around(
        src,
        lat,
        lon,
        near_m,
        ps_cell_m(src.spec, lat),
        _polar_citation(src.spec.name),
        download=False,
    )
    mid = _whole_window(polar_source("75", "s", "240m"), lat)
    far = _whole_window(global_source(16), lat)
    layers = [Layer(near, near_m), Layer(mid, MID_M), Layer(far, np.inf)]
    return LayeredDEM(lat, lon, layers), float(np.isnan(near.data).mean())


def refined_horizon(lat: float, lon: float, h_obs: float, az_step: float = 0.25, dem=None):
    """C3 horizon (``moonat.terrain.horizon_profile``) with :func:`refined_layers`."""
    if dem is None:
        dem, _ = refined_layers(lat, lon)
    return horizon_profile(lat, lon, observer_height_m=h_obs, az_step_deg=az_step, dem=dem)


# ------------------------------------------------------------------------------------------------
# Exact (C6) visibility series for one site
# ------------------------------------------------------------------------------------------------


def _rolling(el_h: np.ndarray, half: int, fn) -> np.ndarray:
    """Circular rolling max/min of the horizon samples over +-half samples."""
    stack = np.stack([np.roll(el_h, k) for k in range(-half, half + 1)])
    return fn(stack, axis=0)


def exact_series(hz: dict, eph: dict, n_points: int = 400) -> dict:
    """C6 visible fractions for one site over the ephemeris samples.

    ``hz``: C3 horizon dict (lat_deg, lon_deg, ground_elev_m, observer_height_m, az_step_deg,
    el_deg). Returns per-sample arrays ``sun_flux`` (flux_frac: limb-darkened, terrain + Earth),
    ``sun_disk`` (vis_frac of the Sun, terrain only), ``earth_vis`` (vis_frac of the Earth),
    ``eclipse`` (share of the Sun's flux behind the Earth), and the Sun/Earth elevations.

    Equivalent to ``moonat.eclipse.site_sun_state`` + ``moonat.visibility.disk_fractions`` per
    sample: the reference's own fast paths (disk entirely above the highest / below the lowest
    horizon sample in its azimuth span) are evaluated vectorised with a wider, conservative
    azimuth window; every other sample, and every sample with a possible eclipse, calls the
    reference functions.
    """
    lat, lon = hz["lat_deg"], hz["lon_deg"]
    r_eye = R_MOON_M + hz["ground_elev_m"] + hz["observer_height_m"]
    step = float(hz["az_step_deg"])
    el_h = np.asarray(hz["el_deg"], dtype=float)
    s = topocentric(eph["sun"], lat, lon, r_eye, SUN_RADIUS_KM)
    e = topocentric(eph["earth"], lat, lon, r_eye, EARTH_RADIUS_KM)
    out = {}
    for name, b in (("sun", s), ("earth", e)):
        rho = b["rho"]
        cos_el = np.cos(np.radians(b["el"]))
        daz = np.degrees(np.arcsin(np.clip(np.sin(np.radians(rho)) / cos_el, 0, 1)))
        half = int(math.ceil(float(daz.max()) / step)) + 2
        k = np.floor(np.mod(b["az"], 360.0) / step).astype(np.int64) % el_h.size
        hmax = _rolling(el_h, half, np.max)[k]
        hmin = _rolling(el_h, half, np.min)[k]
        ramp = 0.5 * rho * math.sqrt(math.pi / n_points) + 1e-9
        one = (b["el"] - rho - ramp > hmax) & (b["el"] + rho < 89.0)
        zero = b["el"] + rho + ramp < hmin
        vis = np.where(one, 1.0, 0.0)
        flux = vis.copy()
        amb = np.flatnonzero(~(one | zero))
        for i in amb:
            v, f, _ = disk_fractions(
                float(b["az"][i]),
                float(b["el"][i]),
                float(rho[i]),
                hz,
                LIMB_DARKENING_U if name == "sun" else None,
                None,
                n_points,
            )
            vis[i], flux[i] = v, f
        out[name] = (vis, flux)
    sun_vis, sun_flux = out["sun"]
    earth_vis = out["earth"][0]
    # The Earth in front of the Sun (a lunar eclipse seen from Earth).
    cos_sep = np.sum(s["enu"] * e["enu"], axis=1)
    near = np.flatnonzero(cos_sep > np.cos(np.radians(s["rho"] + e["rho"])))
    eclipse = np.zeros_like(sun_flux)
    for i in near:
        rs, re = float(s["rho"][i]), float(e["rho"][i])
        f_ecl = ecl.sun_eclipse_frac(s["enu"][i], rs, e["enu"][i], re)
        if f_ecl <= 0.0:
            continue
        v, f, lit = disk_fractions(
            float(s["az"][i]),
            float(s["el"][i]),
            rs,
            hz,
            LIMB_DARKENING_U,
            (e["enu"][i], re),
            n_points,
        )
        eclipse[i] = f_ecl
        sun_flux[i] = ecl.combined_flux_frac(v, f, lit, f_ecl)
    return {
        "sun_flux": sun_flux,
        "sun_disk": sun_vis,
        "earth_vis": earth_vis,
        "eclipse": eclipse,
        "sun_el": s["el"],
        "earth_el": e["el"],
    }


# ------------------------------------------------------------------------------------------------
# Terrain: slope and polar-stereographic helpers
# ------------------------------------------------------------------------------------------------


def ps_xy_km(lat, lon) -> tuple[np.ndarray, np.ndarray]:
    """South polar stereographic map coordinates (km): x toward 90 E, y toward lon 0 (Earth).

    x = 2R tan(psi/2) sin(lon), y = 2R tan(psi/2) cos(lon), psi = colatitude from the south pole.
    """
    psi = np.radians(90.0 + np.asarray(lat, dtype=float))
    r = 2.0 * R_KM * np.tan(psi / 2.0)
    lo = np.radians(lon)
    return r * np.sin(lo), r * np.cos(lo)


def ps_latlon(x_km, y_km) -> tuple[np.ndarray, np.ndarray]:
    """Inverse of :func:`ps_xy_km`: (lat, lon) in deg, lon in -180..180."""
    x = np.asarray(x_km, dtype=float)
    y = np.asarray(y_km, dtype=float)
    r = np.hypot(x, y)
    psi = 2.0 * np.arctan(r / (2.0 * R_KM))
    return np.degrees(psi) - 90.0, np.degrees(np.arctan2(x, y))


def great_circle_m(lat1, lon1, lat2, lon2) -> np.ndarray:
    """Ground distance (m) on the 1737.4 km sphere between points (deg)."""
    u1 = unit_from_latlon(lat1, lon1)
    u2 = unit_from_latlon(lat2, lon2)
    c = np.clip(np.sum(u1 * u2, axis=-1), -1.0, 1.0)
    s = np.linalg.norm(np.cross(u1, u2), axis=-1)
    return np.arctan2(s, c) * R_MOON_M


def plane_slope_deg(z: np.ndarray, cell_m: float) -> tuple[float, float, float]:
    """Tilt of the best-fit plane through a height grid, and the roughness about it.

    ``z``: (n, m) heights (m) on a square grid of spacing ``cell_m`` (m). Returns
    (plane tilt in deg, mean per-cell slope in deg from central differences, RMS residual in m).
    The per-cell slope uses the interior cells only.
    """
    n, m = z.shape
    yy, xx = np.mgrid[0:n, 0:m] * cell_m
    a = np.column_stack([xx.ravel(), yy.ravel(), np.ones(z.size)])
    coef, *_ = np.linalg.lstsq(a, z.ravel(), rcond=None)
    tilt = math.degrees(math.atan(math.hypot(coef[0], coef[1])))
    resid = z.ravel() - a @ coef
    gy, gx = np.gradient(z, cell_m)
    g = np.degrees(np.arctan(np.hypot(gx, gy)))[1:-1, 1:-1]
    return tilt, float(g.mean()), float(np.sqrt(np.mean(resid**2)))


def local_slope(lat: float, lon: float, box_m: float = 100.0) -> dict:
    """Slope of the LOLA 20 m DEM in a box of side ``box_m`` centred on a point.

    Uses the 20 m pixels whose centres lie within +-box_m/2 of the point along the map axes
    (5 x 5 pixels for 100 m), from cached blocks only. Returns plane tilt, mean per-pixel slope
    (deg), RMS roughness (m) and the number of pixels.
    """
    src = polar_source("80", "s", "20m")
    spec = src.spec
    row, col = grid_rowcol(spec, unit_from_latlon(lat, lon)[None, :])
    r, c = int(round(float(row[0]))), int(round(float(col[0])))
    h = int(round(box_m / 2.0 / spec.scale_m))
    pad = 1
    z = src.read(r - h - pad, r + h + pad + 1, c - h - pad, c + h + pad + 1, download=False)
    if np.isnan(z).any():
        return {"tilt_deg": None, "mean_slope_deg": None, "rms_m": None, "n_px": 0}
    tilt, _, rms = plane_slope_deg(z[pad:-pad, pad:-pad], spec.scale_m)
    gy, gx = np.gradient(z, spec.scale_m)
    g = np.degrees(np.arctan(np.hypot(gx, gy)))[pad:-pad, pad:-pad]
    return {
        "tilt_deg": round(tilt, 2),
        "mean_slope_deg": round(float(g.mean()), 2),
        "max_slope_deg": round(float(g.max()), 2),
        "rms_m": round(rms, 2),
        "n_px": int((2 * h + 1) ** 2),
    }
