# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Build the globe's LOLA base maps ("Elevation", "Plain") and contour lines (web/data/basemaps/).

Usage:
    uv run python scripts/data/build_base_maps.py            # build from the shared DEMs (no download)
    uv run python scripts/data/build_base_maps.py --preview  # also write outputs/base_maps_preview.png

Heights: NASA LRO LOLA gridded data records, already in ``data/raw/dem/`` (see build_terrain.py):
LDEM_16 (simple cylindrical, 16 px/deg, about 1.9 km/px) for the globe and the north cap, and
LDEM_75S_240M (south polar stereographic, 240 m/px) for the south caps. Heights are metres above the
1737.4 km reference sphere (DN x 0.5 m).

Outputs, in the globe's projections (web/data/moonmap/moonmap.json): an equirectangular image
(column 0 = longitude -180 E, row 0 = latitude +90) and polar caps in the polar stereographic cap
projection (``cap_projection``) with the same psi_max and fades as the imagery caps, so the globe swaps
textures and keeps every other uniform:

* ``elev_*.jpg``: hypsometric tint (matplotlib "viridis": perceptually uniform, colour-blind safe)
  from ELEV_RANGE_KM, times a LOLA hillshade.
* ``plain_*.jpg``: neutral grey with a light hillshade, so overlays stand out.
* ``contours_global.png`` (4096 x 2048) and ``contours_north.png``, ``contours_south.png``
  (2048 x 2048, poleward of 80 deg, psi_max CONTOUR_CAP_PSI): anti-aliased iso-height lines as a
  palette PNG; red = line coverage of a minor line, green = of an index line. Intervals: GLOBAL
  every 1 km (index every 5 km), CAPS every 250 m (index every 1 km).
* ``basemaps.json``: the manifest (files, projections, ramp, intervals, sources, bytes, AI note).

Line rasterisation: on the output grid, the distance (px) of a pixel centre to the nearest contour
level L is about |h - L| / |grad h| (h in m, grad in m per px; first-order Taylor). Coverage =
clip(0.5 w + 0.5 - d, 0, 1) for a line w px wide: a box filter of one pixel.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_moonmap as mm  # noqa: E402

AI_NOTE = mm.AI_NOTE
OUT = ROOT / "web" / "data" / "basemaps"
R_MOON_M = mm.R_MOON_M

ELEV_RANGE_KM = (-8.0, 8.0)  # ramp ends; heights beyond are clipped to the end colours
RAMP = "viridis"
RAMP_STOPS = 9  # colour stops written to the manifest (the legend bar)
GLOBAL_SIZE = (2048, 1024)  # elevation and plain base (W, H)
CONTOUR_GLOBAL_SIZE = (4096, 2048)
CONTOUR_CAP_PSI = (
    10.2  # deg: cap contour images reach 79.8 deg; the globe switches to them at 80 deg
)
CONTOUR_CAP_N = 2048
CONTOUR_SWITCH_LAT = 80.0
INTERVALS = {
    "global": {"interval_m": 1000.0, "index_every": 5},
    "caps": {"interval_m": 250.0, "index_every": 4},
}
LINE_PX = {"minor": 1.2, "index": 2.0}
SMOOTH_PX = {
    "global": 1.0,
    "caps": 1.5,
}  # Gaussian sigma (px) applied to the heights before contouring
Z_GLOBAL = 3.0  # hillshade vertical exaggeration on the 2048 x 1024 grid (5.3 km/px at the equator)
Z_CAP = 2.0
LEVELS = 2  # coverage levels per line class in the palette (0 = none)


# ------------------------------------------------------------------------------------------------
# Colour and shading
# ------------------------------------------------------------------------------------------------


def ramp_rgb(h_m: np.ndarray) -> np.ndarray:
    """Hypsometric colour (0..1 RGB, sRGB) of heights h (m above 1737.4 km): viridis over ELEV_RANGE_KM."""
    from matplotlib import colormaps

    lo, hi = ELEV_RANGE_KM
    t = np.clip((np.atleast_1d(np.asarray(h_m, dtype=float)) / 1000.0 - lo) / (hi - lo), 0.0, 1.0)
    rgb = np.asarray(colormaps[RAMP](t))[..., :3]
    return rgb.reshape(np.shape(h_m) + (3,))


