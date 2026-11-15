# References

Required for the submission's References field: **every** dataset, library, code snippet, text, image and tool we use,
even if free. **Agents append here in the same PR that introduces the dependency or asset.** One line each:
`- <name> — <what we used it for> — <URL> — <licence>`.

## NASA / space agency data
Challenge Resources tab (published 2026-11-13): Quickmap, Moon Trek, JPL Horizons, CSA Moon Exploration. We use the ones marked ★.
- ★ JPL Horizons System (NASA/JPL) — reference positions of the Sun and Earth from lunar surface sites; validation of our ephemeris — https://ssd.jpl.nasa.gov/horizons/ — public
- ★ Moon Trek (NASA) — LRO WAC map tiles stitched into the base texture of the Moon globe site picker — https://trek.nasa.gov/moon/ — public
- LROC Quickmap (ASU / NASA LRO) — cross-checking landing-site coordinates and terrain — https://quickmap.lroc.asu.edu/ — public
- JPL Horizons API (NASA/JPL) — cached topocentric lunar-site tables used as test fixtures (tests/fixtures/horizons/) — https://ssd-api.jpl.nasa.gov/doc/horizons.html — public
- JPL Horizons API (NASA/JPL), observer and vector tables (geometric, LT, LT+S) — independent cross-check of the browser physics, cached in tests/fixtures/horizons_cache/ (docs/validation/independent_check.md) — https://ssd-api.jpl.nasa.gov/doc/horizons.html — public
- JPL DE421 planetary ephemeris `de421.bsp` (NASA/JPL, via NAIF) — positions of the Sun, Earth, Moon and planets — https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/a_old_versions/de421.bsp — public
- Lunar orientation kernel `moon_pa_de421_1900-2050.bpc` (NASA/JPL NAIF) — lunar principal-axes orientation (physical libration) — https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de421_1900-2050.bpc — public
- Lunar frame kernel `moon_080317.tf` (NASA/JPL NAIF) — MOON_ME_DE421 = PA + fixed rotation — https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_080317.tf — public
- Planetary constants `pck00008.tpc` (NASA/JPL NAIF) — lunar reference radius check (1737.4 km) — https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/a_old_versions/pck00008.tpc — public

## Software libraries
- skyfield (Brandon Rhodes) — ephemeris, light-time, aberration, lunar frames — https://rhodesmill.org/skyfield/ — MIT
- NumPy — array maths for geometry, tables and interpolation — https://numpy.org/ — BSD-3-Clause
- Matplotlib — validation figures — https://matplotlib.org/ — Matplotlib licence (PSF-based)

### Web app (agent `web-app`)
- Plotly.js (plotly.js-dist-min 2.35.2) — Sun and Earth time-series charts, loaded from jsDelivr — https://plotly.com/javascript/ — MIT
- three.js 0.160.0 — 3D sky view and the Moon globe site picker (import map shared with the sky viewer), loaded from jsDelivr — https://threejs.org — MIT
- jsDelivr CDN — serves the pinned library versions above — https://www.jsdelivr.com — free public CDN
- Paul Tol, "Colour schemes" (SRON technical note, 2021), qualitative scheme "bright" — hues of the six scenario colours, stepped per theme and checked with the palette validator of the Claude Code "dataviz" skill (all pairs, colour-vision deficiency, contrast) — https://personal.sron.nl/~pault/ — free to use
- GitHub Pages and GitHub Actions (configure-pages v5, upload-pages-artifact v3, deploy-pages v4) — hosting the public site — https://pages.github.com — GitHub terms

