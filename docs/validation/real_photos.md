# Real Apollo photos and the ALSJ Sun/Earth table vs Moonat

> AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
> Producer: agent `real-photos` (branch `shay/real-photos`). Physics and terrain maths are Shay's domain.
> Reproduce: `uv run python scripts/validate_real_photos.py` (numbers in `docs/validation/real_photos.json`,
> figures `docs/figures/real_vs_moonat_*.png`). Tests: `uv run pytest tests/test_real_photos.py`.

## Summary

| Check | Reference | Moonat vs reference |
|---|---|---|
| Sun altitude, 43 epochs (Apollo 11, 12, 14, 15, 16, 17: landing, every EVA start and end, liftoff) | ALSJ alt-az table (Nautical Almanac) | mean +0.008°, RMS 0.016°, max 0.066° |
| Sun azimuth, same 43 epochs | same | RMS 0.064°, max 0.41° (one table row; the other 42 rows within 0.03°, see §1) |
| Earth altitude, same 43 epochs | same | mean −0.13°, max 0.26°. This is parallax: the table is from the Moon's centre, Moonat from the observer. After removing it: RMS 0.030°, max 0.076° (§1) |
| Earth azimuth, same 43 epochs | same | RMS 0.055°, max 0.12° |
| Terrain skyline, Apollo 15, Hadley Delta (AS15-88-11863), 34° of azimuth, 718 points | photo | **RMS 0.076°**, median 0.03° |
| Terrain skyline, Apollo 15, Mount Hadley (AS15-86-11603), 18° of azimuth, 369 points | photo | **RMS 0.086°** (31 points on rover antennas removed) |
| Terrain skyline, Apollo 16, Stone Mountain (AS16-113-18339), 46° of azimuth, 326 points | photo | **RMS 0.15°**, median 0.03° |
| Terrain skyline, Apollo 11, flat mare (AS11-40-5875), 25° of azimuth, 353 points | photo | RMS 0.048° (weak test: the flat horizon does not fix the heading) |
| Sun azimuth from the flagpole shadow (AS15-88-11863) | photo | −2° to −11° (shadow points read by eye, ground not level; weak) |
| Earth lit fraction (AS17-134-20384) | photo | photo 0.64; Moonat 0.655–0.684 over EVA-1 (−0.02 to −0.05) |

