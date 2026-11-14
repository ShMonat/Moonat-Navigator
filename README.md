<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# Moonat: Lunar Landing Site Navigator

**See the Sun and the Earth from any point on the Moon, at any time, behind the real LOLA horizon.**

![Moonat Sky view: Apollo 11 at landing](docs/figures/app_sky_apollo11.png)
*Computed render (not an AI-generated image): Apollo 11 at touchdown, 1969-07-20 20:17 UTC. Sun 10.7° up in the east, Earth 59.2° up in the west.*

**Live app: <https://shmonat.github.io/Moonat-Navigator/>**

Our entry for NASA Space Apps Challenge 2026,
[Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).
The Sun sets the power budget and the Earth sets the direct-to-Earth communication windows. A ridge or a crater rim
can hide either one. Moonat computes both against the real terrain and lets you compare sites and dates side by side.

## What it does
- **Scenarios:** pick a place (coordinates, a map click, or one of 40 catalog sites: Apollo, Luna, Surveyor, Chang'e,
  Chandrayaan-3, Artemis III candidate regions) and a time or a mission span. Add as many as you want.
- **Compare tab:** Sun and Earth elevation, visible fraction of each disk, solar flux (W/m²), phase, and time to
  sunset or Earthset, one line per scenario.
- **Sky tab:** a first-person 3D view from 2 m above the ground, with terrain lit by the Sun, the Earth with its true
  phase and orientation, stars and planets, and a timelapse.
- **Eclipses seen from the Moon:** when the Earth crosses the Sun (a lunar eclipse on Earth), the share of sunlight it
  hides is computed and drawn, with the red ring of Earth's atmosphere; quick start "Eclipse from the Moon" replays
  Blue Ghost's 14 March 2025 view ([validation against NASA's contact times](docs/validation/eclipse.md)).

