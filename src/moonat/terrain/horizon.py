# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Terrain horizon profile of a lunar site (contract C3 ``horizon-profile``).

Method (exact geometry on a spherical Moon with a height field):
- Frame: MOON_ME. Site ground point G = (R + h0) up, eye E = (R + h0 + h_obs) up, with
  R = 1737.4 km, h0 = DEM height at the site, up = unit vector from the Moon's centre to the site.
- For true azimuth A (clockwise from north), the ray is the great circle leaving the site with
  tangent d = cos A north + sin A east. The point at central angle theta is
  u(theta) = cos(theta) up + sin(theta) d; the terrain point is P = (R + h(u)) u.
- Elevation of P seen from the eye: the components of P - E along up and d are
  rho cos(theta) - r_E and rho sin(theta) (rho = R + h, r_E = |E|), so
  el = atan2(rho cos(theta) - r_E, rho sin(theta)), identical to asin(((P - E).up) / |P - E|).
  Lunar curvature is therefore included exactly; there is no refraction on the Moon.
- The horizon is the maximum el along the ray; ``dist_km`` is the ground arc R * theta of the
  point that sets it.
- Sampling: the step along the ray equals the pixel size of the DEM layer in use (fine near the
  site, coarser far away), so no DEM cell is skipped along the ray.
- Termination (rigorous): with rho <= rho_max (the highest loaded terrain plus a margin),
  a point at central angle theta can exceed the running maximum el* only if
  rho_max cos(theta + el*) > r_E cos(el*). Each ray stops once
  theta > acos(r_E cos(el*) / rho_max) - el*; beyond that no terrain can rise above its horizon.
