# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Tests for moonat.terrain: projections, sampling, horizon geometry and terrain patches.

Synthetic cases have closed-form answers. Real-data checks run only if the LOLA files are already
in the local DEM cache (no network access in tests).
"""

from pathlib import Path

import numpy as np
import pytest

from moonat.terrain import dem as demmod
from moonat.terrain.dem import Layer, LayeredDEM, Window, bilinear
from moonat.terrain.fetch import dem_dir
from moonat.terrain.horizon import (
    horizon_from_sampler,
    horizon_profile,
    ray_schedule,
    stop_angle,
)
from moonat.terrain.patch import terrain_patch_grid
from moonat.terrain.pds import (
    R_MOON_M,
    RasterSpec,
    enu_basis,
    grid_rowcol,
    latlon_from_unit,
    parse_label,
    spec_from_label,
    unit_from_latlon,
)

R = R_MOON_M


def _const_global_dem(h_m: float, lat=0.0, lon=0.0) -> LayeredDEM:
    """A LayeredDEM whose only layer is a 1 px/deg global grid of constant height."""
    spec = RasterSpec(
        name="CONST",
        url="",
        lines=180,
        samples=360,
        record_bytes=720,
        dtype="<i2",
        to_metres=1.0,
        projection="cyl",
        res_ppd=1.0,
        lat_top=90.0,
        lon_left=0.0,
    )
    w = Window(
        spec,
        np.full((180, 360), h_m, dtype=np.float32),
        0,
        0,
        1000.0,
        "synthetic",
        periodic_cols=360,
    )
    return LayeredDEM(lat, lon, [Layer(w, np.inf)])


# ------------------------------------------------------------------------------------------------
# Labels and projections
# ------------------------------------------------------------------------------------------------

POLAR_LABEL = """PDS_VERSION_ID = "PDS3"
RECORD_BYTES              = 60800
^IMAGE                    = "LDEM_80S_20M.IMG"
  OBJECT                  = IMAGE
    LINES                 = 30400
    LINE_SAMPLES          = 30400
    SAMPLE_TYPE           = LSB_INTEGER
    SAMPLE_BITS           = 16
    UNIT                  = METER
    SCALING_FACTOR        = 0.5
    OFFSET                = 1737400.
  END_OBJECT              = IMAGE
 MAP_PROJECTION_TYPE          = "POLAR STEREOGRAPHIC"
 MAP_RESOLUTION               = 1516.17 <pix/deg>
 CENTER_LATITUDE              = -90 <deg>
 CENTER_LONGITUDE             = 0 <deg>
 MAP_SCALE                    = 20 <m/pix>
 LINE_PROJECTION_OFFSET       = 15199.5 <pix>
 SAMPLE_PROJECTION_OFFSET     = 15199.5 <pix>
END
"""

CYL_LABEL = """RECORD_BYTES              = 11520
^IMAGE                    = "LDEM_16.IMG"
    LINES                 = 2880
    LINE_SAMPLES          = 5760
    SAMPLE_TYPE           = LSB_INTEGER
    SAMPLE_BITS           = 16
    UNIT                  = METER
    SCALING_FACTOR        = 0.5
    OFFSET                = 1737400.
 MAP_PROJECTION_TYPE          = "SIMPLE CYLINDRICAL"
 MAP_RESOLUTION               = 16 <pix/deg>
 CENTER_LATITUDE              = 0 <deg>
 CENTER_LONGITUDE             = 180 <deg>
 MAXIMUM_LATITUDE             = 90 <deg>
 WESTERNMOST_LONGITUDE        = 0 <deg>
 LINE_PROJECTION_OFFSET       = 1439.5 <pix>
 SAMPLE_PROJECTION_OFFSET     = 2879.5 <pix>