**Verdict.** Where the photos have a clear skyline, Moonat's LOLA horizon has the same shape as the real
mountains to about 0.1° (a tenth of the Earth's diameter in the sky). Moonat's Sun and Earth directions agree with
the published ALSJ table to a few hundredths of a degree. The one larger Earth difference (0.13–0.26°) is real
physics that Moonat includes and the table leaves out. We do **not** claim "100 %". The limits are in §5.

## 1. Sun and Earth vs the ALSJ alt-az table (43 epochs)

- **Reference:** Apollo Lunar Surface Journal, "Sun and Earth altitudes and azimuths" (D. Scotti), file
  `Scotti_AltAz.txt`. Its header says it was derived from the Nautical Almanac lunar ephemeris. Landing and liftoff
  times are from Orloff, "Apollo by the Numbers". EVA times are from Orloff and Harland. Each row gives the UT time,
  the sub-Earth and sub-solar points, and the Earth and Sun altitude and azimuth at the landing site.
- **Moonat:** `moonat.ephem.direct.sky_state` (skyfield + JPL DE421 + MOON_ME, apparent, eye 2 m above the 1737.4 km
  sphere) at the table's own site coordinates and times. The browser reproduces this to 3e-11°
  ([physics.md](physics.md)), so this is also the app's number.
- **Units and frame:** degrees; altitude above the local horizontal plane; azimuth clockwise from selenographic north.

| Moonat − ALSJ (deg) | mean | RMS | max \|d\| |
|---|---|---|---|
| Sun altitude | +0.008 | 0.016 | 0.066 |
| Sun azimuth | +0.012 | 0.064 | 0.409 |
| Earth altitude | −0.130 | 0.143 | 0.261 |
| Earth azimuth | +0.033 | 0.055 | 0.117 |

- **Sun azimuth 0.41°:** this is one row, Apollo 12 "EVA1 end" (table 90.53°, Moonat 90.94°). In the table, the
  azimuths before and after it are 91.03° and 90.60°, so 90.53° breaks the smooth trend. It is very likely a typo in
  the table. The next-largest Sun azimuth difference over the other 42 rows is 0.03°.
- **Earth altitude −0.13° on average:** this is parallax. The table gives the Earth's direction from the Moon's
  centre (from the sub-Earth point). Moonat gives it from the observer on the surface. The two differ by up to
  R_moon / d_earth = 1737 km / 384 400 km = 0.26°, times sin(zenith distance). The Earth is 13–46° from the zenith
  at these sites, so the expected shift is −0.06 to −0.19°, always downward. If we remove this parallax from the
  difference, the Earth altitude agrees to mean −0.014°, RMS 0.030°, max 0.076° (43 rows). The effect is real, and
  Moonat, which computes from the observer's position, is the more exact of the two.
- Example rows: Apollo 11 landing, 1969-07-20 20:17:39 UTC: Sun alt 10.65° / Moonat 10.664°, az 88.81° / 88.808°;
  Earth alt 59.43° / 59.265°, az 272.16° / 272.175°. Apollo 17 landing: Sun alt 13.33° / 13.347°.

## 2. Terrain skyline vs Apollo photos

### Method
- **Photos:** NASA Image and Video Library originals (scans about 4000 × 4000 px, public domain). The Hasselblad
  EL Data Camera used a Zeiss Biogon 60 mm lens, and its reseau plate puts crosses 10 mm apart on the film. The crosses
  measured in AS15-88-11863 and AS15-86-11603 show that a scan is 51.4–51.5 mm wide. That gives a focal length of
  about 4560 px at full resolution and a horizontal field of view of 46.4°. The principal point is the frame centre.
- **Skyline in the photo:** the sky is black and the lit ground is bright. For each image column (at 1/4
  resolution), the skyline is the first row from the top where 4 pixels in a row are brighter than a threshold.
  Columns where an astronaut, the flag or the LM covers the skyline are left out (the ranges are in the script).
- **Moonat skyline:** the catalog horizon `web/data/horizons/<site>.json` (LOLA SLDEM2015 59 m near field, LDEM_64
  and LDEM_16 beyond; eye 2 m; exact curvature, see [terrain.md](terrain.md) §1). This is the same profile the app draws.
- **Camera pointing:** the heading, the pitch and the roll of the hand-held camera are not documented to better than a
  few degrees. So they are fitted: a grid search finds the three angles that best line up the photo skyline with
  Moonat's (trimmed RMS of the elevation difference). The fitted heading is then checked against the direction the
  NASA caption gives. The residual measures how well the **shape** of the skyline agrees: its relief, the slopes of
  the mountains and where the peaks and dips sit along it. With only 3 free angles, a skyline that spans 20–45° of
  azimuth and rises 5–8° cannot be forced to fit.
- **Sensitivity to the focal length:** the fit was repeated with the focal length 3 % shorter and 3 % longer
  (`skyline_rms_if_f_pm3pct_deg` in the JSON). The RMS changes by less than 0.03° on every photo.

### Results

| Photo (NASA) | Site, time (UTC) | Fitted heading / pitch / roll | Documented direction | Points | Skyline RMS | Moonat el range |
|---|---|---|---|---|---|---|
| AS15-88-11863, Scott salutes; Hadley Delta | apollo15, 1971-08-01 ~18:30 (late EVA-2) | 164.4° / −4.9° / +2.5° | "Hadley Delta in the background" (south) | 718 | **0.076°** (median 0.03°, 95 % < 0.12°) | 5.3–13.0° |
| AS15-86-11603, Irwin at the rover; Mount Hadley | apollo15, 1971-07-31 ~14:00 (EVA-1) | 46.8° / −7.7° / +1.2° | "looking northeast, Mount Hadley" | 400 (369 used) | **0.086°** without the 31 rover-antenna points (3.3° with them) | 5.6–11.2° |
| AS16-113-18339, Young's jump salute; Stone Mountain | apollo16, 1972-04-21 ~18:00 (EVA-1) | 163.4° / −2.9° / −0.3° | "Stone Mountain dominates the background" (south) | 326 | **0.15°** (median 0.03°) | 1.8–4.8° |
| AS11-40-5875, Aldrin and the flag | apollo11, 1969-07-21 ~03:30 (EVA) | 156.9° / −3.0° / −1.9° (heading not determined) | flat mare | 353 | 0.048° | 1.0–1.9° |

- Figures (left: the photo with Moonat's horizon drawn in cyan through the fitted camera, red dots are the detected
  skyline; right: elevation vs azimuth):
  `docs/figures/real_vs_moonat_AS15-88-11863.png`, `real_vs_moonat_AS15-86-11603.png`,
  `real_vs_moonat_AS16-113-18339.png`, `real_vs_moonat_AS11-40-5875.png`.
- **Apollo 15, Hadley Delta:** over 34° of azimuth the skyline rises from 5° to 13°, with a 0.5° hump at az 156°. The
  photo and LOLA agree point by point to 0.08° RMS. The largest local difference is −0.3° at az 145–146°, at the
  left edge of the frame, where the skyline is a fainter, more distant ridge.
- **Apollo 15, Mount Hadley:** the summit (11.2°) and the 5.5° descent of the south-east shoulder agree to 0.09° RMS.
  The fitted heading of 46.8° matches the caption "looking northeast".
- **Apollo 16, Stone Mountain:** the steep fall of the right flank from 4.9° to 1.8° (az 174–183°), and the next rise,
  match to 0.15° RMS. The scatter comes from rocks and shadows on the dark flank, not from a systematic offset.
- **Apollo 11:** the photo skyline is flat to within 1° across the frame, as Moonat's is (1.0–1.9°, the regional
  0.9° slope noted in terrain.md §6). A flat skyline does not fix the heading, so this is only a consistency check.
