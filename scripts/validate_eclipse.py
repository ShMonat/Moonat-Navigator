# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Eclipse validation: docs/figures/eclipse_coverage.png + the contact table for
docs/validation/eclipse.md (printed as Markdown).

The Sun covered by the Earth, seen from Blue Ghost (2025-03-14) and Surveyor 3 (1967-04-24),
against NASA's published contact times (Espenak, Danjon's rule).

Usage: uv run python scripts/validate_eclipse.py
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from moonat import eclipse as E  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FIG = ROOT / "docs" / "figures" / "eclipse_coverage.png"
# Reference palette (dataviz skill, light surface; as scripts/validate_ephem.py).
SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
BLUE, ORANGE, SHADE = "#2a78d6", "#eb6834", "#dfe9f7"
# Classical solar radius (semi-diameter 959.63 arcsec at 1 au), for the like-for-like NASA column.
CLASSICAL_SUN_RADIUS_KM = 696000.0

CASES = [
    {
        "title": "Blue Ghost (Mare Crisium), 14 March 2025",
        "site": "blueghost1",
        "window": ("2025-03-14T03:30:00Z", "2025-03-14T10:30:00Z"),
        "delta_t_nasa_s": 75.0,
        "tt_minus_utc_s": 69.184,
        "nasa": {
            "P1": "03:57:24",
            "U1": "05:09:33",
            "U2": "06:25:59",
            "Greatest": "06:58:41.7",
            "U3": "07:31:23",
            "U4": "08:47:48",
            "P4": "10:00:01",
        },
        "photo": ("08:30:00", "diamond ring photo\n(APOD: ~3:30 a.m. CDT)", -1),
    },
    {
        "title": "Surveyor 3 (Oceanus Procellarum), 24 April 1967",
        "site": "surveyor3",
        "window": ("1967-04-24T09:00:00Z", "1967-04-24T15:15:00Z"),
        "delta_t_nasa_s": 38.0,
        "tt_minus_utc_s": 37.736,
        "nasa": {
            "P1": "09:29:48",
            "U1": "10:25:03",
            "U2": "11:27:28",
            "Greatest": "12:06:26.3",
            "U3": "12:45:24",
            "U4": "13:47:49",
            "P4": "14:43:05",
        },
        "photo": ("11:24:00", "eclipse photo\n(3:24 a.m. PST)", 1),
    },
]


