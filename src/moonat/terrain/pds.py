# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""PDS3 labels of LOLA / SLDEM2015 rasters and their map projections.

Every grid maps unit vectors in the Moon-fixed frame (MOON_ME, the frame of LOLA products) to
fractional pixel coordinates (row, col). Pixel centres sit on integers, row 0 / col 0 is the first
pixel of the image, rows increase downwards. Heights in the rasters are relative to the 1737.4 km
reference sphere (LOLA convention).

Projection equations follow the PDS catalog files of the LOLA GDR archive:
- ``DSMAP.CAT`` (simple cylindrical):
  ``row = LINE_PROJECTION_OFFSET - (lat - CENTER_LATITUDE) * res``,
  ``col = SAMPLE_PROJECTION_OFFSET + (lon - CENTER_LONGITUDE) * res`` (0-based, pixel registered).
- ``DSMAP_POLAR.CAT`` (polar stereographic, spherical R = 1737.4 km): ``X = r sin(lon)``,
  ``Y = r cos(lon)`` with ``r = 2 R tan(psi / 2)`` (psi = angular distance from the pole),
  Y positive Earthward (toward lon 0). In the south, lon 0 points up and 90 E right; in the north,
  lon 0 points down and 90 E right.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np

R_MOON_M = 1737400.0  # LOLA reference sphere radius (m)


