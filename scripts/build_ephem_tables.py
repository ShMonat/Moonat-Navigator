# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Build the C1 ``ephem-table`` for the browser: web/data/ephem/manifest.json + <YYYY>.bin.

Each record holds Moon-centre apparent vectors (skyfield + DE421 + MOON_ME_DE421) at a fixed UTC
grid; see docs/CONTRACTS.md C1 and ``moonat.ephem.table`` for the format and the exact
interpolation the readers use. After writing, the script measures the interpolation error
against direct skyfield at random times (plus the first and last interval of every year) and
stores the maximum in the manifest.

Usage: uv run python scripts/build_ephem_tables.py [--step-hours 3] [--out web/data/ephem]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from moonat.ephem import direct, topo
from moonat.ephem.table import (
    PLANETS,
    RECORD_DTYPE,
    RECORD_LAYOUT,
    EphemTable,
    n_records,
    year_start_posix,
)

GEN = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."
YEARS = [*range(1966, 1977), *range(2013, 2041)]
ROOT = Path(__file__).resolve().parents[1]
ARCSEC = 3600.0

INTERP_DOC = (
    "Record k of <Y>.bin is at POSIX time T(Y)+k*H*3600 s (T(Y) = Y-01-01T00:00:00Z; POSIX ignores "
    "leap seconds, like JS Date). For time t in year Y: u=(t-T(Y))/(H*3600), i=min(floor(u),N-2), "
    "s=u-i. Positions (sun_me, earth_me, planets_icrs; per component) use cubic Hermite with "
    "per-step tangents m_k=(P[k+1]-P[k-1])/2 for 1<=k<=N-2, m_0=(-11P[0]+18P[1]-9P[2]+2P[3])/6, "
    "m_(N-1)=(11P[N-1]-18P[N-2]+9P[N-3]-2P[N-4])/6; P(s)=(2s^3-3s^2+1)P[i]+(s^3-2s^2+s)m_i+"
    "(-2s^3+3s^2)P[i+1]+(s^3-s^2)m_(i+1). Planet directions are renormalised. Quaternion: slerp "
    "from q[i] to q[i+1] after negating q[i+1] if dot(q[i],q[i+1])<0. Rotation matrix from "
    "(w,x,y,z): Hamilton, active, v_me = R v_icrs. Topocentric: site_me = (1737.4 + (ground_elev_m+"
    "observer_height_m)/1000) km * (cos lat cos lon, cos lat sin lon, sin lat); body_topo = body_me - "
    "site_me; planets have no parallax (unit vectors). Reference: moonat.ephem.table (Python)."
)


def build_year(year: int, step_hours: float, out_dir: Path) -> int:
    n = n_records(year, step_hours)
    p = year_start_posix(year) + np.arange(n) * step_hours * 3600.0
    mc = direct.moon_centre_apparent(p)
    r = mc["r_icrs_to_me"]
    rec = np.zeros(n, dtype=RECORD_DTYPE)
    rec["sun_me"] = np.einsum("nij,nj->ni", r, mc["sun"])
    rec["earth_me"] = np.einsum("nij,nj->ni", r, mc["earth"])
    q = topo.matrix_to_quat(r)
    for k in range(1, n):  # keep the sign continuous so slerp never needs the flip within a file
        if np.dot(q[k], q[k - 1]) < 0:
            q[k] = -q[k]
    rec["q_icrs_to_me"] = q
    rec["planets_icrs"] = np.concatenate([topo.unit(mc[b]) for b in PLANETS], axis=1)
    rec.tofile(out_dir / f"{year}.bin")
    return rec.nbytes


