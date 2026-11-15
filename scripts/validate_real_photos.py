# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Compare real Apollo surface photos and a published Sun/Earth table with Moonat (docs/validation/real_photos.md).

Three checks:

1. **Sun and Earth vs the ALSJ alt-az table** (``Scotti_AltAz.txt``, Apollo Lunar Surface Journal, computed from the
   Nautical Almanac lunar ephemeris). For every row (landing, EVA start/end, liftoff of Apollo 11-17) we compute the Sun
   and Earth altitude and azimuth with ``moonat.ephem.direct.sky_state`` (DE421, MOON_ME, eye 2 m) at the table's site
   and UTC time, and report the differences in degrees.
2. **Terrain skyline vs photos.** The skyline is the top edge of the lit terrain against the black sky. Per image
   column, the first row from the top whose grey level is above a threshold, kept only in column ranges free of
   astronauts, flags and the LM. Camera model: pinhole, Zeiss Biogon 60 mm (Hasselblad EL Data Camera), principal
   point at the frame centre; the scan width in mm is measured from the reseau crosses (10 mm apart). The camera
   heading, pitch and roll are unknown, so they are fitted (grid search, robust) to Moonat's LOLA horizon profile
   ``web/data/horizons/<site>.json`` (az clockwise from north, el in deg, eye 2 m). What remains, the residual, is
   the shape disagreement in degrees.
3. **Earth phase vs a photo.** The lit Earth disk in AS17-134-20384 is thresholded; the lit fraction is the extent
   along the Sun axis over the full diameter (cusp to cusp). Compared with ``phase_frac`` from ``sky_state``.

Frames: ENU at the site (x east, y north, z up); az clockwise from north; el above the local horizontal plane.
Assumptions: the photographer stands at the catalog LM site (true offset tens of metres: < 0.5 deg of azimuth for
mountains 5-20 km away); no lens distortion (the Biogon is near-orthoscopic); flat-field threshold.

Usage: ``uv run python scripts/validate_real_photos.py``. The figures draw Moonat's horizon (the file the app's sky
view draws) on each photo through the fitted camera. A render of the app's own view at that camera is not included:
the page does not apply a link's camera (docs/validation/real_photos.md §6).
Photos are read from ``$MOONAT_DATA_DIR/raw/photos`` or the main checkout's ``data/raw/photos`` (NASA Image Library,
public domain; see docs/REFERENCES.md).
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
FIG = ROOT / "docs" / "figures"
OUT_JSON = ROOT / "docs" / "validation" / "real_photos.json"
F_MM = 60.0  # Zeiss Biogon 60 mm f/5.6 on the Hasselblad EL Data Camera (nominal focal length)
NOTE = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."


def photo_dir() -> Path:
    env = os.environ.get("MOONAT_DATA_DIR")
    cands = [Path(env) / "raw" / "photos"] if env else []
    cands += [p / "data" / "raw" / "photos" for p in [ROOT, *ROOT.parents]]
    for c in cands:
        if c.is_dir():
            return c
    raise FileNotFoundError(
        "data/raw/photos not found; see docs/validation/real_photos.md for the download"
    )


