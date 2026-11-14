// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Terrain horizon by ray marching over nested height sources (contract C3 `horizon-profile`).
// The maths is that of moonat.terrain.horizon and horizonFromTiles (web/js/physics/terrain.js):
// - Frame MOON_ME, sphere R = 1737.4 km. Eye at radius r_E = R + h0 + observer height, along up.
// - Ray for true azimuth A: great circle u(θ) = cos θ·up + sin θ·d, d = cos A·north + sin A·east.
//   Terrain point P = (R + h(u))·u; el = atan2(ρ cos θ − r_E, ρ sin θ) (exact curvature, no
//   refraction on the Moon). Horizon = max el along the ray; dist_km = R·θ at that point.
// - Heights: the finest source that covers the sample. Site-centred stereographic grids first
//   (geom.js gridBilinear, at r = 2R tan(θ/2), x = r sin A, y = r cos A), then the far-field
//   sampler (C5 tiles). NaN (no data) falls through to the next source; no data cannot occlude.
// - Steps: one cell of the finest source in use (grid cell, then the tile level cells), so no cell
//   is skipped along a ray.
// - Stop rule (rigorous): with ρ ≤ ρ_max, no point beyond θ = acos(r_E cos el*/ρ_max) − el* can
//   exceed el*. ρ_max = R + highest terrain within 0.25 rad (grids and tiles) + 300 m.

import { D2R, R_M, enuBasis, gridBilinear, stopAngle } from './geom.js';
import { REGION_RAD } from './tiles.js';

export const HEIGHT_MARGIN_M = 300;

/** Ground distance (m) up to which a grid of half-width half_m can be bilinearly sampled on every azimuth. */
export function gridReach(g) {
  // r = 2R tan(s/2R) ≤ half − 1 cell (inscribed circle, one cell kept for interpolation)
  const r = g.half_m - g.cell_m;
  return 2 * R_M * Math.atan(r / (2 * R_M));
}

/**
 * Ray-marched horizon.
 * @param {object} a
 * @param {number} a.lat_deg, a.lon_deg  site (selenographic, deg, east-positive)
 * @param {number} a.observer_height_m   eye height above the ground (m)
 * @param {number} a.az_step_deg         azimuth step (deg)
 * @param {Array}  a.grids               site-centred grids, finest first: {half_m, cell_m, n, data}
 * @param {object} a.far                 far-field sampler {height(ux,uy,uz,s), cells[], smax[], maxHeight}
 * @param {number} [a.min_dist_m=0]      ignore terrain closer than this (m)
 * @returns C3 fields {ground_elev_m, el_deg[], dist_km[], max_range_km, unterminated_rays}
 */
export function marchHorizon({ lat_deg, lon_deg, observer_height_m = 2, az_step_deg = 0.25, grids = [], far, min_dist_m = 0 }) {
  const { east, north, up } = enuBasis(lat_deg, lon_deg);

  // Ground height at the site: centre of the finest grid that has it, else the far field.
  let h0 = NaN;
  for (const g of grids) { h0 = gridBilinear(g, 0, 0); if (Number.isFinite(h0)) break; }
  if (!Number.isFinite(h0)) h0 = far.height(up[0], up[1], up[2], 0);
  if (!Number.isFinite(h0)) h0 = 0;

  let maxH = far.maxHeight;
  for (const g of grids) for (const v of g.data) if (v > maxH) maxH = v;
  const rhoMax = R_M + maxH + HEIGHT_MARGIN_M;
  const rEye = R_M + h0 + observer_height_m;
  const thCap = Math.min(stopAngle(rEye, -5 * D2R, rhoMax), REGION_RAD);
  const sCap = thCap * R_M;

  // Ray schedule: steps of one cell of the finest source that covers the distance.
  const reach = grids.map(gridReach);
  const cells = [...grids.map((g) => g.cell_m), ...far.cells];
  const smax = [...reach, ...far.smax];
  const sched = [], seg = [];
  let s = 0;
  for (let k = 0; k < cells.length; k++) {
    const end = Math.min(smax[k], sCap);
    if (end <= s) continue;
    const n = Math.ceil((end - s) / cells[k]);
    const s0 = s;
    for (let i = 1; i <= n; i++) { sched.push(s0 + cells[k] * i); seg.push(k); }
    s = sched[sched.length - 1];
    if (s >= sCap) break;
  }
  const ns = sched.length;
  const th = new Float64Array(ns), cth = new Float64Array(ns), sth = new Float64Array(ns), rpl = new Float64Array(ns);
  for (let i = 0; i < ns; i++) {
    th[i] = sched[i] / R_M; cth[i] = Math.cos(th[i]); sth[i] = Math.sin(th[i]);
    rpl[i] = 2 * R_M * Math.tan(th[i] / 2);
  }
  const nG = grids.length;

  const nAz = Math.round(360 / az_step_deg);
  const elOut = new Array(nAz), distOut = new Array(nAz);
  let rangeNeeded = 0, unterminated = 0;
  for (let k = 0; k < nAz; k++) {
    const a = k * az_step_deg * D2R;
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = ca * north[0] + sa * east[0], dy = ca * north[1] + sa * east[1], dz = ca * north[2] + sa * east[2];
    let elBest = -Math.PI / 2, thBest = 0, thStop = stopAngle(rEye, elBest, rhoMax), done = false;
    for (let i = 0; i < ns; i++) {
      if (sched[i] >= min_dist_m) {
        let h = NaN;
        for (let j = Math.min(seg[i], nG); j < nG && Number.isNaN(h); j++) {
          if (sched[i] <= reach[j]) h = gridBilinear(grids[j], rpl[i] * sa, rpl[i] * ca);
        }
        if (Number.isNaN(h)) {
          const c = cth[i], sn = sth[i];
          h = far.height(c * up[0] + sn * dx, c * up[1] + sn * dy, c * up[2] + sn * dz, sched[i]);
        }
        if (!Number.isNaN(h)) {
          const rho = R_M + h;
          const el = Math.atan2(rho * cth[i] - rEye, rho * sth[i]);
          if (el > elBest) { elBest = el; thBest = th[i]; thStop = stopAngle(rEye, elBest, rhoMax); }
        }
      }
      if (thStop <= th[i]) { done = true; break; }
    }
    if (!done) unterminated++;
    rangeNeeded = Math.max(rangeNeeded, thStop);
    elOut[k] = Math.round((elBest / D2R) * 1e4) / 1e4;
    distOut[k] = Math.round(thBest * R_M) / 1e3;
  }
  return {
    ground_elev_m: Math.round(h0 * 100) / 100,
    el_deg: elOut,
    dist_km: distOut,
    max_range_km: Math.round((rangeNeeded * R_M) / 100) / 10,
    unterminated_rays: unterminated,
    samples_per_ray: ns,
  };
}

