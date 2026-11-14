# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Near-field 3-D terrain grid in site ENU (contract C4 ``terrain-patch``).

Grid cell (r, c) sits at ENU x = -h + c d (east), y = +h - r d (north). Its value is the ENU up
coordinate (m) of the terrain surface point whose ENU horizontal coordinates are exactly (x, y),
relative to the site's ground point G = (R + h0) up. It includes the drop of the curved surface.

For a horizontal offset of length s and bearing A from the site, the surface point is
P = rho(u) u with u = cos(theta) up + sin(theta) d(A); its horizontal offset is rho sin(theta), so
theta solves rho(u(theta)) sin(theta) = s (fixed-point iteration, 3 passes, converges to < 1 mm
for s <= 20 km). Then z_up = rho cos(theta) - (R + h0).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .dem import LayeredDEM, build_layers
from .horizon import GENERATED_BY
from .pds import R_MOON_M, enu_basis


def terrain_patch_grid(
    lat_deg: float,
    lon_deg: float,
    half_extent_m: float = 12_000.0,
    n: int = 385,
    dem: LayeredDEM | None = None,
) -> tuple[np.ndarray, dict]:
    """Compute the C4 grid. Returns (z_up float32 (n, n), metadata dict without id)."""
    dem = dem or build_layers(lat_deg, lon_deg)
    east, north, up = enu_basis(lat_deg, lon_deg)
    h0 = float(dem.sample(up[None, :])[0])
    d_m = 2.0 * half_extent_m / (n - 1)
    x = -half_extent_m + d_m * np.arange(n)
    y = half_extent_m - d_m * np.arange(n)
    X, Y = np.meshgrid(x, y)  # rows: north -> south, cols: west -> east
    s = np.hypot(X, Y)
    with np.errstate(invalid="ignore", divide="ignore"):
        dirn = (X[..., None] * east + Y[..., None] * north) / s[..., None]
    dirn[s == 0] = north
    rho = np.full(s.shape, R_MOON_M + h0)
    for _ in range(3):
        th = np.arcsin(np.clip(s / rho, -1, 1))
        u = np.cos(th)[..., None] * up + np.sin(th)[..., None] * dirn
        h = dem.sample(u.reshape(-1, 3), s.reshape(-1)).reshape(s.shape)
        rho = R_MOON_M + h
    th = np.arcsin(np.clip(s / rho, -1, 1))
    z = rho * np.cos(th) - (R_MOON_M + h0)
    meta = {
        "grid_n": n,
        "spacing_m": d_m,
        "half_extent_m": half_extent_m,
        "encoding": "float32 LE, row-major, row 0 = north edge, col 0 = west edge",
        "values": "z_up_m: ENU up-coordinate of the terrain surface relative to the GROUND point "
        "(includes curvature drop)",
        "albedo": None,
        "ground_elev_m": round(h0, 2),
        "z_min_m": round(float(np.nanmin(z)), 2),
        "z_max_m": round(float(np.nanmax(z)), 2),
        "dem_sources": [dem.layers[0].window.citation],
        "_generated_by": GENERATED_BY,
    }
    return z.astype(np.float32), meta


def write_terrain_patch(
    site_id: str,
    lat_deg: float,
    lon_deg: float,
    out_dir: Path,
    half_extent_m: float = 12_000.0,
    n: int = 385,
    dem: LayeredDEM | None = None,
) -> dict:
    """Write ``<out_dir>/<site_id>.json`` and ``.bin`` (C4). Returns the JSON dict."""
    z, meta = terrain_patch_grid(lat_deg, lon_deg, half_extent_m, n, dem)
    if np.isnan(z).any():
        raise RuntimeError(f"{site_id}: terrain patch has {np.isnan(z).sum()} NaN cells")
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = {"id": site_id, "lat_deg": lat_deg, "lon_deg": lon_deg, **meta}
    (out_dir / f"{site_id}.bin").write_bytes(z.astype("<f4").tobytes())
    (out_dir / f"{site_id}.json").write_text(json.dumps(doc, indent=1), encoding="utf-8")
    return doc


def terrain_patch(
    lat_deg: float, lon_deg: float, half_extent_m: float = 12_000.0, n: int = 385
) -> dict:
    """Python reference for C4: metadata plus ``z_up_m`` as a nested list (rows north->south)."""
    z, meta = terrain_patch_grid(lat_deg, lon_deg, half_extent_m, n)
    return {**meta, "z_up_m": z}