# Photo set. x ranges are fractions of the image width where the skyline is clean (no astronaut, flag or LM).
# scan_mm: width of the scan in mm from the reseau (10 mm crosses); heading0: documented look direction (deg).
PHOTOS = [
    {
        "id": "AS15-88-11863",
        "site": "apollo15",
        "what": "Scott salutes the flag; Hadley Delta behind (end of EVA-2)",
        "t_utc": "1971-08-01T18:30:00Z",
        "t_note": "flag deployed late in EVA-2 (EVA-2 11:48-19:01 UTC, ALSJ); +-0.5 h",
        "photographer": "James B. Irwin",
        "heading0": 180.0,
        "x_ranges": [[0.005, 0.74]],
        "thr": 95,
        "scan_mm": 51.4,
        # flagpole base and two points along the pole's shadow on the ground (full-resolution px, read by eye)
        "shadow": {"base": [2151, 2405], "along": [[3020, 2424], [3244, 2464]]},
    },
    {
        "id": "AS15-86-11603",
        "site": "apollo15",
        "what": "Irwin at the rover; Mount Hadley behind (EVA-1, looking north-east)",
        "t_utc": "1971-07-31T14:00:00Z",
        "t_note": "rover set-up early in EVA-1 (EVA-1 13:13-19:46 UTC, ALSJ); +-1 h",
        "photographer": "David R. Scott",
        "heading0": 45.0,
        "x_ranges": [[0.45, 0.84]],
        "thr": 120,
        "scan_mm": 51.5,
    },
    {
        "id": "AS16-113-18339",
        "site": "apollo16",
        "what": "Young's jump salute; Stone Mountain behind (EVA-1)",
        "t_utc": "1972-04-21T18:00:00Z",
        "t_note": "flag deployment early in EVA-1 (EVA-1 16:48-23:59 UTC, ALSJ); +-1 h",
        "photographer": "Charles M. Duke Jr.",
        "heading0": 180.0,
        "x_ranges": [[0.003, 0.06], [0.715, 0.99]],
        "thr": 45,
        "scan_mm": 51.5,
    },
    {
        "id": "AS11-40-5875",
        "site": "apollo11",
        "what": "Aldrin beside the flag; flat mare horizon (EVA)",
        "t_utc": "1969-07-21T03:30:00Z",
        "t_note": "flag photos mid-EVA (EVA 02:39-05:11 UTC, ALSJ); +-0.5 h",
        "photographer": "Neil A. Armstrong",
        "heading0": 180.0,
        "x_ranges": [[0.45, 0.585], [0.77, 0.99]],
        "thr": 80,
        "scan_mm": 51.5,
    },
]
EARTH_PHOTO = {
    "id": "AS17-134-20384",
    "site": "apollo17",
    "what": "Schmitt and the flag; Earth above (EVA-1)",
    "t_utc": "1972-12-12T03:30:00Z",
    "t_note": "flag deployment in EVA-1 (EVA-1 23:55-07:07 UTC, ALSJ); +-3.6 h covers the whole EVA",
    "photographer": "Eugene A. Cernan",
    "box": [0.58, 0.22, 0.70, 0.30],  # x0, y0, x1, y1 fractions: a box around the Earth
}


# --------------------------------------------------------------------------------------------- 1. ALSJ table
def parse_scotti(path: Path) -> list[dict]:
    """Rows of the ALSJ alt-az table: mission, event, UTC, site (lat, lon), Earth and Sun alt/az (deg)."""
    rows, site, mission, ymd = [], None, None, None
    months = {
        m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())
    }
    for line in path.read_text().splitlines():
        m = re.match(r"(Apollo \d+)\s+\(([-+\d.]+),\s+([-+\d.]+)\)", line)
        if m:
            mission, site = m.group(1), (float(m.group(3)), float(m.group(2)))
            continue
        m = re.match(
            r"\s+(.*?)\s+(?:(\d{4})\s+)?(?:([A-Z][a-z]{2})\s+)?(?:(\d{1,2})\s+)?(\d\d:\d\d:\d\d)\s+(.*)$",
            line,
        )
        if not m or not mission:
            continue
        ev, yr, mon, day, hms, rest = m.groups()
        nums = [float(x) for x in rest.split()]
        if len(nums) != 8:
            continue
        y, mo, d = ymd or (None, None, None)
        y = int(yr) if yr else y
        mo = months[mon] if mon else mo
        d = int(day) if day else d
        ymd = (y, mo, d)
        rows.append(
            {
                "mission": mission,
                "event": ev,
                "t_utc": f"{y:04d}-{mo:02d}-{d:02d}T{hms}Z",
                "lat_deg": site[0],
                "lon_deg": site[1],
                "earth_alt": nums[2],
                "earth_az": nums[3],
                "sun_alt": nums[6],
                "sun_az": nums[7],
            }
        )
    return rows


