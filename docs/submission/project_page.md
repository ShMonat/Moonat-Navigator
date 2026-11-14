# NASA Space Apps project page: draft texts (paste into the site)

> Draft v0.3 (2026-11-14 evening). Numbers come from docs/validation/. The only open item is the demo video link ([TBD]).
> Editor: Shay. Everything here is English, as the rules require.

## Project name
Moonat: Lunar Landing Site Navigator

## High-Level Summary
Moonat is a web app that shows the Moon's sky from any point on its surface, at any time. Pick a site on a 3D Moon globe
(near side, far side or the poles), by coordinates, or from real missions such as Apollo 11, and choose a date. Moonat places
the Sun and Earth with JPL ephemerides, checks whether a ridge or crater rim hides them using NASA LOLA terrain fetched live
from Moon Trek, and reports the sunlight and Earth contact a lander would get, including eclipses of the Sun by the Earth. It
renders a first-person sky view, compares many sites and dates side by side, and plans rover traverses between two points.

## Project Demo
[TBD: link to the 30-second video, YouTube unlisted or Google Drive, public]

## Final Project
https://shmonat.github.io/Moonat-Navigator/ — source code: https://github.com/ShMonat/Moonat-Navigator

## Project Details
**What it does**
- Inputs: one or more scenarios. Each scenario is a location (a click on the 3D Moon globe, coordinates, or one of 40 catalog sites: missions, Artemis III candidate regions, polar ridges) plus a start time and an end time or a duration. Advanced: a rover traverse, given a start and an end point and a rover type.
- Outputs:
  - Sun panel: elevation, azimuth, how much of the solar disk clears the terrain and the Earth, solar flux (W/m²), time to sunset, eclipses.
  - Earth panel: elevation, azimuth, how much of the Earth is visible (a proxy for direct radio contact), its phase, time to Earthset.
  - Sky view: a first-person 3D view from 2 m above the ground, with real terrain lit by the Sun, the Earth with its true phase and orientation, the stars and the planets. During an eclipse, the Earth covers the Sun and its atmosphere glows as a red ring.
  - Rover traverse: the fastest route within the rover's slope limit, its elevation and slope profiles, and the Sun and Earth along the drive, against time or distance travelled.
- Mission durations become timelines with one line per scenario, so trade-offs are visible at a glance. Every view can be shared as a link.

**How it works**
1. Positions: JPL DE421 ephemeris and the lunar orientation model (MOON_ME frame, which includes libration), with light-time and aberration. Validated against **JPL Horizons** topocentric lunar sites: the Sun and Earth directions agree to 0.055 arcseconds (1.5e-05°) at worst over 399 comparisons at three sites and three epochs.
2. Terrain: NASA LRO **LOLA** elevation maps. For each catalog site, we compute the horizon profile: the elevation of the skyline in every direction, out to 70–330 km, including lunar curvature. We checked it against published south-pole illumination (Gläser et al. 2014): 92.7% of time lit at one reference point against 92.5% published (95.8% against 95.6%).
3. Visibility: the fraction of the Sun's or the Earth's disk that rises above that skyline, weighted for the Sun's limb darkening for power.
4. The physics is precomputed in Python and validated; the browser does the fast geometry and reproduces the Python reference to 3e-11°, so any site and any time works instantly. An independent check of the browser code against JPL Horizons at 20 random places and times (both poles, the far side, 1966–2040) agrees to 0.13 arcseconds.
5. Terrain anywhere: for a point that is not in the catalog, the browser fetches LOLA heights from NASA **Moon Trek** in 1–3 s and traces the horizon itself. At 10 of 12 test sites it agrees with our precomputed horizons to 0.07–0.37° (RMS).
6. Eclipses: the fraction of the Sun hidden by the Earth reproduces NASA's published contact times of the lunar eclipses of 14 March 2025 (seen by the Blue Ghost lander) and 24 April 1967 (seen by Surveyor 3) to 2.6 s or better.
7. Rover traverses: a shortest-time path search on a Moon Trek elevation grid, with VIPER-class (0.2 m/s, ≤ 15°) and Apollo LRV (2.5 m/s, ≤ 20°) presets from NASA sources.

**Tools**
Python (skyfield, numpy), JavaScript (three.js, Plotly), GitHub Pages. Built with AI coding agents (see Use of AI).

**Why it matters**
The challenge asks for rapid, intuitive comparison of landing sites and dates. At the south pole, a few hundred metres or a few days can
decide whether a lander has power and contact with Earth. Moonat makes that visible in seconds, for planners and for the public.

## Use of AI
Yes. The team set the vision, architecture and physics requirements, reviewed the app and directed changes. AI coding agents
(Claude Code by Anthropic) wrote the code, tests, validation reports and documentation under the team's direction. Every source file carries an AI-generated header, and commits
carry an AI co-author tag. No AI-generated images or video are used. The sky views are computed renders from NASA data. Details:
docs/AI_USE.md in the repository.

## Space Agency Data
- **JPL Horizons** (challenge resource): reference positions of the Sun and Earth from lunar sites; our validation benchmark (cached responses are test fixtures).
- **Moon Trek** (challenge resource): the LRO WAC global mosaic on the 3D Moon globe, and LOLA elevation grids (20–118 m) fetched live for the horizon and 3D ground at any point and for rover routes.
- **NASA eclipse predictions** (Espenak, NASA GSFC): contact times of the 2025 and 1967 lunar eclipses, our eclipse benchmark.
- **LRO LOLA** gridded elevation data (NASA PDS): polar stereographic DEMs at 20 m (LDEM_80S_20M), 30 m, 60 m and 240 m; global LDEM_64 (about 474 m) and LDEM_16 (about 1.9 km) for the far field; and SLDEM2015 (LOLA + SELENE Terrain Camera, about 59 m) within ±60° latitude. They give the horizon at every catalog site.
- **JPL/NAIF SPICE kernels**: DE421 ephemeris, lunar principal-axes orientation kernel and the MOON_ME frame kernel.
- **NASA Visible Earth**: Blue Marble and Earth City Lights textures for the Earth in the sky.
- **LROC (ASU/NASA LRO)** NAC mosaics and the NASA Artemis III candidate regions (October 2024): site placement.
- Mission coordinates and times from NASA NSSDCA and the Apollo Lunar Surface Journal.

These data let us answer a simple question, "will we see the Sun and Earth?", with real precision.

## References
See docs/REFERENCES.md in the repository (complete list of data, libraries, papers and assets).
