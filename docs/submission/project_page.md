# NASA Space Apps project page: draft texts (paste into the site)

> Draft v0.8 (2026-11-15). Numbers come from docs/validation/ and docs/research/. Ready to paste; nothing open.
> Editor: Shay. Everything here is English, as the rules require.

## Project name
Moonat: Lunar Landing Site Navigator

## High-Level Summary
Moonat is a web app that shows the Moon's sky from any point on its surface, at any time. It works like a map app for the
Moon: click places on a 3D globe or search for missions such as Apollo 11, pick dates (it suggests the best ones for
sunlight, Earth contact or a visible eclipse), and plan rover trips with stops. Moonat places the Sun and Earth with JPL
ephemerides, checks whether a ridge or crater rim hides them using NASA LOLA terrain (fetched live from Moon Trek for any
point), and reports the sunlight and Earth contact a lander or base would get, including eclipses of the Sun by the Earth.
A first-person sky view shows it all, and the map shows where each view is looking and where it is day or night at that
moment. Map layers show NASA's permanently shadowed regions and most sunlit ground at the poles, and many sites and dates compare side by side. A story shows what
the tardigrades on Israel's Beresheet lander see from its crash site right now. We used Moonat to choose a site for a
lunar base: the Malapert massif crest, which over 2030–2040 gets 82 % of full sunlight on average and keeps 98 % of the
Earth's disk in view on average (the Earth never fully sets there).

## Project Demo
https://shmonat.github.io/Moonat-Navigator/video/moonat_demo.mp4 (30 s, 1080p, plays in the browser; every frame is a
real render of the app, recorded by scripts/video/record_demo.py: Apollo 11, suggested dates, a globe search, an eclipse
seen from the Blue Ghost lander, the south pole, a rover drive and the far side. Optional: upload the same file to YouTube as unlisted
and use that link instead.)

Backup: 7-slide presentation: https://shmonat.github.io/Moonat-Navigator/slides/ (PDF: https://shmonat.github.io/Moonat-Navigator/slides/moonat_slides.pdf)

## Final Project
https://shmonat.github.io/Moonat-Navigator/ — source code: https://github.com/ShMonat/Moonat-Navigator

## Project Details
**What it does**
- Inputs, in the order a user thinks (like a map app): places, chosen by clicking the 3D Moon globe (near side, far side or either pole; click a selected pin to remove it), by dropping and dragging a pin, or by searching "Search the Moon" (missions from Apollo to Beresheet, each marked with the flag of the nation that flew it, potential Artemis sites, polar ridges, the home base, or coordinates). A Layers button shows the permanently shadowed regions and the most sunlit ground at both poles. Several places compare side by side. Each has a start time and an end time or a duration, picked from a calendar that also suggests the best dates for that place. Advanced: a rover trip from the place to an end point, with any number of stops, and a rover type as the "travel mode".
- Outputs:
  - Sun panel: elevation, azimuth, how much of the solar disk clears the terrain and the Earth, solar flux (W/m²) on a Sun-facing panel, on a panel that turns on a vertical mast at a fixed tilt, or on flat ground, time to sunset, eclipses.
  - Earth panel: elevation, azimuth, how much of the Earth is visible (a proxy for direct radio contact), its phase, time to Earthset.
  - Sky view: a first-person 3D view from 2 m above the ground that fills the window like an app, with a wedge on the map showing where it looks, real terrain lit by the Sun, the Earth with its true phase and orientation, the stars and the planets. During an eclipse, the Earth covers the Sun and its atmosphere glows as a red ring (an illustrative drawing; the eclipse geometry and timing are computed).
  - Suggested dates: for the chosen place, the best windows for solar power, for direct-to-Earth contact and for both, every eclipse of the Sun by the Earth visible from there, and Earthrises at polar and limb sites.
  - Rover trip: the fastest route through all stops within the rover's slope limit, drawn on the globe, with elevation and slope profiles and the Sun and Earth along the drive, against time or distance travelled. The travel time is coloured like traffic on a map app, by how much slower the route is than a straight drive on flat ground. Pressing play drives the route in the sky view, optionally in a driver's view.
  - Map: day and night at the chosen moment, including the Earth's shadow during eclipses. The point under the Sun agrees with JPL Horizons to 0.7 arcseconds.
  - Map layers: NASA's permanently shadowed regions, and the ground lit at least 70 % of the time at both poles. Every spot on the Moon spends some time in darkness; the best ridges are lit about 89–93 % of the time.
- Mission durations, from hours to years, become timelines with one line per scenario, so trade-offs are visible at a glance. Playback can follow the Sun or the Earth. Every view can be shared as a link.