- **Fitted pitch:** −3° to −8° on all four photos, which is plausible for a camera fixed to the chest of a suit and
  pointed slightly down.
- **Eye height:** Moonat's horizon is for an eye 2 m above the ground. The Hasselblad was about 1.5 m up. For
  mountains 5–20 km away, 0.5 m changes the elevation by 0.5 m / 5 km = 0.006°, which is negligible.
- **Photographer position:** the photos were taken some tens of metres from the LM, and the horizon file is for the
  LM. At 5–20 km that moves the azimuth by less than 0.5°, and the heading fit absorbs it.

## 3. Sun azimuth from a shadow (AS15-88-11863)
- **Method:** with the camera fitted in §2, the flagpole base and two points on its shadow are projected onto a level
  ground plane. The camera height cancels out of the direction. Sun azimuth = shadow azimuth + 180°.
- **Result:** the two shadow points give a Sun azimuth of 96.0° and 105.3°. Moonat gives 107.4° (elevation 31.8°) at
  18:30 UTC; ±0.5 h moves this by ±0.3°. The differences are −11.4° and −2.1°.
- **Verdict: weak.** The points were read by eye, and the near one is in the wide shadow of the flag cloth, not of the
  pole. The ground between the flag and the LM is not level. The far point, on the clean pole shadow, agrees to 2°.
  The ALSJ table in §1 is the better test of the Sun.

## 4. Earth phase and size (AS17-134-20384)
- **Photo:** the lit part of the Earth is thresholded in a crop of the full scan. Its long axis (cusp to cusp) is the
  full diameter, 171 px. Its extent along the Sun axis, 110 px, is the lit width. Lit fraction k = 110 / 171 = **0.64**.
- **Moonat:** at Taurus-Littrow, k = 0.684 at the start of EVA-1 (1972-12-11 23:55 UTC), 0.669 mid-EVA and 0.655 at its
  end (1972-12-12 07:07). The flag photos were taken during EVA-1, and the exact frame time is not in our sources.
  The photo is 0.02–0.05 lower. The dim band at the terminator falls below the threshold, so a threshold always
  measures the lit part too small. The direction and size of the difference are as expected.
- **Size:** the photo gives 2.03° (171 px through the same 60 mm lens and 51.5 mm scan width; this frame's reseau was
  not measured). Moonat gives 1.89°. The 7 % difference is within the scan-scale uncertainty (±3 %) plus the
  blooming of an overexposed disk. This is not a precision test.
- Figure: `docs/figures/real_vs_moonat_AS17-134-20384_earth.png`. The Earth's altitude and azimuth cannot be measured
  from this frame because no horizon is visible in it. The ALSJ table in §1 tests them instead: 45.3° / 240.7° at the
  start of EVA-1, Moonat within 0.26°.

