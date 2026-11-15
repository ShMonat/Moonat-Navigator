# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""The globe's map layers (scripts/data/build_map_layers.py): projection, crops, classes, areas.

No network: the geometry is checked against closed forms and the globe's cap projection, the
classes against synthetic DNs, and the shipped manifest against the script's constants.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "build_map_layers", ROOT / "scripts" / "data" / "build_map_layers.py"
)
B = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(B)

R_KM = 1737.4


def test_pgda_rowcol_pole_and_axes():
    """Pole at the raster centre; south: lon 0 up (row decreases), 90 E right; north: lon 0 down."""
    for band in ("65S_240M", "65N_240M", "85S_060M"):
        b = B.BANDS[band]
        r, c = B.pgda_rowcol(b["pole"] * 90.0, 0.0, band)
        assert r == pytest.approx(b["c0"]) and c == pytest.approx(b["c0"])
    rho_px = 2 * 1737400.0 * np.tan(np.radians(5.0)) / 240.0  # 80 deg latitude, 240 m pixels
    r, c = B.pgda_rowcol(-80.0, 0.0, "65S_240M")
    assert r == pytest.approx(3209.5 - rho_px) and c == pytest.approx(3209.5)
    r, c = B.pgda_rowcol(-80.0, 90.0, "65S_240M")
    assert r == pytest.approx(3209.5) and c == pytest.approx(3209.5 + rho_px)
    r, c = B.pgda_rowcol(80.0, 0.0, "65N_240M")
    assert r == pytest.approx(3209.5 + rho_px) and c == pytest.approx(3209.5)
    r, c = B.pgda_rowcol(80.0, 90.0, "65N_240M")
    assert c == pytest.approx(3209.5 + rho_px)


def test_crops_are_pole_centred_cap_textures():
    """A centred crop is the globe's cap texture: crop_latlon = the moonmap cap projection."""
    assert B.crop_bounds("65S_240M", 2560) == (1930, 4490)
    assert B.crop_bounds("85S_060M", 2048) == (1505, 3553)
    for band, size in (("65S_240M", 2560), ("65N_240M", 2560), ("85S_060M", 2048)):
        s = B.BANDS[band]["pole"]
        rmax = np.tan(np.radians(B.tier_psi_max_deg(band, size)) / 2)
        i = np.array([0, 17, size // 2, size - 1, 900])
        j = np.array([5, size - 3, size // 2 - 1, 0, 1700])
        # moonmap.json cap_projection, inverted: X right, Y up, row 0 at the top
        x = ((j + 0.5) / size - 0.5) * 2 * rmax
        y = -((i + 0.5) / size - 0.5) * 2 * rmax
        psi = np.degrees(2 * np.arctan(np.hypot(x, y)))
        lat_cap = s * (90.0 - psi)
        lon_cap = np.degrees(np.arctan2(x, -s * y))
        lat, lon = B.crop_latlon(band, size, i, j)
        np.testing.assert_allclose(lat, lat_cap, atol=1e-9)
        np.testing.assert_allclose(lon, lon_cap, atol=1e-9)
        # and back through the PGDA projection to the same raster pixels
        a, _ = B.crop_bounds(band, size)
        r, c = B.pgda_rowcol(lat, lon, band)
        np.testing.assert_allclose(r, i + a, atol=1e-6)
        np.testing.assert_allclose(c, j + a, atol=1e-6)


def test_tier_coverage_reaches_80_degrees():
    assert 90 - B.tier_psi_max_deg("65S_240M", 2560) == pytest.approx(79.895, abs=1e-3)
    assert 90 - B.tier_psi_max_deg("85S_060M", 2048) == pytest.approx(87.974, abs=1e-3)


def test_pixel_areas_sum_to_the_spherical_cap():
    """Pixel ground areas within psi_max sum to 2 pi R^2 (1 - cos psi_max).

    Uses the stereographic scale factor k = 2 / (1 + cos psi).
    """
    band, size = "65S_240M", 1024
    psi = B.crop_psi_deg(band, size)
    lim = B.tier_psi_max_deg(band, size)
    area = B.pixel_area_km2(band, psi)[psi <= lim].sum()
    exact = 2 * np.pi * R_KM**2 * (1 - np.cos(np.radians(lim)))
    assert area == pytest.approx(exact, rel=2e-3)
    assert B.pixel_area_km2(band, np.array(0.0)) == pytest.approx(0.0576)


def test_classes_from_synthetic_dns():
    """LPSR DN +20000 -> PSR; AVGVISIB DN x 0.00004 >= 0.70 / 0.80 -> the two sunlight classes."""
    lpsr = np.array([[20000, -20000, -20000, -20000, -20000]], np.int16)
    avg = np.array([[0, 17499, 17500, 19999, 20000]], np.int16)
    assert B.classify(lpsr, avg).tolist() == [[1, 0, 2, 2, 3]]
    assert (B.LIT_LOW, B.LIT_HIGH) == (0.70, 0.80)


def test_sun_spots_group_pixels():
    """Two separate groups of lit pixels -> two spots, brightest first, with their areas."""
    size = 64
    cls = np.zeros((size, size), np.uint8)
    avg = np.zeros((size, size), np.int16)
    cls[10:12, 10:12] = 2
    avg[10:12, 10:12] = 18000
    cls[40, 50] = 3
    avg[40, 50] = 21000
    spots = B.sun_spots(cls, avg, "85S_060M", size, (0.0, 90.0))
    assert len(spots) == 2
    assert spots[0][3] == pytest.approx(84.0) and spots[1][3] == pytest.approx(72.0)
    assert spots[1][2] == pytest.approx(
        4 * 0.0036, abs=5e-4
    )  # four 60 m pixels, rounded to 0.001 km^2
    assert all(s[0] < -89.0 for s in spots)


def test_shipped_manifest_matches_the_script():
    m = json.loads(
        (ROOT / "web" / "data" / "overlays" / "overlays.json").read_text(encoding="utf-8")
    )
    assert m["_generated_by"] == B.AI_NOTE
    assert m["source"]["page"] == B.PRODUCT_PAGE
    sun = next(layer for layer in m["layers"] if layer["id"] == "sun")
    assert sun["thresholds"] == [B.LIT_LOW, B.LIT_HIGH]
    assert [t["id"] for t in m["tiers"]] == [t["id"] for t in B.TIERS]
    for t in m["tiers"]:
        band = next(x["band"] for x in B.TIERS if x["id"] == t["id"])
        assert t["psi_max_deg"] == pytest.approx(B.tier_psi_max_deg(band, t["size"]), abs=1e-5)
        assert (ROOT / "web" / "data" / "overlays" / t["url"]).stat().st_size == m["bytes"][
            t["url"]
        ]
    assert sum(m["bytes"].values()) < 400_000