def wrap180(x):
    return (np.asarray(x) + 180.0) % 360.0 - 180.0


def check_table(path: Path) -> dict:
    from moonat.ephem.direct import sky_state

    rows = parse_scotti(path)
    out = []
    for r in rows:
        s = sky_state(r["lat_deg"], r["lon_deg"], r["t_utc"], bodies=("sun", "earth"))
        out.append(
            {
                **r,
                "moonat": {
                    "sun_alt": round(float(s["sun"]["el_deg"][0]), 3),
                    "sun_az": round(float(s["sun"]["az_deg"][0]), 3),
                    "earth_alt": round(float(s["earth"]["el_deg"][0]), 3),
                    "earth_az": round(float(s["earth"]["az_deg"][0]), 3),
                },
            }
        )
    d = {
        k: np.array([wrap180(o["moonat"][k] - o[k]) for o in out])
        for k in ("sun_alt", "sun_az", "earth_alt", "earth_az")
    }
    stats = {
        k: {
            "mean": round(float(v.mean()), 3),
            "rms": round(float(np.sqrt((v**2).mean())), 3),
            "max_abs": round(float(np.abs(v).max()), 3),
        }
        for k, v in d.items()
    }
    return {"rows": out, "n": len(out), "diff_moonat_minus_alsj_deg": stats}


# --------------------------------------------------------------------------------------------- 2. skylines
def load_grey(path: Path, step: int):
    from PIL import Image

    im = Image.open(path).convert("RGB")
    full = im.size
    small = im.reduce(step)
    a = np.asarray(small).astype(float)
    return a, a.mean(axis=2), full


def extract_skyline(grey: np.ndarray, x_ranges, thr: float, run: int = 4):
    """Return (cols, rows) of the skyline in the reduced image: first row from the top with `run` pixels > thr."""
    h, w = grey.shape
    cols, rows = [], []
    above = grey > thr
    # a run of `run` bright pixels: cumulative trick
    c = np.cumsum(above, axis=0)
    ok = np.zeros_like(above)
    ok[: h - run] = (c[run:] - c[:-run]) == run
    for x0, x1 in x_ranges:
        for x in range(int(x0 * w), int(x1 * w)):
            idx = np.flatnonzero(ok[:, x])
            if idx.size:
                cols.append(x)
                rows.append(idx[0] + 1)
    return np.array(cols, float), np.array(rows, float)


def cam_rays(u, v, f_px, heading, pitch, roll):
    """Unit ENU rays for image offsets u (right, px) and v (down, px) from the principal point.

    Camera: forward F at azimuth `heading` and elevation `pitch` (deg); `roll` (deg) turns the image clockwise
    as seen by the photographer. Arrays broadcast: heading/pitch/roll may carry extra leading axes.
    """
    h, p, r = np.radians(heading), np.radians(pitch), np.radians(roll)
    f = np.stack([np.sin(h) * np.cos(p), np.cos(h) * np.cos(p), np.sin(p)], -1)
    r0 = np.stack([np.cos(h), -np.sin(h), np.zeros_like(h)], -1)
    u0 = np.cross(r0, f)
    cr, sr = np.cos(r)[..., None], np.sin(r)[..., None]
    right = cr * r0 - sr * u0
    up = sr * r0 + cr * u0
    d = (
        u[..., None] * right[..., None, :]
        - v[..., None] * up[..., None, :]
        + f_px * f[..., None, :]
    )
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def az_el(d):
    az = np.degrees(np.arctan2(d[..., 0], d[..., 1])) % 360.0
    el = np.degrees(np.arcsin(np.clip(d[..., 2], -1, 1)))
    return az, el


def horizon(site: str):
    h = json.loads((ROOT / "web" / "data" / "horizons" / f"{site}.json").read_text())
    el = np.array(h["el_deg"], float)
    step = float(h["az_step_deg"])

    def f(az):
        x = (np.asarray(az) % 360.0) / step
        i0 = np.floor(x).astype(int) % el.size
        t = x - np.floor(x)
        return el[i0] * (1 - t) + el[(i0 + 1) % el.size] * t

    return f, h


