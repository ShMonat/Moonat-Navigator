<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# Globe map layers: permanent shadow and the most sunlit ground

Two optional layers on the Moon globe (Layers button, off by default): **Permanently shadowed regions** and **Most
sunlit (lit ≥ 70 % of the time)**. Both are NASA's own maps, not our computation. Numbers below:
`docs/validation/map_layers.json`, written by `uv run python scripts/data/build_map_layers.py`.

## Data

NASA GSFC Planetary Geodesy Data Archive, product 69 "Lunar polar illumination" (LRO LOLA team, release 201608,
method of Mazarico et al. 2011): https://pgda.gsfc.nasa.gov/products/69, PDS files at
http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/.

| Product | What a pixel says | Used for |
|---|---|---|
| `LPSR_<band>_201608` | 1 = permanent shadow (DN +20000), 0 = not (DN −20000) | PSR layer, as is |
| `AVGVISIB_<band>_201608` | share of hourly time steps over an 18.6-year cycle with **any part of the Sun's disc** above the terrain horizon, **at the surface** (DN × 0.00004) | sunlight layer |

| Globe tier | Band | Crop | Pixel | Covers |
|---|---|---|---|---|
| north | `65N_240M` | 2560 × 2560 | 240 m | poleward of 79.9° N |
| south | `65S_240M` | 2560 × 2560 | 240 m | poleward of 79.9° S |
| south inner | `85S_060M` | 2048 × 2048 | 60 m (NASA's full resolution) | poleward of 87.97° S (fades in at 88°) |

The PGDA maps are polar stereographic on the 1737.4 km sphere in the DE421 Mean Earth/Polar Axis frame, which is the
globe's own cap projection, so a pole-centred crop is a texture with no resampling (`tests/test_map_layers.py` checks
the round trip). Each crop is a 2-bit palette PNG (one class per pixel): **271 kB for all three** (north 116 kB,
south 84 kB, south inner 71 kB) plus `overlays.json` (12 kB). Download: about 70 MB of byte ranges, once.

## Decisions for Shay

1. **PSR = NASA's `LPSR` map** (not "AVGVISIB exactly 0"). Every LPSR pixel has AVGVISIB = 0, but AVGVISIB = 0 has
   1.8–1.9 % more pixels (north 315 208 vs 309 269, south 350 794 vs 344 440): ground lit less than 0.002 % of the time
   rounds to DN 0. NASA's dedicated map is the cleaner definition.
2. **Sunlight thresholds: ≥ 70 % and ≥ 80 % of the time** (orange and yellow). Area lit at least X % of the time,
   poleward of 79.9° (240 m maps), and the number of separate spots:

   | X | South | North |
   |---|---|---|
   | 50 % | 2957 km² (flat ground near 80° gets about half the time) | 2999 km² |
   | 60 % | 56 km², 323 spots | 62 km², 401 spots |
   | **70 %** | **9.2 km², 69 spots** | **7.7 km², 58 spots** |
   | **80 %** | **1.2 km², 17 spots** | **1.4 km², 13 spots** |
   | 85 % | 0.35 km², 5 spots | 0.40 km², 4 spots |
   | 90 % | 0.12 km², 2 spots | 0 |

   70 % is where the layer stops being "flat high-latitude ground" and becomes a list of peaks and crater rims; 80 %
   keeps the best dozen or so per pole. Highest pixel: south 93.5 % (240 m map, connecting ridge), north 89.1 %.
3. **Honest label.** "Most sunlit (lit ≥ 70 % of the time)", with the note: "Lit: some of the Sun in view, at ground
   level, averaged over 18.6 years. No ground is lit all the time: the best ridges here are lit 89–93 % of the time."
   No "eternal light" anywhere in the interface (a test checks the label).
4. **Colours**, blended over the grey relief so its shading stays visible: permanent shadow `#4452ff` blue at 78 %;
   lit 70–80 % orange `#ff9a1f`, lit ≥ 80 % yellow `#ffe14d`. Blue against yellow-orange stays apart for the common
   colour-vision deficiencies, and the orange and yellow differ in lightness too. The sunlit spots are mostly smaller than a screen pixel, so each also gets
   a small **sun symbol** (disc and eight rays, 16 px) in its class colour; symbols closer than 18 px are grouped under
   the brightest; zoomed in past a few pixels, the symbol becomes a thin ring around the filled spot. The mouse
   readout adds "sunlit spot: lit up to N % of the time" over a symbol.
5. **Turning a layer on with no pole in view flies to the nearer pole** (north only when the view centre is north of
   about 11.5° N), zoom 5 (the whole area poleward of 80°), and says so in the panel. The panel also has South pole /
   North pole buttons. The share link keeps the layers (`ml=psr.sun`).

## Sanity checks

