# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Independent cross-check of the browser physics (web/js/physics, contract C6) against JPL Horizons.

No Python ephemeris code is used here: the Moonat side is the JavaScript `skyState()` / `series()`
run in Node (scripts/xcheck_skystate.mjs) on the shipped tables web/data/ephem, and the reference
side is the JPL Horizons API (DE441), queried for a topocentric site on the Moon:
CENTER='coord@301', site in Horizons' MEAN_ME body-fixed frame (east longitude, 1737.4 km sphere),
airless apparent az/el, UT time scale.

Checks:
1. 20 seeded random (lat, lon, height, UTC) cases: near side, far side, limb, both polar caps,
   1966-1976 and 2013-2040, table year boundaries, 3-hour nodes and mid-intervals. Sun and Earth
   az/el, range, angular radius, Earth illuminated fraction, light time.
2. Eclipses of 2025-03-14 (Blue Ghost) and 1967-04-24 (Surveyor 3): Sun-Earth separation.
3. Light time and aberration: JS apparent directions vs Horizons geometric / light-time-only /
   light-time + stellar aberration vectors (ICRF).

Horizons responses are cached in tests/fixtures/horizons_cache/ (one small JSON per query), so the
pytest tests/test_horizons_js_xcheck.py runs offline. Requests are sequential, 1 s apart.

Usage:
  uv run python scripts/validate_horizons_js.py            # fetch missing responses, print the results
  uv run python scripts/validate_horizons_js.py --offline  # cache only
  uv run python scripts/validate_horizons_js.py --write    # also write the report and the figure
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "tests" / "fixtures" / "horizons_cache"
EPHEM_DIR = ROOT / "web" / "data" / "ephem"
BRIDGE = ROOT / "scripts" / "xcheck_skystate.mjs"
FIG = ROOT / "docs" / "figures" / "xcheck_horizons_js.png"
MD = ROOT / "docs" / "validation" / "independent_check.md"
API = "https://ssd.jpl.nasa.gov/api/horizons.api"
GEN = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."

SEED = 20261115
R_MOON_KM = 1737.4  # Horizons "Center radii" and CONTRACTS §0
OBSERVER_HEIGHT_M = 2.0  # C6 default eye height
AU_KM = 149597870.7
C_KM_S = 299792.458
AS = 3600.0  # arcsec per degree
# Solar radius: IAU 2015 Resolution B3 nominal. Moonat (web/data/ephem/manifest.json
# body_radii_km) and Horizons ("Target radii" of the Sun) both use it.
R_SUN_KM = 695700.0
BODIES = {"sun": "10", "earth": "399"}
VEC_CORR = {"geom": "NONE", "lt": "LT", "lts": "LT+S"}
QUANTITIES = "4,10,13,20,21,24"  # az/el, illuminated %, ang. diam., range, light time, S-T-O
POLAR_LAT_DEG = 85.0  # polar sites are passed to Horizons in cylindrical coordinates


class HorizonsUnavailable(RuntimeError):
    """A response is not in the cache and Horizons cannot be reached (or fetching is off)."""