def fit_camera(u, v, f_px, hfun, heading0, span=60.0):
    """Grid search (heading, pitch, roll) minimising the trimmed RMS of el_photo - el_moonat. Returns the best."""

    def score(hs, ps, rs):
        H, P, R = np.meshgrid(hs, ps, rs, indexing="ij")
        d = cam_rays(u, v, f_px, H, P, R)
        az, el = az_el(d)
        res = el - hfun(az)
        res = res - 0.0
        q = np.sort(np.abs(res), axis=-1)[..., : int(0.9 * res.shape[-1])]
        return np.sqrt((q**2).mean(-1)), H, P, R

    best = None
    for hs in np.array_split(np.arange(heading0 - span, heading0 + span + 0.1, 1.0), 12):
        s, H, P, R = score(hs, np.arange(-20, 20.1, 0.5), np.arange(-10, 10.1, 1.0))
        i = np.unravel_index(np.argmin(s), s.shape)
        if best is None or s[i] < best[0]:
            best = (s[i], H[i], P[i], R[i])
    for dh, dp, dr in ((1.0, 0.5, 1.0), (0.2, 0.1, 0.2), (0.04, 0.02, 0.04)):
        _, h0, p0, r0 = best
        s, H, P, R = score(
            np.linspace(h0 - dh, h0 + dh, 11),
            np.linspace(p0 - dp, p0 + dp, 11),
            np.linspace(r0 - dr, r0 + dr, 11),
        )
        i = np.unravel_index(np.argmin(s), s.shape)
        best = (s[i], H[i], P[i], R[i])
    return {"heading": float(best[1]), "pitch": float(best[2]), "roll": float(best[3])}