## Code, algorithms and papers
- Williams, Boggs & Folkner (2008), "DE421 Lunar Orbit, Physical Librations, and Surface Coordinates", JPL IOM 335-JW,DB,WF-20080314-001 — definition of the MOON_ME_DE421 frame — https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/a_old_versions/de421_lunar_ephemeris_and_orientation.pdf — public
- IERS Conventions (2010), Technical Note 36, eq. 5.15 — Earth Rotation Angle formula (`era_deg`, Python and browser) — https://www.iers.org/IERS/EN/Publications/TechnicalNotes/tn36.html — public
- USNO `tai-utc.dat` — official TAI−UTC "rubber second" formulas for 1966–1971 (pre-1972 UTC) — https://maia.usno.navy.mil/ser7/tai-utc.dat — public
- Vogel, H. (1979), "A better way to construct the sunflower head", Math. Biosci. 44, 179–189 (golden-angle point pattern) — even sampling of the Sun and Earth disks for the visible fraction — https://doi.org/10.1016/0025-5564(79)90080-4 — method only
- Linear solar limb-darkening law I(μ) = 1 − u(1 − μ), u ≈ 0.6 in the visible (e.g. Cox, Allen's Astrophysical Quantities, 4th ed., §14.7) — flux fraction of a partly hidden Sun — method only
- IAU 2015 Resolution B3 (total solar irradiance 1361 W/m², nominal solar radius 695 700 km, Earth equatorial radius 6 378.137 km) — solar flux and the angular sizes of the Sun and the Earth — https://www.iau.org/static/resolutions/IAU2015_English.pdf — public
- Snyder, J. P. (1987), "Map Projections — A Working Manual", USGS Professional Paper 1395, polar stereographic projection (sphere) — the polar caps of the globe picker (scripts/data/build_moonmap.py, web/js/globe/) — https://doi.org/10.3133/pp1395 — public
- Horn, B. K. P. (1981), "Hill shading and the reflectance map", Proc. IEEE 69(1), 14–47 — Lambertian hillshade of the LOLA polar caps — https://doi.org/10.1109/PROC.1981.11918 — method only

### Eclipse seen from the Moon (agent `eclipse`)
- Espenak, F. (NASA GSFC), "Total Lunar Eclipse of 2025 Mar 14" — contact times P1…P4, umbral magnitude, ΔT, Danjon rule; validation of the eclipse computation — https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE2025Mar14T.pdf — public (NASA)
- Espenak, F. (NASA GSFC), "Total Lunar Eclipse of 1967 Apr 24" — the same for 1967 — https://eclipse.gsfc.nasa.gov/LEplot/LEplot1951/LE1967Apr24T.pdf — public (NASA)
- Espenak, F. & Meeus, J., Five Millennium Canon of Lunar Eclipses, "Enlargement of Earth's shadows" (Danjon's 1.01 = 1 + 1/85 − 1/594 versus Chauvenet's 1/50) — shadow-radius formulas used in `moon_shadow_contacts` — https://eclipse.gsfc.nasa.gov/LEcat5/shadow.html — public (NASA)
- NASA APOD 2025 March 19, "Blue Ghost's Diamond Ring" (image: Firefly Aerospace) — the diamond-ring time used as a check (~3:30 a.m. CDT, 14 March 2025) — https://science.nasa.gov/image-article/apod-2025-march-19-blue-ghost-s-diamond-ring/ — cited only (image not used)
- NSSDCA, Surveyor 3 (1967-035A) — "images of an eclipse of the Sun by the Earth" — https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1967-035A — public (NASA)
- JPL photo P-6586, Surveyor III eclipse picture caption ("3:24 a.m. PST", 24 April 1967) — check of our totality at Surveyor 3 — https://flic.kr/photos/apollo4ever/54066543071 — cited only (image not used)
- Shoemaker, E. M. et al. (1968), "Television observations from Surveyor 3", J. Geophys. Res. 73, 3989 — the refraction halo and bright beads around the Earth in Surveyor 3's eclipse pictures (motivates the red ring in the sky view) — https://doi.org/10.1029/JB073i012p03989 — paper (cited only)
- Gauss–Legendre quadrature (Newton iteration on Legendre polynomials; e.g. Press et al., Numerical Recipes, §4.6) — the ring integral of the eclipsed solar flux — method only

### Suggested dates (agent `suggest`)
- Espenak, F. (NASA GSFC), "Decade Tables of Lunar Eclipses: 2021 to 2030" — the 14 lunar eclipses of 2025–2030 (greatest eclipse, type, umbral magnitude) against which the eclipse search is validated (docs/validation/suggest.md) — https://eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html — public (NASA)
- Cassini's laws of lunar rotation (lunar equator inclined 1.54° to the ecliptic, common node line) — explanation of the polar seasons and the 346.6-day eclipse year in docs/validation/suggest.md — https://en.wikipedia.org/wiki/Cassini%27s_laws — CC BY-SA 4.0 (cited only)

## Images, textures and other media
- LRO WAC global mosaic 303 ppd v02 (NASA/GSFC/Arizona State University), via the NASA Moon Trek WMTS, 128 tiles at zoom 3 stitched to 4096 x 2048 px (plus a 1024 x 512 preview) — base texture of the Moon globe site picker (web/data/moonmap/wac_global*.jpg) — https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/WMTSCapabilities.xml — public (NASA)
- LOLA LDEM_16 and LDEM_75S_240M (NASA LRO LOLA, PDS) rendered as hillshade — polar-cap textures of the globe (web/data/moonmap/cap_*.jpg; 1.3 km/px caps to 68°, a 193 m/px south cap poleward of 83.5° S) — https://pds-geosciences.wustl.edu/missions/lro/lola.htm — public (NASA PDS)
- Link-preview image web/assets/og.png (1200 x 630) — a browser render of Moonat's own sky view (the 14 March 2025 eclipse from Blue Ghost; LOLA terrain, JPL DE421, NASA Blue Marble and City Lights textures as listed above) with a title band, made by scripts/make_social_images.py; not generative imagery — https://shmonat.github.io/Moonat-Navigator/ — project asset
- Favicon web/assets/favicon.svg and home-screen icon web/assets/apple-touch-icon.png — the Moonat crescent logo, written as SVG for this project — project asset
- National flags of the nations that flew the missions — the flag inside each mission marker on the globe and next to mission names in "Search the Moon" and the place card (web/js/app/flags.js). Third-party artwork, vendored **unaltered** (byte-identical copies, SHA-256 checked by web/tests/app_flags.test.mjs, downloaded 2026-11-15) and sized only with CSS at its own aspect ratio; not AI-generated, not redrawn:
  - flag-icons 7.6.0 by Panayiotis Lipiridis (lipis), 4x3 set: web/assets/flags/us.svg (United States), cn.svg (China), in.svg (India), jp.svg (Japan), il.svg (Israel) — https://github.com/lipis/flag-icons , files from https://cdn.jsdelivr.net/npm/flag-icons@7.6.0/flags/4x3/ — MIT (licence copied to web/assets/flags/LICENSE-flag-icons.txt)
  - "Flag of the Soviet Union.svg", Wikimedia Commons: web/assets/flags/su.svg (flag-icons has no Soviet flag) — https://commons.wikimedia.org/wiki/File:Flag_of_the_Soviet_Union.svg (file https://upload.wikimedia.org/wikipedia/commons/a/a9/Flag_of_the_Soviet_Union.svg) — public domain

## Tools
- Claude Code (Anthropic) — AI coding agent used to write the code and docs — https://claude.com/claude-code — see docs/AI_USE.md
- Playwright for Python (Microsoft) with the installed Microsoft Edge — scripted app screenshots in docs/figures/app_*.png and docs/figures/globe_*.png, the live-terrain browser check scripts/check_terrain_live.py (docs/figures/terrain_live_*.png), and the demo video recorder scripts/video/record_demo.py (dev dependency) — https://playwright.dev/python/ — Apache-2.0
- imageio-ffmpeg — bundled FFmpeg binary used to encode the demo video — https://github.com/imageio/imageio-ffmpeg — BSD-2-Clause (the bundled FFmpeg build with libx264 is GPL)
- FFmpeg with libx264 — H.264 encoding of the demo video (outputs/video/, via imageio-ffmpeg) — https://ffmpeg.org/ , https://www.videolan.org/developers/x264.html — LGPL/GPL

### Catalog (agent `catalog`)
- Apollo Lunar Surface Journal (NASA) — Apollo landing and liftoff times — https://www.hq.nasa.gov/alsj/ — public
- NSSDCA Lunar landing sites (NASA) — Luna/Surveyor mission data — https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_landing_sites.html — public
- Wikipedia, List of artificial objects on the Moon (LROC-sourced coordinates) — lander coordinates cross-check — https://en.wikipedia.org/wiki/List_of_artificial_objects_on_the_Moon — CC BY-SA 4.0
- Wikipedia mission and crater articles — coordinates, dates — https://en.wikipedia.org/ — CC BY-SA 4.0
- NASA, candidate landing regions announced in October 2024 (news release "NASA Provides Update on Artemis III Moon Landing Regions") — candidate names, shown in the app as "Potential Artemis sites" — https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/ — public
- Mazarico et al. 2011, Icarus 211, "Illumination conditions of the lunar polar regions using LOLA topography" — Shackleton connecting-ridge POI — https://doi.org/10.1016/j.icarus.2011.03.025 — paper (cited only)
- Monat, S. (2021), StarHab lunar base concept, 72nd International Astronautical Congress (IAC 2021, Dubai) — the app's home base (catalog site `starhab`, the globe's Home entry and button; its site is a placeholder until set) — IAC 2021 proceedings (no link here) — paper by a team member (cited only)
- Yale Bright Star Catalogue, 5th rev. ed. (Hoffleit & Warren 1991; CDS V/50, copy at Harvard TDC) — stars.json (vmag <= 6) — http://tdc-www.harvard.edu/catalogs/bsc5.html — public data
- d3-celestial (Olaf Frohn) — constellation lines and names — https://github.com/ofrohn/d3-celestial — BSD-3-Clause
- NASA Visible Earth, Blue Marble: Land Surface, Shallow Water, and Shaded Topography (id 57752, NASA Earth Observatory / R. Stockli) — earth_daymap.jpg, downsampled to 2048x1024 — https://visibleearth.nasa.gov/images/57752/ — public domain (NASA)
- NASA Visible Earth, Earth's City Lights (id 55167, NASA Earth Observatory) — earth_night.jpg (1280x640 as downloaded) — https://visibleearth.nasa.gov/images/55167/ — public domain (NASA)
- NASA Solar System Treks, Moon Trek WMTS, LRO WAC global mosaic 303 ppd (NASA/GSFC/ASU) — map tiles URL in web/data/maptiles.json — https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/WMTSCapabilities.xml — public
- Pillow — resizing the Earth texture (run with `uv run --with pillow`, not a project dependency) — https://python-pillow.org — HPND