# ---------------------------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------------------------
def _utc(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _rand_time(rng: random.Random, y0: int, y1: int) -> datetime:
    """Uniform random UTC instant (whole seconds) in years y0..y1 inclusive."""
    a = datetime(y0, 1, 1, tzinfo=UTC)
    span = (datetime(y1 + 1, 1, 1, tzinfo=UTC) - a).total_seconds()
    return a + timedelta(seconds=round(rng.uniform(0, span)))


def _node(t: datetime) -> datetime:
    """The 3-hour table node at or before t (records are at YYYY-01-01T00:00Z + k * 3 h)."""
    return t.replace(hour=t.hour - t.hour % 3, minute=0, second=0, microsecond=0)


def make_cases(seed: int = SEED) -> list[dict]:
    """20 deterministic cases: site kind x time kind, both drawn with random.Random(seed).

    Sites: lat/lon selenographic MOON_ME (deg, east-positive), ground height above the 1737.4 km
    sphere (m), eye 2 m above the ground. Times: UTC, whole seconds.
    """
    rng = random.Random(seed)
    site_kinds = ["near"] * 5 + ["far"] * 5 + ["limb"] * 4 + ["south polar"] * 3
    site_kinds += ["north polar"] * 3
    old, new = (1966, 1976), (2013, 2040)
    time_kinds = [("year boundary", None)] * 5 + [("3-h node", old), ("3-h node", new)]
    time_kinds += [("3-h node", new), ("mid-interval", old), ("mid-interval", new)]
    time_kinds += [("mid-interval", new)] + [("random", old)] * 3 + [("random", new)] * 6
    boundaries = [  # (start of the 3-hour interval, fixed offset or None = random within it)
        ("1966-01-01T00:00:00Z", None),  # first interval of the tables
        ("1971-12-31T21:00:00Z", None),  # last interval of the rubber-second UTC era
        ("1975-12-31T21:00:00Z", None),  # holds the 1975-12-31 leap second
        ("2016-12-31T21:00:00Z", 10770),  # 23:59:30, holds the 2016-12-31 leap second
        ("2040-12-31T21:00:00Z", None),  # last interval of the tables
    ]
    rng.shuffle(time_kinds)
    cases, nb = [], 0
    for k, (skind, (tkind, era)) in enumerate(zip(site_kinds, time_kinds, strict=True)):
        if skind == "near":
            lat, lon = rng.uniform(-60, 60), rng.uniform(-70, 70)
        elif skind == "far":
            lat, lon = rng.uniform(-60, 60), rng.choice((-1, 1)) * rng.uniform(110, 180)
        elif skind == "limb":
            lat, lon = rng.uniform(-60, 60), rng.choice((-1, 1)) * rng.uniform(80, 100)
        elif skind == "south polar":
            lat, lon = rng.uniform(-89.9, -POLAR_LAT_DEG), rng.uniform(-180, 180)
        else:
            lat, lon = rng.uniform(POLAR_LAT_DEG, 89.9), rng.uniform(-180, 180)
        elev = round(rng.uniform(-4000, 4000))
        note = ""
        if tkind == "year boundary":
            start, off = boundaries[nb]
            nb += 1
            off = off if off is not None else round(rng.uniform(0, 10800))
            t = _utc(start) + timedelta(seconds=off)
            if start.startswith("2016") or start.startswith("1975"):
                note = "leap second in this 3-h interval"
        elif tkind == "random":
            t = _rand_time(rng, *era)
        else:
            t = _node(_rand_time(rng, *era))
            if tkind == "mid-interval":
                t += timedelta(minutes=90)
        cases.append(
            {
                "id": f"c{k + 1:02d}",
                "site_kind": skind,
                "time_kind": tkind,
                "lat_deg": round(lat, 4),
                "lon_deg": round(lon, 4),
                "ground_elev_m": float(elev),
                "observer_height_m": OBSERVER_HEIGHT_M,
                "t_utc": _iso(t),
                "note": note,
            }
        )
    return cases


# Eclipse sites and instants: the site contacts of docs/validation/eclipse.md §3 plus one instant
# before and after. Coordinates and heights as in web/data/sites.json.
ECLIPSES = {
    "ecl2025": {
        "label": "Blue Ghost, 2025-03-14",
        "lat_deg": 18.562,
        "lon_deg": 61.810,
        "ground_elev_m": -3651.0,
        "instants": [
            ("before", "2025-03-14T04:30:00Z"),
            ("C1 Sun starts to be covered", "2025-03-14T05:00:42Z"),
            ("C2 totality starts", "2025-03-14T06:17:24Z"),
            ("greatest at the site", "2025-03-14T07:25:54Z"),
            ("C3 diamond ring", "2025-03-14T08:34:24Z"),
            ("C4 Sun fully uncovered", "2025-03-14T09:51:10Z"),
            ("after", "2025-03-14T10:20:00Z"),
        ],
    },
    "ecl1967": {
        "label": "Surveyor 3, 1967-04-24",
        "lat_deg": -3.015,
        "lon_deg": -23.418,
        "ground_elev_m": -1424.0,
        "instants": [
            ("before", "1967-04-24T09:30:00Z"),
            ("C1 Sun starts to be covered", "1967-04-24T09:47:24Z"),
            ("C2 totality starts", "1967-04-24T10:43:48Z"),
            ("greatest at the site", "1967-04-24T11:54:30Z"),
            ("C3 Sun reappears", "1967-04-24T13:05:13Z"),
            ("C4 Sun fully uncovered", "1967-04-24T14:01:39Z"),
            ("after", "1967-04-24T14:30:00Z"),
        ],
    },
}


def vector_case_ids(cases: list[dict]) -> list[str]:
    """One case of each site kind (not a leap-second interval) for the light-time check."""
    seen, ids = set(), []
    for c in cases:
        if c["site_kind"] not in seen and not c["note"]:
            seen.add(c["site_kind"])
            ids.append(c["id"])
    return ids


# ---------------------------------------------------------------------------------------------
# Horizons (with a JSON cache)
# ---------------------------------------------------------------------------------------------
def site_params(lat: float, lon: float, height_m: float) -> dict:
    """Horizons site of a lunar point: east longitude 0..360, on the 1737.4 km sphere.

    Our (lat, lon) order and -180..180 longitudes are converted to Horizons' order
    'E-lon,lat,alt' (GEODETIC, alt in km above the sphere) or 'E-lon,Dxy,Dz' (CYLINDRICAL, km)
    for |lat| > 85 deg. On a sphere both give the same point and a radial zenith.
    """
    elon = lon % 360.0
    if abs(lat) > POLAR_LAT_DEG:
        r = R_MOON_KM + height_m / 1000.0
        dxy, dz = r * math.cos(math.radians(lat)), r * math.sin(math.radians(lat))
        return {"COORD_TYPE": "'CYLINDRICAL'", "SITE_COORD": f"'{elon:.6f},{dxy:.6f},{dz:.6f}'"}
    return {
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{elon:.6f},{lat:.6f},{height_m / 1000:.6f}'",
    }


def observer_params(body: str, site: dict, times: list[str]) -> dict:
    p = {
        "format": "text",
        "COMMAND": f"'{BODIES[body]}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "TIME_TYPE": "'UT'",
        "TLIST_TYPE": "'CAL'",
        "TLIST": " ".join(f"'{t.replace('T', ' ').rstrip('Z')}'" for t in times),
        "QUANTITIES": f"'{QUANTITIES}'",
        "ANG_FORMAT": "'DEG'",
        "APPARENT": "'AIRLESS'",
        "EXTRA_PREC": "'YES'",
        "CSV_FORMAT": "'YES'",
        "TIME_DIGITS": "'FRACSEC'",
        "CAL_FORMAT": "'CAL'",
    }
    p.update(site)
    return p


def vector_params(command: str, site: dict | None, times: list[str], corr: str) -> dict:
    """ICRF state vectors (km, km/s) of `command` from a lunar site (or, site=None, from the SSB)."""
    p = {
        "format": "text",
        "COMMAND": f"'{command}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'VECTORS'",
        "CENTER": "'coord@301'" if site else "'500@0'",
        "TIME_TYPE": "'UT'",
        "TLIST_TYPE": "'CAL'",
        "TLIST": " ".join(f"'{t.replace('T', ' ').rstrip('Z')}'" for t in times),
        "VEC_TABLE": "'3'",
        "VEC_CORR": f"'{VEC_CORR[corr]}'",
        "REF_SYSTEM": "'ICRF'",
        "REF_PLANE": "'FRAME'",
        "OUT_UNITS": "'KM-S'",
        "CSV_FORMAT": "'YES'",
        "VEC_LABELS": "'NO'",
        "TIME_DIGITS": "'FRACSEC'",
    }
    p.update(site or {})
    return p


class Horizons:
    """Cached access to the Horizons API: tests/fixtures/horizons_cache/<name>.json.

    A cache file holds the exact query parameters and the response text up to $$EOE (the column
    explanations that follow are dropped). A file whose parameters differ is refetched.
    """

    def __init__(self, cache: Path = CACHE, online: bool = True, pause_s: float = 1.0):
        self.cache, self.online, self.pause_s = cache, online, pause_s
        self.fetched = 0
        self._last = 0.0

    def get(self, name: str, params: dict) -> str:
        path = self.cache / f"{name}.json"
        if path.exists():
            d = json.loads(path.read_text(encoding="utf-8"))
            if d.get("params") == params:
                return d["response"]
        if not self.online:
            raise HorizonsUnavailable(f"{path.name} not cached (offline)")
        wait = self.pause_s - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        url = API + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                text = r.read().decode("utf-8")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise HorizonsUnavailable(f"Horizons unreachable: {e}") from e
        finally:
            self._last = time.monotonic()
        if "$$SOE" not in text or "$$EOE" not in text:
            raise RuntimeError(f"Horizons error for {name}:\n{text[:1500]}")
        text = text[: text.index("$$EOE") + len("$$EOE")] + "\n"
        self.cache.mkdir(parents=True, exist_ok=True)
        d = {
            "_generated_by": GEN,
            "_source": "NASA/JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api), "
            "response text up to $$EOE",
            "fetched_utc": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "params": params,
            "response": text,
        }
        path.write_text(json.dumps(d, indent=1) + "\n", encoding="utf-8")
        self.fetched += 1
        return text


def _table(text: str, first_col: str) -> tuple[list[str], list[list[str]]]:
    lines = text.splitlines()
    head = next(ln for ln in lines if ln.strip().startswith(first_col))
    names = [c.strip() for c in head.split(",")]
    i0, i1 = lines.index("$$SOE"), lines.index("$$EOE")
    rows = [[c.strip() for c in ln.split(",")] for ln in lines[i0 + 1 : i1]]
    return names, rows


def _num(s: str) -> float:
    try:
        return float(s)
    except ValueError:
        return math.nan


def header_site(text: str) -> tuple[float, float, float]:
    """(E-lon deg, lat deg, alt km) that Horizons echoes in 'Center geodetic'."""
    ln = next(ln for ln in text.splitlines() if ln.startswith("Center geodetic"))
    vals = ln.split(":", 1)[1].split("{")[0].split(",")
    return tuple(float(v) for v in vals)  # type: ignore[return-value]


def header_checks(text: str) -> dict:
    """Like-for-like flags from the response header."""
    return {
        "mean_me": "Center pole/equ : MEAN_ME" in text,
        "sphere_1737_4": "Center radii    : 1737.4, 1737.4, 1737.4 km" in text,
        "airless": "Atmos refraction: NO (AIRLESS)" in text
        or "VECTORS" in text
        or "cartesian" in text,
    }


def parse_observer(text: str, times: list[str]) -> list[dict]:
    names, rows = _table(text, "Date__(UT)")
    col = {n: i for i, n in enumerate(names) if n}
    out = []
    for row, t in zip(rows, times, strict=True):
        stamp = datetime.strptime(row[0], "%Y-%b-%d %H:%M:%S.%f").replace(tzinfo=UTC)
        if _iso(stamp) != t:
            raise RuntimeError(f"Horizons row time {row[0]} != requested {t}")
        out.append(
            {
                "t_utc": t,
                "az_deg": _num(row[col["Azimuth_(a-app)"]]),
                "el_deg": _num(row[col["Elevation_(a-app)"]]),
                "illu_frac": _num(row[col["Illu%"]]) / 100.0,
                "ang_diam_arcsec": _num(row[col["Ang-diam"]]),
                "dist_km": _num(row[col["delta"]]) * AU_KM,
                "deldot_km_s": _num(row[col["deldot"]]),
                "lt_s": _num(row[col["1-way_down_LT"]]) * 60.0,
                "sto_deg": _num(row[col["S-T-O"]]),
            }
        )
    return out


def parse_vectors(text: str, times: list[str]) -> list[dict]:
    names, rows = _table(text, "JDUT")
    col = {n: i for i, n in enumerate(names) if n}
    out = []
    for row, t in zip(rows, times, strict=True):
        stamp = datetime.strptime(row[1], "A.D. %Y-%b-%d %H:%M:%S.%f").replace(tzinfo=UTC)
        if _iso(stamp) != t:
            raise RuntimeError(f"Horizons row time {row[1]} != requested {t}")
        out.append(
            {
                "pos_km": [float(row[col[k]]) for k in ("X", "Y", "Z")],
                "vel_km_s": [float(row[col[k]]) for k in ("VX", "VY", "VZ")],
                "lt_s": float(row[col["LT"]]),
            }
        )
    return out


# ---------------------------------------------------------------------------------------------
# The browser physics, run in Node
# ---------------------------------------------------------------------------------------------
def find_node() -> str | None:
    cands = [os.environ.get("MOONAT_NODE"), shutil.which("node")]
    cands += [r"C:\Program Files\nodejs\node.exe", "/usr/local/bin/node", "/usr/bin/node"]
    return next((c for c in cands if c and Path(c).exists()), None)


def run_js(states: list[dict], node: str | None = None) -> dict[str, dict]:
    """skyState()/series() of web/js/physics for each state; returns {id: result}."""
    node = node or find_node()
    if not node:
        raise FileNotFoundError("Node.js not found (set MOONAT_NODE)")
    req = {"ephem_dir": str(EPHEM_DIR), "states": states}
    res = subprocess.run(
        [node, str(BRIDGE)],
        input=json.dumps(req),
        capture_output=True,
        text=True,
        timeout=120,
        cwd=ROOT,
        check=False,
    )
    if res.returncode != 0:
        raise RuntimeError(f"node bridge failed:\n{res.stderr}")
    out = json.loads(res.stdout)
    return {s["id"]: s for s in out["states"]} | {"_node": out["node"]}


# ---------------------------------------------------------------------------------------------
# Geometry helpers (independent of the JS code: plain spherical trigonometry)
# ---------------------------------------------------------------------------------------------
def azel_unit(az_deg: float, el_deg: float) -> list[float]:
    """ENU unit vector (east, north, up) of a true azimuth (from north toward east) and elevation."""
    a, e = math.radians(az_deg), math.radians(el_deg)
    return [math.cos(e) * math.sin(a), math.cos(e) * math.cos(a), math.sin(e)]


def angle_deg(u: list[float], v: list[float]) -> float:
    """Angle between two vectors (deg), atan2 form (accurate at small angles)."""
    cx = u[1] * v[2] - u[2] * v[1]
    cy = u[2] * v[0] - u[0] * v[2]
    cz = u[0] * v[1] - u[1] * v[0]
    dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
    return math.degrees(math.atan2(math.sqrt(cx * cx + cy * cy + cz * cz), dot))


def wrap180(x: float) -> float:
    return (x + 180.0) % 360.0 - 180.0


def rms(xs: list[float]) -> float:
    return math.sqrt(sum(x * x for x in xs) / len(xs)) if xs else math.nan


# ---------------------------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------------------------
def _site_of(c: dict) -> dict:
    return site_params(c["lat_deg"], c["lon_deg"], c["ground_elev_m"] + c["observer_height_m"])


def collect(online: bool = True) -> dict:
    """Queries Horizons (or the cache) and runs the JS physics for every check."""
    hz = Horizons(online=online)
    cases = make_cases()
    vec_ids = vector_case_ids(cases)
    states = [
        {
            k: c[k]
            for k in ("id", "lat_deg", "lon_deg", "ground_elev_m", "observer_height_m", "t_utc")
        }
        for c in cases
    ]
    for key, e in ECLIPSES.items():
        for k, (_, t) in enumerate(e["instants"]):
            # The instant, and +-30 s around it for the separation rate.
            for suffix, dt in (("", 0), ("_m", -30), ("_p", 30)):
                states.append(
                    {
                        "id": f"{key}_{k}{suffix}",
                        "lat_deg": e["lat_deg"],
                        "lon_deg": e["lon_deg"],
                        "ground_elev_m": e["ground_elev_m"],
                        "observer_height_m": OBSERVER_HEIGHT_M,
                        "t_utc": _iso(_utc(t) + timedelta(seconds=dt)),
                    }
                )
    js = run_js(states)

    hor: dict = {"cases": {}, "eclipse": {}, "vectors": {}, "headers": []}
    # The Moon's barycentric velocity at every case time (explains the Earth's ~0.1" term).
    times = sorted(c["t_utc"] for c in cases)  # Horizons returns a time list in time order
    text = hz.get("vec_moon_ssb", vector_params("301", None, times, "geom"))
    by_t = dict(zip(times, parse_vectors(text, times), strict=True))
    hor["moon_ssb"] = {c["id"]: by_t[c["t_utc"]] for c in cases}
    for c in cases:
        site = _site_of(c)
        for b in BODIES:
            text = hz.get(f"obs_{c['id']}_{b}", observer_params(b, site, [c["t_utc"]]))
            hor["cases"][(c["id"], b)] = parse_observer(text, [c["t_utc"]])[0]
            hor["headers"].append((c["id"], b, header_checks(text), header_site(text)))
    for key, e in ECLIPSES.items():
        site = site_params(e["lat_deg"], e["lon_deg"], e["ground_elev_m"] + OBSERVER_HEIGHT_M)
        times = [t for _, t in e["instants"]]
        for b in BODIES:
            text = hz.get(f"obs_{key}_{b}", observer_params(b, site, times))
            hor["eclipse"][(key, b)] = parse_observer(text, times)
            hor["headers"].append((key, b, header_checks(text), header_site(text)))
    for cid in vec_ids:
        c = next(x for x in cases if x["id"] == cid)
        for b in BODIES:
            for corr in VEC_CORR:
                p = vector_params(BODIES[b], _site_of(c), [c["t_utc"]], corr)
                text = hz.get(f"vec_{cid}_{b}_{corr}", p)
                hor["vectors"][(cid, b, corr)] = parse_vectors(text, [c["t_utc"]])[0]
    return {"cases": cases, "vec_ids": vec_ids, "js": js, "hz": hor, "fetched": hz.fetched}


def site_echo_errors(data: dict) -> list[dict]:
    """Horizons' echoed site (Center geodetic) vs the site we meant (lon, lat, alt)."""
    want = {c["id"]: c for c in data["cases"]}
    out = []
    for key, b, flags, (elon, lat, alt) in data["hz"]["headers"]:
        if key in want:
            c = want[key]
            lat0, lon0 = c["lat_deg"], c["lon_deg"]
            alt0 = (c["ground_elev_m"] + c["observer_height_m"]) / 1000.0
        else:
            e = ECLIPSES[key]
            lat0, lon0 = e["lat_deg"], e["lon_deg"]
            alt0 = (e["ground_elev_m"] + OBSERVER_HEIGHT_M) / 1000.0
        out.append(
            {
                "key": key,
                "body": b,
                **flags,
                "d_lon_deg": wrap180(elon - lon0),
                "d_lat_deg": lat - lat0,
                "d_alt_km": alt - alt0,
            }
        )
    return out


def centre_apparent_term(body: dict, r_site_km: float, m: list[float], v_obs_icrs: list[float]):
    """Predicted error of the C1 design "apparent vector from the Moon's centre, minus the site".

    The table stores C = |A| * u_app: the light-time vector A from the Moon's centre, turned by
    stellar aberration but kept at the light-time length |A|. To first order the exact apparent
    vector from the centre is A + v*tau (v = observer barycentric velocity, tau = |A|/c), so
    C = (1 - u.v/c) (A + v*tau): the table vector is too short by (u.v/c)|A| (up to ~38 km for
    the Earth). Subtracting the site s then turns that length error into a direction error
    (u.v/c) sin(p), with p the topocentric parallax (up to 0.26 deg for the Earth): a pure
    elevation error of up to ~0.09 arcsec. The range picks up -(s.v)/c (up to ~0.17 km).

    body: JS skyState body (enu unit vector, dist_km); r_site_km: site radius; m: row-major
    ICRS->ENU matrix; v_obs_icrs: the Moon's barycentric velocity (km/s, ICRF).
    Returns (corrected topocentric ENU vector in km, predicted JS - exact range in km).
    """
    v = [body["enu"][i] * body["dist_km"] for i in range(3)]
    c = [v[0], v[1], v[2] + r_site_km]
    cn = math.sqrt(sum(x * x for x in c))
    w = [sum(m[3 * i + k] * v_obs_icrs[k] for k in range(3)) for i in range(3)]
    a = sum(c[i] * w[i] for i in range(3)) / cn / C_KM_S
    corrected = [v[i] + a * c[i] for i in range(3)]
    return corrected, -r_site_km * w[2] / C_KM_S


SYNODIC_DAYS = 29.530589  # mean synodic month: the Sun's period around the sky in MOON_ME
STEP_S = 3 * 3600.0  # C1 table step


# Steps of UTC within the table years: (first UTC instant after the step, seconds inserted).
# 1972-01-01: end of the rubber-second era (TAI-UTC 9.892242 -> 10 s); the others are leap seconds.
UTC_STEPS = [
    ("1972-01-01", 0.107758),
    ("1972-07-01", 1.0),
    ("1973-01-01", 1.0),
    ("1974-01-01", 1.0),
    ("1975-01-01", 1.0),
    ("1976-01-01", 1.0),
    ("1977-01-01", 1.0),
    ("2015-07-01", 1.0),
    ("2017-01-01", 1.0),
]


def utc_step_slip_s(t_utc: str) -> float:
    """Time slip (s) of the table interpolation at t when its 3-hour interval holds a UTC step.

    The tables are indexed in POSIX time, which has no 23:59:60, so an interval holding a leap
    second lasts 10801 s of real time but is interpolated as 10800 s: at fraction s of the
    interval the JS state is that of an instant s * 1 s later than t (0 outside such intervals).
    """
    t = _utc(t_utc)
    y0 = datetime(t.year, 1, 1, tzinfo=UTC)
    a = math.floor((t - y0).total_seconds() / STEP_S) * STEP_S
    ta, tb = y0 + timedelta(seconds=a), y0 + timedelta(seconds=a + STEP_S)
    slip = 0.0
    for day, d in UTC_STEPS:
        ts = _utc(day + "T00:00:00Z")
        if ta < ts <= tb:
            slip += d * ((t - ta).total_seconds() / STEP_S) - (d if ts <= t else 0.0)
    return slip


def sun_interp_model(t_utc: str, dist_km: float) -> tuple[float, float]:
    """Interpolation error of the C1 table for the Sun, modelled as a circle.

    In MOON_ME the Sun turns around the Moon once per synodic month at ~1 au, so each table
    component is a sinusoid. This replays web/js/physics/ephem.js on that circle (cubic Hermite in
    POSIX time; central-difference tangents inside a year file, third-order one-sided tangents at
    its first and last record), with the records at their true instants (UTC steps above).
    Returns (radial error km, along-track error arcsec): ~-1.7 km mid-interval, 0 at nodes; a leap
    second in the interval adds up to 1 s of the Sun's motion (0.5 arcsec).
    """
    t = _utc(t_utc)
    y0 = datetime(t.year, 1, 1, tzinfo=UTC)
    n = round((datetime(t.year + 1, 1, 1, tzinfo=UTC) - y0).total_seconds() / STEP_S) + 1
    u = (t - y0).total_seconds() / STEP_S
    i = min(int(math.floor(u)), n - 2)
    s = u - i
    om = 2 * math.pi / (SYNODIC_DAYS * 86400.0)  # rad/s

    def inserted(posix_s: float) -> float:
        """UTC steps between the year start and y0 + posix_s (s of real time)."""
        return sum(
            d
            for day, d in UTC_STEPS
            if 0 < (_utc(day + "T00:00:00Z") - y0).total_seconds() <= posix_s
        )

    def phase(x: float) -> float:  # x = record index (float), on the POSIX grid
        return om * (x * STEP_S + inserted(x * STEP_S))

    def p(k: int) -> complex:
        return dist_km * complex(math.cos(phase(k)), math.sin(phase(k)))

    def tangent(k: int) -> complex:
        if 0 < k < n - 1:
            return (p(k + 1) - p(k - 1)) / 2
        if k == 0:
            return (-11 * p(0) + 18 * p(1) - 9 * p(2) + 2 * p(3)) / 6
        return (11 * p(n - 1) - 18 * p(n - 2) + 9 * p(n - 3) - 2 * p(n - 4)) / 6

    s2, s3 = s * s, s * s * s
    h = (2 * s3 - 3 * s2 + 1, s3 - 2 * s2 + s, -2 * s3 + 3 * s2, s3 - s2)
    q = h[0] * p(i) + h[1] * tangent(i) + h[2] * p(i + 1) + h[3] * tangent(i + 1)
    true_phase = om * (u * STEP_S + inserted((t - y0).total_seconds()))
    along = (math.atan2(q.imag, q.real) - true_phase + math.pi) % (2 * math.pi) - math.pi
    return abs(q) - dist_km, math.degrees(along) * AS


def _azel(v: list[float]) -> tuple[float, float]:
    return (
        math.degrees(math.atan2(v[0], v[1])) % 360.0,
        math.degrees(math.atan2(v[2], math.hypot(v[0], v[1]))),
    )


def compare_cases(data: dict) -> list[dict]:
    """One row per (case, body): JS skyState - Horizons."""
    rows = []
    for c in data["cases"]:
        j = data["js"][c["id"]]
        r_site = R_MOON_KM + (c["ground_elev_m"] + c["observer_height_m"]) / 1000.0
        v_moon = data["hz"]["moon_ssb"][c["id"]]["vel_km_s"]
        for b in BODIES:
            h = data["hz"]["cases"][(c["id"], b)]
            s = j["sky"][b]
            ser = j["series"]
            ang_r_h = h["ang_diam_arcsec"] / 2.0
            corr, pred_dist = centre_apparent_term(s, r_site, j["sky"]["r_icrs_to_enu"], v_moon)
            az_c, el_c = _azel(corr)
            r = {
                "id": c["id"],
                "body": b,
                "h_az": h["az_deg"],
                "h_el": h["el_deg"],
                "d_sky_as": angle_deg(s["enu"], azel_unit(h["az_deg"], h["el_deg"])) * AS,
                "d_az_cos_as": wrap180(s["az_deg"] - h["az_deg"])
                * math.cos(math.radians(h["el_deg"]))
                * AS,
                "d_el_as": (s["el_deg"] - h["el_deg"]) * AS,
                "d_dist_km": s["dist_km"] - h["dist_km"],
                "d_rho_as": s["ang_radius_deg"] * AS - ang_r_h,
                "d_lt_ms": (s["dist_km"] / C_KM_S - h["lt_s"]) * 1000.0,
                "series_vs_sky_deg": max(
                    abs(wrap180(ser[f"{b}_az"] - s["az_deg"])), abs(ser[f"{b}_el"] - s["el_deg"])
                ),
                "pred_d_el_as": (s["el_deg"] - el_c) * AS,
                "pred_d_az_cos_as": wrap180(s["az_deg"] - az_c) * math.cos(math.radians(el_c)) * AS,
                "d_sky_corr_as": angle_deg(corr, azel_unit(h["az_deg"], h["el_deg"])) * AS,
                "pred_d_dist_km": pred_dist,
                "slip_s": utc_step_slip_s(c["t_utc"]),
            }
            # Range residual after the explained terms: centre-to-site, leap-second slip x range rate.
            r["d_dist_corr_km"] = (
                s["dist_km"] - h["dist_km"] - pred_dist - h["deldot_km_s"] * r["slip_s"]
            )
            if b == "sun":
                r["pred_interp_dist_km"], r["pred_interp_along_as"] = sun_interp_model(
                    c["t_utc"], h["dist_km"]
                )
                r["d_dist_corr_km"] -= r["pred_interp_dist_km"]
                # Remove the along-track interpolation term: the Sun moves about -Z_ME (westward).
                lat = math.radians(c["lat_deg"])
                w = [0.0, -math.cos(lat), -math.sin(lat)]  # -Z_ME in the site ENU frame
                n = math.sqrt(sum(x * x for x in corr))
                u = [x / n for x in corr]
                mv = [
                    w[1] * u[2] - w[2] * u[1],
                    w[2] * u[0] - w[0] * u[2],
                    w[0] * u[1] - w[1] * u[0],
                ]
                mn = math.sqrt(sum(x * x for x in mv))
                a = math.radians(r["pred_interp_along_as"] / AS)
                corr = [u[k] - a * mv[k] / mn for k in range(3)]
                r["d_sky_corr_as"] = angle_deg(corr, azel_unit(h["az_deg"], h["el_deg"])) * AS
                # asin(R/d) with Horizons' range: isolates our range error from Horizons' rounding.
                rho_like = math.degrees(math.asin(R_SUN_KM / h["dist_km"])) * AS
                r["d_rho_like_as"] = s["ang_radius_deg"] * AS - rho_like
                r["h_rho_rounding_as"] = ang_r_h - rho_like
            else:
                r["d_phase"] = s["phase_frac"] - h["illu_frac"]
                r["series_vs_sky_phase"] = abs(ser["earth_phase"] - s["phase_frac"])
                r["d_rho_like_as"] = r["d_rho_as"]
            rows.append(r)
    return rows


def compare_eclipses(data: dict) -> list[dict]:
    """Sun-Earth separation at the site: JS vs Horizons, plus the contact condition margins."""
    rows = []
    for key, e in ECLIPSES.items():
        hs, he = data["hz"]["eclipse"][(key, "sun")], data["hz"]["eclipse"][(key, "earth")]
        for k, (label, t) in enumerate(e["instants"]):
            j = data["js"][f"{key}_{k}"]["sky"]
            sep_j = angle_deg(j["sun"]["enu"], j["earth"]["enu"])
            sep_h = angle_deg(
                azel_unit(hs[k]["az_deg"], hs[k]["el_deg"]),
                azel_unit(he[k]["az_deg"], he[k]["el_deg"]),
            )
            # Radii: our constants on each side's own ranges (like-for-like contact condition).
            rs_j, re_j = j["sun"]["ang_radius_deg"], j["earth"]["ang_radius_deg"]
            rs_h = math.degrees(math.asin(R_SUN_KM / hs[k]["dist_km"]))
            re_h = he[k]["ang_diam_arcsec"] / 2.0 / AS
            outer = "C1" in label or "C4" in label
            inner = "C2" in label or "C3" in label
            m_j = sep_j - (rs_j + re_j) if outer else sep_j - (re_j - rs_j) if inner else math.nan
            m_h = sep_h - (rs_h + re_h) if outer else sep_h - (re_h - rs_h) if inner else math.nan
            # d(separation)/dt from the JS states 30 s either side (arcsec/s).
            jm, jp = data["js"][f"{key}_{k}_m"]["sky"], data["js"][f"{key}_{k}_p"]["sky"]
            rate = (
                (
                    angle_deg(jp["sun"]["enu"], jp["earth"]["enu"])
                    - angle_deg(jm["sun"]["enu"], jm["earth"]["enu"])
                )
                * AS
                / 60.0
            )
            rows.append(
                {
                    "eclipse": e["label"],
                    "label": label,
                    "t_utc": t,
                    "sep_h_deg": sep_h,
                    "sep_j_deg": sep_j,
                    "d_sep_as": (sep_j - sep_h) * AS,
                    "ecl_frac_js": j["sun"]["eclipse_frac"],
                    "rate_as_per_s": rate,
                    "margin_js_as": m_j * AS,
                    "margin_h_as": m_h * AS,
                    # Contact time with the JS geometry minus with Horizons' geometry (s).
                    "d_contact_s": (m_h - m_j) * AS / rate,
                }
            )
    return rows


def compare_vectors(data: dict) -> list[dict]:
    """JS apparent direction (ICRS) vs Horizons geometric / LT / LT+S vectors from the site."""
    rows = []
    for cid in data["vec_ids"]:
        j = data["js"][cid]["sky"]
        m = j["r_icrs_to_enu"]  # row-major, enu = M . icrs  ->  icrs = M^T . enu
        for b in BODIES:
            e = j[b]["enu"]
            icrs = [
                m[0] * e[0] + m[3] * e[1] + m[6] * e[2],
                m[1] * e[0] + m[4] * e[1] + m[7] * e[2],
                m[2] * e[0] + m[5] * e[1] + m[8] * e[2],
            ]
            v = {k: data["hz"]["vectors"][(cid, b, k)] for k in VEC_CORR}
            g = v["geom"]
            # First-order planetary aberration (light time + aberration together): the apparent
            # direction is the geometric one shifted by v_perp / c, v = target velocity relative
            # to the observer (Horizons geometric state).
            p = g["pos_km"]
            pn = math.sqrt(sum(x * x for x in p))
            u = [x / pn for x in p]
            vr = g["vel_km_s"]
            vpar = sum(a * c for a, c in zip(vr, u, strict=True))
            vperp = math.sqrt(max(0.0, sum(a * a for a in vr) - vpar * vpar))
            rows.append(
                {
                    "id": cid,
                    "body": b,
                    "js_vs_lts_as": angle_deg(icrs, v["lts"]["pos_km"]) * AS,
                    "js_vs_lt_as": angle_deg(icrs, v["lt"]["pos_km"]) * AS,
                    "js_vs_geom_as": angle_deg(icrs, g["pos_km"]) * AS,
                    "h_lts_vs_geom_as": angle_deg(v["lts"]["pos_km"], g["pos_km"]) * AS,
                    "h_lts_vs_lt_as": angle_deg(v["lts"]["pos_km"], v["lt"]["pos_km"]) * AS,
                    "theory_vperp_over_c_as": math.degrees(vperp / C_KM_S) * AS,
                    "lt_h_s": v["lts"]["lt_s"],
                    "lt_js_s": j[b]["dist_km"] / C_KM_S,
                }
            )
    return rows


def stats(rows: list[dict], key: str, body: str | None = None, skip: set | None = None) -> dict:
    xs = [
        r[key]
        for r in rows
        if (body is None or r["body"] == body)
        and not (skip and r["id"] in skip)
        and key in r
        and not math.isnan(r[key])
    ]
    return {"n": len(xs), "max": max((abs(x) for x in xs), default=math.nan), "rms": rms(xs)}


# ---------------------------------------------------------------------------------------------
# Figure
# ---------------------------------------------------------------------------------------------
# Reference palette (dataviz skill; same as docs/figures/ephem_vs_horizons.png): an opaque light
# card that reads on light and dark pages. Slot 1 blue = Earth, slot 2 orange = Sun.
SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
COLOR = {"earth": "#2a78d6", "sun": "#eb6834"}


def make_figure(data: dict, cmp: list[dict], vec: list[dict], path: Path = FIG) -> None:
    """Two panels: per-case sky error (JS - Horizons); JS vs geometric / LT / LT+S vectors."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

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
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(14, 5.4), gridspec_kw={"width_ratios": [2.0, 1]})
    fig.patch.set_facecolor(SURFACE)
    for ax in (a1, a2):
        ax.set_facecolor(SURFACE)
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)

    # Panel 1: great-circle error per case, Sun and Earth side by side.
    cases = data["cases"]
    ids = [c["id"] for c in cases]
    noted = {c["id"] for c in cases if c["note"]}
    ymax = 0.17  # the one leap-second outlier is clipped and labelled
    a1.axhline(
        0.055, color=INK2, lw=1, ls="--", zorder=1, label="earlier Python-pipeline max (0.055″)"
    )
    for k, (b, label) in enumerate((("sun", "Sun"), ("earth", "Earth"))):
        xs = [i + (k - 0.5) * 0.3 for i in range(len(ids))]
        ys = [next(r["d_sky_as"] for r in cmp if r["id"] == cid and r["body"] == b) for cid in ids]
        yp = [min(y, ymax) for y in ys]
        a1.vlines(xs, 0, yp, color=COLOR[b], lw=2, zorder=2)
        a1.scatter(
            xs,
            yp,
            s=42,
            color=COLOR[b],
            edgecolor=SURFACE,
            linewidth=2,
            zorder=3,
            label=label,
            clip_on=False,
        )
        for x, y in zip(xs, ys, strict=True):
            if y > ymax:
                a1.annotate(
                    f"{y:.2f}″ ↑",
                    (x, ymax),
                    xytext=(-6, -30),
                    textcoords="offset points",
                    ha="right",
                    va="top",
                    fontsize=8.5,
                    color=INK,
                )
        yc = [
            next(r["d_sky_corr_as"] for r in cmp if r["id"] == cid and r["body"] == b)
            for cid in ids
        ]
        a1.scatter(
            xs,
            yc,
            s=34,
            facecolor=SURFACE,
            edgecolor=COLOR[b],
            linewidth=1.6,
            zorder=4,
            label=f"{label}, computed terms of §6 removed",
        )
    a1.set_ylim(0, ymax)
    for i, cid in enumerate(ids):
        if cid in noted:
            y = max(r["d_sky_as"] for r in cmp if r["id"] == cid)
            a1.text(
                i - 0.45 if y > ymax else i,
                ymax * 0.74 if y > ymax else 0.064,
                "leap second\nin this 3-h\ninterval",
                ha="right" if y > ymax else "center",
                va="bottom",
                fontsize=7.5,
                color=INK2,
            )
    kind_short = {
        "near": "near",
        "far": "far",
        "limb": "limb",
        "south polar": "S pole",
        "north polar": "N pole",
    }
    a1.set_xticks(range(len(ids)))
    a1.set_xticklabels(
        [f"{c['id']}\n{kind_short[c['site_kind']]}\n{c['t_utc'][:4]}" for c in cases], fontsize=7
    )
    a1.set_ylabel("direction error, JS − Horizons (arcsec)")
    a1.grid(axis="y", color=GRID, lw=0.8, zorder=0)
    h_, l_ = a1.get_legend_handles_labels()
    order = [1, 3, 2, 4, 0]  # Sun, Sun corrected, Earth, Earth corrected, reference line
    a1.legend(
        [h_[k] for k in order],
        [l_[k] for k in order],
        loc="upper left",
        frameon=False,
        ncol=3,
        fontsize=8.5,
    )
    a1.set_title(
        "Sun and Earth seen from 20 random lunar sites (browser code vs JPL Horizons)",
        loc="left",
        fontsize=10.5,
    )

    # Panel 2: JS apparent direction vs three Horizons vector types (log scale).
    groups = [
        ("lts", "light time + aberration\n(Horizons LT+S)"),
        ("lt", "light time only\n(LT)"),
        ("geom", "geometric\n(no correction)"),
    ]
    key = {"lts": "js_vs_lts_as", "lt": "js_vs_lt_as", "geom": "js_vs_geom_as"}
    for gi, (g, _) in enumerate(groups):
        for k, b in enumerate(("sun", "earth")):
            vals = [r[key[g]] for r in vec if r["body"] == b]
            y = gi + (k - 0.5) * 0.3
            a2.scatter(
                vals,
                [y] * len(vals),
                s=42,
                color=COLOR[b],
                edgecolor=SURFACE,
                linewidth=2,
                zorder=3,
                label=("Sun" if b == "sun" else "Earth") if gi == 0 else None,
            )
    a2.set_yticks(range(len(groups)))
    a2.set_yticklabels([g[1] for g in groups], fontsize=8.5)
    a2.invert_yaxis()
    a2.set_xscale("log")
    a2.set_xlim(0.005, 100)
    a2.axvline(1.0, color=INK2, lw=1, ls="--", zorder=1)
    a2.grid(axis="x", color=GRID, lw=0.8, zorder=0)
    a2.set_xlabel("angle, JS direction vs Horizons vector (arcsec)")
    a2.legend(loc="lower right", frameon=False)
    a2.set_title("Which correction does the browser apply?", loc="left", fontsize=10.5)
    fig.text(
        0.99, 0.01, "AI-generated with Claude Code (Anthropic)", ha="right", color=INK2, fontsize=7
    )
    fig.tight_layout(rect=(0, 0.02, 1, 1))
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150, facecolor=SURFACE)
    plt.close(fig)


# ---------------------------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------------------------
def _f(x: float, nd: int = 3, sign: bool = False) -> str:
    return (
        "–"
        if x is None or (isinstance(x, float) and math.isnan(x))
        else (f"{x:+.{nd}f}" if sign else f"{x:.{nd}f}")
    )


def case_table(data: dict, cmp: list[dict]) -> str:
    by = {(r["id"], r["body"]): r for r in cmp}
    out = [
        "| case | site | lat (°) | lon (°E) | height (m) | UTC | time kind | Sun Δsky (″) | "
        "Earth Δsky (″) | Sun Δr (km) | Earth Δr (km) | Earth Δphase |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for c in data["cases"]:
        s, e = by[(c["id"], "sun")], by[(c["id"], "earth")]
        tk = c["time_kind"] + (" (leap s)" if c["note"] else "")
        out.append(
            f"| {c['id']} | {c['site_kind']} | {c['lat_deg']:.4f} | {c['lon_deg']:.4f} | "
            f"{c['ground_elev_m']:.0f} | {c['t_utc'].replace('T', ' ').rstrip('Z')} | {tk} | "
            f"{s['d_sky_as']:.3f} | {e['d_sky_as']:.3f} | {s['d_dist_km']:+.3f} | "
            f"{e['d_dist_km']:+.4f} | {e['d_phase']:+.1e} |"
        )
    return "\n".join(out)


def stats_table(cases: list[dict], cmp: list[dict]) -> str:
    noted = {c["id"] for c in cases if c["note"]}
    spec = [  # key, body, label, unit, digits
        ("d_sky_as", "sun", "Sun direction (great circle)", "arcsec", 3),
        ("d_az_cos_as", "sun", "Sun Δaz·cos el", "arcsec", 3),
        ("d_el_as", "sun", "Sun Δel", "arcsec", 3),
        (
            "d_sky_corr_as",
            "sun",
            "Sun direction, interpolation term removed (§6.1, §6.3)",
            "arcsec",
            3,
        ),
        ("d_sky_as", "earth", "Earth direction (great circle)", "arcsec", 3),
        ("d_az_cos_as", "earth", "Earth Δaz·cos el", "arcsec", 3),
        ("d_el_as", "earth", "Earth Δel", "arcsec", 3),
        (
            "d_sky_corr_as",
            "earth",
            "Earth direction, centre-to-site term removed (§6.2)",
            "arcsec",
            3,
        ),
        ("d_dist_km", "sun", "Sun distance", "km", 3),
        ("d_dist_corr_km", "sun", "Sun distance, explained terms removed (§6.3)", "km", 3),
        ("d_dist_km", "earth", "Earth distance", "km", 4),
        ("d_dist_corr_km", "earth", "Earth distance, explained terms removed (§6.4)", "km", 4),
        ("d_rho_as", "sun", "Sun angular radius (R☉ = 695 700 km on both sides)", "arcsec", 4),
        ("d_rho_like_as", "sun", "Sun angular radius, asin(R☉/d) at Horizons' range", "arcsec", 5),
        ("d_rho_as", "earth", "Earth angular radius", "arcsec", 4),
        ("d_phase", "earth", "Earth illuminated fraction", "–", 7),
        ("d_lt_ms", "sun", "Sun light time (distance / c)", "ms", 4),
        ("d_lt_ms", "earth", "Earth light time (distance / c)", "ms", 5),
    ]
    out = [
        "| quantity (JS − Horizons) | unit | max \\|Δ\\|, 20 cases | RMS, 20 cases | "
        "max \\|Δ\\| without the 2 leap-second intervals |",
        "|---|---|---|---|---|",
    ]
    for key, b, label, unit, nd in spec:
        a, x = stats(cmp, key, b), stats(cmp, key, b, skip=noted)
        fmt = (lambda v: f"{v:.1e}") if key == "d_phase" else (lambda v, nd=nd: f"{v:.{nd}f}")
        out.append(f"| {label} | {unit} | {fmt(a['max'])} | {fmt(a['rms'])} | {fmt(x['max'])} |")
    return "\n".join(out)


def eclipse_table(ecl: list[dict]) -> str:
    out = [
        "| eclipse | instant | UTC | separation, Horizons (°) | separation, JS (°) | Δ (″) | "
        "JS eclipse_frac | contact margin JS / Horizons (″) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in ecl:
        m = (
            "–"
            if math.isnan(r["margin_js_as"])
            else f"{r['margin_js_as']:+.3f} / {r['margin_h_as']:+.3f}"
        )
        out.append(
            f"| {r['eclipse']} | {r['label']} | {r['t_utc'][11:19]} | {r['sep_h_deg']:.6f} | "
            f"{r['sep_j_deg']:.6f} | {r['d_sep_as']:+.3f} | {r['ecl_frac_js']:.4f} | {m} |"
        )
    return "\n".join(out)


def vector_table(data: dict, vec: list[dict]) -> str:
    kind = {c["id"]: c for c in data["cases"]}
    out = [
        "| case | body | JS vs LT+S (″) | JS vs LT only (″) | JS vs geometric (″) | "
        "Horizons LT+S vs geometric (″) | v⊥/c theory (″) | light time Horizons / JS (s) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in vec:
        c = kind[r["id"]]
        out.append(
            f"| {r['id']} ({c['site_kind']}, {c['t_utc'][:4]}) | {r['body']} | "
            f"{r['js_vs_lts_as']:.3f} | {r['js_vs_lt_as']:.2f} | {r['js_vs_geom_as']:.3f} | "
            f"{r['h_lts_vs_geom_as']:.3f} | {r['theory_vperp_over_c_as']:.3f} | "
            f"{r['lt_h_s']:.6f} / {r['lt_js_s']:.6f} |"
        )
    return "\n".join(out)


def write_report(data: dict, cmp: list[dict], ecl: list[dict], vec: list[dict], path: Path = MD):
    cases = data["cases"]
    noted = {c["id"] for c in cases if c["note"]}
    st = {
        (k, b, x): stats(cmp, k, b, skip=noted if x else None)
        for k in (
            "d_sky_as",
            "d_sky_corr_as",
            "d_el_as",
            "d_az_cos_as",
            "d_dist_km",
            "d_dist_corr_km",
            "d_rho_as",
            "d_rho_like_as",
            "d_phase",
            "d_lt_ms",
        )
        for b in BODIES
        for x in (False, True)
    }

    def g(k, b, x=False, f="max"):
        return st[(k, b, x)][f]

    by = {(r["id"], r["body"]): r for r in cmp}
    c15 = next(c for c in cases if c["t_utc"].startswith("2016-12-31"))
    r15 = by[(c15["id"], "sun")]
    echo = site_echo_errors(data)
    echo_max = (
        max(abs(e["d_lat_deg"]) for e in echo),
        max(abs(e["d_lon_deg"]) for e in echo),
        max(abs(e["d_alt_km"]) for e in echo),
    )
    ser_max = max(r["series_vs_sky_deg"] for r in cmp)
    ecl_max = max(abs(r["d_sep_as"]) for r in ecl)
    dcon = [abs(r["d_contact_s"]) for r in ecl if not math.isnan(r["d_contact_s"])]
    mjs = max(abs(r["margin_js_as"]) for r in ecl if not math.isnan(r["margin_js_as"]))
    vs = {b: [r for r in vec if r["body"] == b] for b in BODIES}

    def rng(rows, k, nd=2):
        xs = [r[k] for r in rows]
        return f"{min(xs):.{nd}f}–{max(xs):.{nd}f}"

    pe = [
        (by[(c["id"], "earth")]["d_el_as"], by[(c["id"], "earth")]["pred_d_el_as"]) for c in cases
    ]
    mx = sum(a for a, _ in pe) / len(pe)
    my = sum(b for _, b in pe) / len(pe)
    corr = sum((a - mx) * (b - my) for a, b in pe) / math.sqrt(
        sum((a - mx) ** 2 for a, _ in pe) * sum((b - my) ** 2 for _, b in pe)
    )
    n_resp = len(list(CACHE.glob("*.json")))
    floor = max(g("d_sky_corr_as", "sun"), g("d_sky_corr_as", "earth"))

    def sci(x: float) -> str:
        return "0" if x == 0 else f"{x:.0e}"

    text = f"""<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
<!-- Generated by scripts/validate_horizons_js.py --write; do not edit by hand. -->
# Independent check: the browser physics against JPL Horizons

**Result: over 20 random sites and times, the code that runs in the browser (`web/js/physics`)
agrees with JPL Horizons to {g("d_sky_as", "sun", True):.3f}″ for the Sun and {g("d_sky_as", "earth"):.3f}″
for the Earth (great-circle direction error, worst case; RMS {g("d_sky_as", "sun", True, "rms"):.3f}″ and
{g("d_sky_as", "earth", False, "rms"):.3f}″). One case inside the 3-hour table interval that holds the
2016 leap second reaches {r15["d_sky_as"]:.2f}″, as ephem.md predicted. We computed every term above the
ephemeris floor from first principles (§6). With those terms removed, both bodies agree to
{floor:.3f}″. That equals the 0.05″ DE421-vs-DE441 floor of
the Python pipeline. No bug was found. The requirement was 36″ (0.01°).**

![Browser physics vs Horizons](../figures/xcheck_horizons_js.png)

*Left: direction error per case. Hollow circles show the same case after the computed terms of §6 are
removed (table interpolation and leap seconds for the Sun, the centre-to-site term for the Earth).
Right: angle between the browser's direction and three Horizons vector types. The browser matches
"light time + aberration" to below 0.1″. For the Sun it is ~20″ away from the other two.*

## 1. Why this check
The earlier reports compare our Python pipeline (skyfield) with Horizons ([ephem.md](ephem.md)), and the
browser JavaScript with the Python pipeline ([physics.md](physics.md)). A shared mistake in both of our
implementations would pass both checks. Here the browser code is compared **directly** with Horizons,
with no Python ephemeris code in between. The harness was written from scratch: it does not use
`moonat.ephem.horizons` or `scripts/fetch_horizons.py`.

## 2. Method
- **Moonat side:** Node runs [`scripts/xcheck_skystate.mjs`](../../scripts/xcheck_skystate.mjs), which
  calls the public C6 API: `loadEphem` on the shipped tables `web/data/ephem`, `makeSite`, `skyState()` and
  `series()` (a one-sample window). `series()` equals `skyState()` in all 20 cases (largest difference {sci(ser_max)}°).
- **Horizons side:** the Horizons API, observer table, `CENTER='coord@301'`, `APPARENT='AIRLESS'`,
  `QUANTITIES='{QUANTITIES}'` (apparent az/el, illuminated fraction, angular diameter, range and range
  rate, one-way light time, S-T-O), `TIME_TYPE='UT'`, a time list (`TLIST`), `EXTRA_PREC='YES'`. For §5 also
  vector tables (ICRF, km and km/s) with `VEC_CORR` = `NONE`, `LT` and `LT+S`, and the Moon's barycentric
  state. Horizons uses DE441; our tables use DE421.
- **Convention matching.**
  - *Site:* we write (lat, lon) with east longitude in −180…180°. Horizons wants **longitude first**, east
    longitude 0…360°: `SITE_COORD='E-lon,lat,alt'` with `COORD_TYPE='GEODETIC'`, or `'E-lon,Dxy,Dz'` with
    `COORD_TYPE='CYLINDRICAL'`. The 6 polar cases (|lat| > 85°) use the cylindrical form, with
    Dxy = r·cos(lat), Dz = r·sin(lat) and r = 1737.4 km + height.
  - *Frame and figure:* every response header says `Center pole/equ : MEAN_ME {{East-longitude positive}}` and
    `Center radii : 1737.4, 1737.4, 1737.4 km`. MEAN_ME is the DE421 mean-Earth frame, i.e. our
    `MOON_ME_DE421`. Horizons' Moon is a sphere, so geodetic = geocentric, the zenith is radial and the
    altitude is the height above the 1737.4 km sphere, as in CONTRACTS §0.
  - *Height:* Horizons altitude = ground height + the 2 m eye height of C6. The case heights are random in
    ±4 km.
  - *Check:* Horizons echoes the site it used (`Center geodetic`). For all {len(echo)} observer responses,
    the echo matches the intended site: largest differences {sci(echo_max[0])}° in latitude, {sci(echo_max[1])}° in longitude and
    {echo_max[2] * 1e6:.0f} mm in height. The test asserts this, and asserts the MEAN_ME, sphere and airless flags.
  - *Time:* Horizons UT is UTC after 1962 (the official "rubber-second" UTC before 1972). JS uses POSIX
    milliseconds of the same UTC label.
- **Cases** (`make_cases`, `random.Random({SEED})`): 5 near side, 5 far side, 4 limb, 3 south polar,
  3 north polar; times drawn per kind: 3 at an exact 3-hour table node, 3 at mid-interval (node + 1 h 30 min),
  5 in the first or last interval of a year file (1966 start, 1971 end of the rubber-second era, 1975 and
  2016 with a leap second, 2040 end of the tables), 3 random in 1966–1976, 6 random in 2013–2040.
- **Cache:** the {n_resp} Horizons responses are in `tests/fixtures/horizons_cache/` (one small JSON per
  query with the exact parameters; the text after `$$EOE` is dropped). Queries were sequential, 1 s apart.

## 3. Results for the 20 cases
"Δsky" is the great-circle angle between the two directions. "Δr" is the range difference: JS
`dist_km` minus Horizons `delta`.

{case_table(data, cmp)}

{stats_table(cases, cmp)}

Also: `series()` = `skyState()` for az, el and phase (largest difference {sci(ser_max)}°).

## 4. Eclipses: Sun–Earth separation at the lander sites
The instants are the site contacts of [eclipse.md](eclipse.md) §3 (Blue Ghost, 18.562°N 61.810°E, −3651 m;
Surveyor 3, 3.015°S 23.418°W, −1424 m), plus one instant before and one after. Horizons' separation
is the angle between its apparent Sun and Earth az/el. The "contact margin" is the separation minus
ρ☉ + ρ⊕ (C1, C4) or ρ⊕ − ρ☉ (C2, C3). Both sides use R☉ = 695 700 km (IAU 2015 nominal) and
R⊕ = 6378.137 km, the radii of Horizons' own response headers.

{eclipse_table(ecl)}

The separation agrees within **{ecl_max:.3f}″**. At the contacts the separation changes by 0.38–0.58″/s,
so the JS and Horizons geometries give the same contact times within **{max(dcon):.2f} s**. The JS
margins are within ±{mjs:.2f}″ of zero, because the contact times in eclipse.md are rounded to 1 s. This check
covers the geometry only. The shadow model (solid Earth or the Danjon 1.01 enlargement) is discussed in
eclipse.md.

## 5. Light time and aberration
For one case of each site kind, Horizons gives the vector from the site to the body in three forms:
geometric (`NONE`), corrected for light time only (`LT`), and corrected for light time and stellar
aberration (`LT+S`, the apparent direction). The JS direction is rotated to ICRS with its own
`r_icrs_to_enu`.

{vector_table(data, vec)}

- The browser matches **LT+S**: Sun {rng(vs["sun"], "js_vs_lts_as", 3)}″, Earth
  {rng(vs["earth"], "js_vs_lts_as", 3)}″.
- **Sun:** with light time only, the error would be {rng(vs["sun"], "js_vs_lt_as", 1)}″. That is the stellar
  aberration v/c from the Moon's ~30 km/s barycentric velocity. So aberration is applied.
- **Earth:** the light time is {rng(vs["earth"], "lt_h_s", 3)} s (JS range / c agrees with Horizons' light
  time to {g("d_lt_ms", "earth") * 1000:.1f} µs). Light time alone moves the Earth by the Earth's own
  barycentric motion during those 1.3 s, i.e. ~40 km, which is {rng(vs["earth"], "js_vs_lt_as", 1)}″ depending on the
  geometry. Aberration moves it back. The two nearly cancel, so apparent and geometric differ by only
  {rng(vs["earth"], "h_lts_vs_geom_as", 2)}″. That is the first-order "planetary aberration" v⊥/c, with v the
  Earth's velocity relative to the site (column "v⊥/c theory", from Horizons' geometric state; it agrees
  with Horizons' own LT+S − geometric to 0.001″). The browser shows the same 0.6–0.7″ offset from the
  geometric direction. Both corrections are therefore applied with the right sign and size.

## 6. Differences above the ephemeris floor, explained
1. **Leap-second interval ({c15["id"]}, Sun {r15["d_sky_as"]:.3f}″).** The tables are indexed in POSIX time,
   which has no 23:59:60. The interval 2016-12-31 21:00–24:00 lasts 10801 s but is interpolated as
   10800 s. At 23:59:30 the browser is therefore {r15["slip_s"]:.3f} s ahead. In that time the Sun moves
   0.51″ across the lunar sky. The circle model of item 3, which includes the leap second, predicts
   {abs(r15["pred_interp_along_as"]):.3f}″ along the Sun's path (observed {r15["d_sky_as"]:.3f}″; residual
   {r15["d_sky_corr_as"]:.3f}″). The Earth is nearly fixed in the Moon's frame (synchronous rotation), so
   it is hardly affected. Only its range changes, by its rate × slip. This is the known limit in ephem.md
   ("up to 0.55″" in such intervals; there are 8 such intervals in the table years).
