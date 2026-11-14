# Challenge: Lunar Landing Site Navigator (NASA Space Apps 2026)

Source: https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/
(printed copy: `docs/Challenge description.pdf`). Difficulty: Advanced. Subjects: Human/Space Exploration, Moon, Software.
This file is a condensed summary for agents. Read the PDF for the original wording.

## The problem
South-pole lunar missions (CLPS and others) need landing sites and dates that work for both
**lighting** (Sun position, which drives power and thermal) and **communication** (Earth position, which
drives direct-to-Earth links without relays). Existing tools such as Quickmap, Moon Trek and JPL Horizons are built
for specialists. They are slow for rapid "what if we slip the date / move the site" comparisons. The south
pole makes this worse: the geometry and terrain cause extreme variation in illumination and Earth
visibility, so small location or date changes matter a lot.

## Build
A tool or app that **quickly evaluates lunar landing site options** by showing Sun and Earth
positions relative to the horizon. Users should be able to judge power potential and direct-to-Earth comms windows.

## Suggested objectives (optional, "may consider")
- **Site selection and comparison**: a curated list (Apollo, CLPS targets, other commercial/international
  sites) plus custom coordinates. Side-by-side or sequential comparison.
- **Date/time flexibility**: pick dates and times, and see how conditions change across lunar days and seasons.
- **Sun and Earth position visualization**: show both against the local horizon. Show time left until sunset or Earthset.
- **Power and comms metrics**: solar elevation angle, sunlight duration, Earth visibility windows, and a viability verdict.
- **Multiple visualization approaches**: 2D maps, 3D surface, others.
- **Temporal dynamics**: animations or timelines over a lunar day or several days.
- **Accessibility across skill levels**: works for mission planners, educators and the public.
- Any format is allowed: web app, mobile app, interactive viz, educational game.

## Technical considerations (optional)
- Ephemeris: JPL Horizons, or precomputed datasets.
- Topography: LOLA (Lunar Orbiter Laser Altimeter) data for realistic surfaces and horizons.
- No atmosphere, so no refraction. The horizon is set by local terrain plus the lunar curvature.
- Make solar elevation angle a prominent, key power metric.
- Real topography strongly affects horizon and visibility windows. South-pole slopes and craters cause extreme shadows.
- Earth libration and the Moon's orbital variations should be accounted for.

## UX and impact (optional)
- Prioritize rapid comparison of many site and date combinations.
- Clearly communicate the time remaining before sunset or Earthset.
- Make the lunar vs terrestrial differences compelling.
- Help users see why small changes have big impacts.
- Serve planners (schedule slips), and also educators and the public.

Resources tab on the challenge page: may be updated before the hackathon. Re-check it.
