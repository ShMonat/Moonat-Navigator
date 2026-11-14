# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""LOLA DEM sources, site windows and multi-resolution height sampling.

Heights are metres above the 1737.4 km reference sphere, in the MOON_ME frame (LOLA convention).
Sampling is bilinear in the native pixel grid of each product.

Layers per site (finest first; each covers a distance band from the site):
- near (to ``NEAR_RADIUS_M``): LOLA polar stereographic 20 m (80-90 deg), 30 m (75-90 deg) or
  60 m (60-90 deg); SLDEM2015 512 px/deg (about 59 m) within +-60 deg latitude.
- mid (to ``MID_RADIUS_M``): LOLA polar 240 m (75-90 deg, whole file) near the poles, else LDEM_64
  (about 474 m).
- far: LOLA LDEM_16 (about 1.9 km, whole global file).
A sample that falls outside a layer's window takes the next coarser layer's value.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .fetch import RemoteRaster
from .pds import (
    R_MOON_M,
    RasterSpec,
    cyl_cell_m,
    enu_basis,
    grid_rowcol,
    ps_cell_m,
    unit_from_latlon,
)

PDS = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data"
GDR = f"{PDS}/lola_gdr"
SLDEM = f"{PDS}/sldem2015/tiles/float_img"

NEAR_RADIUS_M = 30_000.0
MID_RADIUS_M = 150_000.0

# Human-readable citations used in the "dem_sources" field of the outputs.
CITATION = {
    "LDEM_16": "LOLA LDEM_16 (16 px/deg, ~1.9 km), LRO-L-LOLA-4-GDR-V1.0, NASA PDS Geosciences",
    "LDEM_64": "LOLA LDEM_64 (64 px/deg, ~474 m), LRO-L-LOLA-4-GDR-V1.0, NASA PDS Geosciences",
    "SLDEM2015_512": "SLDEM2015 LOLA+SELENE TC (512 px/deg, ~59 m; Barker et al. 2016), NASA PDS",
}


def _polar_citation(name: str) -> str:
    return f"LOLA {name} (polar stereographic), LRO-L-LOLA-4-GDR-V1.0, NASA PDS Geosciences Node"


_cache: dict[str, object] = {}


def polar_source(lat_band: str, pole: str, res: str) -> RemoteRaster:
    """A LOLA polar stereographic product, e.g. ``polar_source("80", "s", "20m")``."""
    name = f"LDEM_{lat_band}{pole.upper()}_{res.upper()}"
    if name not in _cache:
        base = f"{GDR}/polar/img/ldem_{lat_band}{pole}_{res}"
        _cache[name] = RemoteRaster(name, base + ".img", base + ".lbl")
    return _cache[name]


def global_source(ppd: int) -> RemoteRaster:
    """A LOLA global simple-cylindrical product (``ppd`` = 4, 16, 64)."""
    name = f"LDEM_{ppd}"
    if name not in _cache:
        base = f"{GDR}/cylindrical/img/ldem_{ppd}"
        _cache[name] = RemoteRaster(name, base + ".img", base + ".lbl")
    return _cache[name]