2. **Earth elevation, up to {g("d_el_as", "earth"):.3f}″: the "centre-to-site" term.** The C1 tables store the
   apparent vector from the Moon's **centre**. Its direction includes aberration, but its length is the light-time
   distance |A|. To first order the exact apparent vector is A + v·τ (v = observer barycentric velocity,
   τ = |A|/c). Fixing the length to |A| shortens it by (û·v/c)·|A|, up to ~38 km for the Earth.
   `skyState` then subtracts the site vector (1737 km). This turns the length error into a direction error
   (û·v/c)·sin p, where p is the topocentric parallax (up to 0.26° for the Earth). The result is a pure
   **elevation** error of at most 1e-4 × 4.5e-3 rad = 0.09″. Together with the ~0.05″ floor of item 7, this
   gives the observed {g("d_el_as", "earth"):.3f}″. For the Sun, p is 1.2e-5 rad, so the term is below 1e-6″.
   We computed the term for each case from the Moon's barycentric velocity (Horizons). It correlates with
   the observed Earth Δel (r = {corr:.2f}). Removing it lowers the Earth error from
   {g("d_sky_as", "earth"):.3f}″ to **{g("d_sky_corr_as", "earth"):.3f}″** max (RMS {g("d_sky_as", "earth", False, "rms"):.3f}″
   → {g("d_sky_corr_as", "earth", False, "rms"):.3f}″). This approximation is part of the table design. It is about
   1/70000 of the Earth's apparent diameter. It is not a bug.
