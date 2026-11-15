# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""The globe's LOLA base maps and contour lines (scripts/data/build_base_maps.py).

No DEM needed: the contour rasteriser is checked on small synthetic DEMs with known iso-lines,
the shading and ramp against closed forms, and the shipped manifest against the script's constants.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "build_base_maps", ROOT / "scripts" / "data" / "build_base_maps.py"
)
B = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(B)


def test_contours_on_a_plane_sit_at_the_levels_with_the_set_widths():
    """h = 100 m per px along x: levels every 1000 m at columns 0, 10, 20, ...; index every 5th."""
    x = np.arange(64, dtype=float)
    h = np.tile(100.0 * x, (8, 1))
    minor, index = B.contour_coverage(h, 1000.0, 5, 1.2, 2.0)
    row_m, row_i = minor[4], index[4]
    # Minor lines at 10, 20, 30, 40, 60 (not 0 and 50: those are index lines).
    for c in (10, 20, 30, 40, 60):
        assert row_m[c] == pytest.approx(1.0)
        assert row_i[c] == 0.0
    for c in (0, 50):
        assert row_i[c] == pytest.approx(1.0)
        assert row_m[c] == 0.0
    # Box-filtered width: the coverage summed across one line equals its width in px.
    assert row_m[7:14].sum() == pytest.approx(1.2, abs=1e-9)
    assert row_i[46:55].sum() == pytest.approx(2.0, abs=1e-9)
    # Nothing between the lines.
    assert row_m[15] == 0.0 and row_i[15] == 0.0


def test_contours_of_a_cone_are_circles_at_the_expected_radii():
    """h = 50 m per px from the centre: 250 m contours are circles of radius 5, 10, 15, ... px."""
    n = 81
    yy, xx = np.mgrid[0:n, 0:n] - 40.0
    r = np.hypot(xx, yy)
    h = 50.0 * r
    minor, index = B.contour_coverage(h, 250.0, 4, 1.2, 2.0)
    line = np.maximum(minor, index)
    for rad in (10.0, 15.0, 25.0, 30.0):  # minor and index circles
        ring = np.abs(r - rad) < 0.3
        assert line[ring].mean() > 0.9, rad
    between = np.abs(r - 12.5) < 0.3
    assert line[between].max() == 0.0
    # Index circles (every 4th level: 1000 m = 20 px) are in the index channel.
    assert index[np.abs(r - 20.0) < 0.3].mean() > 0.9
    assert minor[np.abs(r - 20.0) < 0.3].max() == 0.0


def test_flat_floor_at_a_level_gives_no_blob():
    """A flat floor lying 3 m off a level: no gradient, so no line (not a filled blob)."""
    h = np.full((20, 20), 1003.0)
    minor, index = B.contour_coverage(h, 1000.0, 5, 1.2, 2.0)
    assert minor.max() == 0.0 and index.max() == 0.0


def test_palette_png_classes():
    minor = np.array([[0.0, 1.0, 0.0]])
    index = np.array([[0.0, 0.0, 1.0]])
    img = B.contour_palette_image(minor, index).convert("RGB")
    assert [img.getpixel((i, 0)) for i in range(3)] == [(0, 0, 0), (255, 0, 0), (0, 255, 0)]


def test_smooth_keeps_a_plane_and_wraps_longitude():
    a = np.tile(np.arange(30, dtype=float), (30, 1)) * 2.0 + 5.0
    s = B.smooth(a, 1.5)
    assert np.allclose(s[10:20, 10:20], a[10:20, 10:20])
    # A wrapped seam: a column of ones at the left edge spreads to the right edge.
    b = np.zeros((5, 40))
    b[:, 0] = 1.0
    assert B.smooth(b, 1.0, wrap_cols=True)[2, -1] > 0.1
    assert B.smooth(b, 1.0, wrap_cols=False)[2, -1] == 0.0


def test_hillshade_flat_and_relief_factor():
    flat = B.mm.AMBIENT + (1 - B.mm.AMBIENT) * np.sin(np.radians(B.mm.LIGHT_ALT_DEG))
    hs = B.hillshade_equirect(np.zeros((16, 32)), 3.0)
    assert np.allclose(hs, flat)
    assert np.allclose(B.relief(hs), 1.0)
    # A slope facing the light (rising to the south-east, light from the north-west) is brighter.
    rows, cols = np.mgrid[0:16, 0:32]
    tilt = B.hillshade_equirect(200.0 * (rows + cols).astype(float), 3.0)
    assert tilt[8, 8:24].mean() > flat


def test_ramp_ends_and_stops():
    stops = B.ramp_stops()
    assert len(stops) == B.RAMP_STOPS
    assert stops[0] == {"km": -8.0, "hex": "#440154"}  # viridis ends
    assert stops[-1] == {"km": 8.0, "hex": "#fde725"}
    lo, hi = B.ramp_rgb(np.array([-20000.0, 20000.0]))
    assert np.allclose(lo, B.ramp_rgb(np.array(-8000.0)))  # clipped beyond the range
    assert np.allclose(hi, B.ramp_rgb(np.array(8000.0)))


def test_shipped_manifest_matches_the_script():
    m = json.loads(
        (ROOT / "web" / "data" / "basemaps" / "basemaps.json").read_text(encoding="utf-8")
    )
    assert m["_generated_by"] == B.AI_NOTE
    assert m["contours"]["global"]["interval_m"] == B.INTERVALS["global"]["interval_m"] == 1000.0
    assert m["contours"]["global"]["index_every"] == 5
    assert all(c["interval_m"] == 250.0 and c["index_every"] == 4 for c in m["contours"]["caps"])
    assert m["contours"]["switch_lat_deg"] == 80.0
    assert m["elevation"]["ramp"]["stops"] == B.ramp_stops()
    moon = json.loads(
        (ROOT / "web" / "data" / "moonmap" / "moonmap.json").read_text(encoding="utf-8")
    )
    imagery = {c["id"]: c for c in moon["caps"]}
    for kind in ("elevation", "plain"):
        for c in m[kind]["caps"]:  # same cap geometry as the imagery: the globe swaps textures only
            assert c["psi_max_deg"] == imagery[c["id"]]["psi_max_deg"]
            assert c["fade_psi_deg"] == imagery[c["id"]]["fade_psi_deg"]
    total = 0
    for name, size in m["bytes"].items():
        assert (ROOT / "web" / "data" / "basemaps" / name).stat().st_size == size
        total += size
    assert total < 4_000_000
