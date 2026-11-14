# Research brief: how much of the Sun / Earth disk is visible from a point on the lunar terrain?

> Purpose: a self-contained question for a deep-research model, to be run before the hackathon (Sat 2026-11-14).
> Owner: Shay (physics domain). Context: docs/VISION.md, docs/ARCHITECTURE.md.
> Please answer with methods, equations, algorithms, error budgets and implementation guidance, and cite sources.

## 1. Context
We're building a web tool that, for a user-chosen point on the Moon and a time (or a time interval, i.e. a
mission), reports how much of the **Sun** and how much of the **Earth** an observer standing there can see. This drives
solar power and direct-to-Earth communication. Sites range from the Apollo landing sites (low latitudes) to the lunar
south pole, where the Sun grazes the horizon and the terrain decides everything. The tool must be **accurate**
(validated against JPL Horizons and published illumination studies) and **fast enough to be interactive**. Arbitrary
sites are clicked on a map, and time series span up to ~30 days at minute-to-hour resolution.

## 2. The calculation chain we intend (please critique it)
1. **Inertial frame.** Use the ICRF (BCRS, solar-system barycentre) as the fixed reference. Use JPL DE ephemerides (DE440 or
   DE421) for the positions of the Sun, Earth, Moon and planets at each time.
2. **Lunar orientation.** Use the high-accuracy lunar body-fixed frame from the JPL binary PCK (PA frame), converted to
   the **Mean-Earth/Polar-Axis (ME)** frame in which LOLA topography is published. This includes physical libration.
3. **Observer position.** Selenographic latitude/longitude (ME), with the radius = LOLA reference sphere (1737.4 km) + the DEM
   height at that point + the observer height above ground (e.g. ~2 m for a camera or astronaut eye; it matters at grazing
   angles).
4. **Local horizontal plane.** This is the plane through the observer **normal to the Moon-centre→observer vector**. It is
   NOT the local terrain slope. Azimuth is measured clockwise from local north. Elevation is measured above this plane.
5. **Apparent direction and distance** from the observer to each body. This includes light-time and the aberration due to the observer's
   velocity. The Moon has no atmosphere, so there is no refraction. From this we get each body's centre direction (az, el) and
   **angular radius** ρ (Sun ≈ 0.27°, Earth ≈ 0.95°, both varying with distance).
6. **Terrain occlusion: the open problem**, below.

## 3. The open problem: formal statement
Given:
- a terrain surface T: the lunar DEM (a raster of heights on a sphere of radius R = 1737.4 km, in polar-stereographic
  or simple-cylindrical projection, at 5–60 m/px locally and ~0.5–2 km/px globally);
- an observer point O on (or slightly above) T;
- a body B seen from O as a circular disk D of angular radius ρ, centred on the unit direction **u**. Equivalently, a circular
  cone with apex O, axis **u** and half-angle ρ;

compute the **visible fraction** f ∈ [0,1]: the solid-angle fraction of the cone (disk D) whose rays from O do not
intersect T before leaving the terrain's influence (max terrain height ~±10 km around R).

And variants:
- **f_flux** (Sun): the visible fraction weighted by **solar limb darkening**, since power ≠ area fraction for a partial
  disk.
- **Lit-and-visible fraction** (Earth): the part of the Earth disk that is both sunlit (phase) and unobstructed.
  Is this, or the geometric fraction f, the right "how much Earth do we see"? Recommend definitions for both
  illumination and comms.
- **Events**: the times when f crosses 0 or 1 (body-set and body-rise behind terrain), found by root-finding over time.
- The same machinery should yield the **horizon silhouette** used later to draw the sky image.

## 4. Our current hypothesis (please validate, improve or replace it)
Because O is fixed for a site and the terrain is static, precompute the **horizon elevation profile** h(A): for each
azimuth A, the maximum elevation angle of the terrain as seen from O. Include lunar curvature, and range out to where no
terrain can rise above the local horizon. A peak of height H is visible to ~√(2RH), so ~130–170 km for 5–8 km relief,
and possibly ~300 km. Then, per time step, f is the area fraction of the disk lying above the curve h(A): a cheap 1-D
problem. The 3-D cone–surface intersection reduces to a 2-D disk vs. a 1-D horizon curve.