3. **Sun: table interpolation (direction ≤ 0.07″, distance −1.9…+1.7 km).** In MOON_ME the Sun circles the
   Moon once per synodic month at 1 au, so the table components are sinusoids with θ = 1.52° per 3-hour
   step. A cubic Hermite with finite-difference tangents cuts inside such a circle by about R·θ⁴/48: about
   −1.7 km at mid-interval and 0 at the nodes. At the first and last record of a year file, the one-sided
   tangents push it outward instead (+1.7 km in the 1966 and 1971 cases). The tangents are also slightly
   too short, which puts the Sun up to ~0.07″ behind or ahead along its path, away from the nodes and
   mid-interval. The script replays `ephem.js` on that circle, with leap seconds included
   (`sun_interp_model`). For the distance it also adds −(s·v)/c (item 4) and the leap-second slip × range
   rate. Residuals: direction **{g("d_sky_corr_as", "sun"):.3f}″** max (RMS
   {g("d_sky_corr_as", "sun", False, "rms"):.3f}″, from {g("d_sky_as", "sun", True):.3f}″ without the leap-second cases).
   Distance {g("d_dist_corr_km", "sun"):.2f} km max (RMS {g("d_dist_corr_km", "sun", False, "rms"):.2f} km, from
   {g("d_dist_km", "sun"):.2f} km). Relative to 1 au, 1.9 km is 1.3e-8. That changes the flux by 3e-8 and the
   solar angular radius by 2e-5″.