def ramp_stops() -> list[dict]:
    """The legend's colour stops: height (km) and hex colour, RAMP_STOPS evenly spaced over the range."""
    lo, hi = ELEV_RANGE_KM
    out = []
    for km in np.linspace(lo, hi, RAMP_STOPS):
        r, g, b = (np.round(ramp_rgb(np.array(km * 1000.0)) * 255)).astype(int)
        out.append({"km": round(float(km), 3), "hex": f"#{r:02x}{g:02x}{b:02x}"})
    return out


def relief(hs: np.ndarray) -> np.ndarray:
    """Hillshade (0..1, mm.hillshade) relative to flat ground: 1 on the flat, < 1 facing away from the light."""
    flat = mm.AMBIENT + (1 - mm.AMBIENT) * np.sin(np.radians(mm.LIGHT_ALT_DEG))
    return np.clip(hs / flat, 0.3, 1.35)


def elevation_rgb(h: np.ndarray, hs: np.ndarray) -> np.ndarray:
    """Elevation base: ramp colour times a moderate hillshade (0..1 RGB)."""
    return np.clip(ramp_rgb(h) * (1 + 0.6 * (relief(hs) - 1))[..., None], 0, 1)


def plain_grey(hs: np.ndarray) -> np.ndarray:
    """Plain base: a neutral grey (0.62) with a light hillshade (0..1)."""
    return np.clip(0.62 * (1 + 0.3 * (relief(hs) - 1)), 0, 1)


def hillshade_equirect(h: np.ndarray, z: float) -> np.ndarray:
    """Hillshade (0..1) of an equirectangular height grid (m; row 0 = +90, column 0 = -180 E).

    Same light and formula as mm.hillshade (light from the north-west at 40 deg). Pixel sizes on the
    1737.4 km sphere: R dlat per row, R cos(lat) dlon per column (cos clamped at 0.05; the caps cover
    the poles). Longitude wraps.
    """
    rows, cols = h.shape
    lat = np.radians(90.0 - (np.arange(rows) + 0.5) * 180.0 / rows)
    dy = np.pi / rows * R_MOON_M
    dx = (2 * np.pi / cols * R_MOON_M * np.maximum(np.cos(lat), 0.05))[:, None]
    dzdx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * dx) * z
    hp = np.pad(h, ((1, 1), (0, 0)), mode="edge")
    dzdy = (hp[:-2] - hp[2:]) / (2 * dy) * z
    az, alt = np.radians(mm.LIGHT_AZ_DEG), np.radians(mm.LIGHT_ALT_DEG)
    lx, ly, lz = np.sin(az) * np.cos(alt), np.cos(az) * np.cos(alt), np.sin(alt)
    shade = (-dzdx * lx - dzdy * ly + lz) / np.sqrt(1 + dzdx**2 + dzdy**2)
    return mm.AMBIENT + (1 - mm.AMBIENT) * np.clip(shade, 0, 1)


# ------------------------------------------------------------------------------------------------
# Contours
# ------------------------------------------------------------------------------------------------


def smooth(a: np.ndarray, sigma_px: float, wrap_cols: bool = False) -> np.ndarray:
    """Separable Gaussian low-pass (sigma in px): generalises the contours, as on a printed map.

    Rows clamp at the edges; columns clamp or wrap (longitude).
    """
    r = max(1, int(np.ceil(3 * sigma_px)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma_px) ** 2)
    k /= k.sum()
    out = np.pad(a.astype(np.float64), ((r, r), (0, 0)), mode="edge")
    out = sum(w * out[i : i + a.shape[0]] for i, w in enumerate(k))
    out = np.pad(out, ((0, 0), (r, r)), mode="wrap" if wrap_cols else "edge")
    return sum(w * out[:, i : i + a.shape[1]] for i, w in enumerate(k))


