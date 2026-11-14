# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Measure what shipping more DEM data on GitHub Pages would cost (docs/research/terrain-everywhere.md).

Uses only rasters already in the shared raw-DEM cache (no downloads). Every sample is quantised to
int16 metres (as the C5 tiles), cut into 256 x 256 tiles and compressed with gzip -9 (what a browser
can inflate natively with DecompressionStream). Two encodings are measured:
- ``raw``: int16 little-endian;
- ``dz``: horizontal delta (each value minus its left neighbour) + zigzag, as uint16.
The measured bytes per pixel are then scaled to the full product extent.

Run: ``uv run python scripts/data/measure_dem_ship_sizes.py``
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np

from moonat.terrain.dem import _whole_window, global_source, polar_source
from moonat.terrain.fetch import dem_dir

TILE = 256


def _block_mean(a: np.ndarray, f: int) -> np.ndarray:
    nr, nc = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    return a[:nr, :nc].reshape(nr // f, f, nc // f, f).mean(axis=(1, 3))


def _dz(q: np.ndarray) -> np.ndarray:
    d = np.diff(q.astype(np.int32), axis=1, prepend=0)
    return ((d << 1) ^ (d >> 31)).astype("<u2")


def tile_bytes(a: np.ndarray) -> dict:
    """gzip -9 bytes of ``a`` (metres) cut into 256^2 int16 tiles, for both encodings."""
    q = np.round(np.nan_to_num(a, nan=0.0)).astype("<i2")
    out = {"px": int(q.size), "raw": 0, "dz": 0}
    for r in range(0, q.shape[0], TILE):
        for c in range(0, q.shape[1], TILE):
            t = q[r : r + TILE, c : c + TILE]
            out["raw"] += len(gzip.compress(t.tobytes(), 9))
            out["dz"] += len(gzip.compress(_dz(t).tobytes(), 9))
    return out


def blocks(product: str, scale_m: float, limit: int = 400) -> list[np.ndarray]:
    """Cached 256^2 window blocks of a product, converted to metres."""
    files = sorted((dem_dir() / product).glob("b256_*.npy"))[:limit]
    out = []
    for f in files:
        b = np.load(f).astype(np.float64)
        out.append(b * scale_m)
    return out


def mosaic_rate(arrs: list[np.ndarray], factor: int = 1) -> dict:
    tot = {"px": 0, "raw": 0, "dz": 0}
    for a in arrs:
        b = _block_mean(a, factor) if factor > 1 else a
        r = tile_bytes(b)
        for k in tot:
            tot[k] += r[k]
    return tot


def report(name: str, rate: dict, full_px: float, note: str) -> dict:
    bpp_raw, bpp_dz = rate["raw"] / rate["px"], rate["dz"] / rate["px"]
    row = {
        "product": name,
        "full_px_M": round(full_px / 1e6, 1),
        "uncompressed_MB": round(full_px * 2 / 1e6, 1),
        "gzip_bytes_per_px": round(bpp_raw, 3),
        "delta_zigzag_gzip_bytes_per_px": round(bpp_dz, 3),
        "shipped_MB_gzip": round(full_px * bpp_raw / 1e6, 1),
        "shipped_MB_delta_zigzag_gzip": round(full_px * bpp_dz / 1e6, 1),
        "measured_on_px_M": round(rate["px"] / 1e6, 2),
        "note": note,
    }
    print(json.dumps(row))
    return row


def main() -> None:
    rows = []
    # LDEM_16 (whole file in the cache): global, 1.9 km.
    g16 = _whole_window(global_source(16), 0.0).data
    rows.append(report("LDEM_16 global (~1.9 km)", tile_bytes(g16), g16.size, "whole product"))
    g8 = _block_mean(g16, 2)
    rows.append(report("global8 (current C5, ~3.8 km)", tile_bytes(g8), g8.size, "whole product"))
    # LDEM_64 (474 m): cached blocks only; raw DN are 0.5 m.
    b64 = blocks("ldem_64", 0.5)
    rows.append(
        report(
            "LDEM_64 global (~474 m)", mosaic_rate(b64), 23040 * 11520, f"{len(b64)} cached blocks"
        )
    )
    # LDEM_128 (~237 m): estimated from SLDEM2015 (59 m, km floats) block-averaged 4x.
    sl = []
    for d in sorted(dem_dir().glob("sldem2015_512_*")):
        sl += [np.load(f).astype(np.float64) * 1000.0 for f in sorted(d.glob("b256_*.npy"))[:40]]
    rows.append(
        report(
            "LDEM_128 global (~237 m), est.",
            mosaic_rate(sl, 4),
            46080 * 23040,
            "SLDEM2015 blocks, 4x block mean",
        )
    )
    rows.append(
        report(
            "118 m global (256 ppd), est.",
            mosaic_rate(sl, 2),
            92160 * 46080,
            "SLDEM2015 blocks, 2x block mean",
        )
    )
    # Polar caps beyond 80 deg: stereographic square of side 2 * 2R tan(5 deg) ~ 608 km.
    side_m = 2 * 2 * 1737400.0 * np.tan(np.radians(5.0))
    b20 = blocks("ldem_80s_20m", 0.5)
    for res, f in ((60, 3), (120, 6)):
        n = (side_m / res) ** 2
        rows.append(
            report(
                f"South polar {res} m beyond 80S",
                mosaic_rate(b20, f),
                n,
                f"LDEM_80S_20M blocks, {f}x block mean",
            )
        )
    p240 = _whole_window(polar_source("75", "s", "240m"), -89.0).data
    rows.append(report("LDEM_75S_240M whole (240 m)", tile_bytes(p240), p240.size, "whole product"))
    out = Path("outputs/dem_ship_sizes.json")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(rows, indent=1), encoding="utf-8")
    print("wrote", out)


if __name__ == "__main__":
    main()
