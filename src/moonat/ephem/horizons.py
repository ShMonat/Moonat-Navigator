# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Compare our ephemeris with cached JPL Horizons topocentric lunar-site tables.

Fixtures: tests/fixtures/horizons/ (fetched by scripts/fetch_horizons.py). Horizons settings, as
echoed in each response header: observer on body 301 at GEODETIC (E-lon, lat, alt) on a
1737.4 km sphere in the "MEAN_ME" frame (DE421 mean Earth); airless apparent az/el (light-time,
gravitational deflection by the Sun and Earth, stellar aberration); azimuth clockwise from north;
times UTC; DE441 ephemeris. Ours: DE421 + MOON_ME_DE421, same definitions.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from . import topo

AU_KM = 149597870.700
FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "horizons"


def parse(text: str) -> dict[str, np.ndarray]:
    """Parse one Horizons CSV observer table into arrays.

    Keys: ``t_posix``, ``az_deg``, ``el_deg``, ``ang_diam_arcsec``, ``dist_km``, and when given
    ``illum_pct`` and ``sto_deg`` (Sun-target-observer angle). Missing values ("n.a.") are NaN.
    """
    lines = text.splitlines()
    soe = lines.index("$$SOE")
    header = [h.strip() for h in lines[soe - 2].split(",")]
    rows = []
    for ln in lines[soe + 1 : lines.index("$$EOE")]:
        rows.append([c.strip() for c in ln.split(",")])
    col = {name: i for i, name in enumerate(header) if name}

    def num(name):
        if name not in col:
            return None
        return np.array([float(r[col[name]]) if r[col[name]] != "n.a." else np.nan for r in rows])

    t = [
        datetime.strptime(r[0], "%Y-%b-%d %H:%M:%S.%f").replace(tzinfo=UTC).timestamp()
        for r in rows
    ]
    out = {
        "t_posix": np.array(t),
        "az_deg": num("Azimuth_(a-app)"),
        "el_deg": num("Elevation_(a-app)"),
        "ang_diam_arcsec": num("Ang-diam"),
        "dist_km": num("delta") * AU_KM,
    }
    for key, name in (("illum_pct", "Illu%"), ("sto_deg", "S-T-O")):
        v = num(name)
        if v is not None:
            out[key] = v
    return out


def _wrap180(d):
    return (np.asarray(d) + 180.0) % 360.0 - 180.0


def _unit_from_azel(az, el):
    a, e = np.radians(az), np.radians(el)
    return np.stack([np.cos(e) * np.sin(a), np.cos(e) * np.cos(a), np.sin(e)], axis=-1)


def compare(method: str = "direct", fixtures: Path = FIXTURES) -> list[dict]:
    """Differences ours minus Horizons for every cached row.

    ``method``: ``"direct"`` (skyfield, needs kernels) or ``"table"`` (C1 tables, numpy only).
    Observer: on the 1737.4 km sphere (ground_elev 0, eye height 0), as in the Horizons queries.
    Returns one dict per row: case, site, body, t_posix, Horizons az/el, d_az_deg, d_el_deg,
    d_sep_deg (great-circle angle between the two directions), d_dist_km, d_ang_diam_arcsec, and
    for the Earth d_phase (fraction) and d_sto_deg.
    """
    if method == "direct":
        from .direct import sky_state
    else:
        from .table import sky_state
    index = json.loads((fixtures / "index.json").read_text(encoding="utf-8"))
    out = []
    for case in index["cases"]:
        site = index["sites"][case["site"]]
        h = parse((fixtures / case["file"]).read_text(encoding="utf-8"))
        s = sky_state(site["lat_deg"], site["lon_deg"], h["t_posix"], 1000 * site["alt_km"], 0.0)
        b = s[case["body"]]
        d_sep = topo.angle_between_deg(
            _unit_from_azel(b["az_deg"], b["el_deg"]), _unit_from_azel(h["az_deg"], h["el_deg"])
        )
        for k in range(len(h["t_posix"])):
            row = {
                "case": case["file"].removesuffix(".txt"),
                "site": case["site"],
                "body": case["body"],
                "t_utc": topo.posix_to_iso(h["t_posix"][k]),
                "h_az_deg": float(h["az_deg"][k]),
                "h_el_deg": float(h["el_deg"][k]),
                "d_az_deg": float(_wrap180(b["az_deg"][k] - h["az_deg"][k])),
                "d_el_deg": float(b["el_deg"][k] - h["el_deg"][k]),
                "d_sep_deg": float(d_sep[k]),
            }
            if "dist_km" in b:
                row["d_dist_km"] = float(b["dist_km"][k] - h["dist_km"][k])
            if "ang_radius_deg" in b:
                row["d_ang_diam_arcsec"] = float(
                    2 * 3600 * b["ang_radius_deg"][k] - h["ang_diam_arcsec"][k]
                )
            if "phase_frac" in b:
                row["d_phase"] = float(b["phase_frac"][k] - h["illum_pct"][k] / 100.0)
                alpha = np.degrees(np.arccos(2 * b["phase_frac"][k] - 1))
                row["d_sto_deg"] = float(alpha - h["sto_deg"][k])
            out.append(row)
    return out


def summarize(rows: list[dict]) -> dict:
    """Max |difference| per (body) and overall, for the keys produced by :func:`compare`."""
    keys = [
        "d_az_deg",
        "d_el_deg",
        "d_sep_deg",
        "d_dist_km",
        "d_ang_diam_arcsec",
        "d_phase",
        "d_sto_deg",
    ]
    res = {}
    for body in sorted({r["body"] for r in rows}) + ["all"]:
        sel = [r for r in rows if body in ("all", r["body"])]
        res[body] = {"n": len(sel)}
        for k in keys:
            v = [abs(r[k]) for r in sel if k in r]
            if v:
                res[body][k] = max(v)
    return res