def contour_coverage(
    h: np.ndarray, interval_m: float, index_every: int, minor_px: float, index_px: float
):
    """Anti-aliased coverage (0..1) of the minor and index contour lines on a height grid.

    h: heights (m) on a regular grid (pixel units). Levels k * interval_m; a level is an index line when
    k is a multiple of index_every. Distance to the nearest level in px: |h - L| / |grad h|, with grad in
    m per px (central differences). On near-flat ground (gradient below 1 % of the interval per px) the
    line fades out in proportion to the gradient: there the level's position is undefined, and a floor
    lying close to a level would otherwise fill in as a blob. Returns (minor, index), each the shape of h.
    """
    gy, gx = np.gradient(h.astype(np.float64))
    g_raw = np.hypot(gx, gy)
    g_floor = 0.01 * interval_m
    g = np.maximum(g_raw, g_floor)
    fade = np.clip(g_raw / g_floor, 0.0, 1.0)
    k = np.round(h / interval_m)
    d = np.abs(h - k * interval_m) / g
    is_index = np.mod(k, index_every) == 0
    minor = np.where(is_index, 0.0, np.clip(0.5 * minor_px + 0.5 - d, 0, 1) * fade)
    index = np.where(is_index, np.clip(0.5 * index_px + 0.5 - d, 0, 1) * fade, 0.0)
    return minor, index


def contour_palette_image(minor: np.ndarray, index: np.ndarray) -> Image.Image:
    """Palette PNG image: 0 none; 1..LEVELS-1 minor (red = coverage); LEVELS..2(LEVELS-1) index (green)."""
    q = LEVELS - 1
    qm = np.round(minor * q).astype(np.uint8)
    qi = np.round(index * q).astype(np.uint8)
    px = np.where(qi > 0, q + qi, qm).astype(np.uint8)
    pal = [0, 0, 0]
    pal += [c for i in range(1, LEVELS) for c in (round(255 * i / q), 0, 0)]
    pal += [c for i in range(1, LEVELS) for c in (0, round(255 * i / q), 0)]
    img = Image.fromarray(px, "P")
    img.putpalette(pal + [0] * (768 - len(pal)))
    return img


# ------------------------------------------------------------------------------------------------
# Build
# ------------------------------------------------------------------------------------------------


