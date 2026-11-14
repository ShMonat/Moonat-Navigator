# Validation: rover traverse planner (`web/js/rover`, contract C10)

> AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
> Branch `shay/rover`, 2026-11-14. Contract: [CONTRACTS.md C10](../CONTRACTS.md).
> Domains: the speed model, slope limits and horizon maths are Shay's (pending his review); the data source and
> network costs are Shahar's (same Moon Trek service as C9).
>
> **Reproduce:**
> 1. `node --test web/tests/` (offline: `rover_planner`, `rover_terrain`, `rover_route` tests);
> 2. `node scripts/data/validate_rover.mjs` (live, needs trek.nasa.gov; writes [rover.json](rover.json)).

## 1. What it does
1. **Terrain for the route.** One LOLA grid from the NASA Moon Trek ImageServer covering both end points plus a margin of
   max(3 km, 30 % of the distance), in a local stereographic plane centred on the great-circle midpoint (the C9 plane and
   layers: 20 m south of 85°S, 30 m poleward of 75°, 118 m elsewhere; ≤ 1001² px, at least 401 px). A 401² mid-field grid
   (to ±64 km near the poles, ±95 km elsewhere) and the shipped C5 tiles complete the horizons. Limit: 60 km straight line.
2. **Path.** A* on travel time over the grid, 16-connected. A cell is "no-go" when its terrain slope (Horn 3 × 3) exceeds
   the rover's limit; a move may not cross or cut the corner of a no-go cell, and must respect the along-track slope and
   cross-slope limits. Speed: level and downhill = the rover's speed; uphill power-limited (§4).
3. **Sky along the route.** Positions every 100–250 m along the path, each with its own horizon (the C9 ray march over the
   route grids and the C5 tiles). The rover leaves at the start time, drives at the planned speeds (optional stops) and
   parks at the end. Each time step uses the existing physics (`makeSite` + `series`, C6) at the horizon sample the
   rover has reached, and the result carries `distance_km` and `position` so the charts can use the distance driven.

## 2. Offline checks (`node --test web/tests/`, no network)
| Check | Result |
|---|---|
| Flat ground, east–west | the path is the straight row of cells; distance 2000 m exactly; time = distance / 0.2 m/s |
| Flat ground, oblique (110 × 50 cells) | 16-connected length within 3 % of the straight line; 8-connected is longer |
| Wall 60 m high with a 9-cell gap | the path crosses the wall only through the gap; with the gap closed: "blocked" |
| Cone hill (22° flanks) on the straight line, 15° rover | detour around the hill, never above 1 m on its flanks; a 30° rover is not slower |
| Random rough terrain (40 Gaussian bumps), 12° slope and 8° cross-slope limits | no vertex or crossed cell is no-go; every move within both limits; time = Σ distance / speed |
| Speed model | level and downhill = v; 10° uphill = 0.367 v, 15° = 0.281 v (μ = 0.1); uphill on a 6° ramp > 1.5 × the downhill time |
| Start on a 37° cell | moved to the nearest drivable cell, path still never touches a no-go cell |
| Stereographic plane | lat/lon → plane → lat/lon round trip < 1e-6 m (6 sites incl. both poles); s = 2R atan(r/2R) |
| Route grid seen from the route centre | identical to the grid (< 1 mm) |
| **Off-centre route grid vs site-centred grids (the terrainAt way)**, same analytic terrain (4 Gaussian hills of 0.3–2 km near the south pole, point 7 km from the route centre) | horizon RMS < 0.03°, max < 0.15° over all azimuths; ground within 0.5 m |
| Synthetic route (steep hill on the line) end to end | detour outside the > 15° ring; samples every 100–250 m, one horizon each; start and end within one cell of the requested points |
| **Zero-length route** | `routeSeries` equals the static-site `series` exactly (all 13 C6 arrays, deepEqual) |
| Moving route with stops (LRV, stops every 5 km for 30 min) | distance grows monotonically from 0 to the path length; each step equals `series` at its sample's site; first and last positions are the end points |

## 3. Live checks against `terrainAt` (2026-11-14, [rover.json](rover.json))
Five points along each route (start, quarter, middle, three quarters, end): route horizon vs `computeTerrain` (C9) at the
same point, both with a 0.5° azimuth step, over all 720 azimuths.

| Route (rover) | Path / straight | Driving | Grid | Planning time (Node) | Horizon vs terrainAt: RMS / bias / max | Ground |
|---|---|---|---|---|---|---|
| Shackleton rim (connecting ridge) → de Gerlache rim (VIPER-class) | 22.25 / 20.48 km | 43.3 h, 0.14 m/s mean | 1001², 27.2 m (LOLA 20 m layer) + 319 m mid-field | terrain 2.7 s, A* 0.19 s, 201 horizons 8.9 s; 6.3 MB incl. the 4.8 MB south C5 tile set | 0.03–0.15° / −0.07 to −0.01° / 0.16–0.60° | within 0.05 m |
| Apollo 15 landing site → 9 km south-east (Apollo LRV) | 6.43 km | 0.71 h, 2.50 m/s mean | 401², 118.45 m + 474 m mid-field | terrain 1.0 s, A* 0.01 s, 65 horizons 0.8 s; 0.93 MB | 0.008–0.039° / −0.01 to +0.01° / 0.05–0.23° | within 0.1 m |

