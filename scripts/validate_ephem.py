# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Ephemeris validation report: docs/figures/ephem_vs_horizons.png + docs/validation/ephem.md.

Compares (a) direct skyfield and (b) the browser tables with the cached JPL Horizons responses
(tests/fixtures/horizons/). Needs the NAIF kernels for (a).

Usage: uv run python scripts/validate_ephem.py
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from moonat.ephem import horizons  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FIG = ROOT / "docs" / "figures" / "ephem_vs_horizons.png"
MD = ROOT / "docs" / "validation" / "ephem.md"
AS = 3600.0
# Reference palette (dataviz skill, light surface): slot 1 blue, slot 2 orange; text greys.
SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
COLOR = {"earth": "#2a78d6", "sun": "#eb6834"}
SITE_LABEL = {"apollo11": "Apollo 11", "southpole": "89.5°S 0°E", "change4": "Chang'e 4"}


def d_az_sky(r):
    return r["d_az_deg"] * np.cos(np.radians(r["h_el_deg"]))


def make_plot(direct, table):
    plt.rcParams.update(
        {
            "font.size": 10,
            "text.color": INK,
            "axes.labelcolor": INK,
            "xtick.color": INK2,
            "ytick.color": INK2,
            "axes.edgecolor": INK2,
        }
    )
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(12, 5.4), gridspec_kw={"width_ratios": [1, 1.25]})
    fig.patch.set_facecolor(SURFACE)
    for ax in (a1, a2):
        ax.set_facecolor(SURFACE)
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)

    # Panel 1: per-row az/el differences (direct skyfield - Horizons), arcsec.
    for body, label in (("sun", "Sun"), ("earth", "Earth")):
        rows = [r for r in direct if r["body"] == body]
        x = np.array([d_az_sky(r) for r in rows]) * AS
        y = np.array([r["d_el_deg"] for r in rows]) * AS
        a1.scatter(
            x,
            y,
            s=22,
            color=COLOR[body],
            edgecolor=SURFACE,
            linewidth=0.8,
            label=f"{label} ({len(rows)} rows)",
            zorder=3,
        )
    lim = 0.08
    a1.set_xlim(-lim, lim)
    a1.set_ylim(-lim, lim)
    a1.set_aspect("equal")
    a1.axhline(0, color=GRID, lw=1, zorder=1)
    a1.axvline(0, color=GRID, lw=1, zorder=1)
    a1.set_xlabel("Δazimuth × cos(elevation)  [arcsec]")
    a1.set_ylabel("Δelevation  [arcsec]")
    a1.set_title("Direct skyfield − Horizons, every row", loc="left", fontsize=11)
    a1.legend(frameon=False, loc="upper left")
    a1.text(
        0.0,
        -0.17,
        "Target: 0.01° = 36 arcsec (450× this axis range)",
        color=INK2,
        transform=a1.transAxes,
        fontsize=9,
    )

    # Panel 2: max great-circle error per site/body, direct (filled) and table (open), log x.
    groups = [(s, b) for s in SITE_LABEL for b in ("sun", "earth")]
    groups += [("apollo11", p) for p in ("mercury", "venus", "mars", "jupiter", "saturn")]
    for k, (site, body) in enumerate(groups):
        y = len(groups) - 1 - k
        c = COLOR.get(body, INK2)
        for rows, filled in ((direct, True), (table, False)):
            v = max(r["d_sep_deg"] for r in rows if r["site"] == site and r["body"] == body) * AS
            a2.scatter(
                v,
                y,
                s=40 if filled else 130,
                color=c if filled else "none",
                edgecolor=c,
                linewidth=0.8 if filled else 1.8,
                zorder=4 if filled else 3,
            )
    a2.set_yticks(range(len(groups)))
    a2.set_yticklabels([f"{SITE_LABEL[s]} · {b.capitalize()}" for s, b in reversed(groups)])
    a2.set_xscale("log")
    a2.set_xlim(3e-3, 100)
    for v, lab in ((3.6, "0.001°"), (36, "0.01° target")):
        a2.axvline(v, color=INK2, lw=1, ls="--", zorder=1)
        a2.text(v * 1.08, len(groups) - 0.6, lab, color=INK2, fontsize=9)
    a2.grid(axis="x", color=GRID, lw=0.8, zorder=0)
    a2.set_xlabel("max great-circle error vs Horizons  [arcsec, log]")
    a2.set_title(
        "Max error per site and body:  ● direct skyfield   ○ browser table", loc="left", fontsize=11
    )
    a2.text(
        0.0,
        -0.17,
        "Table planets have no topocentric parallax (by design, C1)",
        color=INK2,
        transform=a2.transAxes,
        fontsize=9,
    )
    fig.suptitle(
        "Moonat ephemeris vs JPL Horizons (lunar topocentric, airless apparent)",
        x=0.01,
        ha="left",
        fontsize=13,
        color=INK,
    )
    fig.text(
        0.99, 0.01, "AI-generated with Claude Code (Anthropic)", ha="right", color=INK2, fontsize=7
    )
    fig.tight_layout(rect=(0, 0.02, 1, 0.95))
    FIG.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIG, dpi=150, facecolor=SURFACE)