def resize_f(a: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Area-average (box filter) resize of a float grid to (W, H)."""
    return np.asarray(
        Image.fromarray(a.astype(np.float32), "F").resize(size, Image.BOX), dtype=np.float32
    )


def save_jpeg(a: np.ndarray, name: str, quality: int = 85) -> int:
    """0..1 grey (H, W) or RGB (H, W, 3) as a JPEG in OUT; returns the byte count."""
    mode = "RGB" if a.ndim == 3 else "L"
    path = OUT / name
    Image.fromarray(np.round(np.clip(a, 0, 1) * 255).astype(np.uint8), mode).save(
        path, "JPEG", quality=quality, optimize=True, progressive=True, comment=AI_NOTE
    )
    return path.stat().st_size


def save_contours(minor: np.ndarray, index: np.ndarray, name: str) -> int:
    info = PngInfo()
    info.add_text("Comment", AI_NOTE)
    path = OUT / name
    contour_palette_image(minor, index).save(path, "PNG", optimize=True, bits=2, pnginfo=info)
    return path.stat().st_size


def cap_heights(n: int, psi_max: float, pole: int, g16, s960):
    """Heights (m) on a cap grid: LDEM_16, with LDEM_75S_240M (960 m block mean) poleward of 75.5 S."""
    u, lat, lon, psi = mm.cap_grid(n, psi_max, pole)
    h = g16.sample(lat, lon)
    if pole < 0:
        w = np.clip((-lat - 75.5) / 0.5, 0, 1)
        inside = w > 0
        h[inside] = h[inside] * (1 - w[inside]) + s960.sample(u[inside]) * w[inside]
    return h, psi


def build(preview: bool) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    print("LOLA heights ...", flush=True)
    g16 = mm.Ldem16()
    s240 = mm.Ldem75s()
    s960 = mm.Ldem75s(block=4)
    h_full = np.roll(g16.h, g16.h.shape[1] // 2, axis=1)  # column 0 at longitude -180
    sizes: dict[str, int] = {}
    imgs: dict[str, np.ndarray] = {}

    # Global base maps (equirectangular).
    h = resize_f(h_full, GLOBAL_SIZE)
    hs = hillshade_equirect(h, Z_GLOBAL)
    imgs["elev_global"] = elevation_rgb(h, hs)
    sizes["elev_global.jpg"] = save_jpeg(imgs["elev_global"], "elev_global.jpg", 84)
    sizes["plain_global.jpg"] = save_jpeg(plain_grey(hs), "plain_global.jpg", 84)

    # Polar caps of the base maps (same geometry as the imagery caps).
    caps = (
        ("north", mm.OUTER_N, mm.OUTER_PSI_MAX, 1, mm.OUTER_FADE),
        ("south", mm.OUTER_N, mm.OUTER_PSI_MAX, -1, mm.OUTER_FADE),
        ("south_inner", 1024, mm.INNER_PSI_MAX, -1, mm.INNER_FADE),
    )
    cap_meta = []
    for cid, n, psi_max, pole, fade in caps:
        if cid == "south_inner":
            u, _, _, psi = mm.cap_grid(n, psi_max, pole)
            hc = s240.sample(u)
            z = 1.0
        else:
            hc, psi = cap_heights(n, psi_max, pole, g16, s960)
            z = Z_CAP
        hsc = mm.hillshade(hc, psi, psi_max, z=z)
        imgs[f"elev_{cid}"] = elevation_rgb(hc, hsc)
        sizes[f"elev_{cid}.jpg"] = save_jpeg(imgs[f"elev_{cid}"], f"elev_{cid}.jpg", 84)
        sizes[f"plain_{cid}.jpg"] = save_jpeg(plain_grey(hsc), f"plain_{cid}.jpg", 84)
        cap_meta.append(
            {"id": cid, "pole": pole, "psi_max_deg": psi_max, "fade_psi_deg": list(fade), "size": n}
        )

    # Contours: global, then the polar caps poleward of CONTOUR_SWITCH_LAT.
    print("Contours ...", flush=True)
    gi = INTERVALS["global"]
    hg = smooth(resize_f(h_full, CONTOUR_GLOBAL_SIZE), SMOOTH_PX["global"], wrap_cols=True)
    mi, ix = contour_coverage(
        hg, gi["interval_m"], gi["index_every"], LINE_PX["minor"], LINE_PX["index"]
    )
    imgs["contours_global"] = np.maximum(mi, ix)
    sizes["contours_global.png"] = save_contours(mi, ix, "contours_global.png")
    ci = INTERVALS["caps"]
    for cid, pole in (("north", 1), ("south", -1)):
        u, lat, lon, psi = mm.cap_grid(CONTOUR_CAP_N, CONTOUR_CAP_PSI, pole)
        hc = smooth(g16.sample(lat, lon) if pole > 0 else s240.sample(u), SMOOTH_PX["caps"])
        mi, ix = contour_coverage(
            hc, ci["interval_m"], ci["index_every"], LINE_PX["minor"], LINE_PX["index"]
        )
        out = psi > np.radians(CONTOUR_CAP_PSI)
        mi[out] = 0
        ix[out] = 0
        imgs[f"contours_{cid}"] = np.maximum(mi, ix)
        sizes[f"contours_{cid}.png"] = save_contours(mi, ix, f"contours_{cid}.png")

    manifest = make_manifest(cap_meta, sizes)
    (OUT / "basemaps.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    if preview:
        write_preview(imgs)
    return manifest


def make_manifest(cap_meta: list[dict], sizes: dict[str, int]) -> dict:
    """basemaps.json: files, projections, ramp, contour intervals, sources, byte counts, AI note."""
    return {
        "_generated_by": AI_NOTE,
        "format": "moonat-basemaps/1",
        "built_utc": datetime.now(UTC).strftime("%Y-%m-%d"),
        "frame": "MOON_ME (selenographic latitude, east-positive longitude)",
        "heights": "LOLA heights above the 1737.4 km reference sphere (m)",
        "projections": "global: equirectangular, column 0 = -180 E, row 0 = +90; caps: the globe's polar "
        "stereographic cap projection (web/data/moonmap/moonmap.json cap_projection)",
        "elevation": {
            "global": {"url": "elev_global.jpg", "width": GLOBAL_SIZE[0], "height": GLOBAL_SIZE[1]},
            "caps": [{**c, "url": f"elev_{c['id']}.jpg"} for c in cap_meta],
            "ramp": {
                "name": RAMP,
                "range_km": list(ELEV_RANGE_KM),
                "reference_radius_km": 1737.4,
                "stops": ramp_stops(),
                "note": "heights beyond the range take the end colours",
            },
            "hillshade": {
                "light_azimuth_image_deg": mm.LIGHT_AZ_DEG,
                "light_elevation_deg": mm.LIGHT_ALT_DEG,
                "z_global": Z_GLOBAL,
                "z_caps": Z_CAP,
            },
        },
        "plain": {
            "global": {
                "url": "plain_global.jpg",
                "width": GLOBAL_SIZE[0],
                "height": GLOBAL_SIZE[1],
            },
            "caps": [{**c, "url": f"plain_{c['id']}.jpg"} for c in cap_meta],
            "grey": 0.62,
        },
        "contours": {
            "global": {
                "url": "contours_global.png",
                "width": CONTOUR_GLOBAL_SIZE[0],
                "height": CONTOUR_GLOBAL_SIZE[1],
                **INTERVALS["global"],
            },
            "caps": [
                {
                    "id": cid,
                    "pole": pole,
                    "url": f"contours_{cid}.png",
                    "psi_max_deg": CONTOUR_CAP_PSI,
                    "size": CONTOUR_CAP_N,
                    **INTERVALS["caps"],
                }
                for cid, pole in (("north", 1), ("south", -1))
            ],
            "switch_lat_deg": CONTOUR_SWITCH_LAT,
            "line_px": LINE_PX,
            "smoothing_sigma_px": SMOOTH_PX,
            "encoding": "palette PNG; red = minor line coverage, green = index line coverage (0..1)",
            "method": "distance to the nearest level |h - L| / |grad h| on the output grid, box-filtered",
        },
        "source": {
            "name": "NASA LRO LOLA gridded data records LDEM_16 and LDEM_75S_240M (PDS)",
            "page": "https://pds-geosciences.wustl.edu/missions/lro/lola.htm",
            "credit": "NASA/GSFC LRO LOLA team",
            "north_cap_contours": "LDEM_16 (about 1.9 km/px; no north polar DEM in the shared cache)",
            "south_cap_contours": "LDEM_75S_240M (240 m/px)",
        },
        "bytes": sizes,
    }


def write_preview(imgs: dict) -> None:
    """outputs/base_maps_preview.png: the global elevation map with its contours, and the south cap pair."""
    fig = ROOT / "outputs"
    fig.mkdir(exist_ok=True)
    g = imgs["elev_global"][::2, ::2] * (1 - 0.8 * imgs["contours_global"][::4, ::4][..., None])
    s = imgs["elev_south"]
    c = np.repeat(1 - imgs["contours_south"][::2, ::2][..., None], 3, axis=2)
    top = np.zeros((g.shape[0], 2048, 3))
    top[:, : g.shape[1]] = g
    out = np.concatenate([top, np.concatenate([s, c], axis=1)], axis=0)
    Image.fromarray(np.round(out * 255).astype(np.uint8)).save(fig / "base_maps_preview.png")
    print(f"preview: {fig / 'base_maps_preview.png'}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--preview", action="store_true", help="also write outputs/base_maps_preview.png"
    )
    args = ap.parse_args()
    m = build(args.preview)
    total = sum(m["bytes"].values())
    for k, v in m["bytes"].items():
        print(f"{k:28s} {v / 1e3:8.0f} kB")
    print(f"total {total / 1e6:.2f} MB -> {OUT}")


if __name__ == "__main__":
    main()