**Named points** (nearest pixel; the "globe shows" column is the map the globe draws there):

| Point | Expect | Globe shows | 60 m map | 240 m map |
|---|---|---|---|---|
| Shackleton crater floor (centre, 89.67° S 129.78° E) | PSR | 60 m | **PSR** | PSR |
| LCROSS impact point, Cabeus (about 84.675° S 48.725° W) | PSR | 240 m | PSR | **PSR** |
| Haworth floor (87.45° S 5.0° W) | PSR | 240 m | PSR | **PSR** |
| Shoemaker floor (88.1° S 44.9° E) | PSR | 60 m | **PSR** | PSR |
| Connecting ridge, Gläser CR1 spot 3 | lit | 60 m | **86.4 % (≥ 80 class)** | 63.1 %, a ≥ 80 % pixel 186 m away |
| Connecting ridge, Gläser CR1 spot 1 | lit | 60 m | **44.3 %; a ≥ 70 % pixel 72 m away, ≥ 80 % at 353 m** | 74.7 % |
| Malapert massif crest (StarHab site) | lit | 240 m | 52.1 %; ≥ 70 % at 35 m | **74.1 % (≥ 70 class)**; ≥ 80 % at 479 m |
| de Gerlache rim (Moonat catalog point) | lit | 60 m | **52.8 %; ≥ 70 % at 101 m** | 81.7 % (≥ 80 class) |
| Malapert Massif (Moonat catalog point, 1 km off the crest) | – | 240 m | 43.9 % | 67.2 %, no ≥ 70 % within 1 km |

All four PSR floors are permanent shadow in both maps. The brightest spots the layer finds in the south are the known
ones: the connecting ridge (88.4 %, 89.47° S 137.40° W), the Shackleton rim (87.1 %, 89.69° S 162.75° W), Gläser's
CR1 spot 3 (86.4 %), the de Gerlache rim next to the Artemis III "de Gerlache Rim 2" region (82.7 %, 88.67° S
68.38° W) and the Malapert massif (83.4 %, 85.95° S 3.42° W). North: 89.1 % at 89.35° N 130.2° E.

**Ground level makes crests fragile.** On a ridge the share changes by 30–40 points from one 60 m pixel to the next
(CR1 spot 1: 44 % at the point, 75.5 % in its 3 × 3 neighbourhood), because a pixel's centre can sit just off the
crest. Our own StarHab study saw the same (docs/research/starhab_site.md: PGDA is at ground level, and Gläser's CR1
spot 3 is lit 95.6 % of the time 10 m up against 86.4 % in this 60 m ground-level pixel). The 240 m map smooths the crests and finds about ten times more ≥ 70 % ground inside 88° S than
the 60 m map (5.0 vs 0.53 km²; ≥ 80 %: 0.92 vs 0.06 km²). The globe shows the 60 m map there.

**PSR area poleward of 80°** against Mazarico et al. (2011), who used the same method on earlier 240 m LOLA maps:

| | This release (201608), 240 m | Mazarico et al. 2011 | Ratio |
|---|---|---|---|
| South | 18 316 km² | 16 055 km² | 1.14 |
| North | 15 519 km² | 12 866 km² | 1.21 |

Our area sum is checked: pixel areas with the stereographic scale factor add up to the analytic spherical cap within
0.2 % (`tests/test_map_layers.py`). So the difference is in the maps: the 2016 release is built from LOLA data up to
July 2013 (the product label's STOP_TIME), far more tracks than the 2011 paper had, which resolve more small craters;
Barker et al. (2023) find that PSRs smaller than 1 km² hold 15 ± 5 % of the south's PSR area. We did not find a published total for the 201608 release itself: **uncertain**, and worth a
look by Shay. Inside 87.97° S the 60 m and 240 m maps agree on PSR area to 5 % (2533 vs 2420 km²).

**Alignment.** Screenshots with the layers on and off (outputs/map_layers/, not committed): the PSR outlines sit on the
crater floors of the globe's LOLA relief at both poles, Shackleton's floor is one blue disc, and the sun symbols line
the Shackleton rim and the connecting ridge. Around the north pole the relief under the layer is the coarse LDEM_16
hillshade (about 1.9 km), so the many small 240 m PSRs there have no visible crater under them.

## Not covered

- The layers stop at 80° latitude (the PGDA products reach 65°; small PSRs exist there too).
- No Earth-visibility layer (the same product family has `AVGVISIB_..._EARTH`; an easy addition).
- Heights above the ground (a mast) are not in these maps.

## Reproduce

```
uv run python scripts/data/build_map_layers.py --preview   # data, checks, outputs/map_layers_preview.png
uv run pytest -q tests/test_map_layers.py
node --test web/tests/globe_layers.test.mjs
```
