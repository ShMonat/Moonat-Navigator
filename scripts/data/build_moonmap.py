# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Build the textures of the Moon globe location picker (web/data/moonmap/).

Usage:
    uv run python scripts/data/build_moonmap.py            # build everything
    uv run python scripts/data/build_moonmap.py --preview  # also write a contact sheet to outputs/

Outputs (all greyscale JPEG, plus ``moonmap.json`` that describes them):

* ``wac_global.jpg``: equirectangular base map, 4096 x 2048 px (11.4 px/deg, 2.7 km/px at the
  equator), stitched from the NASA Moon Trek WMTS tiles of the LRO WAC global mosaic (zoom 3).
  Column 0 is longitude -180 deg (east-positive), row 0 is latitude +90 deg.
  ``wac_global_1k.jpg`` is a 1024 x 512 copy shown while the full image loads.
* ``cap_north.jpg``, ``cap_south.jpg``: polar caps to 22 deg from each pole (latitude 68 deg),
  1024 x 1024 px, LOLA hillshade. They replace the base map near the poles, where an
  equirectangular image smears. Heights: LOLA LDEM_16 (north and south), plus LDEM_75S_240M
  (block mean to 960 m) poleward of 75 S.
* ``cap_south_inner.jpg``: south polar cap to 6.5 deg from the pole (latitude -83.5 deg),
  2048 x 2048 px (193 m/px), LOLA LDEM_75S_240M hillshade, for crater-level detail around
  Shackleton and the Artemis candidate regions.

Cap projection (polar stereographic on the unit sphere, the same image orientation as a
top-down view from outside the Moon and as the PDS LOLA polar products): for a unit vector u in
MOON_ME and pole sign s (+1 north, -1 south)

    k = 1 / (1 + s * uz);  X = k * uy;  Y = -s * k * ux        (X right, Y up)
    u_tex = 0.5 + X / (2 * rmax);  v_tex = 0.5 + Y / (2 * rmax),  rmax = tan(psi_max / 2)

so the south cap has longitude 0 at the top and 90 E on the right; the north cap has 180 at the
top and 90 E on the right. Image row 0 is the top (v_tex = 1).

Hillshade: light from the upper left of each cap image (azimuth 315 deg in the image), 40 deg
above the horizon, plus an ambient floor of 0.18; slopes from central differences on the
spherical ground distance (vertical exaggeration 2 on the coarse outer caps). Each cap is
then matched in mean and contrast to the image it fades into (WAC base for the outer caps, the
outer cap for the inner cap), so the seams do not show.

Idempotent: tiles and DEMs are cached in the shared raw-data folder (data/raw/moonmap and
data/raw/dem of the main checkout); a rerun rewrites identical files. Downloads: 128 Moon Trek
tiles (about 4 MB) on the first run; the LOLA files are expected to be there already (see
scripts/data/build_terrain.py, which downloads them).
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image  # Pillow, a dependency of matplotlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from moonat.terrain.fetch import dem_dir  # noqa: E402

AI_NOTE = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."
OUT = ROOT / "web" / "data" / "moonmap"
R_MOON_M = 1737400.0

WAC_URL = (
    "https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/"
    "default028mm/{z}/{y}/{x}.jpg"
)
WAC_ZOOM = 3  # 2^(z+1) x 2^z tiles of 256 px: 4096 x 2048 px
USER_AGENT = "moonat-moonmap/0.1 (python urllib)"

LIGHT_AZ_DEG = 315.0  # image azimuth, clockwise from image up: upper left
LIGHT_ALT_DEG = 40.0
AMBIENT = 0.18

# Cap geometry (psi = angular distance from the pole). The globe shader fades between layers.
OUTER_PSI_MAX = 22.0
OUTER_N = 1024
OUTER_FADE = (20.0, 16.0)  # base -> cap between these psi (deg)
INNER_PSI_MAX = 6.5
INNER_N = 2048
INNER_FADE = (6.0, 5.0)  # outer cap -> inner cap


# ------------------------------------------------------------------------------------------------
# Sources
# ------------------------------------------------------------------------------------------------


def raw_dir(name: str) -> Path:
    """Shared raw-data folder ``<main checkout>/data/raw/<name>`` (next to the DEM cache)."""
    p = dem_dir().parent / name
    p.mkdir(parents=True, exist_ok=True)
    return p


def _get(url: str, retries: int = 4) -> bytes:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except OSError:
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("unreachable")


