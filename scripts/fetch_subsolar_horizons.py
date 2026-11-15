# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Fetch (once) the JPL Horizons sub-solar point on the Moon that tests the globe's day/night shading.

Query: target the Moon (301), observer the Earth's centre (500@399), quantity 15 ("SunSub-LON, SunSub-LAT"): the
apparent sub-solar longitude and latitude on the Moon in Horizons' MOON_ME frame (east longitude, 1737.4 km sphere,
so planetodetic = planetocentric), light time Sun -> Moon included, at the instant the Moon's light leaves for the Earth
(1.3 s before the print time: < 0.0002 deg of lunar rotation relative to the Sun).

The response is cached in tests/fixtures/horizons_cache/subsolar_moon.json (the same cache format as
scripts/validate_horizons_js.py). web/tests/physics_subsolar.test.mjs compares web/js/physics subsolarPoint() with it.

    uv run python scripts/fetch_subsolar_horizons.py
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "validate_horizons_js.py"
_spec = importlib.util.spec_from_file_location("validate_horizons_js", SCRIPT)
xc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(xc)

NAME = "subsolar_moon"
# Apollo 11 and Apollo 17 landings, today, and a later epoch in the 2013-2040 tables (UTC).
TIMES = ["1969-07-20 20:17:40", "1972-12-11 19:54:57", "2026-11-15 00:00:00", "2035-09-02 06:30:00"]
PARAMS = {
    "format": "text",
    "COMMAND": "'301'",
    "OBJ_DATA": "'NO'",
    "MAKE_EPHEM": "'YES'",
    "EPHEM_TYPE": "'OBSERVER'",
    "CENTER": "'500@399'",
    "TIME_TYPE": "'UT'",
    "TLIST_TYPE": "'CAL'",
    "TLIST": " ".join(f"'{t}'" for t in TIMES),
    "QUANTITIES": "'15'",
    "ANG_FORMAT": "'DEG'",
    "APPARENT": "'AIRLESS'",
    "EXTRA_PREC": "'YES'",
    "CSV_FORMAT": "'YES'",
    "TIME_DIGITS": "'FRACSEC'",
}


def main() -> None:
    text = xc.Horizons().get(NAME, PARAMS)
    rows = text[text.index("$$SOE") + 5 : text.index("$$EOE")].strip().splitlines()
    for r in rows:
        print(r)


if __name__ == "__main__":
    main()
