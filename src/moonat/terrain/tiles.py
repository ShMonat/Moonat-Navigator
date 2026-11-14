# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""DEM tile pyramid for the browser (contract C5 ``dem-tiles``): writer and Python reference reader.

Two levels (heights in metres above the 1737.4 km sphere, int16 little-endian, row-major):
- ``global8``: simple cylindrical, 8 px/deg (~3.8 km), from LOLA LDEM_16 (2 x 2 block mean).
  Pixel (r, c) centre: lat = 90 - (r + 0.5)/8, lon_east = (c + 0.5)/8 (0..360).
- ``south480``: south polar stereographic, 480 m/px at the pole, from LOLA LDEM_75S_240M
  (2 x 2 block mean), covering about 80-90 deg S. With s = -1 (south),
  k = 2R / (1 + s uz), x = k uy, y_up = -s k ux, row = row0 - y_up/scale, col = col0 + x/scale.

The browser computes a horizon for any clicked site with the same ray marching as
``moonat.terrain.horizon`` using these tiles as the only (coarse) layer: the near field (first
few km) is missing, so tile horizons are a far-field approximation.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .dem import Layer, LayeredDEM, Window, _whole_window, global_source, polar_source
from .horizon import GENERATED_BY
from .pds import R_MOON_M, RasterSpec, cyl_cell_m, ps_cell_m

NODATA = -32768
GLOBAL_TILE = 240  # 30 x 30 deg tiles
POLAR_TILE = 260
POLAR_HALF_PX_240 = 1300  # crop of LDEM_75S_240M: +-1300 px = +-312 km around the pole