### Terrain (agent `terrain`)
- LOLA Gridded Data Records, polar stereographic DEMs LDEM_80S_20M, LDEM_75S_30M, LDEM_60S_60M, LDEM_75S_240M (LRO-L-LOLA-4-GDR-V1.0; Smith et al., NASA GSFC) — near- and mid-field terrain for south-polar horizons and 3D patches (byte-range windows) — https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ — public (NASA PDS)
- LOLA Gridded Data Records, simple cylindrical LDEM_16 and LDEM_64 — far-field terrain for every horizon — https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ — public (NASA PDS)
- SLDEM2015 (LOLA + SELENE Terrain Camera, 512 px/deg; Barker et al. 2016, Icarus 273, 346-355, doi:10.1016/j.icarus.2015.07.039) — near-field terrain within +-60 deg latitude — https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/tiles/float_img/ — public (NASA PDS)
- LOLA PDS map-projection catalog files DSMAP.CAT / DSMAP_POLAR.CAT — exact projection equations for the DEM readers — https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/catalog/ — public
- Zuber et al. 2012, Nature 486, 378, "Constraints on the volatile distribution within Shackleton crater" — Shackleton centre and floor depth, used to verify DEM georeferencing — https://doi.org/10.1038/nature11216 — paper (cited only)
- Gläser et al. 2014, Icarus 243, 78-90, "Illumination conditions at the lunar south pole using high resolution DTMs from LOLA" (and EPSC2014-136-1) — connecting-ridge reference points for validation — https://doi.org/10.1016/j.icarus.2014.08.013 — paper (cited only)
- Barker et al. 2021, Planet. Space Sci. 196, 105119, "Improved LOLA elevation maps for south pole landing sites" — published horizon profiles at connecting-ridge sites, used for validation — https://ntrs.nasa.gov/citations/20205009660 — paper (cited only)
- Wagner et al. 2017, Icarus 283, 92-103 (LROC landing-site coordinates and elevations) — Apollo 11 ground elevation check (-1926 m) — https://doi.org/10.1016/j.icarus.2016.05.011 — paper (cited only)
- Bussey et al. 2010, Icarus 208, 558-564, "Illumination conditions of the south pole of the Moon derived using Kaguya topography" — Malapert M1/M2 illumination (74 %) for comparison with our site search — https://doi.org/10.1016/j.icarus.2010.03.028 — paper (cited only)
- LROC NAC low-Sun controlled mosaics of the Artemis III candidate regions (ASU / NASA LRO; NAC_ROI_CABEUSPKLOA, HAWORTH_LOA, MALAPERTLOA, MOUTNPLTLO1, MTMOUTONLOB, NOBILE02LOA, DEGERRIMLO1) — region centres for the polar site search — https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_ROI_CABEUSPKLOA — public (NASA)