def fmt(x, d=4):
    return f"{x:.{d}f}"


def make_md(direct, table, manifest):
    sd, st = horizons.summarize(direct), horizons.summarize(table)

    def line(name, s, body):
        v = s[body]
        dist = f"{v['d_dist_km']:.3f} km" if "d_dist_km" in v else "–"
        diam = fmt(v["d_ang_diam_arcsec"], 3) if "d_ang_diam_arcsec" in v else "–"
        phase = f"{v['d_phase']:.1e}" if "d_phase" in v else "–"
        return (
            f"| {name} | {body} | {v['n']} | {fmt(v['d_sep_deg'] * AS)} | "
            f"{fmt(v['d_el_deg'] * AS)} | {dist} | {diam} | {phase} |"
        )

    head = (
        "| method | body | rows | max sky error (arcsec) | max \\|Δel\\| (arcsec) | "
        "max \\|Δdist\\| | max \\|Δdiam\\| (arcsec) | max \\|Δphase\\| |\n|---|---|---|---|---|---|---|---|"
    )
    summary = [head]
    for name, s in (("direct", sd), ("table", st)):
        for b in ("sun", "earth", "mercury", "venus", "mars", "jupiter", "saturn"):
            summary.append(line(name, s, b))
    epochs = [
        "| site | body | UTC | Horizons az (°) | Horizons el (°) | Δaz·cos el (arcsec) | "
        "Δel (arcsec) | table Δsky (arcsec) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    tab = {(r["case"], r["t_utc"]): r for r in table}
    for r in direct:
        if r["case"].endswith("_epochs") and r["body"] in ("sun", "earth"):
            t = tab[(r["case"], r["t_utc"])]
            epochs.append(
                f"| {SITE_LABEL[r['site']]} | {r['body']} | {r['t_utc'][:16]} | "
                f"{r['h_az_deg']:.5f} | {r['h_el_deg']:.5f} | {d_az_sky(r) * AS:+.4f} | "
                f"{r['d_el_deg'] * AS:+.4f} | {t['d_sep_deg'] * AS:.4f} |"
            )
    chk = manifest["interp_error_check"]
    text = f"""<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
<!-- Generated by scripts/validate_ephem.py; do not edit by hand. -->
# Ephemeris validation against JPL Horizons

**Result: our Sun and Earth directions agree with JPL Horizons to {sd["all"]["d_sep_deg"] * AS:.3f} arcsec
({sd["all"]["d_sep_deg"]:.1e}°) at worst over {sd["all"]["n"]} rows. The target was 0.01° (36 arcsec).**

![ephemeris vs Horizons](../figures/ephem_vs_horizons.png)

## What was compared
- **Ours (direct):** skyfield 1.55 + JPL DE421 + lunar frame `MOON_ME_DE421` (`moon_pa_de421_1900-2050.bpc`
  + `moon_080317.tf`). The observer is fixed on the Moon at radius 1737.4 km (+ height). We compute the
  apparent position (light-time, gravitational deflection, aberration) and rotate it into the site's
  ENU frame with a radial up vector. Code: `moonat.ephem.direct`.
- **Ours (table):** the browser tables `web/data/ephem/` (C1) + the topocentric transform in
  `moonat.ephem.table`, which is exactly what the JavaScript port does.
- **Horizons:** `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `SITE_COORD='E-lon,lat,0'`,
  `QUANTITIES='4,10,13,20,24'`, `APPARENT='AIRLESS'`, UT time scale. The cached responses are in
  `tests/fixtures/horizons/`, and `scripts/fetch_horizons.py` fetches them.

**Like-for-like check (from the Horizons response headers):** `Center pole/equ: MEAN_ME`. The Horizons manual says
this is the DE421 mean-Earth frame, realised from the DE440 PA frame with a fixed rotation. `Center radii: 1737.4, 1737.4, 1737.4 km`
means a sphere, so GEODETIC altitude = height above the 1737.4 km sphere and the zenith is radial,
exactly as in CONTRACTS §0. `Atmos refraction: NO (AIRLESS)`. The azimuth is clockwise from north. Horizons uses
DE441 and we use DE421. The difference is invisible at this level.

Sites: Apollo 11 (0.674°N, 23.473°E), south polar (89.5°S, 0°E), Chang'e 4 (45.44°S, 177.59°E).
Epochs: 1969-07-20 20:17, 2026-11-14 12:00 and 2030-06-01 00:00 UTC, plus a one-month series
(2026-11-14 → 12-14, every 12 h) per site and body. Planets: Apollo 11 at the three epochs.

## Maximum differences (ours − Horizons)
"Sky error" is the great-circle angle between the two directions. Unlike Δaz, it does not blow up near the zenith.

{chr(10).join(summary)}

## The required epochs (Sun and Earth)
{chr(10).join(epochs)}

## Findings
1. **UTC before 1972 matters.** skyfield assumes TAI−UTC = 10 s for every date before 1972. The official value on
   1969-07-20 was 7.57 s (the USNO "rubber second" formula). With skyfield's default, the 1969 Sun
   differs from Horizons by 3.4e-4° (1.2 arcsec). With the official formula (`moonat.ephem.direct.skyfield_time`) the difference is 6e-6°.
   So Horizons uses the official 1960s UTC, and so do we.
2. **Angular diameter of the Sun:** we use R☉ = 696000 km (from the brief). Horizons' value is about 0.84 arcsec smaller,
   which matches R☉ = 695700 km (IAU 2015 nominal). The Earth (6378.137 km) agrees to 0.001 arcsec.
3. **Distances:** Sun within {sd["sun"]["d_dist_km"] * 1000:.0f} m and Earth within {sd["earth"]["d_dist_km"] * 1000:.1f} m (light-time range).
   For Jupiter and Saturn, the 170 km difference comes from the DE421 system barycentre that we use. This is below 0.1 arcsec.
4. **Table planets** are unit vectors from the Moon's centre (C1). They have no topocentric parallax, so the error is up to
   {st["venus"]["d_sep_deg"] * AS:.1f} arcsec for Venus near Earth. That is far below one pixel in the sky view.
5. **Phase:** illuminated fraction (1+cos α)/2 agrees with Horizons' `Illu%` within {sd["earth"]["d_phase"]:.1e}.

## Table interpolation (C1)
Step {manifest["step_hours"]} h, years {manifest["years"][0]}–1976 and 2013–{manifest["years"][-1]},
{manifest["total_bytes"] / 1e6:.1f} MB. Cubic Hermite with finite-difference tangents
(central inside each file, third-order one-sided at the file edges) and slerp for the rotation. The
exact recipe is in `manifest.json` and `moonat.ephem.table`. Measured against direct skyfield
({chk["n_samples"]} times, including the first and last interval of every year):
Sun {chk["sun_dir_arcsec"]:.3f}", Earth {chk["earth_dir_arcsec"]:.3f}", rotation {chk["rotation_arcsec"]:.3f}".
The largest values come from the one 3-hour interval that holds the 2016-12-31 leap second: POSIX/JS
time cannot represent 23:59:60, so there is up to 1 s of lunar rotation (0.55") in that interval. Elsewhere the Sun is within 0.1".
The topocentric az/el from the table agree with direct skyfield within 3e-5° (200 random sites and times,
`tests/test_ephem_table.py`).

## Known approximations (for the consumers)
- `era_deg` uses UT1 = UTC (error < 0.9 s, < 0.004°). The Earth body frame `R_icrs_to_enu · Rz(era)` (C6)
  ignores precession and nutation since J2000. This is about 0.36° in 2026 and −0.43° in 1969 on the Earth's
  rendered orientation. That is fine for a texture, but it is not an ephemeris quantity.
- Inside each 3-hour table interval, a leap second gives an error of at most 0.55" (see above).
"""
    MD.parent.mkdir(parents=True, exist_ok=True)
    MD.write_text(text, encoding="utf-8")


def main():
    direct = horizons.compare("direct")
    table = horizons.compare("table")
    manifest = json.loads((ROOT / "web/data/ephem/manifest.json").read_text(encoding="utf-8"))
    make_plot(direct, table)
    make_md(direct, table, manifest)
    print(f"wrote {FIG}\nwrote {MD}")


if __name__ == "__main__":
    main()