**Reading:** where both use the same LOLA layer (Apollo 15, 118 m), the route horizons equal terrainAt to a few
hundredths of a degree. Near the pole the route grid is 27 m (the 20 m layer resampled by the server so 1001 px cover
both end points) against terrainAt's 20 m near field, hence 0.03–0.15° RMS; the slightly low bias is the same peak
flattening seen in C9 (docs/validation/terrain-everywhere.md §2).

**Browser:** the showcase quick start (south pole → connecting ridge, 19.3 km, 194 horizon samples) plans in about 7 s
in headless Edge on the team laptop, including the Moon Trek downloads and the Sun/Earth series (15–20 s with a single
worker; the horizons are now spread over up to 4 workers). The page stays responsive throughout. A 6.4 km route at
Apollo 15 (118 m grid) takes 2.4 s.

**Showcase quick start** ("Rover: Shackleton rim to the ridge"): VIPER-class, from the exact south pole (on the
Shackleton rim) to the catalog's Shackleton rim / connecting-ridge point (Gläser et al. 2014): 19.3 km driven (17.0 km
straight), 40.4 h of driving, steepest move 14.7°, +990 / −321 m. Start time: a scan of Dec 2026 – Nov 2027 every 6 h
(Sun and Earth along the planned path, 30 min steps) picked 2027-10-15 00:00 UTC, the window with the most sunlight along
the drive (86 %) and Earth in view all the way. The rover starts in the pole's shadow and drives into the Sun after
~10 min (300 m); hills shadow the 1.2–1.5° high Sun a few times further on. It is near full Moon, so the Earth is
"new" (its night side faces the Moon). Windows with a half-lit Earth (e.g. 2026-12-15, 2027-01-14) give 56–62 % sunlight
along the same path.

## 4. Rover presets and the speed model (Shay to review)
| Preset | Level speed | Max slope | Cross-slope limit | Source |
|---|---|---|---|---|
| VIPER-class rover | 0.2 m/s | 15° | 15° | NASA "VIPER Lunar Operations": 10–20 cm/s toward a destination, "generally" ≤ 15° (25–30° when necessary); Fong 2026 (NTRS 20260002876): top 20 cm/s, nominal 10 cm/s, 15° design limit |
| Apollo LRV | 2.5 m/s (9 km/h) | 20° | 20° | Jacob et al., LPSC 2026 (NTRS 20250011301): 9–13 km/h theoretical, 20–23° "favorable conditions", max 25° |

- **Uphill:** the drive delivers a fixed power P = power_margin · m g μ v (enough to hold v on level ground when
  power_margin = 1); uphill v(θ) = v · min(1, power_margin · μ / (μ cos θ + sin θ)), μ = 0.1 (rolling resistance on loose
  regolith, an assumption). Mass and g cancel. **Downhill and level:** v (no gain from gravity; braking assumed).
- **Sanity check:** on the flat Hadley plain the LRV preset gives 2.50 m/s; Apollo 15 and 16 averaged 2.0 and 1.7 m/s
  speed made good (best legs 2.6 / 2.5 m/s). The model is optimistic on flat ground because it has no obstacle
  avoidance, boulders or driver caution. VIPER's 0.8 cm/s speed made good includes prospecting and comms stops: use the
  "Stop every N km for H h" option to include such stops.
- **Cross slope:** no separate published limit was found for either vehicle, so the default equals the slope limit (it
  then rarely binds); it is editable.

## 5. Limits and assumptions
- **Grid resolution hides boulders and small craters.** Slopes are computed over 20–118 m cells (3 × 3 Horn window, so
  60–355 m), so the slope a rover meets at wheel scale is steeper: the computed slope is a **lower bound**, and the
  no-go map is optimistic. Rocks, roughness and soil strength are not modelled.
- **Cost = driving time only.** The planner does not know about sunlight, shadows or Earth contact; the Sun/Earth
  charts show them along the chosen path afterwards. A VIPER-like planner would add illumination and comms windows to
  the cost (time-dependent); that is future work.
- **Grid path.** 16-connected moves between cell centres (lengths within ~3 % of a smooth path); no smoothing.
  End points on no-go cells move to the nearest drivable cell within 300 m (shown as "snapped").
- **Horizons along the route:** 0.5° azimuth step (C3/C9 use 0.25°), every 100–250 m; each time step uses the nearest
  sample (≤ 125 m away). The eye is 2 m above the ground (C6 default).
- **Sky tab ride:** the view moves in up to 60 "stations" per route (skyline, ±8 km 3D ground and sky state of the same
  station); the camera is turned by the change of the local azimuth frame, which near the pole changes quickly with
  position.
- **Eclipses** of the Sun by the Earth: contact times are computed at the route centre (≤ 30 km from the rover; < 1 min).
- **Network:** the fine grid must come from Moon Trek (no SLA); without it planning fails with a message. A 1001² grid is
  about 1–1.5 MB (LERC), plus the C5 tiles of the region on the first visit.

## 6. Figures
| | |
|---|---|
| Route preview (hillshade, no-go cells, path, profiles) | [rover_preview.png](../figures/rover_preview.png) |
| Compare tab on the distance axis | [rover_compare_distance.png](../figures/rover_compare_distance.png) |
| Sky tab mid-traverse | [rover_sky.png](../figures/rover_sky.png) |
| Phone | [rover_phone.png](../figures/rover_phone.png) |