END
"""


def test_parse_label_strips_units_and_quotes():
    lab = parse_label(POLAR_LABEL)
    assert lab["MAP_SCALE"] == "20"
    assert lab["MAP_PROJECTION_TYPE"] == "POLAR STEREOGRAPHIC"
    assert lab["^IMAGE"] == "LDEM_80S_20M.IMG"


def test_polar_projection_matches_dsmap_polar_inverse():
    """Forward projection vs the inverse equations printed in LOLA's DSMAP_POLAR.CAT."""
    spec = spec_from_label("LDEM_80S_20M", "", POLAR_LABEL)
    assert spec.pole == -1 and spec.to_metres == 0.5
    rng = np.random.default_rng(1)
    lat = rng.uniform(-89.99, -80.5, 50)
    lon = rng.uniform(-180, 180, 50)
    row, col = grid_rowcol(spec, unit_from_latlon(lat, lon))
    # DSMAP_POLAR.CAT, 1-based I (sample) and J (line), N = 30400, NS = -1 (south)
    n = 30400
    x = (col + 1 - n / 2 - 0.5) * 20.0
    y = (row + 1 - n / 2 - 0.5) * 20.0 * -1
    r = np.hypot(x, y)
    lon_back = np.degrees(np.arctan2(x, y))
    lat_back = -90 + np.degrees(2 * np.arctan(0.5 * r / R))
    assert np.allclose(lat_back, lat, atol=1e-9)
    assert np.allclose((lon_back - lon + 180) % 360 - 180, 0, atol=1e-7)
    # orientation: lon 0 straight up, 90 E to the right
    r0, c0 = grid_rowcol(spec, unit_from_latlon(-85.0, 0.0))
    assert r0 < spec.row0 and abs(c0 - spec.col0) < 1e-6
    r9, c9 = grid_rowcol(spec, unit_from_latlon(-85.0, 90.0))
    assert c9 > spec.col0 and abs(r9 - spec.row0) < 1e-6


def test_cylindrical_projection_pixel_centres():
    spec = spec_from_label("LDEM_16", "", CYL_LABEL)
    assert spec.lat_top == 90.0 and spec.lon_left == 0.0
    row, col = grid_rowcol(spec, unit_from_latlon(90 - 1 / 32, 1 / 32))
    assert abs(row) < 1e-9 and abs(col) < 1e-9
    row, col = grid_rowcol(spec, unit_from_latlon(0.0, -90.0))  # lon -90 == 270 E
    assert abs(row - 1439.5) < 1e-9 and abs(col - (270 * 16 - 0.5)) < 1e-9


def test_bilinear_exact_for_linear_field_and_nan_outside():
    a = np.add.outer(np.arange(5) * 2.0, np.arange(6) * 3.0)
    r = np.array([0.0, 1.25, 3.9, 4.0, -0.1])
    c = np.array([0.0, 2.5, 4.99, 5.0, 1.0])
    v = bilinear(a, r, c)
    assert np.allclose(v[:4], 2 * r[:4] + 3 * c[:4])
    assert np.isnan(v[4])


def test_enu_basis_orthonormal_and_north_points_to_pole():
    e, n, u = enu_basis(30.0, 40.0)
    m = np.vstack([e, n, u])
    assert np.allclose(m @ m.T, np.eye(3), atol=1e-12)
    assert np.allclose(np.cross(e, n), u)
    assert n[2] > 0 and abs(e[2]) < 1e-15
    # exactly at the south pole: north = toward lon 0 = +X
    e, n, u = enu_basis(-90.0, 0.0)
    assert np.allclose(n, [1, 0, 0]) and np.allclose(u, [0, 0, -1])


# ------------------------------------------------------------------------------------------------
# Horizon geometry
# ------------------------------------------------------------------------------------------------


def test_stop_angle_bound_is_tight():
    r_eye, rho_max = R + 100.0, R + 5000.0
    for el_star in np.radians([-2.0, -0.1, 0.0, 0.5, 3.0]):
        th = stop_angle(r_eye, np.array([el_star]), rho_max)[0]
        for dth, above in ((-1e-6, True), (1e-6, False)):
            t = th + dth
            el = np.arctan2(rho_max * np.cos(t) - r_eye, rho_max * np.sin(t))
            assert (el > el_star) == above