4. **Earth distance, up to {g("d_dist_km", "earth") * 1000:.0f} m.** The browser range is |C − s|, with C the
   aberrated centre vector of item 2. Its range differs from Horizons' light-time range by −(s·v)/c, where s
   is the site vector and v the observer barycentric velocity (1737 km × 1e-4 = up to 0.17 km). With this term and
   the leap-second slip removed, the residual is {g("d_dist_corr_km", "earth") * 1000:.0f} m max (RMS
   {g("d_dist_corr_km", "earth", False, "rms") * 1000:.0f} m). The effect on the Earth's angular radius is
   ≤ 0.001″.
5. **Angular radii.** Moonat and Horizons use the same solar radius, R☉ = 695 700 km (IAU 2015
   Resolution B3 nominal; Shay's decision of 2026-11-14 replaced our earlier 696 000 km, which made the Sun
   0.42″ larger than Horizons'). The Sun's angular radius now agrees to {g("d_rho_as", "sun"):.4f}″, Horizons'
   printing precision. With Horizons' range in our formula the difference is {g("d_rho_like_as", "sun"):.0e}″ (the
   range difference of item 3). Earth angular radius: {g("d_rho_as", "earth"):.4f}″ (Horizons prints the
   diameter to 0.001″).
6. **Earth illuminated fraction, {g("d_phase", "earth"):.1e}.** JS uses (1 + cos α)/2 with α from the
   apparent vectors. Horizons uses its own phase angle. The two angles differ by a few arcseconds
   (aberration), which is {g("d_phase", "earth") / 1e-3 * 100:.1f} % of the C6 tolerance (0.001).