def analyse_photo(cfg: dict, pdir: Path, step: int = 4) -> dict:
    rgb, grey, (wfull, hfull) = load_grey(pdir / f"{cfg['id']}.jpg", step)
    cols, rows = extract_skyline(grey, cfg["x_ranges"], cfg["thr"])
    px_per_mm = wfull / cfg["scan_mm"]
    f_px = F_MM * px_per_mm / step
    hh, ww = grey.shape
    u = cols + 0.5 - ww / 2.0
    v = rows + 0.5 - hh / 2.0
    hfun, hjson = horizon(cfg["site"])
    cam = fit_camera(u, v, f_px, hfun, cfg["heading0"])
    d = cam_rays(
        u, v, f_px, np.array(cam["heading"]), np.array(cam["pitch"]), np.array(cam["roll"])
    )
    az, el = az_el(d)
    res = el - hfun(az)
    hfov = 2 * np.degrees(np.arctan(ww / 2 / f_px))
    # sensitivity: the same fit with the focal length 3 % longer and shorter
    sens = []
    for k in (0.97, 1.03):
        c2 = fit_camera(u, v, f_px * k, hfun, cam["heading"], span=8.0)
        d2 = cam_rays(
            u, v, f_px * k, np.array(c2["heading"]), np.array(c2["pitch"]), np.array(c2["roll"])
        )
        a2, e2 = az_el(d2)
        sens.append(float(np.sqrt(np.mean((e2 - hfun(a2)) ** 2))))
    shadow = None
    if "shadow" in cfg:
        # back-project onto a level ground plane 1 unit below the camera: the direction does not depend on the height
        from moonat.ephem.direct import sky_state

        def ground(px):
            uu = np.array(px[0] + 0.5 - wfull / 2.0) / step
            vv = np.array(px[1] + 0.5 - hfull / 2.0) / step
            dd = cam_rays(
                uu,
                vv,
                f_px,
                np.array(cam["heading"]),
                np.array(cam["pitch"]),
                np.array(cam["roll"]),
            )
            dd = dd.reshape(3)
            return dd[:2] * (-1.0 / dd[2])

        b = ground(cfg["shadow"]["base"])
        azs = []
        for q in cfg["shadow"]["along"]:
            g = ground(q) - b
            azs.append(float(np.degrees(np.arctan2(g[0], g[1])) % 360.0))
        site = next(
            s
            for s in json.loads((ROOT / "web" / "data" / "sites.json").read_text())["sites"]
            if s["id"] == cfg["site"]
        )
        st = sky_state(site["lat_deg"], site["lon_deg"], cfg["t_utc"], bodies=("sun",))
        sun_az = float(st["sun"]["az_deg"][0])
        shadow = {
            "shadow_az_photo_deg": [round(a_, 2) for a_ in azs],
            "sun_az_from_shadow_deg": [round((a_ + 180.0) % 360.0, 2) for a_ in azs],
            "sun_az_moonat_deg": round(sun_az, 2),
            "sun_el_moonat_deg": round(float(st["sun"]["el_deg"][0]), 2),
            "diff_deg": [round(float(wrap180((a_ + 180.0) - sun_az)), 2) for a_ in azs],
        }
    return {
        "cfg": cfg,
        "shadow_sun": shadow,
        "n_points": int(cols.size),
        "hfov_deg": round(float(hfov), 2),
        "f_px_full": round(float(f_px * step), 1),
        "camera_fit": {k: round(v_, 2) for k, v_ in cam.items()},
        "skyline_rms_deg": round(float(np.sqrt(np.mean(res**2))), 3),
        "skyline_median_abs_deg": round(float(np.median(np.abs(res))), 3),
        "skyline_p95_abs_deg": round(float(np.percentile(np.abs(res), 95)), 3),
        # foreground objects (rover antennas, LM struts) that slip into the column ranges sit > 1.5 deg off
        "skyline_rms_without_outliers_deg": round(
            float(np.sqrt(np.mean(res[np.abs(res) <= 1.5] ** 2))), 3
        ),
        "outliers_over_1p5deg": int(np.sum(np.abs(res) > 1.5)),
        "skyline_rms_if_f_pm3pct_deg": [round(x, 3) for x in sens],
        "az_range_deg": [round(float(az.min()), 2), round(float(az.max()), 2)],
        "photo_el_range_deg": [round(float(el.min()), 2), round(float(el.max()), 2)],
        "moonat_el_range_deg": [round(float(hfun(az).min()), 2), round(float(hfun(az).max()), 2)],
        "_arrays": {
            "az": az,
            "el": el,
            "cols": cols,
            "rows": rows,
            "step": step,
            "f_px": f_px,
            "shape": grey.shape,
        },
        "_hfun": hfun,
        "_rgb": rgb,
    }


# --------------------------------------------------------------------------------------------- 3. Earth phase
def earth_phase(cfg: dict, pdir: Path) -> dict:
    from PIL import Image

    from moonat.ephem.direct import sky_state

    im = Image.open(pdir / f"{cfg['id']}.jpg").convert("RGB")
    w, h = im.size
    x0, y0, x1, y1 = cfg["box"]
    crop = np.asarray(im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))).astype(float)
    g = crop.mean(axis=2)
    thr = 0.5 * (np.percentile(g, 5) + np.percentile(g, 99.5))
    ys, xs = np.nonzero(g > thr)
    pts = np.stack([xs, ys], 1).astype(float)
    c = pts.mean(0)
    # principal axes: the long axis is cusp to cusp (full diameter), the short one is the Sun axis
    evals, evecs = np.linalg.eigh(np.cov((pts - c).T))
    long_ax, short_ax = evecs[:, 1], evecs[:, 0]
    pl = (pts - c) @ long_ax
    ps = (pts - c) @ short_ax
    diam = pl.max() - pl.min() + 1
    lit = ps.max() - ps.min() + 1
    k_photo = float(min(1.0, lit / diam))
    site = json.loads((ROOT / "web" / "data" / "sites.json").read_text())
    s_ = next(s for s in site["sites"] if s["id"] == cfg["site"])
    ts = ["1972-12-11T23:55:00Z", cfg["t_utc"], "1972-12-12T07:07:00Z"]
    st = sky_state(s_["lat_deg"], s_["lon_deg"], ts, bodies=("sun", "earth"))
    ks = [float(x) for x in st["earth"]["phase_frac"]]
    return {
        "cfg": cfg,
        "threshold": round(float(thr), 1),
        "earth_diameter_px": round(float(diam), 1),
        "lit_extent_px": round(float(lit), 1),
        "k_photo": round(k_photo, 3),
        "k_moonat_eva_start_mid_end": [round(k, 3) for k in ks],
        # apparent diameter: pinhole with the same 60 mm lens and a 51.5 mm wide scan as the skyline photos
        "earth_diam_deg_photo": round(float(np.degrees(diam / (F_MM * w / 51.5))), 3),
        "earth_diam_deg_moonat": round(float(2 * st["earth"]["ang_radius_deg"][1]), 3),
        "earth_alt_az_moonat_mid": [
            round(float(st["earth"]["el_deg"][1]), 2),
            round(float(st["earth"]["az_deg"][1]), 2),
        ],
        "_crop": crop,
        "_mask": g > thr,
    }