"""

from __future__ import annotations

import numpy as np

from .dem import LayeredDEM, build_layers
from .pds import R_MOON_M, enu_basis, unit_from_latlon

GENERATED_BY = (
    "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."
)
HEIGHT_MARGIN_M = 300.0  # added to the max loaded DEM height for the termination bound
CHUNK = 256  # ray samples processed per vectorised step
REGION_RAD = 0.25  # central angle (~434 km) over which the max terrain height is taken


def stop_angle(r_eye: float, el_star: np.ndarray, rho_max: float) -> np.ndarray:
    """Central angle (rad) beyond which no terrain of radius <= rho_max can exceed elevation el*.

    Units: radii in metres, angles in radians. Derivation: the point (rho, theta) is above el*
    iff rho cos(theta + el*) > r_E cos(el*), using tan(el) = (rho cos theta - r_E)/(rho sin theta).
    """
    c = np.clip(r_eye * np.cos(el_star) / rho_max, -1.0, 1.0)
    return np.arccos(c) - el_star


def ray_schedule(
    layers_cell_m: list[float], layers_smax_m: list[float], s_cap_m: float
) -> np.ndarray:
    """Ground distances (m) of the samples along a ray: steps of one pixel of the active layer."""
    out = []
    s = 0.0
    for cell, smax in zip(layers_cell_m, layers_smax_m, strict=True):
        end = min(smax, s_cap_m)
        if end <= s:
            continue
        n = int(np.ceil((end - s) / cell))
        out.append(s + cell * np.arange(1, n + 1))
        s = out[-1][-1]
        if s >= s_cap_m:
            break
    return np.concatenate(out)


def horizon_from_sampler(
    sample_fn,
    lat_deg: float,
    lon_deg: float,
    ground_elev_m: float,
    observer_height_m: float,
    az_step_deg: float,
    s_samples_m: np.ndarray,
    rho_max_m: float,
    require_termination: bool = True,
) -> dict:
    """Core ray-marching loop, independent of the DEM source (used by tests with synthetic terrain).

    ``sample_fn(u (...,3), s_m (...)) -> heights (m)``. Returns arrays el_deg, dist_km and the
    distance actually needed (max over rays of the termination distance, km).
    """
    east, north, up = enu_basis(lat_deg, lon_deg)
    r_eye = R_MOON_M + ground_elev_m + observer_height_m
    az = np.radians(np.arange(0.0, 360.0, az_step_deg))
    d = np.cos(az)[:, None] * north + np.sin(az)[:, None] * east  # (n_az, 3)
    n_az = len(az)
    el_best = np.full(n_az, -np.pi / 2)
    th_best = np.zeros(n_az)
    th_all = s_samples_m / R_MOON_M
    active = np.ones(n_az, dtype=bool)
    th_needed = np.zeros(n_az)
    for i0 in range(0, len(th_all), CHUNK):
        idx = np.flatnonzero(active)
        if idx.size == 0:
            break
        th = th_all[i0 : i0 + CHUNK]
        ct, st = np.cos(th), np.sin(th)
        u = ct[None, :, None] * up[None, None, :] + st[None, :, None] * d[idx, None, :]
        h = sample_fn(u, np.broadcast_to(s_samples_m[i0 : i0 + CHUNK], (idx.size, th.size)))
        rho = R_MOON_M + np.where(np.isnan(h), -np.inf, h)  # no data: cannot occlude
        with np.errstate(invalid="ignore"):
            el = np.arctan2(rho * ct[None, :] - r_eye, rho * st[None, :])
        el = np.where(np.isfinite(rho), el, -np.pi / 2)
        k = np.argmax(el, axis=1)
        e = el[np.arange(idx.size), k]
        better = e > el_best[idx]
        el_best[idx[better]] = e[better]
        th_best[idx[better]] = th[k[better]]
        th_stop = stop_angle(r_eye, el_best[idx], rho_max_m)
        th_needed[idx] = th_stop
        done = th_stop <= th[-1]
        active[idx[done]] = False
    if require_termination and active.any():
        raise RuntimeError(
            f"{active.sum()} rays need more range than the sample schedule "
            f"({s_samples_m[-1] / 1e3:.0f} km)"
        )
    return {
        "el_deg": np.degrees(el_best),
        "dist_km": th_best * R_MOON_M / 1000.0,
        "range_needed_km": float(th_needed.max() * R_MOON_M / 1000.0),
    }


def horizon_profile(
    lat_deg: float,
    lon_deg: float,
    observer_height_m: float = 2.0,
    az_step_deg: float = 0.25,
    max_range_km: float | None = None,
    site_id: str | None = None,
    dem: LayeredDEM | None = None,
    min_dist_m: float = 0.0,
) -> dict:
    """Terrain horizon of a lunar site from LOLA DEMs (contract C3).

    Args:
        lat_deg, lon_deg: planetocentric latitude and east longitude (deg) in MOON_ME.
        observer_height_m: eye height above the DEM ground (m).
        az_step_deg: azimuth step (deg); azimuths are k * step, true azimuth from north.
        max_range_km: optional hard cap on the ray length; by default the range comes from the
            termination bound (see module docstring) and is reported as ``max_range_km``.
        site_id: value for the ``id`` key.
        dem: preloaded layers (otherwise they are built and downloaded as needed).
        min_dist_m: ignore terrain closer than this ground distance (m). 0 (default) is the C3
            definition; a few DEM cells shows how much the near-field DEM texture matters.

    Returns:
        dict with the C3 keys: id, lat_deg, lon_deg, ground_elev_m, observer_height_m, az_step_deg,
        el_deg (list), dist_km (list), max_range_km, dem_sources, _generated_by.
    """
    dem = dem or build_layers(lat_deg, lon_deg)
    up = unit_from_latlon(lat_deg, lon_deg)
    h0 = float(dem.sample(up[None, :])[0])
    rho_max = R_MOON_M + dem.max_height_m(REGION_RAD) + HEIGHT_MARGIN_M
    # Samples reach the edge of the region over which rho_max holds (0.25 rad); each ray stops
    # earlier by the exact bound. Rays that would need more raise an error (never silently cut).
    th_cap = REGION_RAD
    s_cap = th_cap * R_MOON_M if max_range_km is None else max_range_km * 1000.0
    cells = [ly.window.cell_m for ly in dem.layers]
    smax = [ly.s_max_m for ly in dem.layers]
    s_samples = ray_schedule(cells, smax, s_cap)

    def sample(u, s):
        h = dem.sample(u, s)
        return h if min_dist_m <= 0 else np.where(s >= min_dist_m, h, np.nan)

    res = horizon_from_sampler(
        sample, lat_deg, lon_deg, h0, observer_height_m, az_step_deg, s_samples, rho_max
    )
    return {
        "id": site_id,
        "lat_deg": lat_deg,
        "lon_deg": lon_deg,
        "ground_elev_m": round(h0, 2),
        "observer_height_m": observer_height_m,
        "az_step_deg": az_step_deg,
        "el_deg": [round(float(x), 4) for x in res["el_deg"]],
        "dist_km": [round(float(x), 3) for x in res["dist_km"]],
        "max_range_km": round(res["range_needed_km"], 1),
        "dem_sources": dem.sources,
        "_generated_by": GENERATED_BY,
    }