def interp_errors(table: EphemTable, years, per_year: int, seed: int = 1) -> dict:
    """Max table-vs-direct errors (arcsec, km) at random times + the first/last interval of each year."""
    rng = np.random.default_rng(seed)
    ts = []
    for y in years:
        t0, t1 = year_start_posix(y), year_start_posix(y + 1)
        ts.append(rng.uniform(t0, t1, per_year))
        ts.append(t0 + rng.uniform(0, 1, 3) * table.step_s)  # first interval (one-sided tangent)
        ts.append(t1 - rng.uniform(0, 1, 3) * table.step_s)  # last interval
    p = np.concatenate(ts)
    got = table.moon_centre(p)
    ref = direct.moon_centre_apparent(p)
    r = ref["r_icrs_to_me"]
    err = {}
    for b in ("sun", "earth"):
        v = np.einsum("nij,nj->ni", r, ref[b])
        err[f"{b}_dir_arcsec"] = float(topo.angle_between_deg(got[f"{b}_me"], v).max() * ARCSEC)
        err[f"{b}_dist_km"] = float(
            np.abs(np.linalg.norm(got[f"{b}_me"], axis=1) - np.linalg.norm(v, axis=1)).max()
        )
    # rotation error: angle of R_table^T R_ref
    rt = topo.quat_to_matrix(got["q_icrs_to_me"])
    d = np.einsum("nji,njk->nik", rt, r)
    cos = np.clip((np.trace(d, axis1=1, axis2=2) - 1) / 2, -1, 1)
    err["rotation_arcsec"] = float(np.degrees(np.arccos(cos)).max() * ARCSEC)
    # Planets: report separately; within ~2 deg of the Sun the solar light-deflection term varies
    # too steeply for the grid (up to ~6 arcsec at Venus' 2016 superior conjunction).
    pe, pe_far = 0.0, 0.0
    for k, b in enumerate(PLANETS):
        e = topo.angle_between_deg(got["planets_icrs"][:, k], ref[b]) * ARCSEC
        far = topo.angle_between_deg(ref[b], ref["sun"]) > 2.0
        pe, pe_far = max(pe, e.max()), max(pe_far, e[far].max())
    err["planets_dir_arcsec"] = float(pe)
    err["planets_dir_arcsec_elong_gt_2deg"] = float(pe_far)
    err["n_samples"] = int(p.size)
    return err


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--step-hours", type=float, default=3.0)
    ap.add_argument("--out", type=Path, default=ROOT / "web" / "data" / "ephem")
    ap.add_argument("--years", type=int, nargs="*", default=YEARS)
    ap.add_argument("--check-per-year", type=int, default=60)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    total = 0
    for y in a.years:
        total += build_year(y, a.step_hours, a.out)
        print(f"{y}: done", flush=True)
    manifest = {
        "_generated_by": GEN,
        "years": a.years,
        "step_hours": a.step_hours,
        "frame": "MOON_ME_DE421",
        "ephemeris": "DE421",
        "time_scale": "UTC",
        "record_layout": RECORD_LAYOUT,
        "record_bytes": RECORD_DTYPE.itemsize,
        "endianness": "little",
        "interpolation": "cubic Hermite (C1) on positions; slerp on quaternion",
        "interpolation_scheme": INTERP_DOC,
        "quaternion": "q_icrs_to_me = (w, x, y, z), Hamilton, active: v_me = q v_icrs q*",
        "apparent": "seen from the Moon's centre: light-time + gravitational deflection (Sun, "
        "Jupiter, Saturn) + stellar aberration; vector length = light-time distance (km)",
        "planets": list(PLANETS),
        "planet_note": "jupiter and saturn are system barycentres (DE421); offset < 0.1 arcsec",
        "body_radii_km": {"sun": topo.SUN_RADIUS_KM, "earth": topo.EARTH_RADIUS_KM},
        "moon_radius_km": topo.MOON_RADIUS_KM,
        "total_bytes": total,
        "max_interp_error_arcsec": None,
    }
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    err = interp_errors(EphemTable(a.out), a.years, a.check_per_year)
    manifest["max_interp_error_arcsec"] = round(
        max(err["sun_dir_arcsec"], err["earth_dir_arcsec"], err["rotation_arcsec"]), 4
    )
    manifest["interp_error_check"] = {
        k: (round(v, 6) if isinstance(v, float) else v) for k, v in err.items()
    }
    manifest["interp_error_note"] = (
        "Max over random times and the first/last interval of every year, table vs direct skyfield, "
        "Moon-centre vectors. Includes the intervals holding a leap second (POSIX time cannot "
        "represent 23:59:60, so up to 1 s of lunar rotation, ~0.55 arcsec, there). Elsewhere the "
        "Sun error is <= 0.1 arcsec at a 3 h step."
    )
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(json.dumps(manifest["interp_error_check"], indent=1))
    print(f"total {total / 1e6:.2f} MB in {len(a.years)} files")


if __name__ == "__main__":
    main()
