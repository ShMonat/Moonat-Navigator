<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# Validation: suggested dates (C11 `suggest-dates`)

For a selected site, the engine proposes mission dates: the best windows for **solar power**, for **direct-to-Earth
contact**, and for **both at once**, plus special events: **eclipses of the Sun by the Earth** seen from the site and
**Earthrises/Earthsets** with the Sun up. Code: `web/js/suggest/` (module worker). API: docs/CONTRACTS.md §C11.

Reproduce: `node --test web/tests/suggest_windows.test.mjs web/tests/suggest_validation.test.mjs` (the checks below)
and `node scripts/suggest_report.mjs` (the tables in §3 and §4).

## 1. Method in one paragraph
One C6 `series()` pass samples the site over the whole range (default: today 00:00 UTC + two calendar years, clipped to
the ephemeris coverage 1966–1976 / 2013–2040) every **10 min** (longer ranges get a longer step, ≤ 110 000 samples).
Each sample has the Sun's visible flux share `flux_frac` (terrain + Earth, limb-darkened, C6) and the Earth's visible
disk share `earth_vis` (terrain only). The window kinds slide a window of the chosen length over these samples (prefix
sums, O(N)). Eclipses come from the same pass: `series()` scans the Sun–Earth separation at the site and brackets every
minimum that could reach contact (once a month, near full Moon; the bracket uses a 0.75°/h bound on the separation
rate, so events between samples are found). Each candidate is then refined at the site with a 30-s series and the
existing eclipse physics (`physics/eclipse.js`, contacts to 1 s). The site's separation differs from the separation at
the Moon's centre by at most the Earth's parallax (0.26°), so scanning at the site directly loses nothing and needs no
second ephemeris reader. If only eclipses are asked for, the scan step is 3 h.

## 2. Definitions (for review)
**Windows (`sun`, `earth`, `both`).** A window has length D = `durationMs` (default one lunar day, 14.77 d = half the
mean synodic month). Its **score** is the time average of a 0..1 quantity v over the window. The search:
1. computes the score of every window start on the 10-min grid;
2. takes the best window, blocks every start that would overlap it, and repeats (non-overlapping windows, up to 60);
3. drops windows scoring below half the best one;
4. ranks by score, but windows within **0.5 points** (0.005) of a better one count as equal and are listed **soonest
   first**; returns the first `limit` (default 5).

Ties: near the equator a 14.77-d window holds the whole lunar day for a range of starts, so the plain average is flat
there. A tie-break adds 0.001 × the front-weighted average (weights falling linearly from 1 to 0 across the window): of
two windows with the same average, the one with the light (or contact) earlier wins. This puts the start at sunrise
and can cost at most 0.001 of the score.

| Kind | v (per sample) | Score | Also reported |
|---|---|---|---|
| `sun` | `flux_frac`: share of the full Sun's limb-darkened light reaching the site, terrain and Earth included (C6) | mean `flux_frac` | % of time sunlit (`flux_frac` > 0; a total eclipse counts as dark, as in C6), longest unbroken sunlit stretch, mean W/m² on a Sun-facing panel (`flux_normal`) and on level ground (`flux_horiz`), whether it opens at sunrise, eclipses inside, and at \|lat\| ≥ 75° the subsolar latitude (season, §3) |
| `earth` | `earth_vis`: share of the Earth's disk above the terrain skyline | mean `earth_vis` | % of time in view (`earth_vis` > 0), longest unbroken contact |
| `both` | min(`flux_frac`, `earth_vis`) | mean of the minimum | % of time with both, longest stretch with both, each average separately |

**Why `both` = the average of the minimum, not the minimum of the two averages.** Operating a lander, or driving a
rover from Earth, needs power and a link **at the same moment**; this score counts only such time. It is never above
the minimum of the two averages, equals it when sunlight and Earth contact are in phase, and is lower when they
alternate, as at the poles, where the Earth's libration cycle (27.2 d) beats against the Sun's (29.5 d). The minimum of
the two averages would suit a lander with large batteries; both averages are in the item's `stats`, so the UI can show
them.

**Notes instead of windows.** Each note is one item with `note: true`:
- `earth` on the **near side** (Earth visible at every sample): one note, "Earth always in view: any date works", with
  the elevation range from libration (e.g. Apollo 11: 58.4°–74.3°). No list of equal windows.
