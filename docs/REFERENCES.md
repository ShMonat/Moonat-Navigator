# References

Required for the submission's References field: **every** dataset, library, code snippet, text, image and tool we use,
even if free. **Agents append here in the same PR that introduces the dependency or asset.** One line each:
`- <name> — <what we used it for> — <URL> — <licence>`.

## NASA / space agency data
Challenge Resources tab (published 2026-11-13): Quickmap, Moon Trek, JPL Horizons, CSA Moon Exploration. We use the ones marked ★.
- ★ JPL Horizons System (NASA/JPL) — reference positions of the Sun and Earth from lunar surface sites; validation of our ephemeris — https://ssd.jpl.nasa.gov/horizons/ — public
- ★ Moon Trek (NASA) — lunar map tiles (LRO imagery) for the site-picker map — https://trek.nasa.gov/moon/ — public
- LROC Quickmap (ASU / NASA LRO) — cross-checking landing-site coordinates and terrain — https://quickmap.lroc.asu.edu/ — public
- JPL Horizons API (NASA/JPL) — cached topocentric lunar-site tables used as test fixtures (tests/fixtures/horizons/) — https://ssd-api.jpl.nasa.gov/doc/horizons.html — public
- JPL DE421 planetary ephemeris `de421.bsp` (NASA/JPL, via NAIF) — positions of the Sun, Earth, Moon and planets — https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/a_old_versions/de421.bsp — public
- Lunar orientation kernel `moon_pa_de421_1900-2050.bpc` (NASA/JPL NAIF) — lunar principal-axes orientation (physical libration) — https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de421_1900-2050.bpc — public
- Lunar frame kernel `moon_080317.tf` (NASA/JPL NAIF) — MOON_ME_DE421 = PA + fixed rotation — https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_080317.tf — public
- Planetary constants `pck00008.tpc` (NASA/JPL NAIF) — lunar reference radius check (1737.4 km) — https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/a_old_versions/pck00008.tpc — public

## Software libraries
- skyfield (Brandon Rhodes) — ephemeris, light-time, aberration, lunar frames — https://rhodesmill.org/skyfield/ — MIT
- NumPy — array maths for geometry, tables and interpolation — https://numpy.org/ — BSD-3-Clause
- Matplotlib — validation figures — https://matplotlib.org/ — Matplotlib licence (PSF-based)

### Web app (agent `web-app`)
- Leaflet 1.9.4 — interactive Moon map (site picker), loaded from jsDelivr — https://leafletjs.com — BSD-2-Clause
- Plotly.js (plotly.js-dist-min 2.35.2) — Sun and Earth time-series charts, loaded from jsDelivr — https://plotly.com/javascript/ — MIT
- three.js 0.160.0 — 3D sky view (import map shared with the sky viewer), loaded from jsDelivr — https://threejs.org — MIT
- jsDelivr CDN — serves the pinned library versions above — https://www.jsdelivr.com — free public CDN
- Colour-blind-safe categorical palette (reference palette of the Claude Code "dataviz" skill, validated for colour-vision deficiency in light and dark themes) — scenario colours — https://claude.com/claude-code — used with Claude Code
- GitHub Pages and GitHub Actions (configure-pages v5, upload-pages-artifact v3, deploy-pages v4) — hosting the public site — https://pages.github.com — GitHub terms

