# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Build the Moon globe's optional map layers (web/data/overlays/) from NASA's polar illumination maps.

Usage:
    uv run python scripts/data/build_map_layers.py            # download (once), build, check
    uv run python scripts/data/build_map_layers.py --preview  # also write outputs/map_layers_preview.png

Source: NASA GSFC Planetary Geodesy Data Archive (PGDA) product 69, "Lunar polar illumination"
(https://pgda.gsfc.nasa.gov/products/69), LRO LOLA team, method of Mazarico et al. (2011, Icarus 211,
1066-1081). PDS IMG files at http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/ (release 201608):

* ``LPSR_<band>_201608``: permanently shadowed regions. INT16 LSB, DN +20000 = permanent shadow (1),
  DN -20000 = not (0). This is NASA's own PSR map; we do not threshold anything for it.
* ``AVGVISIB_<band>_201608``: share of hourly time steps over an 18.6-year cycle in which any part of
  the Sun's disc is above the local terrain horizon, at the surface. INT16 LSB, value = DN x 0.00004
  (0 = permanent shadow, 1 = always lit).

Bands used: ``65S_240M`` and ``65N_240M`` (240 m/px, 6420 x 6420, pole at pixel 3209.5) and
``85S_060M`` (60 m/px, 5058 x 5058, pole at 2528.5). All are polar stereographic on the 1737.4 km
sphere, true scale at the pole, frame MEAN EARTH/POLAR AXIS of DE421 (= our MOON_ME): for the pole
sign s (+1 north, -1 south), psi = angular distance from the pole and east longitude lon,

    rho = 2 R tan(psi / 2);  x = rho sin(lon);  y = -s rho cos(lon)
    row = C0 - y / scale;    col = C0 + x / scale              (0-based pixel centres)

which is also the globe's cap projection (web/data/moonmap/moonmap.json, ``cap_projection``): image
row 0 is the top, 90 E is on the right, longitude 0 at the top of the south cap and at the bottom of
the north cap. So a square crop centred on the pole IS a cap texture, with no resampling.

Outputs (``web/data/overlays/``):

* ``layers_north.png``, ``layers_south.png``: 2560 x 2560 crops of the 240 m maps (to latitude 79.9,
  the inscribed circle; the globe draws them poleward of that circle only).
* ``layers_south_inner.png``: 2048 x 2048 crop of the 60 m south map (to latitude 87.97 S), for the
  craters and ridges around Shackleton.
* ``overlays.json``: the manifest (classes, thresholds, tiers, sources, areas, AI note) and the
  sunlit spots (one row per group of pixels lit >= 70 %: centre, area, best share), which the globe
  rings so that spots smaller than a screen pixel can still be found.

Each PNG is a 2-bit palette image with one class per pixel, chosen so the decoded RGB channels are
masks that the globe's shader can filter: 0 none (0, 0, 0); 1 permanently shadowed (255, 0, 0);
2 lit >= 70 % of the time (0, 128, 0); 3 lit >= 80 % of the time (0, 255, 0). Red = PSR, green =
sunlight class (0, 0.5, 1).