# --------------------------------------------------------------------------------------------- figures
def figure(r: dict, app_png: Path | None) -> Path:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    a, cfg, cam = r["_arrays"], r["cfg"], r["camera_fit"]
    rgb = r["_rgb"] / 255.0
    hh, ww = a["shape"]
    hfun = r["_hfun"]
    # Moonat's horizon projected into the photo with the fitted camera
    azs = np.linspace(cam["heading"] - 35, cam["heading"] + 35, 1400)
    els = hfun(azs)
    e = np.stack(
        [
            np.cos(np.radians(els)) * np.sin(np.radians(azs)),
            np.cos(np.radians(els)) * np.cos(np.radians(azs)),
            np.sin(np.radians(els)),
        ],
        -1,
    )
    h, p, rl = np.radians(cam["heading"]), np.radians(cam["pitch"]), np.radians(cam["roll"])
    f = np.array([np.sin(h) * np.cos(p), np.cos(h) * np.cos(p), np.sin(p)])
    r0 = np.array([np.cos(h), -np.sin(h), 0.0])
    u0 = np.cross(r0, f)
    right = np.cos(rl) * r0 - np.sin(rl) * u0
    up = np.sin(rl) * r0 + np.cos(rl) * u0
    zc = e @ f
    ok = zc > 0.2
    uu = a["f_px"] * (e @ right) / zc + ww / 2
    vv = -a["f_px"] * (e @ up) / zc + hh / 2
    ncol = 3 if app_png else 2
    fig, ax = plt.subplots(1, ncol, figsize=(5.2 * ncol, 5.6), facecolor="white")
    ax[0].imshow(rgb)
    ax[0].plot(uu[ok], vv[ok], color="#00d5ff", lw=1.2, label="Moonat LOLA horizon (fitted camera)")
    ax[0].plot(a["cols"], a["rows"], ".", color="#ff3b30", ms=1.5, label="photo skyline (detected)")
    ax[0].set_xlim(0, ww)
    ax[0].set_ylim(hh, 0)
    ax[0].axis("off")
    ax[0].legend(loc="lower left", fontsize=7, framealpha=0.85)
    ax[0].set_title(f"NASA {cfg['id']} (public domain)", fontsize=9)
    k = 1
    if app_png:
        from PIL import Image

        ax[1].imshow(Image.open(app_png))
        ax[1].axis("off")
        ax[1].set_title(
            f"Moonat sky view, same camera\n(az {cam['heading']:.1f}, el {cam['pitch']:.1f}, "
            f"hfov {r['hfov_deg']:.1f} deg; no roll)",
            fontsize=9,
        )
        k = 2
    order = np.argsort(a["az"])
    ax[k].plot(azs, els, color="#0a6ebd", lw=1.5, label="Moonat horizon (LOLA, eye 2 m)")
    ax[k].plot(a["az"][order], a["el"][order], ".", color="#d62728", ms=2, label="photo skyline")
    ax[k].set_xlim(a["az"].min() - 3, a["az"].max() + 3)
    ax[k].set_xlabel("azimuth (deg, clockwise from north)")
    ax[k].set_ylabel("elevation (deg)")
    ax[k].grid(alpha=0.3)
    ax[k].legend(fontsize=8)
    ax[k].set_title(
        f"skyline RMS {r['skyline_rms_deg']:.2f} deg, median |d| {r['skyline_median_abs_deg']:.2f} deg",
        fontsize=9,
    )
    fig.text(
        0.01,
        0.01,
        "Photo: NASA (public domain). Moonat: LOLA/SLDEM2015 horizon, DE421. " + NOTE,
        fontsize=6,
        color="#555",
    )
    fig.tight_layout(rect=(0, 0.03, 1, 1))
    out = FIG / f"real_vs_moonat_{cfg['id']}.png"
    fig.savefig(out, dpi=130)
    plt.close(fig)
    return out


