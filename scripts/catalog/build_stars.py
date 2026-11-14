# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Convert the Yale Bright Star Catalogue (BSC5) and d3-celestial constellation data to compact web JSON.

Inputs (downloaded to data/raw/catalog/, see docs/REFERENCES.md):
  bsc5.dat.gz                   http://tdc-www.harvard.edu/catalogs/bsc5.dat.gz (fixed-width, J2000)
  constellations.lines.json     d3-celestial (BSD-3), GeoJSON MultiLineString, lon in -180..180 = RA deg
  constellations.json           d3-celestial, Point = label centre (RA deg, Dec deg)
Outputs: web/data/stars/stars.json, web/data/stars/constellations.json. Angles in degrees, ICRS/J2000.
"""

import gzip
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parents[2] / "data/raw/catalog"
OUT = ROOT / "web/data/stars"
GEN = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."

# Harvard Revised (HR) numbers of the brightest named stars.
NAMES = {
    2491: "Sirius",
    2326: "Canopus",
    5340: "Arcturus",
    7001: "Vega",
    1708: "Capella",
    1713: "Rigel",
    2943: "Procyon",
    2061: "Betelgeuse",
    472: "Achernar",
    5267: "Hadar",
    7557: "Altair",
    4730: "Acrux",
    1457: "Aldebaran",
    6134: "Antares",
    5056: "Spica",
    2990: "Pollux",
    8728: "Fomalhaut",
    7924: "Deneb",
    4853: "Mimosa",
    3982: "Regulus",
    2618: "Adhara",
    2891: "Castor",
    6527: "Shaula",
    4763: "Gacrux",
    1790: "Bellatrix",
    1791: "Elnath",
    3685: "Miaplacidus",
    1903: "Alnilam",
    8425: "Alnair",
    1948: "Alnitak",
    4905: "Alioth",
    4301: "Dubhe",
    1017: "Mirfak",
    2693: "Wezen",
    6553: "Sargas",
    6879: "Kaus Australis",
    3307: "Avior",
    5191: "Alkaid",
    2088: "Menkalinan",
    6217: "Atria",
    2421: "Alhena",
    7790: "Peacock",
    3485: "Alsephina",
    2294: "Mirzam",
    3748: "Alphard",
    424: "Polaris",
    617: "Hamal",
    4057: "Algieba",
    188: "Diphda",
    5054: "Mizar",
    7121: "Nunki",
    2004: "Saiph",
    1852: "Mintaka",
    5563: "Kochab",
    5793: "Alphecca",
    6556: "Rasalhague",
    15: "Alpheratz",
    168: "Schedar",
    337: "Mirach",
    4534: "Denebola",
    7796: "Sadr",
    4295: "Merak",
    8308: "Enif",
    8775: "Scheat",
    8781: "Markab",
    603: "Almach",
    99: "Ankaa",
    6705: "Eltanin",
    6378: "Sabik",
    7417: "Albireo",
    1865: "Arneb",
    2827: "Aludra",
    3699: "Aspidiske",
    5459: "Rigil Kentaurus",
}


def parse_bsc():
    stars, names = [], {}
    with gzip.open(RAW / "bsc5.dat.gz", "rt", encoding="latin-1") as f:
        for line in f:
            if len(line) < 110 or not line[75:77].strip() or not line[102:107].strip():
                continue  # no J2000 position (novae etc.) or no magnitude
            vmag = float(line[102:107])
            if vmag > 6.0:
                continue
            ra = 15 * (int(line[75:77]) + int(line[77:79]) / 60 + float(line[79:83]) / 3600)
            dec = int(line[84:86]) + int(line[86:88]) / 60 + int(line[88:90]) / 3600
            if line[83] == "-":
                dec = -dec
            bv = float(line[109:114]) if line[109:114].strip() else None
            hr = int(line[0:4])
            if hr in NAMES:
                names[len(stars)] = NAMES[hr]
            stars.append([round(ra, 4), round(dec, 4), round(vmag, 2), bv])
    return stars, names


def main():
    stars, names = parse_bsc()
    missing = set(NAMES.values()) - set(names.values())
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "stars.json").write_text(
        json.dumps(
            {
                "_generated_by": GEN,
                "source": "Yale Bright Star Catalogue 5th rev. ed. (Hoffleit & Warren 1991), J2000",
                "fields": ["ra_deg", "dec_deg", "vmag", "bv"],
                "stars": stars,
                "names": names,
            },
            separators=(",", ":"),
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    lines = json.loads((RAW / "constellations.lines.json").read_text(encoding="utf-8"))
    cons = json.loads((RAW / "constellations.json").read_text(encoding="utf-8"))
    out_lines = {
        ft["id"]: [
            [[round(lo % 360, 3), round(la, 3)] for lo, la in seg]
            for seg in ft["geometry"]["coordinates"]
        ]
        for ft in lines["features"]
    }
    out_names = {}
    for ft in cons["features"]:
        lo, la = ft["geometry"]["coordinates"]
        out_names[ft["id"]] = {
            "name": ft["properties"]["name"],
            "ra": round(lo % 360, 2),
            "dec": round(la, 2),
        }
    (OUT / "constellations.json").write_text(
        json.dumps(
            {
                "_generated_by": GEN,
                "source": "d3-celestial (Olaf Frohn), BSD-3-Clause",
                "lines": out_lines,
                "names": out_names,
            },
            separators=(",", ":"),
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(
        len(stars),
        "stars;",
        len(names),
        "named; missing names:",
        missing,
        "; constellations:",
        len(out_lines),
    )


main()