def _block_mean(a: np.ndarray, f: int) -> np.ndarray:
    nr, nc = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    return a[:nr, :nc].reshape(nr // f, f, nc // f, f).mean(axis=(1, 3))


def _write_tiles(arr: np.ndarray, tile: int, out: Path) -> list[list[int]]:
    out.mkdir(parents=True, exist_ok=True)
    q = np.where(np.isfinite(arr), np.round(arr), NODATA).astype("<i2")
    nt_r, nt_c = int(np.ceil(arr.shape[0] / tile)), int(np.ceil(arr.shape[1] / tile))
    for tr in range(nt_r):
        for tc in range(nt_c):
            blk = np.full((tile, tile), NODATA, dtype="<i2")
            sub = q[tr * tile : (tr + 1) * tile, tc * tile : (tc + 1) * tile]
            blk[: sub.shape[0], : sub.shape[1]] = sub
            (out / f"r{tr}_c{tc}.bin").write_bytes(blk.tobytes())
    return [nt_r, nt_c]


def build_tiles(out_dir: Path) -> dict:
    """Write ``out_dir/manifest.json`` and the tile files. Returns the manifest."""
    levels = []
    # ---- global8 ----
    g = global_source(16)
    gw = _whole_window(g, 0.0)
    g8 = _block_mean(gw.data, 2)
    nt = _write_tiles(g8, GLOBAL_TILE, out_dir / "global8")
    levels.append(
        {
            "id": "global8",
            "projection": "simple_cylindrical",
            "res_ppd": 8,
            "lat_top_deg": 90.0,
            "lon_left_deg": 0.0,
            "lines": g8.shape[0],
            "samples": g8.shape[1],
            "periodic_lon": True,
            "pixel_centre": "lat = lat_top - (row + 0.5)/res_ppd; "
            "lon_east = lon_left + (col + 0.5)/res_ppd",
            "tile_size": GLOBAL_TILE,
            "tiles": nt,
            "url": "global8/r{tr}_c{tc}.bin",
            "cell_m": round(np.pi * R_MOON_M / 180 / 8, 1),
            "source": "LOLA LDEM_16 (NASA PDS), 2 x 2 block mean",
        }
    )
    # ---- south480 ----
    p = polar_source("75", "s", "240m")
    pw = _whole_window(p, -89.0)
    c = int(round(p.spec.row0 + 0.5))  # 1906: first pixel of the lower-right quadrant
    h = POLAR_HALF_PX_240
    crop = pw.data[c - h : c + h, c - h : c + h]
    p480 = _block_mean(crop, 2)
    n = p480.shape[0]
    nt = _write_tiles(p480, POLAR_TILE, out_dir / "south480")
    levels.append(
        {
            "id": "south480",
            "projection": "polar_stereographic",
            "pole": -1,
            "scale_m": 480.0,
            "row0": (n - 1) / 2,
            "col0": (n - 1) / 2,
            "lines": n,
            "samples": n,
            "equations": "s = pole; k = 2R/(1 + s*uz); x = k*uy; y_up = -s*k*ux; "
            "row = row0 - y_up/scale_m; col = col0 + x/scale_m "
            "(u = unit vector in MOON_ME, R = 1737400 m)",
            "tile_size": POLAR_TILE,
            "tiles": nt,
            "url": "south480/r{tr}_c{tc}.bin",
            "cell_m": 480.0,
            "use_where": "lat_deg <= -80 (fall back to global8 outside the grid)",
            "source": "LOLA LDEM_75S_240M (NASA PDS), 2 x 2 block mean of the central "
            "2600 x 2600 px",
        }
    )
    manifest = {
        "_generated_by": GENERATED_BY,
        "format": "moonat-dem-tiles/1",
        "frame": "MOON_ME_DE421",
        "reference_radius_m": R_MOON_M,
        "dtype": "int16",
        "byte_order": "little",
        "value": "height_m above the reference sphere (1 unit = 1 m)",
        "nodata": NODATA,
        "layout": "each tile is tile_size x tile_size values, row-major, row 0 = top (north for "
        "cylindrical, lon 0 side for south polar); tile (tr, tc) holds rows tr*tile_size.. "
        "and cols tc*tile_size..; edge tiles are padded with nodata",
        "levels": levels,
        "algorithm": "moonat.terrain.horizon (docs/validation/terrain.md); use the finest level "
        "that covers each ray sample, step = level cell size, bilinear interpolation",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return manifest


def tiles_dem(lat_deg: float, lon_deg: float, base: Path) -> LayeredDEM:
    """Python reference reader: a LayeredDEM built only from the C5 tiles (whole levels)."""
    man = json.loads((base / "manifest.json").read_text(encoding="utf-8"))
    layers = []
    for lv in sorted(man["levels"], key=lambda v: v["cell_m"]):
        ts = lv["tile_size"]
        ntr, ntc = lv["tiles"]
        full = np.empty((ntr * ts, ntc * ts), dtype=np.float32)
        for tr in range(ntr):
            for tc in range(ntc):
                b = np.frombuffer((base / lv["url"].format(tr=tr, tc=tc)).read_bytes(), "<i2")
                full[tr * ts : (tr + 1) * ts, tc * ts : (tc + 1) * ts] = b.reshape(ts, ts)
        full[full == man["nodata"]] = np.nan
        full = full[: lv["lines"], : lv["samples"]]
        if lv["projection"] == "simple_cylindrical":
            spec = RasterSpec(
                name=lv["id"],
                url="",
                lines=lv["lines"],
                samples=lv["samples"],
                record_bytes=0,
                dtype="<i2",
                to_metres=1.0,
                projection="cyl",
                res_ppd=float(lv["res_ppd"]),
                lat_top=lv["lat_top_deg"],
                lon_left=lv["lon_left_deg"],
            )
            w = Window(
                spec, full, 0, 0, cyl_cell_m(spec), lv["source"], periodic_cols=lv["samples"]
            )
            layers.append(Layer(w, np.inf))
        else:
            spec = RasterSpec(
                name=lv["id"],
                url="",
                lines=lv["lines"],
                samples=lv["samples"],
                record_bytes=0,
                dtype="<i2",
                to_metres=1.0,
                projection="ps",
                pole=lv["pole"],
                scale_m=lv["scale_m"],
                row0=lv["row0"],
                col0=lv["col0"],
            )
            w = Window(spec, full, 0, 0, ps_cell_m(spec, lat_deg), lv["source"])
            layers.append(Layer(w, 450_000.0))
    if abs(lat_deg) < 78.0:  # the polar level only helps near the pole
        layers = [ly for ly in layers if ly.window.spec.projection == "cyl"]
    return LayeredDEM(lat_deg, lon_deg, layers)
