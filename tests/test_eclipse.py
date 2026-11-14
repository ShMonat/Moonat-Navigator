# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Eclipse of the Sun by the Earth seen from the Moon (moonat.eclipse), validated against NASA.

NASA contact times (UT): F. Espenak, NASA GSFC eclipse pages (Danjon's rule, VSOP87/ELP2000-85),
https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE2025Mar14T.pdf (Delta T = 75 s) and
https://eclipse.gsfc.nasa.gov/LEplot/LEplot1951/LE1967Apr24T.pdf (Delta T = 38 s).

Also writes tests/fixtures/eclipse_cases.json (Python reference values for the JS port,
web/tests/physics_eclipse.test.mjs). Regenerate:  uv run python tests/test_eclipse.py
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

from moonat import eclipse as E
from moonat.ephem import topo

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = Path(__file__).parent / "fixtures" / "eclipse_cases.json"
GENERATED_BY = (
    "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."
)


def posix(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def horizon(site_id: str) -> dict:
    return json.loads((ROOT / "web" / "data" / "horizons" / f"{site_id}.json").read_text("utf-8"))


# NASA's published contacts (UT), and the site of the mission that photographed the eclipse.
ECLIPSES = {
    "2025-03-14": {
        "site": "blueghost1",
        "delta_t_nasa_s": 75.0,
        "tt_minus_utc_s": 69.184,
        "window": ("2025-03-14T02:00:00Z", "2025-03-14T12:00:00Z"),
        "umbral_magnitude": 1.1784,
        "nasa": {
            "p1": "2025-03-14T03:57:24Z",
            "u1": "2025-03-14T05:09:33Z",
            "u2": "2025-03-14T06:25:59Z",
            "greatest": "2025-03-14T06:58:41.7Z",
            "u3": "2025-03-14T07:31:23Z",
            "u4": "2025-03-14T08:47:48Z",
            "p4": "2025-03-14T10:00:01Z",
        },
    },
    "1967-04-24": {
        "site": "surveyor3",
        "delta_t_nasa_s": 38.0,
        # TAI-UTC on 1967-04-24 (USNO tai-utc.dat: 4.3131700 + (MJD - 39126) * 0.002592) + 32.184 s
        "tt_minus_utc_s": 37.736,
        "window": ("1967-04-24T07:30:00Z", "1967-04-24T16:30:00Z"),
        "umbral_magnitude": 1.3356,
        "nasa": {
            "p1": "1967-04-24T09:29:48Z",
            "u1": "1967-04-24T10:25:03Z",
            "u2": "1967-04-24T11:27:28Z",
            "greatest": "1967-04-24T12:06:26.3Z",
            "u3": "1967-04-24T12:45:24Z",
            "u4": "1967-04-24T13:47:49Z",
            "p4": "1967-04-24T14:43:05Z",
        },
    },
}


def site_args(site_id: str) -> dict:
    h = horizon(site_id)
    return {"lat_deg": h["lat_deg"], "lon_deg": h["lon_deg"], "ground_elev_m": h["ground_elev_m"]}


@pytest.fixture(scope="module")
def contacts() -> dict:
    out = {}
    for key, ev in ECLIPSES.items():
        out[key] = {
            "moon": E.moon_shadow_contacts(*ev["window"]),
            "site": _site_contacts(ev),
            "site_danjon": _site_contacts(ev, earth_radius_km=E.EARTH_RADIUS_KM * E.DANJON_FACTOR),
        }
    return out


def _site_contacts(ev: dict, **kw) -> dict:
    a = site_args(ev["site"])
    return E.site_contacts(
        a["lat_deg"], a["lon_deg"], *ev["window"], ground_elev_m=a["ground_elev_m"], **kw
    )


# ---- the overlap integral ------------------------------------------------------------------------


@pytest.mark.parametrize("p", [0.1, 0.5, 0.99, 1.0, 1.5, 3.4, 3.9])
def test_uniform_disk_matches_lens_area(p):
    z = np.linspace(0.0, 1.0 + p + 0.1, 601)
    err = max(
        abs(E.occulted_flux_fraction(float(x), p, 0.0) - E.lens_area_fraction(float(x), p))
        for x in z
    )
    assert err < 1e-8


def test_limb_darkened_fraction_matches_a_dense_grid():
    # Independent check: integrate I(mu) on a 1601 x 1601 Cartesian grid over the solar disk.
    n = 1601
    x = (np.arange(n) + 0.5) / n * 2.0 - 1.0
    xx, yy = np.meshgrid(x, x)
    r2 = xx**2 + yy**2
    inside = r2 < 1.0
    i_ld = np.where(inside, 1.0 - 0.6 * (1.0 - np.sqrt(np.clip(1.0 - r2, 0.0, 1.0))), 0.0)
    total = i_ld.sum()
    for z, p in [
        (0.0, 0.3),
        (0.5, 0.3),
        (1.0, 0.4),
        (2.5, 3.5),
        (3.0, 3.5),
        (4.2, 3.5),
        (0.8, 1.0),
    ]:
        covered = (xx - z) ** 2 + yy**2 < p * p
        ref = float((i_ld * covered).sum() / total)
        assert E.occulted_flux_fraction(z, p, 0.6) == pytest.approx(ref, abs=2e-3), (z, p)


def test_fraction_is_monotonic_and_bounded():
    p = 3.5
    z = np.linspace(0.0, 5.0, 400)
    f = np.array([E.occulted_flux_fraction(float(v), p) for v in z])
    assert np.all(np.diff(f) <= 1e-12)
    assert f[0] == 1.0 and f[-1] == 0.0
    assert E.occulted_flux_fraction(p - 1.0, p) == 1.0  # internal contact: just total
    assert E.occulted_flux_fraction(p + 1.0, p) == 0.0  # external contact


def test_no_overlap_work_beyond_the_sum_of_radii():
    a = math.radians(0.27 + 0.95 + 1e-6)
    assert E.sun_eclipse_frac([1, 0, 0], 0.27, [math.cos(a), math.sin(a), 0.0], 0.95) == 0.0


# ---- the real eclipses ---------------------------------------------------------------------------


@pytest.mark.parametrize("key", list(ECLIPSES))
def test_sun_fully_covered_at_greatest_eclipse(key, contacts):
    ev = ECLIPSES[key]
    a = site_args(ev["site"])
    h = horizon(ev["site"])
    for t in (posix(ev["nasa"]["greatest"]), contacts[key]["site"]["max"]):
        st = E.site_sun_state(a["lat_deg"], a["lon_deg"], t, h, a["ground_elev_m"])
        assert st["eclipse_frac"][0] == 1.0
        assert st["flux_frac"][0] == 0.0
        assert st["vis_frac"][0] == 1.0  # the Sun is above this site's terrain


@pytest.mark.parametrize("key", list(ECLIPSES))
def test_whole_moon_contacts_reproduce_nasa(key, contacts):
    """Our ephemeris + NASA's method (Danjon) gives NASA's contacts within a few seconds."""
    ev = ECLIPSES[key]
    m = contacts[key]["moon"]
    # NASA's UT = TD - Delta T(NASA); ours = TD - (TT - UTC): ours is later by the difference.
    shift = ev["delta_t_nasa_s"] - ev["tt_minus_utc_s"]
    for k, iso in ev["nasa"].items():
        assert m[k] - posix(iso) - shift == pytest.approx(0.0, abs=4.0), k
    assert m["umbral_magnitude"] == pytest.approx(ev["umbral_magnitude"], abs=5e-4)


@pytest.mark.parametrize("key", list(ECLIPSES))
def test_site_contacts_fall_between_nasa_contacts(key, contacts):
    """A near-side site enters the umbra between U1 and U2, leaves it between U3 and U4, and sees
    the Sun start and stop being covered between P1 and P2 and between P3 and P4 (the whole Moon
    inside the penumbra; computed, NASA does not list it). The solid Earth (no 1/85 atmosphere)
    makes the site's shadow contacts later on entry and earlier on exit by 1-1.5 min."""
    ev = ECLIPSES[key]
    n = {k: posix(v) for k, v in ev["nasa"].items()}
    m = contacts[key]["moon"]
    for c, slack in ((contacts[key]["site"], 120.0), (contacts[key]["site_danjon"], 10.0)):
        assert n["u1"] < c["c2"] < n["u2"] + slack
        assert n["u3"] - slack < c["c3"] < n["u4"]
        assert n["p1"] < c["c1"] < m["p2"] + slack
        assert m["p3"] - slack < c["c4"] < n["p4"]
    s, d = contacts[key]["site"], contacts[key]["site_danjon"]
    for k, sign in (("c1", -1), ("c2", -1), ("c3", 1), ("c4", 1)):
        assert 40.0 < sign * (d[k] - s[k]) < 120.0, k  # the enlarged Earth: earlier in, later out


def test_blue_ghost_end_of_totality_matches_the_diamond_ring_photo(contacts):
    """NASA APOD 2025-03-19: Blue Ghost's diamond ring 'around 3:30 a.m. CDT' = 08:30 UTC."""
    c3 = contacts["2025-03-14"]["site"]["c3"]
    assert abs(c3 - posix("2025-03-14T08:30:00Z")) < 10 * 60


def test_surveyor3_photo_time_is_during_totality(contacts):
    """The Surveyor 3 eclipse picture caption: 3:24 a.m. PST on 1967-04-24 = 11:24 UT."""
    c = contacts["1967-04-24"]["site"]
    assert c["c2"] < posix("1967-04-24T11:24:00Z") < c["c3"]


@pytest.mark.parametrize(
    "iso",
    [
        "2025-03-20T12:00:00Z",
        "2025-04-13T00:22:00Z",
        "2031-07-02T09:00:00Z",
        "1967-05-10T00:00:00Z",
    ],
)
def test_no_eclipse_outside_eclipse_seasons(iso):
    """An ordinary date, and a full Moon (2025-04-13 00:22 UTC) outside an eclipse season."""
    a = site_args("blueghost1")
    st = E.site_sun_state(a["lat_deg"], a["lon_deg"], iso, None, a["ground_elev_m"])
    assert st["eclipse_frac"][0] == 0.0
    assert st["sep_deg"][0] > st["rho_sun_deg"][0] + st["rho_earth_deg"][0]


def test_terrain_and_earth_combine():
    """During the partial phase: no terrain -> 1 - ecl; a wall up to the Sun's centre hides about
    half of the remaining flux; vis_frac stays terrain-only."""
    a = site_args("blueghost1")
    t = posix("2025-03-14T05:40:00Z")
    flat = E.site_sun_state(a["lat_deg"], a["lon_deg"], t, None, a["ground_elev_m"])
    ecl = float(flat["eclipse_frac"][0])
    assert 0.1 < ecl < 0.9
    assert flat["flux_frac"][0] == pytest.approx(1.0 - ecl, abs=1e-15)
    wall = wall_horizon(float(flat["sun_el_deg"][0]))
    cut = E.site_sun_state(a["lat_deg"], a["lon_deg"], t, wall, a["ground_elev_m"])
    assert cut["vis_frac"][0] == pytest.approx(0.5, abs=0.01)
    assert 0.0 < cut["flux_frac"][0] < 1.0 - ecl
    assert cut["eclipse_frac"][0] == ecl


def wall_horizon(el_deg: float) -> dict:
    return {"az_step_deg": 1.0, "el_deg": [round(el_deg, 6)] * 360}


# ---- fixtures for the JS port --------------------------------------------------------------------


def build_cases() -> dict:
    occ = []
    for u in (0.0, 0.6):
        for p in (0.3, 1.0, 3.5):
            for z in np.linspace(0.0, 1.0 + p + 0.05, 23):
                z = float(np.round(z, 6))
                occ.append({"z": z, "p": p, "u": u, "frac": E.occulted_flux_fraction(z, p, u)})
    states = []
    for ev in ECLIPSES.values():
        site = ev["site"]
        a = site_args(site)
        h = horizon(site)
        t0, t1 = posix(ev["window"][0]), posix(ev["window"][1])
        for t in np.linspace(t0, t1, 41):
            t = float(round(t))
            st = E.site_sun_state(a["lat_deg"], a["lon_deg"], t, h, a["ground_elev_m"])
            states.append(_state_row(site, None, t, st))
        # Joint terrain + Earth: a wall at the Sun's centre elevation during the partial phase.
        for iso in ((ev["nasa"]["u1"]), ev["nasa"]["u4"]):
            t = posix(iso)
            flat = E.site_sun_state(a["lat_deg"], a["lon_deg"], t, None, a["ground_elev_m"])
            for dh in (-0.15, 0.0, 0.15):
                w = round(float(flat["sun_el_deg"][0]) + dh, 6)
                st = E.site_sun_state(
                    a["lat_deg"], a["lon_deg"], t, wall_horizon(w), a["ground_elev_m"]
                )
                states.append(_state_row(site, w, t, st))
    contacts = []
    for ev in ECLIPSES.values():
        c = _site_contacts(ev, tol_s=0.05)
        contacts.append(
            {
                "site": ev["site"],
                "t0_ms": posix(ev["window"][0]) * 1e3,
                "t1_ms": posix(ev["window"][1]) * 1e3,
                **{k: c[k] * 1e3 for k in ("c1", "c2", "max", "c3", "c4")},
                "max_frac": c["max_frac"],
            }
        )
    return {
        "_generated_by": GENERATED_BY,
        "source": "moonat.eclipse (tests/test_eclipse.py)",
        "occulted": occ,
        "site_states": states,
        "contacts": contacts,
    }


def _state_row(site: str, wall: float | None, t: float, st: dict) -> dict:
    return {
        "site": site,
        "wall_deg": wall,
        "t_ms": t * 1e3,
        "eclipse_frac": float(st["eclipse_frac"][0]),
        "vis_frac": float(st["vis_frac"][0]),
        "flux_frac": float(st["flux_frac"][0]),
        "sun_el_deg": float(st["sun_el_deg"][0]),
    }


def test_fixture_matches_python_reference():
    assert FIXTURE.exists(), "run: uv run python tests/test_eclipse.py"
    saved = json.loads(FIXTURE.read_text("utf-8"))
    fresh = build_cases()
    for a, b in zip(saved["occulted"], fresh["occulted"], strict=True):
        assert a["frac"] == pytest.approx(b["frac"], abs=1e-12)
    for a, b in zip(saved["site_states"], fresh["site_states"], strict=True):
        for k in ("eclipse_frac", "vis_frac", "flux_frac"):
            assert a[k] == pytest.approx(b[k], abs=1e-9), k
    for a, b in zip(saved["contacts"], fresh["contacts"], strict=True):
        for k in ("c1", "c2", "max", "c3", "c4"):
            assert a[k] == pytest.approx(b[k], abs=200.0), k


def test_earth_radius_is_the_solid_body_equatorial_radius():
    assert E.EARTH_RADIUS_KM == topo.EARTH_RADIUS_KM == 6378.137
    manifest = json.loads((ROOT / "web" / "data" / "ephem" / "manifest.json").read_text("utf-8"))
    assert manifest["body_radii_km"]["earth"] == E.EARTH_RADIUS_KM


if __name__ == "__main__":
    data = build_cases()
    data["_generated_utc"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    FIXTURE.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {FIXTURE} ({len(data['site_states'])} states)")