def parse_label(text: str) -> dict[str, str]:
    """Parse the ``KEY = VALUE`` pairs of a PDS3 label into a flat dict (units and quotes stripped).

    Multi-line quoted values are kept as one string. Nested OBJECT structure is ignored, which is
    safe for the keys used here (they are unique in LOLA labels).
    """
    out: dict[str, str] = {}
    key = None
    buf = ""
    for raw in text.splitlines():
        line = raw.split("/*")[0].rstrip() if "/*" in raw and key is None else raw.rstrip()
        if key is not None:  # continuation of a multi-line quoted value
            buf += " " + line.strip()
            if buf.count('"') % 2 == 0:
                out[key] = buf.strip().strip('"')
                key = None
            continue
        m = re.match(r"^\s*([\^A-Z_0-9:]+)\s*=\s*(.*)$", line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        if v.count('"') % 2 == 1:
            key, buf = k, v
            continue
        v = re.sub(r"<[^>]*>", "", v).strip().strip('"').strip("'").strip()
        out[k] = v
    return out


@dataclass(frozen=True)
class RasterSpec:
    """Geometry and encoding of one PDS IMG raster (no data)."""

    name: str  # product id, e.g. "LDEM_80S_20M"
    url: str  # URL of the .IMG file
    lines: int
    samples: int
    record_bytes: int
    dtype: str  # numpy dtype string, little-endian
    to_metres: float  # height_m = DN * to_metres
    projection: str  # "cyl" or "ps"
    # simple cylindrical
    res_ppd: float = 0.0
    lat_top: float = 0.0  # latitude of the top edge (deg)
    lon_left: float = 0.0  # longitude of the left edge (deg, 0..360)
    # polar stereographic
    pole: int = 0  # -1 south, +1 north
    scale_m: float = 0.0  # metres per pixel at the pole (exact)
    row0: float = 0.0  # row of the pole (0-based)
    col0: float = 0.0  # col of the pole (0-based)

    @property
    def bytes_per_px(self) -> int:
        return np.dtype(self.dtype).itemsize

    @property
    def file_bytes(self) -> int:
        return self.lines * self.record_bytes


def spec_from_label(name: str, url: str, label_text: str) -> RasterSpec:
    """Build a :class:`RasterSpec` from PDS3 label text, checking the assumptions we rely on."""
    lab = parse_label(label_text)
    bits = int(lab["SAMPLE_BITS"])
    stype = lab["SAMPLE_TYPE"]
    if stype == "LSB_INTEGER" and bits == 16:
        dtype = "<i2"
    elif stype == "PC_REAL" and bits == 32:
        dtype = "<f4"
    else:
        raise ValueError(f"{name}: unsupported SAMPLE_TYPE {stype}/{bits}")
    unit = lab.get("UNIT", "METER").upper()
    scale = float(lab["SCALING_FACTOR"]) * (1000.0 if unit.startswith("KILOMETER") else 1.0)
    offset = float(lab["OFFSET"]) * (1000.0 if unit.startswith("KILOMETER") else 1.0)
    if abs(offset - R_MOON_M) > 1e-6:
        raise ValueError(f"{name}: reference radius {offset} m != {R_MOON_M} m")
    pointer = lab.get("^IMAGE", "")
    if "," in pointer:  # attached label with a record offset: not used by these products
        raise ValueError(f"{name}: attached label / record offset not supported: {pointer}")
    lines, samples = int(lab["LINES"]), int(lab["LINE_SAMPLES"])
    rb = int(lab["RECORD_BYTES"])
    if rb != samples * bits // 8:
        raise ValueError(f"{name}: RECORD_BYTES {rb} != LINE_SAMPLES * bytes")
    lpo = float(lab["LINE_PROJECTION_OFFSET"])
    spo = float(lab["SAMPLE_PROJECTION_OFFSET"])
    ptype = lab["MAP_PROJECTION_TYPE"].upper()
    common = dict(
        name=name,
        url=url,
        lines=lines,
        samples=samples,
        record_bytes=rb,
        dtype=dtype,
        to_metres=scale,
    )
    if ptype == "SIMPLE CYLINDRICAL":
        res = float(lab["MAP_RESOLUTION"])
        clat = float(lab["CENTER_LATITUDE"])
        clon = float(lab["CENTER_LONGITUDE"])
        lat_top = clat + (lpo + 0.5) / res
        lon_left = (clon - (spo + 0.5) / res) % 360.0
        # Cross-check with the stated extent of the tile.
        if abs(lat_top - float(lab["MAXIMUM_LATITUDE"])) > 1e-6:
            raise ValueError(f"{name}: lat_top {lat_top} != MAXIMUM_LATITUDE")
        west = float(lab["WESTERNMOST_LONGITUDE"]) % 360.0
        if abs(lon_left - west) > 1e-6:
            raise ValueError(f"{name}: lon_left {lon_left} != WESTERNMOST_LONGITUDE {west}")
        return RasterSpec(
            **common, projection="cyl", res_ppd=res, lat_top=lat_top, lon_left=lon_left
        )
    if ptype == "POLAR STEREOGRAPHIC":
        clat = float(lab["CENTER_LATITUDE"])
        pole = -1 if clat < 0 else 1
        scale_m = float(lab["MAP_SCALE"])
        if abs(lpo - (lines - 1) / 2) > 1e-6 or abs(spo - (samples - 1) / 2) > 1e-6:
            raise ValueError(f"{name}: projection pole is not at the image centre")
        if float(lab["CENTER_LONGITUDE"]) != 0.0:
            raise ValueError(f"{name}: CENTER_LONGITUDE != 0")
        return RasterSpec(**common, projection="ps", pole=pole, scale_m=scale_m, row0=lpo, col0=spo)
    raise ValueError(f"{name}: unsupported projection {ptype}")


# --------------------------------------------------------------------------------------------
# Geometry helpers (MOON_ME frame, spherical Moon)
# --------------------------------------------------------------------------------------------


def unit_from_latlon(lat_deg, lon_deg) -> np.ndarray:
    """Unit vector(s) in MOON_ME (..., 3) from planetocentric latitude / east longitude (deg)."""
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    cl = np.cos(lat)
    return np.stack([cl * np.cos(lon), cl * np.sin(lon), np.sin(lat)], axis=-1)


def latlon_from_unit(u: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Planetocentric latitude and east longitude in -180..180 (deg) of unit vectors (..., 3)."""
    lat = np.degrees(np.arctan2(u[..., 2], np.hypot(u[..., 0], u[..., 1])))
    lon = np.degrees(np.arctan2(u[..., 1], u[..., 0]))
    return lat, lon


def enu_basis(lat_deg: float, lon_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Local (east, north, up) unit vectors in MOON_ME at a site (docs/CONTRACTS.md §0).

    up = Moon-centre -> site direction (not the terrain normal). north = projection of the spin
    axis (+Z) on the horizontal plane; exactly at a pole (|lat| > 89.9999 deg) north is taken as the
    direction toward the 0 deg meridian, as the contract specifies.
    """
    up = unit_from_latlon(lat_deg, lon_deg)
    if abs(lat_deg) > 89.9999:
        # Toward lon 0: from the south pole that is +X; from the north pole also +X.
        north = np.array([1.0, 0.0, 0.0])
        north = north - np.dot(north, up) * up
        north /= np.linalg.norm(north)
        east = np.cross(north, up)
        return east, north, up
    lon = np.radians(lon_deg)
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.cross(up, east)
    return east, north, up


def grid_rowcol(spec: RasterSpec, u: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Fractional full-image (row, col) of unit vectors u (..., 3) in the raster ``spec``.

    For cylindrical rasters the column is not wrapped; callers handle longitude periodicity.
    """
    if spec.projection == "cyl":
        lat, lon = latlon_from_unit(u)
        row = (spec.lat_top - lat) * spec.res_ppd - 0.5
        col = ((lon - spec.lon_left) % 360.0) * spec.res_ppd - 0.5
        return row, col
    s = spec.pole
    # r = 2R tan(psi/2), psi from the pole: cos(psi) = s*uz; r*sin(lon) = k*uy, r*cos(lon) = k*ux
    with np.errstate(divide="ignore", invalid="ignore"):  # the opposite pole maps to infinity
        k = 2.0 * R_MOON_M / (1.0 + s * u[..., 2])
        x = k * u[..., 1]
        y_up = -s * k * u[..., 0]
    return spec.row0 - y_up / spec.scale_m, spec.col0 + x / spec.scale_m


def ps_cell_m(spec: RasterSpec, lat_deg: float) -> float:
    """Ground size (m) of one polar-stereographic pixel at latitude ``lat_deg`` (sphere)."""
    psi = np.radians(90.0 - abs(lat_deg))
    return spec.scale_m * (1.0 + np.cos(psi)) / 2.0


def cyl_cell_m(spec: RasterSpec) -> float:
    """North-south ground size (m) of one cylindrical pixel (the larger of the two dimensions)."""
    return np.pi * R_MOON_M / 180.0 / spec.res_ppd