| Compare all Apollo landings | South pole (Shackleton rim) | Far side (Chang'e 4) |
|---|---|---|
| ![Compare](docs/figures/app_compare_apollo.png) | ![South pole sky](docs/figures/app_sky_southpole.png) | ![Chang'e 4](docs/figures/app_farside_change4.png) |

## How accurate is it?
Every claim below is backed by a validation report you can rerun.

| Check | Result | Report |
|---|---|---|
| Sun and Earth direction vs **JPL Horizons** (3 sites, 3 epochs, 399 rows) | max 0.055″ (target was 36″) | [ephem.md](docs/validation/ephem.md) |
| Browser tables vs Horizons (the exact code path the app uses) | Sun 0.049″, Earth 0.13″ at worst | [ephem.md](docs/validation/ephem.md) |
| Browser JavaScript vs Python reference | 3e-11° (ephemeris, 288 cases); visible fraction within 5e-14 (87 cases) | [physics.md](docs/validation/physics.md) |
| Disk-vs-horizon visibility vs analytic circular segment | max error 0.0025 | [physics.md](docs/validation/physics.md) |
| LOLA georeferencing: Shackleton floor, Apollo 11 ground | −2769 m (published −2.77 km); −1929.5 m (published −1926 m) | [terrain.md](docs/validation/terrain.md) |
| South-pole illumination vs **Gläser et al. 2014** (18.5 yr) | 92.7 % / 95.8 % lit at the 10 m point (published 92.5 % / 95.6 %); 86.0 % / 90.6 % at the 2 m point (published 88.1 % / 92 %) | [terrain.md](docs/validation/terrain.md) §5 |
| Malapert site search vs **Bussey et al. 2010** | 75.9 % Sun visibility in 2027 (published 74 % over a lunar year, point 2.5 km away) | [terrain.md](docs/validation/terrain.md) §9 |
| Ray-marched horizon vs independent 3-D point cloud | correlation 0.9995 / 0.9997, no azimuth mirroring | [terrain.md](docs/validation/terrain.md) §4 |
| Eclipse of the Sun by the Earth: whole-Moon contacts P1…P4 of 2025-03-14 and 1967-04-24 vs **NASA (Espenak)** | within 2.6 s; Blue Ghost's end of totality 08:34 UTC vs its diamond-ring photo "around 08:30" | [eclipse.md](docs/validation/eclipse.md) |
| Horizons for **custom map points** (coarse DEM tiles) | reads about 1–1.4° too low at typical sites, because the first few km of relief are not resolved. Far-field features are recovered (4–5× better than a flat horizon at Apollo 15 and 17). The app labels these "approximate terrain". | [physics.md](docs/validation/physics.md) §6 |

Known limits: UT1 is taken as UTC, and the drawn Earth globe ignores precession and nutation (about 0.36° in 2026).
Neither affects Sun or Earth positions. Full lists are in the validation reports. Website QA: [qa.md](docs/validation/qa.md).

## How it works
1. **Positions:** JPL DE421 and the `MOON_ME` lunar frame (libration included), with light-time, aberration and
   gravitational deflection, rotated into the site's local east-north-up frame (no refraction on the Moon).
   Precomputed into compact tables (3 h step, 1966–1976 and 2013–2040) that the browser interpolates.
2. **Terrain:** for each catalog site, a horizon profile from NASA LOLA elevation maps: the highest elevation angle
   along every azimuth, on exact great-circle rays, including lunar curvature, out to 70–330 km.
3. **Visibility:** the Sun and Earth disks are sampled with 400 points. The fraction above the horizon gives the visible
   fraction, with Sun limb darkening for flux.
4. **Split of work:** heavy precomputation in Python (`src/moonat/`, validated against Horizons and the papers above).
   Light geometry in the browser (`web/js/physics/`, tested against the Python reference). Clicked points use coarse DEM
   tiles (11.7 MB) fetched on demand.

## Data sources
NASA Space Apps challenge resources are marked with a star. Full list with licences: [docs/REFERENCES.md](docs/REFERENCES.md).
- ★ **JPL Horizons**: validation reference for Sun and Earth positions.
- ★ **Moon Trek**: LRO WAC mosaic tiles for the site-picker map.
- **LRO LOLA** (NASA PDS): polar DEMs LDEM_80S_20M, 75S_30M, 60S_60M, 75S_240M; global LDEM_64 and LDEM_16;
  SLDEM2015 (LOLA + SELENE) within ±60° latitude.
- **JPL/NAIF**: DE421 ephemeris, lunar orientation kernel and frame kernel.
- **NASA Visible Earth**: Blue Marble and Earth City Lights textures. Stars: Yale Bright Star Catalogue.

## Run locally
Requires [uv](https://docs.astral.sh/uv/) and git. First-time setup: [docs/SETUP.md](docs/SETUP.md).
```bash
git clone https://github.com/ShMonat/Moonat-Navigator.git && cd Moonat-Navigator
uv sync
uv run python -m http.server -d web 8123      # open http://localhost:8123
uv run pytest                                  # Python tests
node --test web/tests/                         # JavaScript tests (Node 20+)
```
The web app has no build step. Libraries (three.js, Plotly) load from a CDN.

## Repo map
```
web/                 the app: index.html, js/app (UI), js/physics, js/sky (3D view), data/ (tables, DEM tiles, catalog)
src/moonat/          Python package: ephem/ (DE421 + MOON_ME), terrain/ (LOLA horizons), visibility.py, metrics.py
scripts/             data builders and validation (build_ephem_tables.py, validate_ephem.py, data/build_terrain.py)
tests/               pytest tests and fixtures (including cached JPL Horizons responses)
docs/                vision, architecture, contracts, validation reports, references, AI use, submission texts
docs/figures/        screenshots and validation plots
```

## Team
- **Shay Monat**, team lead
- **Shahar**, team member

## Use of AI
AI coding agents (Claude Code by Anthropic) wrote most of the code, tests and docs. The team set the vision, the
architecture and the physics requirements, and reviewed the results. Every source file carries an AI-generated header.
Screenshots are computed renders, not AI-generated images. Details: [docs/AI_USE.md](docs/AI_USE.md).

## Licence
No licence file is included. All rights are reserved by the team unless stated otherwise. NASA data and third-party
libraries keep their own terms (see [docs/REFERENCES.md](docs/REFERENCES.md)).