## 5. What we can and cannot claim
- **We can claim:**
  - Moonat's Sun direction agrees with an independent, published Apollo-era table to ≤ 0.07° in altitude (43 epochs).
  - Moonat's Earth direction agrees with it to ≤ 0.26°. After removing the parallax that Moonat includes and the
    table leaves out, it agrees to ≤ 0.08° in altitude and ≤ 0.12° in azimuth.
  - Moonat's terrain skyline has the same shape as real Apollo photos of Hadley Delta, Mount Hadley and Stone Mountain,
    to 0.08–0.15° RMS. The camera's 3 pointing angles are fitted, and the fitted headings agree with the captions.
- **We cannot claim:**
  - Absolute skyline elevations from these photos. The camera pitch is fitted, so a constant offset in elevation
    over the whole frame would be absorbed. The terrain georeferencing checks in [terrain.md](terrain.md) §3–4 cover
    that separately.
  - Agreement better than about 0.05° in the skyline. A scan pixel at 1/4 resolution is 0.05°. LOLA SLDEM2015 is
    59 m per pixel, which is 0.7° of azimuth at 5 km. The residuals are below one DEM cell at that distance.
  - Anything about lens distortion. The Biogon is nearly free of distortion, and we did not model it. The edges of
    the frame would carry it first.
  - A precise Sun azimuth from the shadow (§3), or a precise Earth phase or size from one overexposed frame (§4).
  - The 3D foreground terrain (the near-field patch of the sky view). These photos show the ground within ~50 m. Its
    small craters and rocks are below the 59 m DEM resolution. The app's foreground is a smooth LOLA surface
    by design, and real boulders, footprints and craters smaller than ~100 m will never match it.
- **Not done in this pass (time):**
  - A side-by-side render of the app's own sky view at the fitted camera. See §6: the page did not apply the
    link's camera, so the render looked in the wrong direction and was dropped. The figures show Moonat's horizon
    data, the same file the app draws, on the photos instead.
  - Apollo 17 valley walls (South and North Massif) and a Surveyor Earth photo.

## 6. Terrain and view issues found (for Shay and the QA agent)
1. **Share-link camera not applied (web app, not physics).** We opened
   `#tab=sky&v=164.42,-4.94,60&s=<Apollo 15 scenario>` in Edge with Playwright, on `main` at 4afc3a6, with and
   without an explicit end time.
   - The page rewrote the hash without `v=` within 2 s.
   - The sky view aimed at its default target: it centred the Earth at az ~205°, not az 164°.
   - After a drag on the sky canvas and a settings change, the link the page writes still had no `v=`.
     `skyShareState` (`web/js/app/sky_panel.js`, line 74) returns the queued start (`pendingStart`) while it is set.
     So it looks as if the queued start is never taken by `setSkyItems` in this flow, and the link's camera is
     never applied.

   This cause is **not confirmed**. The code is in the QA agent's files, so we did not fix it here. Effect: a shared
   link does not restore the view direction, and a link copied after turning the view does not hold the new
   direction. Sun, Earth and terrain are not affected. For the same reason the figures have no column with the
   app's own render: we steered the view with drags, but we could not read its camera back to check the framing.
2. **No horizon error found at the three mountain skylines.** The residuals are 0.08–0.15° RMS. There is no seam, no
   missing ridge and no height-scale error at Hadley Delta, Mount Hadley or Stone Mountain. A height scale wrong by
   5 % would change the 8° rise of the Hadley Delta skyline (5° to 13°) by 0.4°. The pitch fit cannot absorb that,
   and the residual is 0.08°.
3. The near-field 3D patch vs the far horizon, the coarse fallback horizon and artifacts at the poles were **not**
   checked against photos here, because no well-documented polar surface photo exists. The live-terrain checks are in
   [terrain-everywhere.md](terrain-everywhere.md).

## 7. Sources and credits
- Photos: NASA, Apollo 11, 15, 16 and 17 crews (photographers in `real_photos.json`), from the NASA Image and Video
  Library (images.nasa.gov), public domain. Files are in `data/raw/photos/` (not committed). Download: the
  `nasa_id` search of `https://images-api.nasa.gov/search?nasa_id=<ID>`, the `~orig.jpg` asset.
- Sun and Earth table: ALSJ, `https://www.nasa.gov/wp-content/uploads/static/history/alsj/Scotti_AltAz.txt`.
- EVA times for the photos: the same ALSJ table (EVA start and end). Each photo's time inside its EVA is an
  estimate from its NASA caption (±0.5–3.6 h, listed in the JSON). Only the Sun and Earth checks depend on it
  (0.5° per hour for the Sun, < 0.01 per hour for the Earth phase). The skyline does not depend on the time.