Downloads (cached in ``<main checkout>/data/raw/illumination/``, never twice): HTTP multi-range
requests of the crop rows only, about 70 MB in all; the byte count is logged in
``download_log.json`` there (not in the DEM budget of ``moonat.terrain.fetch``).
Also writes ``docs/validation/map_layers.json``: the sanity checks (named points, PSR areas against
Mazarico et al. 2011, the two maps' agreement).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from moonat.terrain import fetch  # noqa: E402

AI_NOTE = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."
OUT = ROOT / "web" / "data" / "overlays"
CHECKS = ROOT / "docs" / "validation" / "map_layers.json"
R_MOON_M = 1737400.0

BASE_URL = "http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/"
PRODUCT_PAGE = "https://pgda.gsfc.nasa.gov/products/69"
RELEASE = "201608"
# band -> raster size (px), pole pixel (0-based), m/px, pole sign
BANDS = {
    "65S_240M": {"n": 6420, "c0": 3209.5, "scale": 240.0, "pole": -1},
    "65N_240M": {"n": 6420, "c0": 3209.5, "scale": 240.0, "pole": 1},
    "85S_060M": {"n": 5058, "c0": 2528.5, "scale": 60.0, "pole": -1},
}
AVG_DN = 0.00004  # AVGVISIB: value = DN x 0.00004 (label SCALING_FACTOR, OFFSET 0)
# Globe tiers: id, band, crop size (px), fade (psi, deg) from the tier below to this one (inner only)
TIERS = (
    {"id": "north", "band": "65N_240M", "size": 2560},
    {"id": "south", "band": "65S_240M", "size": 2560},
    {"id": "south_inner", "band": "85S_060M", "size": 2048, "fade_psi_deg": [2.0, 1.85]},
)
# Sunlight classes (share of time with any part of the Sun's disc visible, at the surface).
LIT_LOW, LIT_HIGH = 0.70, 0.80
PALETTE = [0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 255, 0]  # none, PSR, lit >= 70 %, lit >= 80 %
CLASSES = [
    {"index": 0, "rgb": [0, 0, 0], "meaning": "neither"},
    {"index": 1, "rgb": [255, 0, 0], "meaning": "permanently shadowed (LPSR = 1)"},
    {"index": 2, "rgb": [0, 128, 0], "meaning": f"lit {LIT_LOW:.0%} to {LIT_HIGH:.0%} of the time"},
    {"index": 3, "rgb": [0, 255, 0], "meaning": f"lit at least {LIT_HIGH:.0%} of the time"},
]
# Mazarico et al. (2011), abstract: PSR area poleward of 80 deg (240 m LOLA DEMs).
MAZARICO_PSR_KM2 = {"north": 12866.0, "south": 16055.0}
MAX_DOWNLOAD_BYTES = 150_000_000

# Named points for the sanity check: id, name, lat, lon (deg, MOON_ME), what the maps should say.
POINTS = (
    ("shackleton_floor", "Shackleton crater floor (centre)", -89.67, 129.78, "psr"),
    ("lcross_cabeus", "LCROSS impact point, Cabeus", -84.675, -48.725, "psr"),
    ("haworth_floor", "Haworth crater floor", -87.45, -5.0, "psr"),
    ("shoemaker_floor", "Shoemaker crater floor", -88.1, 44.9, "psr"),
    ("connecting_ridge_1", "Connecting ridge (Glaser 2014 CR1 spot 1)", -89.4395, -137.1934, "lit"),
    ("connecting_ridge_3", "Connecting ridge (Glaser 2014 CR1 spot 3)", -89.4516, -137.2419, "lit"),
    ("degerlache_rim", "de Gerlache rim (Moonat catalog)", -89.0056, -96.6455, "lit"),
    ("malapert_crest", "Malapert massif crest (StarHab site)", -85.96775, -2.28748, "lit"),
    ("malapert_catalog", "Malapert Massif (Moonat catalog point)", -85.99, 0.12, "lit"),
)


# ------------------------------------------------------------------------------------------------
# Geometry
# ------------------------------------------------------------------------------------------------


def pgda_rowcol(lat_deg, lon_deg, band: str):
    """Fractional 0-based (row, col) of points in a PGDA polar stereographic raster.

    Units: degrees in (selenographic latitude, east longitude, MOON_ME); pixels out. Spherical polar
    stereographic on R = 1737.4 km, true scale at the pole: rho = 2 R tan(psi/2), x = rho sin(lon),
    y = -s rho cos(lon) (s = +1 north, -1 south), row = C0 - y/scale, col = C0 + x/scale.
    """
    b = BANDS[band]
    s = b["pole"]
    psi = np.radians(90.0 - s * np.asarray(lat_deg, dtype=float))
    rho = 2.0 * R_MOON_M * np.tan(psi / 2.0)
    lon = np.radians(lon_deg)
    x, y = rho * np.sin(lon), -s * rho * np.cos(lon)
    return b["c0"] - y / b["scale"], b["c0"] + x / b["scale"]


def crop_bounds(band: str, size: int) -> tuple[int, int]:
    """First and last+1 pixel index of a ``size`` px crop centred on the pole (rows = cols)."""
    c0 = BANDS[band]["c0"]
    a = int(round(c0 + 0.5 - size / 2))
    assert abs((a + a + size - 1) / 2 - c0) < 1e-9, "crop must be centred on the pole"
    return a, a + size


def tier_psi_max_deg(band: str, size: int) -> float:
    """Angular radius (deg) of the circle inscribed in a ``size`` px crop: the tier's coverage."""
    half_m = size / 2 * BANDS[band]["scale"]
    return float(np.degrees(2.0 * np.arctan(half_m / (2.0 * R_MOON_M))))


def crop_psi_deg(band: str, size: int) -> np.ndarray:
    """Angular distance from the pole (deg) of each pixel centre of a pole-centred crop."""
    scale = BANDS[band]["scale"]
    t = (np.arange(size) + 0.5 - size / 2) * scale
    rho = np.hypot(t[None, :], t[:, None])
    return np.degrees(2.0 * np.arctan(rho / (2.0 * R_MOON_M)))


def pixel_area_km2(band: str, psi_deg: np.ndarray) -> np.ndarray:
    """Ground area (km^2) of a map pixel at angular distance psi from the pole.

    The spherical polar stereographic scale factor is k = 2 / (1 + cos psi) (1 at the pole), so a
    pixel of ``scale`` m on the map covers (scale / k)^2 of ground.
    """
    k = 2.0 / (1.0 + np.cos(np.radians(psi_deg)))
    return (BANDS[band]["scale"] / 1000.0 / k) ** 2


# ------------------------------------------------------------------------------------------------
# Download (HTTP multi-range, cached)
# ------------------------------------------------------------------------------------------------


def raw_dir() -> Path:
    """Shared raw-data folder ``<main checkout>/data/raw/illumination`` (next to the DEM cache)."""
    p = fetch.dem_dir().parent / "illumination"
    p.mkdir(parents=True, exist_ok=True)
    return p


_log_lock = threading.Lock()


def _account(n: int, what: str) -> None:
    with _log_lock:
        p = raw_dir() / "download_log.json"
        log = json.loads(p.read_text()) if p.exists() else {"total_bytes": 0, "by_product": {}}
        if log["total_bytes"] + n > MAX_DOWNLOAD_BYTES:
            raise RuntimeError(
                f"illumination download cap {MAX_DOWNLOAD_BYTES / 1e6:.0f} MB reached"
            )
        log["total_bytes"] += n
        log["by_product"][what] = log["by_product"].get(what, 0) + n
        p.write_text(json.dumps(log, indent=1))


def _fetch_ranges(url: str, ranges: list[tuple[int, int]], what: str) -> list[bytes]:
    """Inclusive byte ranges of ``url`` in one multi-range request (as moonat.terrain.fetch)."""
    spec = ",".join(f"{a}-{b}" for a, b in ranges)
    with fetch._open(url, headers={"Range": f"bytes={spec}"}) as r:
        if r.status != 206:
            raise RuntimeError(f"{url}: server ignored Range (status {r.status})")
        ctype = r.headers.get("Content-Type", "")
        crange = r.headers.get("Content-Range", "")
        body = r.read()
    _account(len(body), what)
    parts: dict[int, bytes] = {}
    if ctype.startswith("multipart/byteranges"):
        boundary = re.search(r"boundary=\"?([^\";]+)\"?", ctype).group(1).encode()
        for chunk in body.split(b"--" + boundary):
            if b"Content-Range" not in chunk[:300]:
                continue
            head, _, data = chunk.partition(b"\r\n\r\n")
            m = re.search(rb"bytes (\d+)-(\d+)/", head)
            a, b = int(m.group(1)), int(m.group(2))
            parts[a] = data[: b - a + 1]
    else:
        parts[int(re.search(r"bytes (\d+)-(\d+)/", crange).group(1))] = body
    out = []
    for a, b in ranges:
        for start, data in parts.items():
            if start <= a and start + len(data) >= b + 1:
                out.append(data[a - start : b - start + 1])
                break
        else:
            raise RuntimeError(f"{url}: missing byte range {a}-{b} in reply")
    return out


def read_window(kind: str, band: str, r0: int, r1: int, c0: int, c1: int) -> np.ndarray:
    """Raw DNs (int16) of rows [r0, r1) x cols [c0, c1) of ``<kind>_<band>_201608.IMG`` (cached).

    ``kind`` is "LPSR" or "AVGVISIB". The window must lie inside the raster.
    """
    n = BANDS[band]["n"]
    if not (0 <= r0 < r1 <= n and 0 <= c0 < c1 <= n):
        raise ValueError(f"window {r0}:{r1}, {c0}:{c1} outside the {n} px raster")
    name = f"{kind}_{band}_{RELEASE}"
    path = raw_dir() / f"{name}_r{r0}-{r1}_c{c0}-{c1}.npy"
    if path.exists():
        return np.load(path)
    url = f"{BASE_URL}{name}.IMG"
    rb = n * 2
    ranges = [(r * rb + c0 * 2, r * rb + c1 * 2 - 1) for r in range(r0, r1)]
    chunks = [ranges[i : i + 128] for i in range(0, len(ranges), 128)]
    print(
        f"  {name}: {len(ranges)} rows x {c1 - c0} px ({len(ranges) * (c1 - c0) * 2 / 1e6:.1f} MB)",
        flush=True,
    )
    with ThreadPoolExecutor(4) as ex:
        parts = [p for ch in ex.map(lambda c: _fetch_ranges(url, c, name), chunks) for p in ch]
    a = np.frombuffer(b"".join(parts), dtype="<i2").reshape(r1 - r0, c1 - c0).copy()
    np.save(path, a)
    return a


def read_crop(kind: str, band: str, size: int) -> np.ndarray:
    a, b = crop_bounds(band, size)
    return read_window(kind, band, a, b, a, b)


# ------------------------------------------------------------------------------------------------
# Classes and outputs
# ------------------------------------------------------------------------------------------------


def classify(lpsr_dn: np.ndarray, avg_dn: np.ndarray) -> np.ndarray:
    """Class per pixel (uint8): 0 none, 1 permanently shadowed, 2 lit >= LIT_LOW, 3 lit >= LIT_HIGH.

    PSR comes from NASA's LPSR flag (DN > 0); the sunlight classes from AVGVISIB (DN x 0.00004 = share
    of time with any part of the Sun's disc visible). The two cannot overlap (a PSR has AVGVISIB 0).
    """
    lit = avg_dn.astype(np.float64) * AVG_DN
    cls = np.zeros(lpsr_dn.shape, np.uint8)
    cls[lit >= LIT_LOW - 1e-9] = 2
    cls[lit >= LIT_HIGH - 1e-9] = 3
    cls[lpsr_dn > 0] = 1
    return cls


def save_png(cls: np.ndarray, name: str, meta: dict) -> int:
    img = Image.fromarray(cls, "P")
    img.putpalette(PALETTE)
    info = PngInfo()
    info.add_text("Comment", AI_NOTE)
    info.add_text("Source", meta["source"])
    info.add_text("Description", meta["description"])
    path = OUT / name
    img.save(path, "PNG", optimize=True, bits=2, pnginfo=info)
    return path.stat().st_size


def area_stats(cls: np.ndarray, band: str, size: int, psi_lim_deg: float) -> dict:
    """Areas (km^2) of each class within psi_lim of the pole, and the crop's coverage."""
    psi = crop_psi_deg(band, size)
    inside = psi <= psi_lim_deg
    area = pixel_area_km2(band, psi)
    return {
        "within_lat_deg": round(90.0 - psi_lim_deg, 3),
        "psr_km2": round(float(area[inside & (cls == 1)].sum()), 1),
        "lit_ge_low_km2": round(float(area[inside & (cls >= 2)].sum()), 2),
        "lit_ge_high_km2": round(float(area[inside & (cls == 3)].sum()), 2),
        "cap_km2": round(float(area[inside].sum()), 0),
    }


def point_value(band: str, lat: float, lon: float, radius_m: float = 1000.0) -> dict | None:
    """What a PGDA band says at a point (nearest pixel), and the nearest sunlit-class pixel.

    Returns the share of time lit (%) and the PSR flag of the pixel under the point, the largest
    share in its 3 x 3 neighbourhood, and the map distance (m) to the nearest pixel lit at least
    LIT_LOW and at least LIT_HIGH within ``radius_m`` (None if there is none). None off the map.
    """
    row, col = pgda_rowcol(lat, lon, band)
    ri, ci = int(round(float(row))), int(round(float(col)))
    k = int(np.ceil(radius_m / BANDS[band]["scale"]))
    n = BANDS[band]["n"]
    if not (k <= ri < n - k and k <= ci < n - k):
        return None
    avg_dn = read_window("AVGVISIB", band, ri - k, ri + k + 1, ci - k, ci + k + 1)
    lpsr_dn = read_window("LPSR", band, ri - k, ri + k + 1, ci - k, ci + k + 1)
    cls = classify(lpsr_dn, avg_dn)
    rr, cc = np.mgrid[-k : k + 1, -k : k + 1]
    dist = np.hypot(rr - (row - ri), cc - (col - ci)) * BANDS[band]["scale"]
    near = {}
    for name, m in (("nearest_lit_low_m", cls >= 2), ("nearest_lit_high_m", cls == 3)):
        m = m & (dist <= radius_m)
        near[name] = int(round(float(dist[m].min()))) if m.any() else None
    return {
        "band": band,
        "lit_pct": round(100 * float(avg_dn[k, k]) * AVG_DN, 1),
        "lit_pct_3x3_max": round(
            100 * float(avg_dn[k - 1 : k + 2, k - 1 : k + 2].max()) * AVG_DN, 1
        ),
        "psr": bool(lpsr_dn[k, k] > 0),
        "class": int(cls[k, k]),
        **near,
    }


def crop_latlon(band: str, size: int, rows, cols):
    """Latitude, east longitude (deg) of fractional pixel positions in a pole-centred crop."""
    b = BANDS[band]
    a, _ = crop_bounds(band, size)
    x = (np.asarray(cols, dtype=float) + a - b["c0"]) * b["scale"]
    y = (b["c0"] - (np.asarray(rows, dtype=float) + a)) * b["scale"]
    psi = 2.0 * np.arctan(np.hypot(x, y) / (2.0 * R_MOON_M))
    lat = b["pole"] * (90.0 - np.degrees(psi))
    return lat, np.degrees(np.arctan2(x, -b["pole"] * y))


def sun_spots(cls: np.ndarray, avg_dn: np.ndarray, band: str, size: int, psi_range: tuple) -> list:
    """The sunlit spots (8-connected groups of class >= 2 pixels) whose centre lies in psi_range (deg).

    One row per spot: [lat, lon (deg), ground area (km^2), largest share of time lit (%)]. The globe
    rings each spot so that it can be found when it is smaller than a screen pixel.
    """
    psi = crop_psi_deg(band, size)
    area = pixel_area_km2(band, psi)
    todo = set(zip(*np.nonzero(cls >= 2), strict=True))
    out = []
    while todo:
        stack = [todo.pop()]
        members = []
        while stack:
            r, c = stack.pop()
            members.append((r, c))
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    q = (r + dr, c + dc)
                    if q in todo:
                        todo.remove(q)
                        stack.append(q)
        rs, cs = np.array(members).T
        w = area[rs, cs]
        rc, cc = float((rs * w).sum() / w.sum()), float((cs * w).sum() / w.sum())
        p = float(
            np.degrees(
                2
                * np.arctan(
                    np.hypot(rc + 0.5 - size / 2, cc + 0.5 - size / 2)
                    * BANDS[band]["scale"]
                    / (2 * R_MOON_M)
                )
            )
        )
        if not (psi_range[0] <= p < psi_range[1]):
            continue
        lat, lon = crop_latlon(band, size, rc, cc)
        out.append(
            [
                round(float(lat), 4),
                round(float(lon), 4),
                round(float(w.sum()), 3),
                round(100 * float(avg_dn[rs, cs].max()) * AVG_DN, 1),
            ]
        )
    return sorted(out, key=lambda s: -s[3])


def build(preview: bool) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    tiers, sizes, stats, agree, classes_by_tier, spots = [], {}, {}, {}, {}, {}
    inner_mid = float(np.mean(next(t for t in TIERS if t["id"] == "south_inner")["fade_psi_deg"]))
    for t in TIERS:
        band, size = t["band"], t["size"]
        print(f"{t['id']}: {band}, {size} px", flush=True)
        lpsr = read_crop("LPSR", band, size)
        avg = read_crop("AVGVISIB", band, size)
        cls = classify(lpsr, avg)
        classes_by_tier[t["id"]] = cls
        psi_max = tier_psi_max_deg(band, size)
        # NASA's PSR map against "average illumination exactly 0" in the same band.
        agree[t["id"]] = {
            "pixels": int(cls.size),
            "lpsr_1": int((lpsr > 0).sum()),
            "avgvisib_0": int((avg == 0).sum()),
            "lpsr_1_and_avgvisib_0": int(((lpsr > 0) & (avg == 0)).sum()),
            "max_lit_pct": round(100 * float(avg.max()) * AVG_DN, 2),
        }
        stats[t["id"]] = area_stats(cls, band, size, psi_max)
        # Each spot from the tier the globe shows at its place (the 60 m map inside the inner fade).
        psi_range = {"south": (inner_mid, psi_max), "south_inner": (0.0, inner_mid)}.get(
            t["id"], (0.0, psi_max)
        )
        spots[t["id"]] = sun_spots(cls, avg, band, size, psi_range)
        url = f"layers_{t['id']}.png"
        lat_lim = BANDS[band]["pole"] * (90.0 - psi_max)
        desc = (
            f"Moonat map layer classes, {t['id']} cap, pole-centred {size} x {size} crop of NASA PGDA "
            f"LPSR_{band}_{RELEASE} and AVGVISIB_{band}_{RELEASE} (to latitude {lat_lim:.2f})"
        )
        sizes[url] = save_png(
            cls,
            url,
            {"source": f"{PRODUCT_PAGE} ({BASE_URL})", "description": desc},
        )
        tier = {
            "id": t["id"],
            "url": url,
            "pole": BANDS[band]["pole"],
            "size": size,
            "m_per_px": BANDS[band]["scale"],
            "psi_max_deg": round(psi_max, 5),
            "products": [f"LPSR_{band}_{RELEASE}", f"AVGVISIB_{band}_{RELEASE}"],
        }
        if "fade_psi_deg" in t:
            tier["fade_psi_deg"] = t["fade_psi_deg"]
        tiers.append(tier)
        print(json.dumps({"stats": stats[t["id"]], "agree": agree[t["id"]]}), flush=True)

    # The 60 m and the 240 m south maps over the inner tier's disc (two DEMs, two computations).
    inner = next(t for t in tiers if t["id"] == "south_inner")
    psi_in = inner["psi_max_deg"]
    s240 = area_stats(classes_by_tier["south"], "65S_240M", 2560, psi_in)
    s60 = stats["south_inner"]
    cross = {
        "within_lat_deg": s60["within_lat_deg"],
        "psr_km2_60m": s60["psr_km2"],
        "psr_km2_240m": s240["psr_km2"],
        "lit_ge_low_km2_60m": s60["lit_ge_low_km2"],
        "lit_ge_low_km2_240m": s240["lit_ge_low_km2"],
        "lit_ge_high_km2_60m": s60["lit_ge_high_km2"],
        "lit_ge_high_km2_240m": s240["lit_ge_high_km2"],
    }

    psr_vs_published = {
        pole: {
            "ours_km2_poleward_of_80": area_stats(classes_by_tier[pole], b, 2560, 10.0)["psr_km2"],
            "mazarico2011_km2": MAZARICO_PSR_KM2[pole],
        }
        for pole, b in (("north", "65N_240M"), ("south", "65S_240M"))
    }
    for v in psr_vs_published.values():
        v["ratio"] = round(v["ours_km2_poleward_of_80"] / v["mazarico2011_km2"], 3)

    points = []
    for pid, name, lat, lon, expect in POINTS:
        psi = 90.0 + lat
        shown = "85S_060M" if psi < inner_mid else "65S_240M"
        row = {
            "id": pid,
            "name": name,
            "lat_deg": lat,
            "lon_deg": lon,
            "expect": expect,
            "globe_shows": shown,
        }
        for band in ("85S_060M", "65S_240M"):
            row[band] = point_value(band, lat, lon)
        points.append(row)
        print(json.dumps(row), flush=True)

    today = datetime.now(UTC).strftime("%Y-%m-%d")
    manifest = {
        "_generated_by": AI_NOTE,
        "format": "moonat-overlays/1",
        "built_utc": today,
        "frame": "MOON_ME (selenographic latitude, east-positive longitude); PGDA: MEAN EARTH/POLAR AXIS OF DE421",
        "source": {
            "name": "NASA GSFC PGDA product 69: Lunar polar illumination (LRO LOLA), release 201608",
            "page": PRODUCT_PAGE,
            "files": BASE_URL,
            "method": "Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T., Torrence, M. H. (2011): "
            "Illumination conditions of the lunar polar regions using LOLA topography. Icarus 211, "
            "1066-1081, doi:10.1016/j.icarus.2010.10.030",
            "credit": "NASA/GSFC LRO LOLA team (PGDA)",
        },
        "layers": [
            {
                "id": "psr",
                "label": "Permanently shadowed regions",
                "definition": "NASA's LPSR map: ground the Sun never reaches directly (AVGVISIB = 0)",
                "channel": "r",
            },
            {
                "id": "sun",
                "label": f"Most sunlit (lit ≥ {100 * LIT_LOW:.0f} % of the time)",
                "definition": "AVGVISIB: share of hourly time steps over an 18.6-year cycle with any part "
                "of the Sun's disc above the terrain horizon, at the surface",
                "thresholds": [LIT_LOW, LIT_HIGH],
                "channel": "g",
                "note": "No point on the Moon is lit all the time at ground level: in these maps the best "
                f"pixels are lit {agree['north']['max_lit_pct']:.1f} % (north) and "
                f"{agree['south']['max_lit_pct']:.1f} % (south) of the time; a few metres above the ground "
                "the best ridges reach about 92-96 % (Glaser et al. 2014).",
            },
        ],
        "classes": CLASSES,
        "encoding": "2-bit palette PNG; decoded red = permanent shadow mask, green = sunlight class "
        f"(0 below {LIT_LOW:.0%}, 0.5 for {LIT_LOW:.0%}-{LIT_HIGH:.0%}, 1 for {LIT_HIGH:.0%} and more)",
        "cap_projection": (
            "polar stereographic on the unit sphere (as web/data/moonmap/moonmap.json): k = 1/(1 + s*uz); "
            "X = k*uy; Y = -s*k*ux; u_tex = 0.5 + X/(2*tan(psi_max/2)); v_tex = 0.5 + Y/(2*tan(psi_max/2)); "
            "image row 0 = v_tex 1 (top). Drawn only where psi <= psi_max (the inscribed circle)."
        ),
        "tiers": tiers,
        "sun_spots": {
            "fields": ["lat_deg", "lon_deg", "area_km2", "max_lit_pct"],
            "definition": f"8-connected groups of pixels lit at least {LIT_LOW:.0%} of the time, each from "
            "the tier the globe shows at its place (60 m inside the south inner fade, 240 m elsewhere)",
            "rows": spots["north"] + spots["south"] + spots["south_inner"],
        },
        "areas_km2": stats,
        "bytes": sizes,
    }
    (OUT / "overlays.json").write_text(
        json.dumps(manifest, indent=1) + "\n", encoding="utf-8", newline="\n"
    )

    checks = {
        "_generated_by": AI_NOTE,
        "built_utc": today,
        "script": "scripts/data/build_map_layers.py",
        "thresholds": [LIT_LOW, LIT_HIGH],
        "psr_area_vs_mazarico2011": psr_vs_published,
        "lpsr_vs_avgvisib_zero": agree,
        "south_60m_vs_240m": cross,
        "points": points,
        "areas_km2": stats,
        "sun_spot_count": {k: len(v) for k, v in spots.items()},
    }
    CHECKS.write_text(json.dumps(checks, indent=1) + "\n", encoding="utf-8", newline="\n")
    total = sum(sizes.values())
    print(json.dumps(sizes, indent=1))
    print(f"total {total / 1e3:.0f} KB; PSR vs Mazarico 2011: {json.dumps(psr_vs_published)}")

    if preview:
        fig = ROOT / "outputs"
        fig.mkdir(exist_ok=True)
        tiles = []
        for tid in ("north", "south", "south_inner"):
            c = classes_by_tier[tid]
            step = max(1, c.shape[0] // 1024)
            rgb = np.array([[40, 40, 40], [70, 90, 255], [255, 150, 30], [255, 230, 40]], np.uint8)[
                c[::step, ::step]
            ]
            tiles.append(rgb[:1024, :1024])
        Image.fromarray(np.concatenate(tiles, axis=1)).save(fig / "map_layers_preview.png")
        print(f"preview: {fig / 'map_layers_preview.png'}")
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--preview", action="store_true", help="write outputs/map_layers_preview.png")
    build(ap.parse_args().preview)


if __name__ == "__main__":
    main()