def earth_figure(r: dict, app_png: Path | None = None) -> Path:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(1, 2, figsize=(9, 4.6), facecolor="white")
    ax[0].imshow(r["_crop"] / 255.0)
    ax[0].set_title(f"NASA {r['cfg']['id']} (public domain), Earth crop", fontsize=9)
    ax[0].axis("off")
    ax[1].imshow(r["_mask"], cmap="gray")
    ax[1].set_title(
        f"lit fraction: photo {r['k_photo']:.2f}; Moonat {min(r['k_moonat_eva_start_mid_end']):.2f}"
        f"-{max(r['k_moonat_eva_start_mid_end']):.2f} (EVA-1)",
        fontsize=9,
    )
    ax[1].axis("off")
    fig.text(0.01, 0.01, NOTE, fontsize=6, color="#555")
    fig.tight_layout(rect=(0, 0.03, 1, 1))
    out = FIG / f"real_vs_moonat_{r['cfg']['id']}_earth.png"
    fig.savefig(out, dpi=130)
    plt.close(fig)
    return out


def main() -> None:
    argparse.ArgumentParser(description=__doc__.splitlines()[0]).parse_args()
    pdir = photo_dir()
    table = check_table(pdir / "Scotti_AltAz.txt")
    print(
        "ALSJ table:",
        table["n"],
        "rows; Moonat - ALSJ (deg):",
        json.dumps(table["diff_moonat_minus_alsj_deg"]),
    )
    results = []
    for cfg in PHOTOS:
        r = analyse_photo(cfg, pdir)
        results.append(r)
        print(
            cfg["id"],
            r["camera_fit"],
            "hfov",
            r["hfov_deg"],
            "rms",
            r["skyline_rms_deg"],
            "med",
            r["skyline_median_abs_deg"],
            "p95",
            r["skyline_p95_abs_deg"],
            "n",
            r["n_points"],
            "f+-3%",
            r["skyline_rms_if_f_pm3pct_deg"],
            "shadow",
            r["shadow_sun"],
        )
    er = earth_phase(EARTH_PHOTO, pdir)
    print(
        "Earth", er["k_photo"], er["k_moonat_eva_start_mid_end"], "diam px", er["earth_diameter_px"]
    )
    figs = [figure(r, None) for r in results]
    figs.append(earth_figure(er))
    clean = [{k: v for k, v in r.items() if not k.startswith("_")} for r in results]
    OUT_JSON.write_text(
        json.dumps(
            {
                "_generated_by": NOTE,
                "alsj_table": table,
                "photos": clean,
                "earth_phase": {k: v for k, v in er.items() if not k.startswith("_")},
                "figures": [str(f.relative_to(ROOT)).replace("\\", "/") for f in figs],
            },
            indent=1,
        )
    )
    print("wrote", OUT_JSON.relative_to(ROOT), *[f.name for f in figs])


if __name__ == "__main__":
    main()