- `earth` and `both` on the **far side** (Earth never visible): one note each, `t_start_utc` = null, score 0, with the
  reason: `stats.reason = "far-side"` when the top of the Earth's disk stays below the level horizon at every sample
  (Chang'e 4: 134° from the sub-Earth point, top of the disk ≥ 36.4° below), or `"terrain"` when the Earth rises above
  the level horizon but the terrain always hides it.
- `sun` with no sunlight at all in the range (permanent shadow): one note.
- `earthrise` returns nothing where the Earth never crosses the skyline (near and far side).

**Eclipse (`eclipse`).** An event is the interval in which the Earth's disk covers part of the Sun's disk **as seen from
the site** (`eclipse_frac` > 0): from the site's first contact (`t_start_utc`) to its last (`t_end_utc`), with the
greatest eclipse at the site (`t_max_utc`, minimum Sun–Earth separation) and the totality contacts when the site enters
the Earth's umbra (`stats.type` = "total"). It is listed only if the Sun's disk is above the terrain skyline
(`vis_frac` > 0) at some moment of it. **Score** = the largest covered share of the Sun's flux while the Sun is above
the skyline (1 for a visible totality); equal scores: longer totality first, then earlier. The Earth is the solid disk
of radius 6378.137 km (no atmosphere), as in docs/validation/eclipse.md.

**Earthrise (`earthrise`).** A crossing of the terrain skyline by the Earth's disk, from fully hidden (`earth_vis` = 0)
to fully visible (≥ 0.999), or back for an Earthset; grazes (hidden → partly visible → hidden) are not counted.
`t_start_utc`/`t_end_utc` = the last sample in the old state and the first in the new one (10-min grid);
`t_max_utc` = the moment half the disk is visible (bisection with `skyState` to 2 s). Listed only if the Sun is up at
that moment (`vis_frac` > 0 and `flux_frac` > 0). **Score** = Earth phase (lit fraction of its disk) × the Sun's flux
share, a photo heuristic (a bright Earth over a lit landscape); scores within 0.05 count as equal (soonest first). At
the poles a crossing takes about a day, because only libration moves the Earth (≤ ~1.5°/day; disk 1.9°).

## 3. Seasons at the poles
The Moon's spin axis is tilted only **1.54°** from the ecliptic pole, and by Cassini's laws the lunar equator, the
ecliptic and the Moon's orbit share one node line, which regresses in 18.6 years. The Sun's latitude in lunar
coordinates (the **subsolar latitude** β) therefore swings between −1.54° and +1.54° with the period of the Sun's
return to that node: the **eclipse year, 346.62 d**, not the 365.25-d year. β = 0 in the eclipse seasons (the Sun at a
node, which is when lunar eclipses happen). At a pole the Sun circles the sky at about −β elevation (south pole), so
south-polar sites have **summer when β < 0**. The seasons come about 18.6 d earlier each calendar year.

Shackleton rim (catalog POI `shackleton_rim`, 89.44° S, 137.19° W, real LOLA horizon), from 10-min samples
(`flux_frac` > 0 for "sunlit"):

| Month | β mid-month | Sunlit | Mean `flux_frac` | Earth in view |
|---|---|---|---|---|
| 2027-01 | −0.71° | 100.0 % | 1.000 | 49.1 % |
| 2027-02 | +0.11° | 98.0 % | 0.947 | 54.6 % |
| 2027-03 | +0.89° | 86.1 % | 0.777 | 49.5 % |
| 2027-04 | +1.42° | 68.5 % | 0.556 | 60.0 % |
| 2027-05 | +1.52° | 65.1 % | 0.539 | 61.4 % |
| 2027-06 | +1.18° | 78.1 % | 0.637 | 59.9 % |
| 2027-07 | +0.50° | 95.0 % | 0.894 | 60.9 % |
| 2027-08 | −0.34° | 100.0 % | 0.997 | 57.2 % |
| 2027-09 | −1.08° | 100.0 % | 1.000 | 52.2 % |
| 2027-10 | −1.51° | 100.0 % | 1.000 | 50.6 % |
| 2027-11 | −1.48° | 100.0 % | 1.000 | 51.6 % |
| 2027-12 | −0.99° | 100.0 % | 1.000 | 58.7 % |
| 2028-01 | −0.16° | 99.9 % | 0.997 | 62.3 % |
| 2028-02 | +0.68° | 95.8 % | 0.916 | 61.3 % |
| 2028-03 | +1.31° | 78.0 % | 0.611 | 65.5 % |
| 2028-04 | +1.55° | 62.5 % | 0.501 | 65.0 % |
| 2028-05 | +1.34° | 69.8 % | 0.596 | 57.3 % |
| 2028-06 | +0.76° | 86.5 % | 0.813 | 54.1 % |
| 2028-07 | −0.03° | 96.7 % | 0.943 | 52.8 % |
| 2028-08 | −0.81° | 100.0 % | 1.000 | 60.1 % |
| 2028-09 | −1.35° | 100.0 % | 1.000 | 65.8 % |
| 2028-10 | −1.49° | 100.0 % | 1.000 | 67.4 % |
| 2028-11 | −1.18° | 100.0 % | 1.000 | 65.6 % |
| 2028-12 | −0.49° | 99.6 % | 0.992 | 65.9 % |

β from our DE421 table peaks at ±1.55°. The β = 0 crossings (Feb and Jul/Aug 2027, Jan and Jul 2028) match the eclipse
seasons in §4. The rim crest sees continuous sunlight for about five months each southern summer, and still 62–69 %
in mid-winter, because it stands above most of its surroundings (its skyline dips below the level horizon). The
`sun` detail states the season at \|lat\| ≥ 75°.

## 4. Validation
### 4.1 Blue Ghost, 2025: the 14 March total eclipse
`suggestDates(blueghost1, {from: 2025-01-01, to: 2026-01-01, kinds: ["eclipse"]})` returns two events, 14 March and
7 September 2025 (both total, the Sun 29° and 23° high). The March event against docs/validation/eclipse.md §3:

| Contact at the site | docs/validation/eclipse.md | Suggest engine |
|---|---|---|
| Sun starts to be covered | 05:00:42 | 05:00:42 |
| Totality starts | 06:17:24 | 06:17:24 |
| Greatest eclipse at the site | 07:25:54 | 07:25:54 |
| Totality ends (diamond ring) | 08:34:24 | 08:34:24 |
| Sun fully uncovered | 09:51:10 | 09:51:10 |

Title: "Total eclipse of the Sun by the Earth, 14 Mar 2025, 2 h 17 min". Contacts are refined to 1 s; the test allows ±2 s. (Values after the switch to the IAU 2015 solar radius, 695 700 km.)

### 4.2 NASA's lunar eclipses 2025–2030 (Espenak) at near-side sites
NASA lists 14 lunar eclipses for 2025–2030: 6 total, 4 partial (umbral) and 4 penumbral
([decade table](https://eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html), greatest eclipse in TD; UT = TD − 75 s).
At a near-side equatorial site the Earth is high in the sky, so the Sun (next to the Earth during an eclipse) is always
up. Each cell: what the site sees, and its greatest eclipse minus NASA's (the site is up to one lunar radius from the
Moon's centre, so up to ~30 min).

| NASA lunar eclipse (greatest, UT) | Type, umbral mag. | Surveyor 6 (0.5° N, 1.4° W) | Apollo 11 | Blue Ghost | Shackleton rim |
|---|---|---|---|---|---|
| 2025-03-14 06:58 | Total, 1.178 | **total 145 min** (−2 min) | **total 147 min** (+11 min) | **total 137 min** (+27 min) | **total 166 min** (−4 min) |
| 2025-09-07 18:11 | Total, 1.362 | **total 147 min** (+1 min) | **total 148 min** (+13 min) | **total 154 min** (+24 min) | **total 105 min** (+4 min) |
| 2026-03-03 11:33 | Total, 1.151 | **total 139 min** (−3 min) | **total 137 min** (+10 min) | **total 145 min** (+25 min) | **total 71 min** (−4 min) |
| 2026-08-28 04:12 | Partial, 0.930 | **total 119 min** (+2 min) | **total 115 min** (+15 min) | **total 87 min** (+26 min) | **total 156 min** (+4 min) |
| 2027-02-20 23:12 | Penumbral, −0.057 | partial 37 % (−2 min) | partial 33 % (+10 min) | partial 51 % (+24 min) | — |
| 2027-07-18 16:02 | Penumbral, −1.068 | — | — | — | — |
| 2027-08-17 07:13 | Penumbral, −0.525 | partial 0.19 % (0 min) | — | — | partial 46 % (+4 min) |
| 2028-01-12 04:12 | Partial, 0.066 | partial 52 % (+1 min) | partial 55 % (+13 min) | partial 38 % (+25 min) | **total 39 min** (−4 min) |
| 2028-07-06 18:19 | Partial, 0.389 | partial 93 % (−3 min) | partial 95 % (+10 min) | **total 56 min** (+24 min) | partial 33 % (+4 min) |
| 2028-12-31 16:52 | Total, 1.246 | **total 143 min** (+2 min) | **total 144 min** (+14 min) | **total 135 min** (+27 min) | **total 158 min** (−4 min) |
| 2029-06-26 03:22 | Total, 1.844 | **total 160 min** (−3 min) | **total 159 min** (+9 min) | **total 157 min** (+22 min) | **total 148 min** (+4 min) |
| 2029-12-20 22:41 | Total, 1.117 | **total 140 min** (+1 min) | **total 138 min** (+15 min) | **total 147 min** (+29 min) | **total 65 min** (−4 min) |
| 2030-06-15 18:33 | Partial, 0.502 | partial 100 % (−2 min) | partial 99 % (+10 min) | partial 82 % (+22 min) | **total 117 min** (+3 min) |
| 2030-12-09 22:27 | Penumbral, −0.163 | partial 32 % (−1 min) | partial 29 % (+13 min) | partial 44 % (+28 min) | — |

- **Every umbral eclipse (all 10, total and partial) appears at Surveyor 6 and Apollo 11** (the test's requirement),
  and every NASA total eclipse is total at both sites. No event appears that is not in NASA's list.
- A **partial** lunar eclipse can be **total** at sites on the part of the Moon that enters the umbra: 28 Aug 2026
  (magnitude 0.93) is total at all four sites; 12 Jan 2028 (0.066, the southern limb grazes the umbra) is total only at
  the Shackleton rim; 6 Jul 2028 (northern limb) is total at Blue Ghost (18.6° N). The pattern follows the sign of
  NASA's gamma, which confirms the geometry.
- **Penumbral eclipses.** A penumbral lunar eclipse is a partial eclipse of the Sun for the lunar sites inside the
  penumbra, and nothing for the rest. We **include every one the site sees** (coverage > 0 with the Sun above the
  skyline), however small (Surveyor 6, 17 Aug 2027: 0.19 % of the Sun's light), and exclude none for any other reason.
  Small ones rank low, so with the default `limit` of 5 they drop out of a busy list first.
  **18 Jul 2027 is seen from nowhere on the Moon** with our solid Earth (6378 km, no atmosphere). A search over the
  whole Moon (3° grid, then 0.5° near the best point, 2-min steps) finds the two disks 0.0084° (30″) apart at best,
  at 83° N, 96.5° E with the Earth 0.9° up. NASA's Earth, enlarged by 1 % for its atmosphere (Danjon; +0.0095° in
  angular radius seen from the Moon), would just graze the Sun there, hence NASA's tiny penumbral magnitude.
- The Sun is up at every listed event at all four sites (`stats.sun_up_min` = the whole duration).

### 4.3 Apollo 11: solar windows start at sunrise
2027, default window (14.77 d), `limit` 12. For each window, sunrise is found independently from a 1-min series (first
minute with `flux_frac` > 0 after the night). Window start − sunrise: **1, 4, 4, 6, 3, 7, 10, 4, 1, 7, 2, 5 min** (test: ≤ 60 min).
The lunar day at Apollo 11 lasts 14.69–14.75 d (first to last sunlit sample, real horizon), slightly shorter than the
window, so the best window contains the whole day and the tie-break puts its start at sunrise.

### 4.4 Shackleton rim: the best sunlight month of 2027 against brute force
`kinds: ["sun"], durationMs` = one synodic month (29.53 d), range 2027. Brute force: `skyState` every hour (8761 calls),
the mean of `flux_frac` for every hourly start by direct summation, then the best non-overlapping months by plain
sorting.

| Rank by score | Brute force (start, mean) | Suggest engine (start, score) |
|---|---|---|
| 1 | 2027-01-01 00:00, 1.0000 | 2027-01-01 00:00, 1.0000 |
| 2 | 2027-08-17 09:00, 1.0000 | 2027-08-17 09:00, 1.0000 |
| 3 | 2027-09-15 22:00, 1.0000 | 2027-09-15 21:40, 1.0000 |
| 4 | 2027-10-15 11:00, 1.0000 | 2027-10-15 10:20, 1.0000 |
| 5 | 2027-11-14 00:00, 1.0000 | 2027-11-13 23:00, 1.0000 |
| 6 | 2027-07-18 17:00, 0.9976 | 2027-07-18 16:30, 0.9976 |

Same months, same scores, starts within 1 h (hourly vs 10-min grid). The test also checks the brute-force mean at every
returned start against the reported score (within 0.003).

### 4.5 Far side and near side
- **Chang'e 4** (45.5° S, 177.6° E): `earth` → one note, "No direct-to-Earth contact here": "The Earth never rises at
  this site: it is on the Moon's far side (134° from the point under the Earth), where even libration … cannot bring
  its disk above the horizon (its top stays 36.4° below at best). Direct-to-Earth radio needs a relay satellite here."
  `both` → the same reason; `earthrise` → nothing.
- **Apollo 11**: `earth` → one note, "Earth always in view: any date works" (elevation 58.4°–74.3° in 2025);
  `earthrise` → nothing; `both` equals `sun` (stated in the detail).

### 4.6 Unit tests (web/tests/suggest_windows.test.mjs)
Window scores against direct sums (1e-12); a synthetic lunar-day square wave (best windows start on the sunrise ramp,
never overlap, equal ones soonest first); ranking; runs; skyline crossings (rise, set, graze); text formats; range
clipping to the coverage, including the 1977–2012 gap.

## 5. Timings
Two years at 10-min steps = 105 265 samples. Headless Microsoft Edge 157 (Playwright), module worker, page served
locally; Node 26 inline for comparison. Same laptop.

| Request | Browser worker | Node inline |
|---|---|---|
| Shackleton rim, 2 years, all kinds, cold (worker start, 3 ephemeris years) | **0.79 s** | 0.53–0.64 s |
| Shackleton rim, another 2 years (3 new ephemeris years) | 0.89 s | |
| Same request again (result cache) | 0 ms | 0 ms |
| Same site and range, another duration (sample cache) | 0.11 s | |
| Apollo 11 / Blue Ghost / Chang'e 4, 2 years, all kinds | 0.10 s each | 0.10–0.11 s |
| Artemis III Malapert, 2 years, all kinds | 0.68 s | 0.46 s |
| Shackleton rim, eclipses only, 6 years (3-h scan + refinement) | 0.40 s | |
| Cancel 40 ms into a run (30 ms in Node) | AbortError 7 ms after the abort | AbortError ~8 ms after the abort |
| Longest main-thread stall during all browser runs | 12 ms | |

Polar sites cost more because the Sun and the Earth sit near the skyline, so every sample integrates both disks against
the terrain (400 points each); at low latitudes the fast paths skip that.

## 6. For the UI
- `import { suggestDates, LUNAR_DAY_MS, SYNODIC_MONTH_MS } from './js/suggest/index.js'`. One call per site and range;
  pass the site's C3 horizon (or the C9 `terrainAt` horizon for custom points). Show `title`, put `detail` in a tooltip
  or expander, and set the date picker to `t_start_utc` (`t_max_utc` for an eclipse or an Earthrise).
- Items with `note: true` are statements, not windows; far-side notes have `t_start_utc` = null.
- Pass an `AbortSignal` when the site changes; aborted calls reject with an `AbortError` (ignore it). Results are cached
  per site and options; a new `durationMs` for the same site and range reuses the samples (~0.1 s).
- The engine is not imported by `js/app/main.js`, so the modulepreload list in `web/index.html` needs no change until
  the app imports it. Then add `js/suggest/index.js`, `core.js`, `windows.js` and `format.js` (the worker file loads
  separately); `web/tests/perf_preload.test.mjs` says exactly which lines are missing.

## 7. Open points for review (Shay)
- `both`: the average of the pointwise minimum (simultaneous power and link, §2) versus the minimum of the two
  averages (batteries bridge the gaps).
- Earth "in view" counts any part of the disk above the skyline. A radio link may want the Earth some degrees clear
  of the terrain (multipath, Fresnel zone); a margin would be a one-line change.
- The `sun` score is `flux_frac` (a share of the Sun's light), as asked: it ignores the ±3.4 % yearly change of
  sunlight with the Sun's distance and the panel orientation. The detail reports W/m² on a Sun-facing panel and on
  level ground.
- Near-equal threshold 0.005 (0.5 points ≈ 1.8 h of full sunlight in 14.77 d) and the Earthrise photo score are
  presentation choices.
- Eclipses use the solid Earth (no atmosphere), as in docs/validation/eclipse.md; NASA's Danjon Earth would start the
  totality about 1.3 min earlier and would make the 18 Jul 2027 penumbral eclipse graze the Moon's limb.