def wac_mosaic(zoom: int = WAC_ZOOM) -> np.ndarray:
    """Equirectangular LRO WAC mosaic (float32 0..1, row 0 = lat +90, col 0 = lon -180)."""
    cache = raw_dir("moonmap") / f"wac_z{zoom}"
    cache.mkdir(parents=True, exist_ok=True)
    rows, cols = 2**zoom, 2 ** (zoom + 1)

    def tile(rc: tuple[int, int]) -> np.ndarray:
        r, c = rc
        p = cache / f"{r}_{c}.jpg"
        if not p.exists():
            p.write_bytes(_get(WAC_URL.format(z=zoom, y=r, x=c)))
        return np.asarray(Image.open(io.BytesIO(p.read_bytes())).convert("L"), dtype=np.float32)

    jobs = [(r, c) for r in range(rows) for c in range(cols)]
    with ThreadPoolExecutor(6) as ex:
        tiles = list(ex.map(tile, jobs))
    out = np.zeros((rows * 256, cols * 256), np.float32)
    for (r, c), t in zip(jobs, tiles, strict=True):
        out[r * 256 : (r + 1) * 256, c * 256 : (c + 1) * 256] = t
    return out / 255.0


def read_ldem(path: Path, lines: int, samples: int) -> np.ndarray:
    """LOLA LDEM raster as height above the 1737.4 km sphere (m, float32). DN x 0.5 m."""
    a = np.fromfile(path, dtype="<i2", count=lines * samples).reshape(lines, samples)
    return a.astype(np.float32) * 0.5


def bilinear(a: np.ndarray, r: np.ndarray, c: np.ndarray, wrap_cols: bool = False) -> np.ndarray:
    """Bilinear sample of ``a`` at fractional (row, col); rows clamp, columns clamp or wrap."""
    h, w = a.shape
    r = np.clip(r, 0, h - 1.000001)
    r0 = np.floor(r).astype(int)
    fr = r - r0
    if wrap_cols:
        c = np.mod(c, w)
        c0 = np.floor(c).astype(int)
        fc = c - c0
        c0 %= w
        c1 = (c0 + 1) % w
    else:
        c = np.clip(c, 0, w - 1.000001)
        c0 = np.floor(c).astype(int)
        fc = c - c0
        c1 = c0 + 1
    top = a[r0, c0] * (1 - fc) + a[r0, c1] * fc
    bot = a[r0 + 1, c0] * (1 - fc) + a[r0 + 1, c1] * fc
    return top * (1 - fr) + bot * fr