### Terrain for any point (agent `terrain-everywhere`)
- ★ NASA Solar System Treks, Moon Trek ArcGIS ImageServer `exportImage` (NASA/JPL-Caltech) — on-demand LOLA elevation grids (float32, LERC) for any clicked point: layers `ldem_85s_20m_Spole_float_SP` (LOLA 20 m, 85–90°S), `LRO_LOLA_DEM_SPole75_30mp_v04` / `LRO_LOLA_DEM_NPole75_30mp_v04` (LOLA 30 m polar), `LRO_LOLA_DEM_Global_256ppd_v06` (LOLA 118 m global), `LRO_LOLA_DEM_Global_128ppd_v04` (LDEM_128) — https://trek.nasa.gov/moon/trekarcgis/rest/services — public (NASA; no published API terms, credited and used at 2–3 requests per point)
- Moon Trek service catalogue and configuration (TrekServices index, `jpl/config/config.json`) — finding the DEM layers and the 3D terrain endpoint — https://trek.nasa.gov/moon/TrekServices/ws/index/eq/searchItems — public
- Moon Trek 3D terrain, Cesium quantized-mesh-1.0 tiles (evaluated, not used: simplified TIN) — https://marshub.s3.amazonaws.com/moon_v14/layer.json — public
- USGS Astrogeology map mosaics on AWS (`planetarymaps.usgs.gov` / `asc-pds-services`): LOLA LDEM 118 m global BigTIFF and the LMAP south-pole 5 m COG `ldem_87s_5mpp_cog.tif` (evaluated as static alternatives, not used) — https://planetarymaps.usgs.gov/mosaic/ — public (USGS / NASA)
- Esri LERC (Limited Error Raster Compression) version 1 format description — our decoder web/js/terrain/lerc1.js is written from it — https://github.com/Esri/lerc — Apache-2.0
- ★ NASA Moon Trek in the live app — every custom point (map click, typed coordinates, shared link) fetches its LOLA horizon and 3D ground from the Moon Trek ImageServer at run time (web/js/app/terrain_live.js); credited in the page footer, the About panel and each point's status line — https://trek.nasa.gov/moon/ — public (NASA)