def posix(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def on_day(case: dict, hms: str) -> float:
    return posix(case["window"][0][:11] + hms + "Z")


def hms(p: float | None) -> str:
    if p is None:
        return "–"
    t = datetime(1970, 1, 1, tzinfo=UTC) + timedelta(seconds=round(p))
    return t.strftime("%H:%M:%S")


def run_case(case: dict) -> dict:
    h = json.loads((ROOT / "web/data/horizons" / f"{case['site']}.json").read_text("utf-8"))
    lat, lon, elev = h["lat_deg"], h["lon_deg"], h["ground_elev_m"]
    t0, t1 = case["window"]
    wide = (t0[:11] + "00:00:00Z", t1[:11] + "23:59:00Z")
    moon = E.moon_shadow_contacts(*wide)
    moon_classical = E.moon_shadow_contacts(*wide, sun_radius_km=CLASSICAL_SUN_RADIUS_KM)
    solid = E.site_contacts(lat, lon, *case["window"], ground_elev_m=elev)
    danjon = E.site_contacts(
        lat,
        lon,
        *case["window"],
        earth_radius_km=E.EARTH_RADIUS_KM * E.DANJON_FACTOR,
        ground_elev_m=elev,
    )
    tt = np.arange(posix(t0), posix(t1) + 1, 60.0)
    cov = E.site_sun_state(lat, lon, tt, None, elev)["eclipse_frac"]
    cov_d = E.site_sun_state(
        lat, lon, tt, None, elev, earth_radius_km=E.EARTH_RADIUS_KM * E.DANJON_FACTOR
    )["eclipse_frac"]
    return {
        "moon": moon,
        "moon_classical": moon_classical,
        "solid": solid,
        "danjon": danjon,
        "t": tt,
        "cov": cov,
        "cov_d": cov_d,
    }


def table(case: dict, r: dict) -> str:
    shift = case["delta_t_nasa_s"] - case["tt_minus_utc_s"]
    rows = [
        f"| Contact | NASA (UT) | Moonat, whole Moon (Danjon) | diff − ΔT shift ({shift:+.1f} s) "
        "| diff with R☉ = 696 000 km |",
        "|---|---|---|---|---|",
    ]
    for k, v in case["nasa"].items():
        ours = r["moon"][k.lower()]
        d = ours - on_day(case, v) - shift
        dc = r["moon_classical"][k.lower()] - on_day(case, v) - shift
        rows.append(f"| {k} | {v[:8]} | {hms(ours)} | {d:+.1f} s | {dc:+.1f} s |")
    return "\n".join(rows)


def site_table(case: dict, r: dict) -> str:
    s, d, m = r["solid"], r["danjon"], r["moon"]
    names = [
        ("c1", "Sun starts to be covered (site enters the penumbra)", "P1 – P2", ("p1", "p2")),
        ("c2", "Sun fully covered (site enters the umbra)", "U1 – U2", ("u1", "u2")),
        ("max", "Greatest eclipse at the site", "", None),
        ("c3", "Sun reappears (site leaves the umbra)", "U3 – U4", ("u3", "u4")),
        ("c4", "Sun fully uncovered (site leaves the penumbra)", "P3 – P4", ("p3", "p4")),
    ]
    rows = [
        "| Site event | Solid Earth (app) | Earth × 1.01 (Danjon) | Bracket | Bracket times (UT) |",
        "|---|---|---|---|---|",
    ]
    for k, label, br, keys in names:
        span = f"{hms(m[keys[0]])} – {hms(m[keys[1]])}" if keys else ""
        rows.append(f"| {label} | {hms(s[k])} | {hms(d[k])} | {br} | {span} |")
    return "\n".join(rows)


def plot(results: list[tuple[dict, dict]]) -> None:
    plt.rcParams.update(
        {
            "font.size": 10,
            "axes.edgecolor": INK2,
            "axes.labelcolor": INK,
            "xtick.color": INK2,
            "ytick.color": INK2,
            "axes.facecolor": SURFACE,
            "text.color": INK,
        }
    )
    fig, axes = plt.subplots(len(results), 1, figsize=(11, 4.1 * len(results)), facecolor=SURFACE)
    for ax, (case, r) in zip(axes, results, strict=True):
        day0 = posix(case["window"][0][:11] + "00:00:00Z")
        hours = (r["t"] - day0) / 3600.0
        s = r["solid"]

        def h(p, d0=day0):
            return (p - d0) / 3600.0

        ax.axvspan(h(s["c2"]), h(s["c3"]), color=SHADE, lw=0, zorder=0)
        ax.text(
            0.5 * (h(s["c2"]) + h(s["c3"])),
            50,
            "Sun fully hidden\nat the site",
            ha="center",
            va="center",
            color=BLUE,
            fontsize=9,
        )
        ax.plot(hours, 100 * r["cov_d"], color=ORANGE, lw=1.3, ls="--", zorder=2)
        ax.plot(hours, 100 * r["cov"], color=BLUE, lw=2.4, zorder=3)
        for k, v in case["nasa"].items():
            x = h(on_day(case, v))
            ax.axvline(x, color=INK2, lw=0.9, ls=":", zorder=1)
            ax.text(x, 104, k, ha="center", va="bottom", fontsize=9, color=INK2)
        px, plab, side = case["photo"]
        xp = h(on_day(case, px))
        ax.plot([xp], [100], marker="v", ms=9, color=INK, zorder=4)
        ax.annotate(
            plab,
            (xp, 100),
            xytext=(xp + side * 0.15, 76),
            ha="left" if side > 0 else "right",
            fontsize=8.5,
            color=INK,
            arrowprops={"arrowstyle": "-", "color": INK2, "lw": 0.8},
        )
        ax.set_ylim(-3, 112)
        ax.set_xlim(hours[0], hours[-1])
        ticks = np.arange(np.ceil(hours[0]), hours[-1] + 1e-9, 1.0)
        ax.set_xticks(ticks)
        ax.set_xticklabels([f"{int(t):02d}:00" for t in ticks])
        ax.set_ylabel("Sun's flux hidden by the Earth [%]")
        ax.set_title(case["title"], loc="left", fontsize=11.5, color=INK, pad=16)
        ax.grid(axis="y", color=GRID, lw=0.8, zorder=0)
        for sp in ("top", "right"):
            ax.spines[sp].set_visible(False)
    axes[-1].set_xlabel("UTC")
    handles = [
        plt.Line2D(
            [], [], color=BLUE, lw=2.4, label="Moonat: solid Earth, R = 6378 km (used in the app)"
        ),
        plt.Line2D(
            [],
            [],
            color=ORANGE,
            lw=1.3,
            ls="--",
            label="Earth enlarged × 1.01 (Danjon's rule, as NASA)",
        ),
        plt.Line2D(
            [], [], color=INK2, lw=0.9, ls=":", label="NASA contacts for the whole Moon (P1 … P4)"
        ),
    ]
    fig.legend(handles=handles, loc="lower center", ncol=3, frameon=False, fontsize=9)
    fig.suptitle(
        "Eclipse of the Sun by the Earth, seen from the lander sites (lunar eclipse on Earth)",
        x=0.01,
        ha="left",
        fontsize=13,
        color=INK,
    )
    fig.text(
        0.99, 0.985, "AI-generated with Claude Code (Anthropic)", ha="right", color=INK2, fontsize=7
    )
    fig.tight_layout(rect=(0, 0.05, 1, 0.97))
    FIG.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIG, dpi=130, facecolor=SURFACE)
    print(f"wrote {FIG}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    results = [(c, run_case(c)) for c in CASES]
    for case, r in results:
        print(f"\n### {case['title']}\n")
        print(table(case, r))
        print(f"\numbral magnitude (ours) = {r['moon']['umbral_magnitude']:.4f}\n")
        print(site_table(case, r))
    plot(results)


if __name__ == "__main__":
    main()
