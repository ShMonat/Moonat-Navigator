# Main Tab: product spec

> Status: **agreed with Shay on 2026-11-09** (flag `main-tab-spec-vs-vision`, resolved). Shared domain (product and UI).
> It refines `docs/VISION.md`. The layout may change once we see the tabs.

## Goal
The Main Tab is the public front page of the app. A visitor compares lunar points. Each point gets a terrain view and two
elevation-angle graphs. The tab is **open to the public**, with no login.

## 1. Comparison points
- The user adds points for comparison. There is **no hard limit**. More than about 5 points can clutter the outputs, but the user decides.
- Each point has its own inputs and its own result. The results appear side by side or overlaid, so the user can compare.

## 2. Inputs for each point
The user picks one of two options.

| Option | Inputs |
|---|---|
| **Historical mission** | Select a past mission from the catalog. Location and dates are prefilled. |
| **Custom parameters** | Latitude and longitude (numbers, selenographic, degrees). Start time (UTC). Optional end time. |

- There is **no default mission length**. Points may share one start time.
- With **no end time**, the analysis covers the start time only.

Open details: input validation ranges, and whether the user can edit prefilled mission dates.

## 3. Site feasibility assessment (dropped)
Crater and hill warnings are **not** part of the Main Tab. Classifying craters and hills is not worth the effort.
The elevation and visibility data speaks for itself (Shay, 2026-11-09).

## 4. Graphs
### Graph 1: Point topography
- Shows the terrain around the point.
- **Open:** the exact content of this graph is not defined yet (Shahar to define). The crater, hill and plain classification is dropped.

### Graph 2: Sun elevation angle
- Shows the angle of the Sun above the **idealized local horizon**, for a **perfectly spherical Moon**.
- X axis: time over the mission. One line per point.

### Graph 3: Earth elevation angle
- Shows the angle of Earth above the same idealized local horizon.
- X axis: time over the mission. One line per point.

### Important distinction (applies to Graphs 2 and 3)
These graphs show the **apparent** elevation angle against a theoretical horizon. They are **not** actual visibility.
Actual visibility also depends on local terrain obstructions. The tab must label the graphs this way, so users do not read
a positive angle as "the Sun is visible".

## 5. Access
The Main Tab is public. No account, no login.

## 6. How it maps to the architecture
| Spec item | Layer (see `docs/ARCHITECTURE.md`) |
|---|---|
| Mission picker | `catalog` (`mission-catalog`) |
| Sun and Earth elevation (Graphs 2 and 3) | `ephem` (`body-track`: `el_deg`) |
| Terrain view (Graph 1) | `terrain` (DEM and `horizon-profile`) |
| Page, inputs, graphs | `app` |

Graphs 2 and 3 use `el_deg` from `body-track`, which is already relative to the local geometric horizontal plane
(`ARCHITECTURE.md` §6). They need no terrain data.

## 7. Open questions
1. Which tabs exist besides the Main Tab? Where do the terrain line of sight and the sky view appear? Proposal: a second tab ("Sky and visibility"). Shay: OK in principle.
2. What exactly does Graph 1 (topography) show, and what is the radius of the terrain? (Shahar)
3. Do historical missions and custom points share the same list of points? (Proposal: yes.)
4. Which tool serves the public tab, and where is it hosted? (`ARCHITECTURE.md` §4, Shahar.)
5. Other data outputs: to be detailed later (Shay).