## Code, algorithms and papers
- Williams, Boggs & Folkner (2008), "DE421 Lunar Orbit, Physical Librations, and Surface Coordinates", JPL IOM 335-JW,DB,WF-20080314-001 — definition of the MOON_ME_DE421 frame — https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/a_old_versions/de421_lunar_ephemeris_and_orientation.pdf — public
- IERS Conventions (2010), Technical Note 36, eq. 5.15 — Earth Rotation Angle formula (`era_deg`, Python and browser) — https://www.iers.org/IERS/EN/Publications/TechnicalNotes/tn36.html — public
- USNO `tai-utc.dat` — official TAI−UTC "rubber second" formulas for 1966–1971 (pre-1972 UTC) — https://maia.usno.navy.mil/ser7/tai-utc.dat — public
- Vogel, H. (1979), "A better way to construct the sunflower head", Math. Biosci. 44, 179–189 (golden-angle point pattern) — even sampling of the Sun and Earth disks for the visible fraction — https://doi.org/10.1016/0025-5564(79)90080-4 — method only
- Linear solar limb-darkening law I(μ) = 1 − u(1 − μ), u ≈ 0.6 in the visible (e.g. Cox, Allen's Astrophysical Quantities, 4th ed., §14.7) — flux fraction of a partly hidden Sun — method only
- IAU 2015 Resolution B3 (total solar irradiance 1361 W/m², Earth equatorial radius 6 378.137 km) — solar flux and the Earth's angular size — https://www.iau.org/static/resolutions/IAU2015_English.pdf — public

## Images, textures and other media

## Tools
- Claude Code (Anthropic) — AI coding agent used to write the code and docs — https://claude.com/claude-code — see docs/AI_USE.md
- Playwright for Python (Microsoft) with the installed Microsoft Edge — scripted app screenshots in docs/figures/app_*.png, and the demo video recorder scripts/video/record_demo.py (dev dependency) — https://playwright.dev/python/ — Apache-2.0
- imageio-ffmpeg — bundled FFmpeg binary used to encode the demo video — https://github.com/imageio/imageio-ffmpeg — BSD-2-Clause (the bundled FFmpeg build with libx264 is GPL)
- FFmpeg with libx264 — H.264 encoding of the demo video (outputs/video/, via imageio-ffmpeg) — https://ffmpeg.org/ , https://www.videolan.org/developers/x264.html — LGPL/GPL

### Catalog (agent `catalog`)
- Apollo Lunar Surface Journal (NASA) — Apollo landing and liftoff times — https://www.hq.nasa.gov/alsj/ — public
- NSSDCA Lunar landing sites (NASA) — Luna/Surveyor mission data — https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_landing_sites.html — public
- Wikipedia, List of artificial objects on the Moon (LROC-sourced coordinates) — lander coordinates cross-check — https://en.wikipedia.org/wiki/List_of_artificial_objects_on_the_Moon — CC BY-SA 4.0
- Wikipedia mission and crater articles — coordinates, dates — https://en.wikipedia.org/ — CC BY-SA 4.0
- NASA, Artemis III candidate landing regions (Oct 2024) — candidate names — https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/ — public
- Mazarico et al. 2011, Icarus 211, "Illumination conditions of the lunar polar regions using LOLA topography" — Shackleton connecting-ridge POI — https://doi.org/10.1016/j.icarus.2011.03.025 — paper (cited only)
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

### Additional entries (docs completeness check, 2026-11-14)
- Smith et al. 2010, Space Sci. Rev. 150, 209-241, "The Lunar Orbiter Laser Altimeter investigation on the Lunar Reconnaissance Orbiter mission" — the LOLA instrument behind every terrain product above — https://doi.org/10.1007/s11214-009-9512-y — paper (cited only)
- pytest and Ruff (dev dependencies in pyproject.toml) — Python tests, lint and format — https://docs.pytest.org/ and https://docs.astral.sh/ruff/ — MIT
- uv (Astral) — Python environment and dependency management — https://docs.astral.sh/uv/ — MIT or Apache-2.0
- Node.js built-in test runner (`node --test`) — JavaScript tests in web/tests/, no npm packages — https://nodejs.org/api/test.html — MIT
- Fonts and icons: the app uses system fonts only, and its icons are inline SVG written for this project (web/js/app/icons.js). No web fonts, icon packs or stock images.
- Video tooling: the demo video is assembled from scripted captures of the live app. If a tool such as imageio-ffmpeg is added for it, the `video` work item lists it here.