**How it works**
1. Positions: JPL DE421 ephemeris and the lunar orientation model (MOON_ME frame, which includes libration), with light-time and aberration. Validated against **JPL Horizons** topocentric lunar sites: the Sun and Earth directions agree to 0.055 arcseconds (1.5e-05°) at worst over 399 comparisons at three sites and three epochs.
2. Terrain: NASA LRO **LOLA** elevation maps. For each catalog site, we compute the horizon profile: the elevation of the skyline in every direction, out to 70–330 km, including lunar curvature. We checked it against published south-pole illumination (Gläser et al. 2014): 92.7% of time lit at one reference point against 92.5% published (95.8% against 95.6%).
3. Visibility: the fraction of the Sun's or the Earth's disk that rises above that skyline, weighted for the Sun's limb darkening for power.
4. The physics is precomputed in Python and validated; the browser does the fast geometry and reproduces the Python reference to 3e-11°, so any site and any time works instantly. An independent check of the browser code against JPL Horizons at 20 random places and times (both poles, the far side, 1966–2040) agrees to 0.13 arcseconds.
5. Terrain anywhere: for a point that is not in the catalog, the browser fetches LOLA heights from NASA **Moon Trek** in 1–3 s and traces the horizon itself. At 10 of 12 test sites it agrees with our precomputed horizons to 0.07–0.37° (RMS).
6. Eclipses: the fraction of the Sun hidden by the Earth reproduces NASA's published contact times of the lunar eclipses of 14 March 2025 (seen by the Blue Ghost lander) and 24 April 1967 (seen by Surveyor 3) to 4.2 s or better.
7. Rover trips: a shortest-time path search through every stop on a Moon Trek elevation grid, with VIPER-class (0.2 m/s, ≤ 15°) and Apollo LRV (2.5 m/s, ≤ 20°) presets from NASA sources.
8. Suggested dates: a two-year scan of the place's sunlight, Earth visibility and eclipse geometry in a background thread (under 1 s at the poles). It finds every umbral lunar eclipse in NASA's 2025–2030 catalog.
9. A base-siting study with the same physics: 80,648 south-polar points screened, the best refined at 20 m resolution over 2030–2040. The recommended StarHab site (Malapert massif crest, −85.968°, −2.287°) gets 82 % of full sunlight on average, 98 % of the Earth's disk in view on average with the Earth never fully hidden, and a longest night of 7 days, on a 10 m mast. Our illumination matches Gläser et al. (2014) within 0.2 points, and our Earth visibility matches NASA's south-pole Earth-visibility map with r = 0.97.

**Tools**
Python (skyfield, numpy), JavaScript (three.js, Plotly), GitHub Pages. Built with AI coding agents (see Use of AI).

**Why it matters**
The challenge asks for rapid, intuitive comparison of landing sites and dates. At the south pole, a few hundred metres or a few days can
decide whether a lander has power and contact with Earth. Moonat makes that visible in seconds, for planners and for the public,
and it scales from one landing to choosing where a permanent base should go.

## Use of AI
Yes. The team set the vision, architecture and physics requirements, reviewed the app and directed changes. AI coding agents
(Claude Code by Anthropic) wrote the code, tests, validation reports and documentation under the team's direction. Every source file carries an AI-generated header, and commits
carry an AI co-author tag. No AI-generated images or video are used. The sky views are computed renders from NASA data. Details:
docs/AI_USE.md in the repository.

## Space Agency Data
- **JPL Horizons** (challenge resource): reference positions of the Sun and Earth from lunar sites; our validation benchmark (cached responses are test fixtures).
- **Moon Trek** (challenge resource): the LRO WAC global mosaic on the 3D Moon globe, and LOLA elevation grids (20–118 m) fetched live for the horizon and 3D ground at any point and for rover routes.
- **NASA eclipse predictions** (Espenak, NASA GSFC): contact times of the 2025 and 1967 lunar eclipses, our eclipse benchmark, and the 2025–2030 catalog for the suggested-dates check.
- **NASA GSFC PGDA** polar illumination, permanent-shadow and Earth-visibility maps (Mazarico et al. 2011 method): the map layers at both poles, and an independent cross-check of the base-siting study.
- **LRO LOLA** gridded elevation data (NASA PDS): polar stereographic DEMs at 20 m (LDEM_80S_20M), 30 m, 60 m and 240 m; global LDEM_64 (about 474 m) and LDEM_16 (about 1.9 km) for the far field; and SLDEM2015 (LOLA + SELENE Terrain Camera, about 59 m) within ±60° latitude. They give the horizon at every catalog site.
- **JPL/NAIF SPICE kernels**: DE421 ephemeris, lunar principal-axes orientation kernel and the MOON_ME frame kernel.
- **NASA Visible Earth**: Blue Marble and Earth City Lights textures for the Earth in the sky.
- **LROC (ASU/NASA LRO)** NAC mosaics, the Beresheet impact site, and the candidate landing regions NASA announced in October 2024 (shown as potential Artemis sites): site placement.
- Mission coordinates and times from NASA NSSDCA and the Apollo Lunar Surface Journal.

These data let us answer a simple question, "will we see the Sun and Earth?", with real precision.

## References
See docs/REFERENCES.md in the repository (complete list of data, libraries, papers and assets).
