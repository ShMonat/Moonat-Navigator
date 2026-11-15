# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Tests for the photo-comparison helpers in scripts/validate_real_photos.py.

Covers the camera model (pinhole, heading, pitch, roll) and the ALSJ table parser.
"""

import importlib.util
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("vrp", ROOT / "scripts" / "validate_real_photos.py")
vrp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vrp)


def test_principal_point_looks_along_heading_and_pitch():
    d = vrp.cam_rays(
        np.array([0.0]), np.array([0.0]), 1000.0, np.array(164.4), np.array(-4.9), np.array(2.0)
    )
    az, el = vrp.az_el(d)
    assert abs(az[0] - 164.4) < 1e-9 and abs(el[0] + 4.9) < 1e-9


def test_pixel_one_focal_length_up_is_45_deg_higher_and_roll_turns_image():
    # level camera, no roll: a pixel f above the centre is 45 deg up, same azimuth
    d = vrp.cam_rays(
        np.array([0.0]), np.array([-1000.0]), 1000.0, np.array(90.0), np.array(0.0), np.array(0.0)
    )
    az, el = vrp.az_el(d)
    assert abs(el[0] - 45.0) < 1e-9 and abs(az[0] - 90.0) < 1e-9
    # a pixel f to the right is 45 deg to the right (clockwise) on the horizon
    d = vrp.cam_rays(
        np.array([1000.0]), np.array([0.0]), 1000.0, np.array(90.0), np.array(0.0), np.array(0.0)
    )
    az, el = vrp.az_el(d)
    assert abs(az[0] - 135.0) < 1e-9 and abs(el[0]) < 1e-9
    # 90 deg of roll moves the "right" pixel to straight up
    d = vrp.cam_rays(
        np.array([1000.0]), np.array([0.0]), 1000.0, np.array(90.0), np.array(0.0), np.array(90.0)
    )
    az, el = vrp.az_el(d)
    assert abs(abs(el[0]) - 45.0) < 1e-9


def test_parse_alsj_table(tmp_path):
    txt = """              Date      T (UT)   e-lon e-lat  e-Alt   e-Az   s-lon s-lat  s-Alt   s-Az
Apollo 15  (+3.6528,  +26.1008)  (Long, Lat)
   Landing 1971 Jul 30 22:16:29  -4.35 +6.84  69.28 203.00   80.33 +0.24  12.05  95.73
   SEVA st          31 00:16:49  -4.44 +6.85  69.26 203.25   79.31 +0.24  12.96  96.20
   EVA2 st      Aug 01 11:48:49  -5.59 +6.51  68.52 205.83   61.23 +0.21  28.89 105.41
   1SSfM1GLfM          02:56:15  -7.25 +2.08  59.30 272.92   99.41 +1.29  14.03  88.84
"""
    p = tmp_path / "t.txt"
    p.write_text(txt)
    rows = vrp.parse_scotti(p)
    assert [r["t_utc"] for r in rows] == [
        "1971-07-30T22:16:29Z",
        "1971-07-31T00:16:49Z",
        "1971-08-01T11:48:49Z",
        "1971-08-01T02:56:15Z",
    ]
    assert rows[0]["lat_deg"] == 26.1008 and rows[0]["lon_deg"] == 3.6528
    assert (
        rows[2]["event"] == "EVA2 st"
        and rows[2]["sun_alt"] == 28.89
        and rows[2]["earth_az"] == 205.83
    )