### Additional entries (docs completeness check, 2026-11-14)
- Smith et al. 2010, Space Sci. Rev. 150, 209-241, "The Lunar Orbiter Laser Altimeter investigation on the Lunar Reconnaissance Orbiter mission" — the LOLA instrument behind every terrain product above — https://doi.org/10.1007/s11214-009-9512-y — paper (cited only)
- pytest and Ruff (dev dependencies in pyproject.toml) — Python tests, lint and format — https://docs.pytest.org/ and https://docs.astral.sh/ruff/ — MIT
- uv (Astral) — Python environment and dependency management — https://docs.astral.sh/uv/ — MIT or Apache-2.0
- Node.js built-in test runner (`node --test`) — JavaScript tests in web/tests/, no npm packages — https://nodejs.org/api/test.html — MIT
- Fonts and icons: the app uses system fonts only, and its icons are inline SVG written for this project (web/js/app/icons.js). No web fonts, icon packs or stock images.
- Video tooling: the demo video is assembled from scripted captures of the live app. If a tool such as imageio-ffmpeg is added for it, the `video` work item lists it here.

### Rover traverse planner (agent `rover`)
- ★ NASA Moon Trek ArcGIS ImageServer `exportImage` (NASA/JPL-Caltech) — one LOLA elevation grid per planned route (20 m, 30 m or 118 m layers, up to 1001² px in a stereographic plane around both end points) plus a coarser mid-field grid, fetched live when a traverse is planned (web/js/rover/terrain.js) — https://trek.nasa.gov/moon/trekarcgis/rest/services — public (NASA)
- NASA, "VIPER: Lunar Operations" — VIPER-class preset: drive speed "about 10 to 20 centimeters per second", slopes up to 15° (25–30° only when necessary), must stay in view of Earth while roving, ≤ 50 h of darkness — https://science.nasa.gov/mission/viper/lunar-operations/ — public (NASA)
- Fong, T. (NASA Ames), "Volatiles Investigating Polar Exploration Rover", robotics seminar, 2026, NTRS 20260002876 — VIPER top speed 20 cm/s, nominal 10 cm/s, 15° slopes as the design limit, 0.8 cm/s speed made good with stops — https://ntrs.nasa.gov/citations/20260002876 — public (NASA)
- Jacob, S. R. et al. (NASA JSC), "Apollo Lunar Roving Vehicle as-traversed performance metrics: preparing for Artemis mobile vehicle traverse planning", LPSC 57 (2026), NTRS 20250011301 — Apollo LRV preset: theoretical 9–13 km/h (2.5–3.6 m/s), designed for 20–23° slopes ("favorable conditions", max 25°); Apollo 15/16 speed made good 2.0 / 1.7 m/s mean, 2.6 / 2.5 m/s best leg — https://ntrs.nasa.gov/citations/20250011301 — public (NASA)
- Hart, P. E., Nilsson, N. J. & Raphael, B. (1968), "A formal basis for the heuristic determination of minimum cost paths", IEEE Trans. SSC 4(2), 100–107 — A* search used by the path planner (web/js/rover/planner.js) — https://doi.org/10.1109/TSSC.1968.300136 — method only
- Horn, B. K. P. (1981), "Hill shading and the reflectance map" (3 × 3 gradient) — terrain slope of each cell and the hillshade of the route preview — https://doi.org/10.1109/PROC.1981.11918 — method only
- Gläser, P. et al. (2014), "Illumination conditions at the lunar south pole using high resolution Digital Terrain Models from LOLA", Icarus 243, 78–90 — the Shackleton rim / connecting-ridge end point of the rover quick start (the catalog's `shackleton_rim`) — https://doi.org/10.1016/j.icarus.2014.08.013 — paper (cited only)

### StarHab site study (agent `starhab-site`)
- Monat, S. (2021), StarHab lunar-base concept (a horizontally placed, regolith-buried Starship HLS), 72nd International Astronautical Congress (IAC 2021) — the base whose site docs/research/starhab_site.md chooses — team lead's own work — cited only
- ★ NASA PGDA "Lunar polar illumination and Earth visibility" maps (Mazarico et al.; LOLA team, product 201608): `AVGVISIB_85S_060M_201608` (Sun) and `AVGVISIB_85S_060M_201608_EARTH` (Earth), 60 m, 18.6 yr hourly — validation of our Sun and Earth visibility and the distance from each site to NASA's permanently shadowed pixels (byte-range windows, about 10.5 MB in total, logged in the shared DEM download budget) — https://pgda.gsfc.nasa.gov/products/69 (files at http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/) — public (NASA)
- Mazarico, E. et al. (2011), "Illumination conditions of the lunar polar regions using LOLA topography", Icarus 211, 1066–1081 — method of the PGDA maps; Shackleton-rim continuous light and permanently shadowed areas — https://doi.org/10.1016/j.icarus.2010.10.030 — paper (cited only)
- Gläser, P. et al. (2014), EPSC2014-136-1, "Illumination conditions at the lunar south pole using high resolution DTMs from LOLA" — published average illumination, time in light and longest darkness of connecting-ridge spots 1–4 at 2 m and 10 m (our literature check) — https://meetingorganizer.copernicus.org/EPSC2014/EPSC2014-136-1.pdf — abstract (cited only)
- Gläser, P. et al. (2018), "Illumination conditions at the lunar poles: Implications for future exploration", Planet. Space Sci. 162, 170–178 — best south- and north-polar illumination (north pole footnote) — https://doi.org/10.1016/j.pss.2017.07.006 — paper (cited only)
- De Rosa, D. et al. (2012), "Characterisation of potential landing sites for the European Space Agency's Lunar Lander project", Planet. Space Sci. 74, 224–246 — region-of-interest coordinates (CR1, SR1, SR2, SV1, GR1, MP1/2, LP1) and DTE-window behaviour near 85° S — https://arxiv.org/abs/1208.5587 — paper (cited only)
- Colaprete, A. et al. (2010), "Detection of water in the LCROSS ejecta plume", Science 330, 463–468 — water ice in south-polar permanent shadow (why the south pole) — https://doi.org/10.1126/science.1186986 — paper (cited only)
- Hayne, P. O. et al. (2021), "Micro cold traps on the Moon", Nature Astronomy 5, 169–175 — small permanently shadowed cold traps next to lit sites — https://doi.org/10.1038/s41550-020-1198-9 — paper (cited only)

### Beresheet crash site (agent `beresheet`)
- M. Robinson (LROC / ASU, 15 May 2019), "Beresheet Impact Site Spotted" — the crash point 32.5956° N, 19.3496° E (darkest pixel of the impact smudge, 95 % confidence 20 m × 8 m), catalog site `beresheet` — https://www.lroc.asu.edu/images/1101 — public (NASA LRO / ASU)
- J. Davis, The Planetary Society, "Beresheet Comes Close before Crashing on the Moon" (11 Apr 2019) — loss of signal about 19:23 UTC after an IMU reset and a main-engine shutdown; last telemetry 149 m altitude, 134 m/s down, 947 m/s across — https://www.planetary.org/articles/beresheet-comes-close-crashes — cited only
- Arch Mission Foundation, "The Lunar Library: Genesis" — the Lunar Library on board Beresheet — https://www.archmission.org/spaceil — cited only
- P. S. Anderson, EarthSky (14 Aug 2019), "Did these tardigrades survive crash-landing on the moon?" — the Lunar Library carried thousands of dehydrated tardigrades — https://earthsky.org/human-world/tardigrades-lunar-library-beresheet-spacecraft-crash-moon — cited only
- Traspas, A. & Burchell, M. J. (2021), "Tardigrade survival limits in high-speed impacts: implications for panspermia and collection of samples from plumes emitted by ice worlds", Astrobiology 21(7), 845–852 — tardigrades survive impacts up to about 0.9 km/s (1.14 GPa) but not above; the study was prompted by Beresheet, whose tardigrades the authors say probably did not survive (Science News, 2021: https://www.sciencenews.org/article/tardigrade-survival-shot-gun-crash-landing-planet) — https://doi.org/10.1089/ast.2020.2405 — paper (cited only)
- Wikipedia, Beresheet — mission overview (SpaceIL and Israel Aerospace Industries) — https://en.wikipedia.org/wiki/Beresheet — CC BY-SA 4.0
- The terrain of the crash site is LOLA+SELENE SLDEM2015 (Barker et al. 2016) with LOLA LDEM_64 and LDEM_16, as for the other catalog sites (see Terrain above).

### Globe map layers: permanent shadow and most sunlit ground (agent `map-layers`)
- ★ NASA GSFC Planetary Geodesy Data Archive (PGDA) product 69, "Lunar polar illumination" (LRO LOLA team, release 201608): `LPSR_65S_240M_201608`, `LPSR_65N_240M_201608`, `LPSR_85S_060M_201608` (permanently shadowed regions) and `AVGVISIB_65S_240M_201608`, `AVGVISIB_65N_240M_201608`, `AVGVISIB_85S_060M_201608` (share of time lit) — the globe's "Permanently shadowed regions" and "Most sunlit" layers (pole-centred crops read by HTTP byte ranges, web/data/overlays/, scripts/data/build_map_layers.py) — https://pgda.gsfc.nasa.gov/products/69 (files at http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/) — public (NASA)
- Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T. & Torrence, M. H. (2011), "Illumination conditions of the lunar polar regions using LOLA topography", Icarus 211, 1066–1081 — method of the PGDA maps, cited on the layers panel; its permanently shadowed areas poleward of 80° (12 866 km² north, 16 055 km² south) are the sanity check in docs/validation/map_layers.md — https://doi.org/10.1016/j.icarus.2010.10.030 — paper (cited only)
- Gläser, P. et al. (2014), "Illumination conditions at the lunar south pole using high resolution Digital Terrain Models from LOLA", Icarus 243, 78–90 — best connecting-ridge points lit about 92–96 % of the time 2–10 m above the ground, quoted in the layer metadata to show that no ground is lit all the time — https://doi.org/10.1016/j.icarus.2014.08.013 — paper (cited only)
- Barker, M. K. et al. (2023), "A new view of the lunar south pole from the Lunar Orbiter Laser Altimeter (LOLA)", Planet. Sci. J. 4(9) — permanently shadowed regions smaller than 1 km² hold 15 ± 5 % of the PSR area poleward of 80° S (why finer maps find more PSR area) — https://doi.org/10.3847/PSJ/acf3e1 — paper (cited only)
- IAU / USGS Gazetteer of Planetary Nomenclature — centres of Shackleton, Haworth and Shoemaker craters for the layer sanity check — https://planetarynames.wr.usgs.gov/ — public