class SldemMosaic:
    """SLDEM2015 512 px/deg tiles (45 x 30 deg, float32 km) seen as one virtual raster.

    Virtual grid: lat 60..-60 (rows), lon 0..360 (cols), 512 px/deg, pixel registered. Each tile's
    label is checked to sit exactly at its place in the virtual grid.
    """

    name = "SLDEM2015_512"
    TILE_ROWS, TILE_COLS = 30 * 512, 45 * 512
    _BANDS = ["30n_60n", "00n_30n", "30s_00s", "60s_30s"]

    def __init__(self):
        self.spec = RasterSpec(
            name=self.name,
            url="",
            lines=120 * 512,
            samples=360 * 512,
            record_bytes=0,
            dtype="<f4",
            to_metres=1000.0,
            projection="cyl",
            res_ppd=512.0,
            lat_top=60.0,
            lon_left=0.0,
        )
        self._tiles: dict[tuple[int, int], RemoteRaster] = {}

    def _tile(self, i: int, j: int) -> RemoteRaster:
        if (i, j) not in self._tiles:
            lon0 = 45 * j
            fname = f"sldem2015_512_{self._BANDS[i]}_{lon0:03d}_{lon0 + 45:03d}_float"
            t = RemoteRaster(
                f"SLDEM2015_512_{self._BANDS[i]}_{lon0:03d}".upper(),
                f"{SLDEM}/{fname}.img",
                f"{SLDEM}/{fname}.lbl",
            )
            ts = t.spec
            assert ts.res_ppd == 512 and ts.lines == self.TILE_ROWS
            assert ts.samples == self.TILE_COLS
            assert abs(ts.lat_top - (60 - 30 * i)) < 1e-9 and abs(ts.lon_left - lon0) < 1e-9
            self._tiles[(i, j)] = t
        return self._tiles[(i, j)]

    def read(self, r0: int, r1: int, c0: int, c1: int, download: bool = True) -> np.ndarray:
        out = np.full((r1 - r0, c1 - c0), np.nan, dtype=np.float32)
        nc = self.spec.samples
        for i in range(4):
            ta, tb = i * self.TILE_ROWS, (i + 1) * self.TILE_ROWS
            ra, rb = max(r0, ta), min(r1, tb)
            if ra >= rb:
                continue
            # walk the (possibly wrapping) column range
            c = c0
            while c < c1:
                cw = c % nc
                j = cw // self.TILE_COLS
                seg_end = min(c1, c + (self.TILE_COLS - cw % self.TILE_COLS))
                lc0 = cw - j * self.TILE_COLS
                out[ra - r0 : rb - r0, c - c0 : seg_end - c0] = self._tile(i, j).read(
                    ra - ta, rb - ta, lc0, lc0 + (seg_end - c), download
                )
                c = seg_end
        return out


def sldem_source() -> SldemMosaic:
    if "SLDEM" not in _cache:
        _cache["SLDEM"] = SldemMosaic()
    return _cache["SLDEM"]


# ------------------------------------------------------------------------------------------------
# Windows and bilinear sampling
# ------------------------------------------------------------------------------------------------


@dataclass
class Window:
    """A rectangular block of a raster held in memory, with bilinear sampling by unit vector."""

    spec: RasterSpec
    data: np.ndarray  # float32 heights (m), NaN = no data
    r0: int
    c0: int
    cell_m: float  # nominal ground pixel size at the site (m)
    citation: str
    periodic_cols: int | None = None  # number of columns in 360 deg (cylindrical) or None

    def sample(self, u: np.ndarray) -> np.ndarray:
        """Bilinear height (m) at unit vectors ``u`` (..., 3); NaN outside the window."""
        row, col = grid_rowcol(self.spec, u)
        r = row - self.r0
        c = col - self.c0
        if self.periodic_cols:
            c = np.mod(c, self.periodic_cols)
        return bilinear(self.data, r, c)