@pytest.mark.parametrize("h_obs", [2.0, 10.0])
def test_smooth_sphere_horizon_is_geometric_dip(h_obs):
    """Constant-height Moon: el = -acos(rho/(rho + h_obs)) at all azimuths, at the tangent point."""
    H = -1500.0
    s = ray_schedule([20.0, 500.0], [30e3, np.inf], 300e3)
    res = horizon_from_sampler(
        lambda u, s_: np.full(u.shape[:-1], H), 12.0, 34.0, H, h_obs, 0.25, s, R + H + 1.0
    )
    dip = -np.degrees(np.arccos((R + H) / (R + H + h_obs)))
    assert len(res["el_deg"]) == 1440
    assert np.allclose(res["el_deg"], dip, atol=2e-5)
    s_tan = R * np.arccos((R + H) / (R + H + h_obs)) / 1000.0
    assert np.allclose(res["dist_km"], s_tan, atol=0.021)


def test_horizon_profile_contract_keys_on_smooth_sphere():
    lay = _const_global_dem(250.0, 0.0, 10.0)
    hp = horizon_profile(0.0, 10.0, site_id="flat", dem=lay)
    for k in (
        "id",
        "lat_deg",
        "lon_deg",
        "ground_elev_m",
        "observer_height_m",
        "az_step_deg",
        "el_deg",
        "dist_km",
        "max_range_km",
        "dem_sources",
        "_generated_by",
    ):
        assert k in hp
    assert hp["ground_elev_m"] == 250.0 and len(hp["el_deg"]) == 1440
    dip = -np.degrees(np.arccos((R + 250) / (R + 252)))
    assert np.allclose(hp["el_deg"], dip, atol=2e-3)  # 1 km steps on the synthetic grid


def _bearing_deg(lat1, lon1, lat2, lon2):
    """Initial great-circle bearing (deg, clockwise from north): standard spherical formula."""
    p1, p2, dl = np.radians(lat1), np.radians(lat2), np.radians(lon2 - lon1)
    return (
        np.degrees(
            np.arctan2(
                np.sin(dl) * np.cos(p2),
                np.cos(p1) * np.sin(p2) - np.sin(p1) * np.cos(p2) * np.cos(dl),
            )
        )
        % 360
    )


def test_gaussian_hill_angle_azimuth_and_distance():
    """A 2 km Gaussian hill 25 km away at bearing 60 deg: el from a dense 1-D brute force."""
    lat0, lon0, H0 = 30.0, 40.0, 0.0
    D, A0, Hh, sig = 25e3, 60.0, 2000.0, 3000.0
    e, n, up = enu_basis(lat0, lon0)
    dA = np.cos(np.radians(A0)) * n + np.sin(np.radians(A0)) * e
    c = np.cos(D / R) * up + np.sin(D / R) * dA  # hill centre
    clat, clon = latlon_from_unit(c)
    assert abs(_bearing_deg(lat0, lon0, clat, clon) - A0) < 1e-9

    def hill(u, s_=None):
        ang = np.arccos(np.clip(u @ c, -1, 1)) * R
        return H0 + Hh * np.exp(-0.5 * (ang / sig) ** 2)

    s = ray_schedule([20.0, 200.0], [30e3, np.inf], 120e3)
    res = horizon_from_sampler(hill, lat0, lon0, float(hill(up)), 2.0, 0.25, s, R + Hh + 10)
    el, dist = res["el_deg"], res["dist_km"]
    k0 = int(A0 / 0.25)
    assert el.argmax() == k0
    # dense brute force along the exact ray
    th = np.arange(1.0, 60e3, 1.0) / R
    u = np.cos(th)[:, None] * up + np.sin(th)[:, None] * dA
    rho = R + hill(u)
    r_eye = R + float(hill(up)) + 2.0
    el_true = np.arctan2(rho * np.cos(th) - r_eye, rho * np.sin(th))
    assert abs(el[k0] - np.degrees(el_true.max())) < 2e-3
    assert abs(dist[k0] - th[el_true.argmax()] * R / 1000.0) < 0.05
    # sanity: about atan((2000 - 2)/D) minus curvature D/(2R)
    approx = np.degrees(np.arctan((Hh - 2.0) / D) - D / (2 * R))
    assert abs(el[k0] - approx) < 0.3
    # the opposite direction sees a smooth (slightly sloping) sphere: near the dip
    assert el[(k0 + 720) % 1440] < 0.0