7. **The ~0.05″ floor.** After items 1–3, the Sun and the Earth both agree to ≤ {floor:.3f}″
   (RMS {g("d_sky_corr_as", "sun", False, "rms"):.3f}″ and {g("d_sky_corr_as", "earth", False, "rms"):.3f}″). This floor
   is our ephemeris (DE421 and the MOON_ME_DE421 orientation) against Horizons' DE441 and its realisation of
   MEAN_ME. It equals the 0.049–0.055″ of the Python pipeline in ephem.md. Apart from items 1–3, the browser adds
   nothing measurable to it.

## 7. Reproduce
```
uv run python scripts/validate_horizons_js.py            # fetches missing responses (1 s apart), prints
uv run python scripts/validate_horizons_js.py --write    # also rewrites this page and the figure
uv run pytest tests/test_horizons_js_xcheck.py           # offline from the cache; skipped without Node
```
Node is found on PATH, in `MOONAT_NODE`, or at the default Windows install path.
"""
    path.write_text(text, encoding="utf-8")


def print_summary(data: dict, cmp: list[dict], ecl: list[dict], vec: list[dict]) -> None:
    print(f"node {data['js']['_node']}; Horizons responses fetched now: {data['fetched']}")
    for b in BODIES:
        for k in (
            "d_sky_as",
            "d_sky_corr_as",
            "d_az_cos_as",
            "d_el_as",
            "d_dist_km",
            "d_dist_corr_km",
            "d_rho_as",
            "d_rho_like_as",
            "d_lt_ms",
            "d_phase",
        ):
            if any(k in r for r in cmp if r["body"] == b):
                s = stats(cmp, k, b)
                print(f"{b:5s} {k:16s} max {s['max']:.4g}  rms {s['rms']:.4g}  (n={s['n']})")
    print(f"eclipse: max |d sep| = {max(abs(r['d_sep_as']) for r in ecl):.4f} arcsec")
    for r in vec:
        print(
            f"{r['id']} {r['body']:5s} JS-LT+S {r['js_vs_lts_as']:.3f}  JS-LT {r['js_vs_lt_as']:.2f}  "
            f"JS-geom {r['js_vs_geom_as']:.3f}  (arcsec)  LT {r['lt_h_s']:.6f} s"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--offline", action="store_true", help="use cached Horizons responses only")
    ap.add_argument("--write", action="store_true", help="write the report and the figure")
    args = ap.parse_args()
    data = collect(online=not args.offline)
    cmp, ecl, vec = compare_cases(data), compare_eclipses(data), compare_vectors(data)
    print_summary(data, cmp, ecl, vec)
    for r in site_echo_errors(data):
        if abs(r["d_lat_deg"]) > 1e-6 or abs(r["d_lon_deg"]) > 1e-6 or abs(r["d_alt_km"]) > 1e-5:
            print("SITE ECHO MISMATCH", r)
    if args.write:
        make_figure(data, cmp, vec)
        write_report(data, cmp, ecl, vec)
        print("wrote", FIG.relative_to(ROOT), "and", MD.relative_to(ROOT))


if __name__ == "__main__":
    main()