class Ldem16:
    """LOLA LDEM_16: simple cylindrical, 16 px/deg, column 0 at lon 0 E, row 0 at lat +90."""

    def __init__(self):
        self.h = read_ldem(dem_dir() / "ldem_16" / "ldem_16.img", 2880, 5760)

    def sample(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        return bilinear(self.h, (90.0 - lat) * 16 - 0.5, np.mod(lon, 360.0) * 16 - 0.5, True)


class Ldem75s:
    """LOLA LDEM_75S_240M: south polar stereographic, 240 m/px, 3812 x 3812, pole at 1905.5.

    ``block`` > 1 averages block x block pixels first (a low-pass for coarser output grids).
    """

    def __init__(self, block: int = 1):
        h = read_ldem(dem_dir() / "ldem_75s_240m" / "ldem_75s_240m.img", 3812, 3812)
        if block > 1:
            n = (h.shape[0] // block) * block
            h = h[:n, :n].reshape(n // block, block, n // block, block).mean(axis=(1, 3))
        self.h = h
        self.scale = 240.0 * block
        self.c0 = (1905.5 + 0.5) / block - 0.5

    def sample(self, u: np.ndarray) -> np.ndarray:
        k = 2.0 * R_MOON_M / (1.0 - u[..., 2])  # south pole: s = -1
        x = k * u[..., 1]
        y_up = k * u[..., 0]
        return bilinear(self.h, self.c0 - y_up / self.scale, self.c0 + x / self.scale)


# ------------------------------------------------------------------------------------------------
# Cap geometry and hillshade
# ------------------------------------------------------------------------------------------------


def unit_from_latlon(lat_deg, lon_deg) -> np.ndarray:
    """Unit vectors in MOON_ME from latitude / east longitude (deg)."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1)


def cap_grid(n: int, psi_max_deg: float, pole: int):
    """Pixel-centre unit vectors (n, n, 3), latitude, longitude (deg) and psi (rad) of a cap image.

    Inverse of the projection in the module docstring: X, Y in the stereographic plane
    (r = tan(psi / 2)); X = r sin(lon), Y = -s r cos(lon).
    """
    rmax = np.tan(np.radians(psi_max_deg) / 2)
    t = ((np.arange(n) + 0.5) / n - 0.5) * 2 * rmax
    x = t[None, :]
    y = -t[:, None]  # row 0 is the top
    x, y = np.broadcast_arrays(x, y)
    r = np.hypot(x, y)
    psi = 2 * np.arctan(r)
    lon = np.degrees(np.arctan2(x, -pole * y))
    lat = pole * (90.0 - np.degrees(psi))
    return unit_from_latlon(lat, lon), lat, lon, psi


def hillshade(h: np.ndarray, psi: np.ndarray, psi_max_deg: float, z: float = 1.0) -> np.ndarray:
    """Hillshade (0..1) of heights ``h`` (m) on a cap grid: AMBIENT + (1 - AMBIENT) x Lambert.

    Ground distance per unit of the stereographic plane is R (1 + cos psi); the pixel size in the
    plane is 2 rmax / n. Light from LIGHT_AZ_DEG (image azimuth) at LIGHT_ALT_DEG elevation. The
    ambient term keeps slopes facing away from the light grey instead of black, so deep craters
    such as Shackleton read as craters, not holes.
    """
    n = h.shape[0]
    rmax = np.tan(np.radians(psi_max_deg) / 2)
    d = (2 * rmax / n) * R_MOON_M * (1 + np.cos(psi))  # m per pixel
    hp = np.pad(h, 1, mode="edge")
    dzdx = (hp[1:-1, 2:] - hp[1:-1, :-2]) / (2 * d) * z
    dzdy = (hp[:-2, 1:-1] - hp[2:, 1:-1]) / (2 * d) * z  # +y is up (row decreasing)
    az, alt = np.radians(LIGHT_AZ_DEG), np.radians(LIGHT_ALT_DEG)
    lx, ly, lz = np.sin(az) * np.cos(alt), np.cos(az) * np.cos(alt), np.sin(alt)
    shade = (-dzdx * lx - dzdy * ly + lz) / np.sqrt(1 + dzdx**2 + dzdy**2)
    return AMBIENT + (1 - AMBIENT) * np.clip(shade, 0, 1)


def band_mask(psi: np.ndarray, lo_deg: float, hi_deg: float) -> np.ndarray:
    return (psi >= np.radians(lo_deg)) & (psi <= np.radians(hi_deg))


def match_tone(img: np.ndarray, mask: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Linear map of ``img`` so its mean and standard deviation inside ``mask`` equal ``ref``'s."""
    a, b = img[mask], ref
    gain = b.std() / max(a.std(), 1e-6)
    return np.clip((img - a.mean()) * gain + b.mean(), 0, 1)


def sample_equirect(img: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Bilinear sample of an equirectangular image (row 0 = +90, col 0 = lon -180)."""
    h, w = img.shape
    return bilinear(img, (90.0 - lat) / 180.0 * h - 0.5, (lon + 180.0) / 360.0 * w - 0.5, True)


# ------------------------------------------------------------------------------------------------
# Build
# ------------------------------------------------------------------------------------------------


def save_jpeg(a: np.ndarray, name: str, quality: int) -> int:
    path = OUT / name
    img = Image.fromarray(np.round(np.clip(a, 0, 1) * 255).astype(np.uint8), "L")
    img.save(path, "JPEG", quality=quality, optimize=True, progressive=True, comment=AI_NOTE)
    return path.stat().st_size


def build(preview: bool) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    print("WAC mosaic (Moon Trek tiles) ...", flush=True)
    wac = wac_mosaic()
    sizes = {"wac_global.jpg": save_jpeg(wac, "wac_global.jpg", 86)}
    # A 1024 x 512 preview (4 x 4 block mean) that the globe shows while the full image loads.
    small = wac.reshape(512, 4, 1024, 4).mean(axis=(1, 3))
    sizes["wac_global_1k.jpg"] = save_jpeg(small, "wac_global_1k.jpg", 82)

    print("LOLA heights ...", flush=True)
    g16 = Ldem16()
    s240 = Ldem75s()
    s960 = Ldem75s(block=4)

    caps = {}
    for name, pole in (("cap_north.jpg", 1), ("cap_south.jpg", -1)):
        u, lat, lon, psi = cap_grid(OUTER_N, OUTER_PSI_MAX, pole)
        h = g16.sample(lat, lon)
        if pole < 0:
            # LDEM_75S_240M (960 m block mean) poleward of 75.5 S, faded in over half a degree.
            w = np.clip((-lat - 75.5) / 0.5, 0, 1)
            inside = w > 0
            h[inside] = h[inside] * (1 - w[inside]) + s960.sample(u[inside]) * w[inside]
        hs = hillshade(h, psi, OUTER_PSI_MAX, z=2.0)
        m = band_mask(psi, *sorted(OUTER_FADE))
        ref = sample_equirect(wac, lat[m], lon[m])
        caps[name] = match_tone(hs, m, ref)
        sizes[name] = save_jpeg(caps[name], name, 86)

    u, lat, lon, psi = cap_grid(INNER_N, INNER_PSI_MAX, -1)
    hs = hillshade(s240.sample(u), psi, INNER_PSI_MAX, z=1.0)
    m = band_mask(psi, *sorted(INNER_FADE))
    # Reference: the outer south cap at the same points.
    rmax = np.tan(np.radians(OUTER_PSI_MAX) / 2)
    k = 1.0 / (1.0 - u[m][:, 2])
    col = (0.5 + k * u[m][:, 1] / (2 * rmax)) * OUTER_N - 0.5
    row = (0.5 - k * u[m][:, 0] / (2 * rmax)) * OUTER_N - 0.5
    ref = bilinear(caps["cap_south.jpg"], row, col)
    inner = match_tone(hs, m, ref)
    sizes["cap_south_inner.jpg"] = save_jpeg(inner, "cap_south_inner.jpg", 84)

    manifest = {
        "_generated_by": AI_NOTE,
        "format": "moonat-moonmap/1",
        "frame": "MOON_ME (selenographic latitude, east-positive longitude)",
        "base": {
            "url": "wac_global.jpg",
            "preview_url": "wac_global_1k.jpg",
            "projection": "equirectangular",
            "width": int(wac.shape[1]),
            "height": int(wac.shape[0]),
            "lon_left_deg": -180.0,
            "lat_top_deg": 90.0,
            "source": "LRO WAC global mosaic 303 ppd v02, NASA Moon Trek WMTS, zoom "
            f"{WAC_ZOOM} tiles stitched",
            "credit": "NASA/GSFC/Arizona State University (LRO WAC), via NASA Moon Trek",
        },
        "caps": [
            {
                "id": "north",
                "url": "cap_north.jpg",
                "pole": 1,
                "psi_max_deg": OUTER_PSI_MAX,
                "fade_psi_deg": list(OUTER_FADE),
                "size": OUTER_N,
                "source": "LOLA LDEM_16 hillshade",
            },
            {
                "id": "south",
                "url": "cap_south.jpg",
                "pole": -1,
                "psi_max_deg": OUTER_PSI_MAX,
                "fade_psi_deg": list(OUTER_FADE),
                "size": OUTER_N,
                "source": "LOLA LDEM_16 and LDEM_75S_240M hillshade",
            },
            {
                "id": "south_inner",
                "url": "cap_south_inner.jpg",
                "pole": -1,
                "psi_max_deg": INNER_PSI_MAX,
                "fade_psi_deg": list(INNER_FADE),
                "size": INNER_N,
                "source": "LOLA LDEM_75S_240M hillshade",
            },
        ],
        "cap_projection": (
            "polar stereographic on the unit sphere: k = 1/(1 + s*uz); X = k*uy; Y = -s*k*ux; "
            "u_tex = 0.5 + X/(2*tan(psi_max/2)); v_tex = 0.5 + Y/(2*tan(psi_max/2)); "
            "image row 0 = v_tex 1 (top)"
        ),
        "hillshade": {
            "light_azimuth_image_deg": LIGHT_AZ_DEG,
            "light_elevation_deg": LIGHT_ALT_DEG,
            "ambient": AMBIENT,
        },
        "credit": "Imagery: NASA/GSFC/Arizona State University (LRO WAC) via NASA Moon Trek. "
        "Polar relief: NASA LRO LOLA (PDS).",
        "bytes": sizes,
    }
    (OUT / "moonmap.json").write_text(
        json.dumps(manifest, indent=1) + "\n", encoding="utf-8", newline="\n"
    )
    total = sum(sizes.values())
    print(json.dumps(sizes, indent=1))
    print(f"total {total / 1e6:.2f} MB in {time.time() - t0:.0f} s")

    if preview:
        fig_dir = ROOT / "outputs"
        fig_dir.mkdir(exist_ok=True)
        sheet = np.ones((1024, 1024 * 3 + 2048 // 2), np.float32)
        sheet[:, :1024] = caps["cap_north.jpg"]
        sheet[:, 1024:2048] = caps["cap_south.jpg"]
        sheet[:, 2048:3072] = inner[::2, ::2]
        sheet[:, 3072:] = wac[512:1536, 1536:2560]
        save_path = fig_dir / "moonmap_preview.jpg"
        Image.fromarray((sheet * 255).astype(np.uint8)).save(save_path, quality=85)
        print(f"preview: {save_path}")
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--preview", action="store_true", help="write outputs/moonmap_preview.jpg")
    build(ap.parse_args().preview)


if __name__ == "__main__":
    main()