Questions:
1. Is the horizon-profile reduction **exact** for this problem, given that each azimuth ray's max elevation fully
   determines visibility along that azimuth? When does it fail (e.g. overhangs: impossible in a heightfield DEM)?
2. **Azimuth resolution.** The Sun spans 0.53°. What sampling of h(A) is needed for a given accuracy in f? Uniform fine
   sampling, or adaptive refinement only around the body's current azimuth range?
3. **Disk-vs-curve area computation.** The disk is in az/el coordinates, which are distorted away from the horizon. What's the correct and
   efficient way to integrate it (tangent-plane projection, sampling points on the disk, analytic segments with h(A)
   linearized across the disk)?
4. **Computing h(A) efficiently and accurately** for one arbitrary point, on demand. Interactive target: a few seconds.
   - Candidates we know of, to be verified and compared:
     - brute-force ray marching per azimuth;
     - multi-resolution DEMs: fine near field, coarse far field;
     - fast horizon algorithms: Dozier et al. 1981, "A faster solution to the horizon problem", and Stewart 1998, "Fast horizon
       computation at all points of a terrain";
     - GIS tools: GRASS GIS `r.horizon` / `r.sun`, viewshed algorithms;
     - GPU approaches: rendering the terrain around O into a cylindrical or panoramic depth/horizon map; heightfield ray tracing
       with max-mipmaps.
   - What sampling along each ray avoids missing narrow peaks? What's the vertical error budget (DEM error, interpolation,
     resolution vs distance)?
5. **Precomputation vs. on demand.** Should we precompute horizon maps for whole regions (e.g. every pixel of the
   south-pole DEM, as in published polar illumination studies) or compute per clicked site? What are the storage and speed trade-offs?
6. **Which DEMs to use** at the pole vs low latitudes, and how to stitch them: LOLA LDEM_80S_20M / 5 m polar products,
   SLDEM2015 (±60°), LOLA global gridded LDEM_4..512. What are the projections, datums and the ME frame consistency (the PA vs ME
   offset is ~hundreds of metres on the surface)?
7. **Accuracy budget, end to end.** Ephemeris and orientation errors; site position error (DEM horizontal accuracy); DEM
   vertical error; horizon sampling; the near-field effect of the observer height (2 m vs 0 m). Which term dominates at a polar site
   with the Sun 1° above a ridge 20 km away? What accuracy in f and in rise/set times is realistic?
8. **Validation data.** Published lunar polar illumination results we can compare against: e.g. Mazarico et al. 2011
   (Icarus, LOLA-based polar illumination), Gläser et al., Bussey et al., Speyerer & Robinson. Also any LOLA/PDS illumination or
   horizon products. Are there known reference values (e.g. % illumination at specific Shackleton-rim or Malapert points)?
9. **Earth visibility specifics.** At the poles Earth stays within ~±7° of the horizon (libration). Are there published
   Earth-visibility or DTE-comms studies for south-pole sites to validate against?
10. **Implementation guidance in Python:** numpy/numba vectorization or GPU (CuPy, or WebGL in the browser for rendering);
    the data volumes involved; libraries that already do part of this (e.g. skyfield, spiceypy, rasterio, GDAL, any
    planetary-illumination codes, open-source or from NASA/ESA).

## 5. What we want back
1. A recommended **algorithm**, with its maths, for h(A) and for f (and f_flux), including complexity and expected run time for
   one site at our ranges and resolutions.
2. An **error budget** table and recommended parameters (azimuth step, ray step schedule, DEM choice per latitude,
   max range, observer height default).
3. A **validation plan**: concrete reference cases with expected values from the literature.
4. Pitfalls: frame mismatches (PA vs ME, IAU_MOON), DEM projection/datum gotchas, edge cases (sites in permanent
   shadow, the Earth near the horizon at the poles, the far side where Earth never rises).
5. If our horizon-profile hypothesis is not the best approach for a 1-day hackathon build, say what is, and why.
