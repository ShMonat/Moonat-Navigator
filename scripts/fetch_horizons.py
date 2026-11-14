# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Fetch JPL Horizons topocentric lunar-site ephemerides and cache them for offline tests.

Writes tests/fixtures/horizons/<case>.txt (raw API text responses) and index.json. Existing files
are kept (delete one to refetch). Horizons conventions for these queries (from the response
headers): centre = Moon (301), "Center pole/equ: MEAN_ME" (DE421 mean-Earth frame), "Center
radii: 1737.4 x 1737.4 x 1737.4 km" (a sphere, so GEODETIC alt = height above 1737.4 km and the
zenith is radial), airless apparent az/el (light-time, deflection, aberration), az from north
toward east, times in UTC.

Usage: uv run python scripts/fetch_horizons.py
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "horizons"
GEN = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."

SITES = {  # selenographic MOON_ME lat, east lon (deg), alt above 1737.4 km sphere (km)
    "apollo11": (0.674, 23.473, 0.0),
    "southpole": (-89.5, 0.0, 0.0),
    "change4": (-45.44, 177.59, 0.0),
}
BODIES = {"sun": "10", "earth": "399"}
PLANETS = {"mercury": "199", "venus": "299", "mars": "499", "jupiter": "599", "saturn": "699"}
EPOCHS = ["1969-07-20 20:17", "2026-11-14 12:00", "2030-06-01 00:00"]
SERIES = ("2026-11-14 00:00", "2026-12-14 00:00", "12h")  # one month, 61 rows per case


def query(command: str, site, tlist=None, span=None) -> str:
    lat, lon, alt = site
    p = {
        "format": "text",
        "COMMAND": f"'{command}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon},{lat},{alt}'",
        "TIME_TYPE": "'UT'",
        "QUANTITIES": "'4,10,13,20,24'",
        "ANG_FORMAT": "'DEG'",
        "APPARENT": "'AIRLESS'",
        "EXTRA_PREC": "'YES'",
        "CSV_FORMAT": "'YES'",
        "TIME_DIGITS": "'FRACSEC'",
        "CAL_FORMAT": "'CAL'",
    }
    if tlist:
        p["TLIST"] = " ".join(f"'{t}'" for t in tlist)
        p["TLIST_TYPE"] = "'CAL'"
    else:
        p["START_TIME"], p["STOP_TIME"], p["STEP_SIZE"] = (f"'{x}'" for x in span)
    url = API + "?" + urllib.parse.urlencode(p, quote_via=urllib.parse.quote)
    with urllib.request.urlopen(url, timeout=60) as r:
        text = r.read().decode("utf-8")
    if "$$SOE" not in text:
        raise RuntimeError(f"Horizons error for {command} {site}:\n{text[:2000]}")
    return text


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cases = []
    for sname in SITES:
        for bname, cmd in BODIES.items():
            cases.append((f"{sname}_{bname}_epochs", sname, bname, cmd, EPOCHS, None))
            cases.append((f"{sname}_{bname}_series", sname, bname, cmd, None, SERIES))
    for pname, cmd in PLANETS.items():
        cases.append((f"apollo11_{pname}_epochs", "apollo11", pname, cmd, EPOCHS, None))
    index = {"_generated_by": GEN, "api": API, "sites": {}, "cases": []}
    for name, sname, bname, cmd, tlist, span in cases:
        path = OUT / f"{name}.txt"
        if not path.exists():
            print("fetching", name)
            path.write_text(query(cmd, SITES[sname], tlist, span), encoding="utf-8")
            time.sleep(1.0)
        index["cases"].append({"file": path.name, "site": sname, "body": bname, "command": cmd})
    index["sites"] = {
        k: {"lat_deg": v[0], "lon_deg": v[1], "alt_km": v[2]} for k, v in SITES.items()
    }
    (OUT / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    print(f"{len(cases)} cases in {OUT}")


if __name__ == "__main__":
    main()
