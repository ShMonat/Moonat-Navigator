# Catalog validation (web/data/sites.json)
AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. Pending Shahar's review.

Coordinates are cross-checked between my knowledge of LROC-measured positions and the Wikipedia "List of artificial
objects on the Moon" table (which cites LROC/NSSDCA values). Times come from the Apollo Lunar Surface Journal (Apollo) and
mission summaries (others). "Approx end" means a date-level value; see `notes` in the JSON.

| Group | Sites | Coordinate source | Time source | Confidence |
|---|---|---|---|---|
| Apollo 11-17 | 6 | LROC-measured (list above) | ALSJ / Apollo Flight Journal | High (coords), High (times) |
| Luna 9,13,16,17,20,21,24 | 7 | NSSDCA / LROC-refined list | Mission summaries | Medium-high coords (Luna 9/13 ~0.01-0.1 deg); end times approximate |
| Surveyor 1,3,5,6,7 | 5 | LROC-refined (list above) | NSSDCA | High coords; end times approximate |
| Chang'e 3,4,5,6 | 4 | LROC / CNSA | CNSA reports | High coords; Ch'ang'e 3/4 end times uncertain (4 = null) |
| Chandrayaan-3, SLIM, IM-1, Blue Ghost 1, IM-2 | 5 | LROC / agency reports | Agency reports | High (Ch-3, BG1, IM-2); medium (SLIM ~10 m); IM-1 uses -80.1286, 1.4376 (the list showed -84.9, 12.9, which looks wrong) |
| Artemis candidate regions | 9 | Region names from NASA's Oct 2024 release; coordinates estimated | none | Low-medium: approximate representative points only |
| POIs | 4 | IAU gazetteer / literature | none | Shackleton rim: low-medium; others medium-high |

Spot checks still worth doing in Quickmap (not done, time): IM-1, Luna 9, Luna 13, Artemis candidate points, Shackleton connecting ridge.