# ------------------------------------------------------------------------------------------------
# Terrain patch
# ------------------------------------------------------------------------------------------------


def test_terrain_patch_curvature_drop_on_smooth_sphere():
    H = 100.0
    lay = _const_global_dem(H, 5.0, 5.0)
    z, meta = terrain_patch_grid(5.0, 5.0, half_extent_m=12000.0, n=33, dem=lay)
    d = meta["spacing_m"]
    assert z.shape == (33, 33) and d == 750.0
    x = -12000.0 + d * np.arange(33)
    X, Y = np.meshgrid(x, x[::-1])
    s = np.hypot(X, Y)
    expect = np.sqrt((R + H) ** 2 - s**2) - (R + H)
    assert np.allclose(z, expect, atol=1e-3)
    assert z[16, 16] == 0.0 and z.min() < -82.0  # corner drop ~ s^2 / 2R = 82.9 m


# ------------------------------------------------------------------------------------------------
# Real data (only if already cached locally)
# ------------------------------------------------------------------------------------------------


def _cached(name: str) -> bool:
    d = dem_dir() / name.lower()
    return (d / f"{name.lower()}.img").exists() and (d / f"{name.lower()}.lbl").exists()


@pytest.mark.skipif(not _cached("LDEM_75S_240M"), reason="LOLA polar 240 m not cached")
def test_real_polar_georeferencing_shackleton_floor():
    """Shackleton floor centre: about -2.77 km at 89.655 S, 129.174 E (Zuber et al. 2012)."""
    w = demmod._whole_window(demmod.polar_source("75", "s", "240m"), -89.6)
    h = w.sample(unit_from_latlon(np.array([-89.655, -89.655]), np.array([129.174, -129.174])))
    assert abs(h[0] - (-2770.0)) < 100.0
    assert h[1] > 0.0  # the mirror-image position is on the rim / massif, not a 2.8 km pit


@pytest.mark.skipif(not _cached("LDEM_16"), reason="LOLA LDEM_16 not cached")
def test_real_apollo11_elevation_ldem16():
    """Apollo 11 LM: -1926 m (LROC / Wagner et al. 2017); LDEM_16 is a 1.9 km average."""
    w = demmod._whole_window(demmod.global_source(16), 0.0)
    h = float(w.sample(unit_from_latlon(0.67416, 23.47314)[None, :])[0])
    assert abs(h - (-1926.0)) < 30.0


# ------------------------------------------------------------------------------------------------
# C5 tiles (committed in web/data/dem/)
# ------------------------------------------------------------------------------------------------

TILES = Path(__file__).resolve().parents[1] / "web" / "data" / "dem"


@pytest.mark.skipif(not (TILES / "manifest.json").exists(), reason="C5 tiles not built")
def test_c5_tiles_manifest_and_georeferencing():
    import json

    from moonat.terrain.tiles import tiles_dem

    man = json.loads((TILES / "manifest.json").read_text(encoding="utf-8"))
    assert man["format"] == "moonat-dem-tiles/1" and man["dtype"] == "int16"
    for lv in man["levels"]:
        ntr, ntc = lv["tiles"]
        f = TILES / lv["url"].format(tr=ntr - 1, tc=ntc - 1)
        assert f.stat().st_size == 2 * lv["tile_size"] ** 2
    # Apollo 11 from global8 (3.8 km mean) and Shackleton floor from south480
    d = tiles_dem(0.67416, 23.47314, TILES)
    assert abs(float(d.sample(unit_from_latlon(0.67416, 23.47314)[None, :])[0]) + 1926) < 40
    d = tiles_dem(-89.6, 129.0, TILES)
    assert d.layers[0].window.spec.name == "south480"
    h = d.sample(unit_from_latlon(np.array([-89.655, -89.655]), np.array([129.174, -129.174])))
    assert h[0] < -2400 and h[1] > 0