def bilinear(a: np.ndarray, r: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Bilinear interpolation of 2-D array ``a`` at fractional (row, col); NaN outside."""
    nr, nc = a.shape
    r = np.asarray(r, dtype=np.float64)
    c = np.asarray(c, dtype=np.float64)
    ok = (r >= 0) & (r <= nr - 1) & (c >= 0) & (c <= nc - 1)
    rf = np.where(ok, r, 0.0)
    cf = np.where(ok, c, 0.0)
    i = np.minimum(np.floor(rf).astype(np.int64), nr - 2)
    j = np.minimum(np.floor(cf).astype(np.int64), nc - 2)
    fr = rf - i
    fc = cf - j
    v = (
        a[i, j] * (1 - fr) * (1 - fc)
        + a[i, j + 1] * (1 - fr) * fc
        + a[i + 1, j] * fr * (1 - fc)
        + a[i + 1, j + 1] * fr * fc
    )
    return np.where(ok, v, np.nan)


def window_around(
    src,
    lat_deg: float,
    lon_deg: float,
    radius_m: float,
    cell_m: float,
    citation: str,
    pad: int = 3,
    download: bool = True,
) -> Window:
    """Read the part of ``src`` covering a disk of ground radius ``radius_m`` around a site.

    With ``download=False`` only already-cached blocks are used (the rest is NaN, so sampling falls
    back to the next coarser layer); used by site searches to stay inside the download budget.
    """
    spec = src.spec
    east, north, up = enu_basis(lat_deg, lon_deg)
    th = radius_m / R_MOON_M
    az = np.radians(np.arange(0.0, 360.0, 2.0))
    d = np.cos(az)[:, None] * north + np.sin(az)[:, None] * east
    # ring at the radius plus a few inner rings (the bbox of a disk around a pole is not its rim)
    pts = [up[None, :]]
    for f in (0.25, 0.5, 0.75, 1.0):
        pts.append(np.cos(f * th) * up + np.sin(f * th) * d)
    u = np.concatenate(pts)
    row, col = grid_rowcol(spec, u)
    periodic = None
    if spec.projection == "cyl" and abs(spec.samples / spec.res_ppd - 360.0) < 1e-9:
        periodic = spec.samples
        c_site = col[0]
        col = c_site + (np.mod(col - c_site + periodic / 2, periodic) - periodic / 2)
    r0 = int(np.floor(row.min())) - pad
    r1 = int(np.ceil(row.max())) + pad + 1
    c0 = int(np.floor(col.min())) - pad
    c1 = int(np.ceil(col.max())) + pad + 1
    if spec.projection == "cyl" and abs(lat_deg) + np.degrees(th) > 89.0:
        # the disk touches a pole: take all longitudes up to the pole row
        c0, c1 = 0, spec.samples
        if lat_deg > 0:
            r0 = -pad
        else:
            r1 = spec.lines + pad
    data = src.read(r0, r1, c0, c1, download=download)
    return Window(spec, data, r0, c0, cell_m, citation, periodic)


def _ps_contains(spec: RasterSpec, lat_deg: float, lon_deg: float, radius_m: float) -> bool:
    east, north, up = enu_basis(lat_deg, lon_deg)
    th = radius_m / R_MOON_M
    az = np.radians(np.arange(0.0, 360.0, 5.0))
    d = np.cos(az)[:, None] * north + np.sin(az)[:, None] * east
    u = np.cos(th) * up + np.sin(th) * d
    row, col = grid_rowcol(spec, u)
    return bool(
        (row.min() >= 1)
        & (row.max() <= spec.lines - 2)
        & (col.min() >= 1)
        & (col.max() <= spec.samples - 2)
    )


@dataclass
class Layer:
    window: Window
    s_max_m: float  # this layer serves ray distances up to s_max_m (ground metres)


@dataclass
class LayeredDEM:
    """Multi-resolution heights around one site: near, mid and far layers."""

    lat_deg: float
    lon_deg: float
    layers: list[Layer] = field(default_factory=list)

    @property
    def sources(self) -> list[str]:
        return [ly.window.citation for ly in self.layers]

    def sample(self, u: np.ndarray, s_m: np.ndarray | float | None = None) -> np.ndarray:
        """Height (m) at unit vectors ``u``. With ``s_m`` (ground distance from the site), each
        point uses the finest layer whose band contains it, falling back to coarser layers where
        that layer has no data. Without ``s_m`` the finest layer with data is used."""
        shape = u.shape[:-1]
        h = np.full(shape, np.nan)
        if s_m is None:
            s_m = np.zeros(shape)
        s_m = np.broadcast_to(np.asarray(s_m, dtype=float), shape)
        last = len(self.layers) - 1
        for k, ly in enumerate(self.layers):
            # this layer's band, plus closer points that the finer layers left without data
            sel = np.isnan(h) if k == last else np.isnan(h) & (s_m < ly.s_max_m)
            if sel.any():
                h[sel] = ly.window.sample(u[sel])
        return h

    def max_height_m(self, within_rad: float | None = None) -> float:
        """Highest loaded terrain (m). With ``within_rad``, only pixels within that central angle
        of the site count (whole-file layers are masked; site windows are already local)."""
        if within_rad is None:
            return float(max(np.nanmax(ly.window.data) for ly in self.layers))
        up = unit_from_latlon(self.lat_deg, self.lon_deg)
        cmin = np.cos(within_rad)
        best = -np.inf
        for ly in self.layers:
            w = ly.window
            nr, nc = w.data.shape
            if w.spec.projection == "cyl":
                lat = np.radians(w.spec.lat_top - (w.r0 + np.arange(nr) + 0.5) / w.spec.res_ppd)
                lon = np.radians(w.spec.lon_left + (w.c0 + np.arange(nc) + 0.5) / w.spec.res_ppd)
                cosd = np.sin(lat)[:, None] * up[2] + np.cos(lat)[:, None] * (
                    np.cos(lon)[None, :] * up[0] + np.sin(lon)[None, :] * up[1]
                )
            else:
                s = w.spec
                y_up = (s.row0 - (w.r0 + np.arange(nr)))[:, None] * s.scale_m
                x = (w.c0 + np.arange(nc) - s.col0)[None, :] * s.scale_m
                r2 = x * x + y_up * y_up
                k = 4.0 * R_MOON_M**2
                # inverse of pds.grid_rowcol: cos(psi) = (K - r^2)/(K + r^2), K = 4 R^2
                uz = s.pole * (k - r2) / (k + r2)
                f = 4.0 * R_MOON_M / (k + r2)
                ux = -s.pole * y_up * f
                uy = x * f
                cosd = ux * up[0] + uy * up[1] + uz * up[2]
            m = (cosd >= cmin) & np.isfinite(w.data)
            if m.any():
                best = max(best, float(w.data[m].max()))
        return best


def build_layers(
    lat_deg: float,
    lon_deg: float,
    near_radius_m: float = NEAR_RADIUS_M,
    mid_radius_m: float = MID_RADIUS_M,
    far_radius_m: float = 450_000.0,
) -> LayeredDEM:
    """Choose and load the DEM layers for a site (downloads windows on first use)."""
    pole = "s" if lat_deg < 0 else "n"
    alat = abs(lat_deg)
    layers: list[Layer] = []

    # ---- near field ----
    near = None
    if alat >= 75.0:
        for band, res in (("80", "20m"), ("75", "30m")):
            src = polar_source(band, pole, res)
            if _ps_contains(src.spec, lat_deg, lon_deg, near_radius_m):
                near = window_around(
                    src,
                    lat_deg,
                    lon_deg,
                    near_radius_m,
                    ps_cell_m(src.spec, lat_deg),
                    _polar_citation(src.spec.name),
                )
                break
    if near is None and alat + np.degrees(near_radius_m / R_MOON_M) < 60.0:
        src = sldem_source()
        near = window_around(
            src, lat_deg, lon_deg, near_radius_m, cyl_cell_m(src.spec), CITATION["SLDEM2015_512"]
        )
    if near is None:
        src = polar_source("60", pole, "60m")
        near = window_around(
            src,
            lat_deg,
            lon_deg,
            near_radius_m,
            ps_cell_m(src.spec, lat_deg),
            _polar_citation(src.spec.name),
        )
    layers.append(Layer(near, near_radius_m))

    # ---- mid field ----
    if alat >= 78.0:
        mid = _whole_window(polar_source("75", pole, "240m"), lat_deg)
        layers.append(Layer(mid, far_radius_m))
    else:
        src = global_source(64)
        mid = window_around(
            src, lat_deg, lon_deg, mid_radius_m, cyl_cell_m(src.spec), CITATION["LDEM_64"]
        )
        layers.append(Layer(mid, mid_radius_m))

    # ---- far field (global) ----
    far = _whole_window(global_source(16), lat_deg)
    layers.append(Layer(far, np.inf))
    return LayeredDEM(lat_deg, lon_deg, layers)


def _whole_window(src: RemoteRaster, lat_deg: float) -> Window:
    """A whole (small) raster as one in-memory window, cached across sites."""
    key = "W:" + src.spec.name
    if key not in _cache:
        s = src.spec
        if s.projection == "cyl":
            w = Window(
                s,
                src.read(0, s.lines, 0, s.samples),
                0,
                0,
                cyl_cell_m(s),
                CITATION.get(s.name, s.name),
                periodic_cols=s.samples,
            )
        else:
            w = Window(
                s, src.read(0, s.lines, 0, s.samples), 0, 0, s.scale_m, _polar_citation(s.name)
            )
        _cache[key] = w
    w = _cache[key]
    if w.spec.projection == "ps":
        return Window(w.spec, w.data, 0, 0, ps_cell_m(w.spec, lat_deg), w.citation)
    return w