/**
 * Terrain patch (contract C4) in site ENU from the grids (and the far field where they have no
 * data), as moonat.terrain.patch: cell (r, c) at ENU x = −h + c·d (east), y = +h − r·d (north);
 * value = ENU up-coordinate of the surface point with those horizontal coordinates, relative to the
 * ground point (includes the curvature drop). For horizontal offset s and bearing A the point is
 * P = ρ(u)·u, u = cos θ·up + sin θ·d(A), with θ solving ρ(u(θ))·sin θ = s (3 fixed-point passes,
 * < 1 mm for s ≤ 20 km); z = ρ cos θ − (R + h0).
 * @returns {{grid_n, spacing_m, half_extent_m, ground_elev_m, z_min_m, z_max_m, z_up_m: Float32Array, nan_cells}}
 */
export function terrainPatch({ lat_deg, lon_deg, grids, far, ground_elev_m, half_extent_m = 12000, n = 385 }) {
  const { east, north, up } = enuBasis(lat_deg, lon_deg);
  const d = (2 * half_extent_m) / (n - 1);
  const z = new Float32Array(n * n);
  const rho0 = R_M + ground_elev_m;
  let zmin = Infinity, zmax = -Infinity, nan = 0;
  const height = (x, y, th) => {
    // plane point of the surface direction at central angle th toward (x, y)
    const s = Math.hypot(x, y);
    const rp = 2 * R_M * Math.tan(th / 2);
    const px = s > 0 ? (rp * x) / s : 0, py = s > 0 ? (rp * y) / s : 0;
    for (const g of grids) {
      const h = gridBilinear(g, px, py);
      if (!Number.isNaN(h)) return h;
    }
    const ax = s > 0 ? x / s : 0, ay = s > 0 ? y / s : 1;
    const ct = Math.cos(th), st = Math.sin(th);
    const u = [0, 1, 2].map((i) => ct * up[i] + st * (ax * east[i] + ay * north[i]));
    return far ? far.height(u[0], u[1], u[2], th * R_M) : NaN;
  };
  for (let r = 0; r < n; r++) {
    const y = half_extent_m - r * d;
    for (let c = 0; c < n; c++) {
      const x = -half_extent_m + c * d;
      const s = Math.hypot(x, y);
      let rho = rho0, th = 0;
      for (let it = 0; it < 3; it++) {
        th = Math.asin(Math.min(1, s / rho));
        rho = R_M + height(x, y, th);
      }
      th = Math.asin(Math.min(1, s / rho));
      const v = rho * Math.cos(th) - rho0;
      z[r * n + c] = v;
      if (Number.isNaN(v)) nan++;
      else { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
    }
  }
  return { grid_n: n, spacing_m: d, half_extent_m, ground_elev_m, z_min_m: Math.round(zmin * 100) / 100, z_max_m: Math.round(zmax * 100) / 100, z_up_m: z, nan_cells: nan };
}
