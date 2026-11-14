// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// One rover traverse, end to end: route terrain (terrain.js) -> fastest drivable path (planner.js) -> positions every
// 100–250 m along it with their terrain horizons (the C9 ray march over the route grids + the C5 tiles) -> a hillshade
// preview. Runs in the Web Worker (worker.js) or inline (Node tests). The Sun/Earth series is computed afterwards on
// the main thread by series.js, where the ephemeris lives.

import { marchHorizon, terrainPatch } from "../terrain/march.js";
import { farField } from "../terrain/tiles.js";
import { fetchRouteTerrain, plannerGrid, cellOf, cellXY, gridView, makePlane, RouteError } from "./terrain.js";
import { slopeField, planPath } from "./planner.js";
import { roverParams } from "./presets.js";

const GENERATED_BY = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.";
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Spacing (m) of the horizon samples along a path of length L (m): L/200, clamped to 100–250 m. */
export function sampleSpacing(L) {
  return Math.min(250, Math.max(100, L / 200));
}

/** Index i with a[i] ≤ v < a[i+1] in an ascending array (clamped to 0..n−2; 0 for n < 2). */
export function bracket(a, v) {
  let lo = 0, hi = a.length - 1;
  if (hi < 1) return 0;
  if (v <= a[0]) return 0;
  if (v >= a[hi]) return hi - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (a[m] <= v) lo = m; else hi = m;
  }
  return lo;
}

/** Plane point (x, y) and elevation of a path at surface distance d (m), linear between vertices. */
export function pointAtDistance(path, d) {
  const D = path.dist_m;
  if (D.length === 1) return { x: path.x[0], y: path.y[0], elev_m: path.elev_m[0], i: 0 };
  const i = bracket(D, d);
  const span = D[i + 1] - D[i];
  const f = span > 0 ? Math.max(0, Math.min(1, (d - D[i]) / span)) : 0;
  return {
    x: path.x[i] + f * (path.x[i + 1] - path.x[i]),
    y: path.y[i] + f * (path.y[i + 1] - path.y[i]),
    elev_m: path.elev_m[i] + f * (path.elev_m[i + 1] - path.elev_m[i]),
    i,
  };
}

/**
 * Drive timeline: knots {t_s[], d_m[]} (time since the start, distance travelled), piecewise linear. Without stops
 * these are the path vertices. With stops (`stop_every_km` > 0 and `stop_h` > 0) the rover parks for stop_h hours
 * every stop_every_km of driving (not at the end point).
 */
export function timeline(path, { stop_every_km = 0, stop_h = 0 } = {}) {
  const T = path.time_s, D = path.dist_m;
  const t_s = [T[0]], d_m = [D[0]];
  const every = stop_every_km > 0 && stop_h > 0 ? stop_every_km * 1000 : Infinity;
  const pause = stop_h * 3600;
  let shift = 0, next = every;
  for (let i = 1; i < T.length; i++) {
    while (next < D[i] && next < D[D.length - 1]) {
      const f = (next - D[i - 1]) / (D[i] - D[i - 1]);
      const t = T[i - 1] + f * (T[i] - T[i - 1]) + shift;
      t_s.push(t, t + pause);
      d_m.push(next, next);
      shift += pause;
      next += every;
    }
    t_s.push(T[i] + shift);
    d_m.push(D[i]);
  }
  return { t_s, d_m, arrival_s: t_s[t_s.length - 1], stops: Number.isFinite(every) ? Math.max(0, Math.ceil(D[D.length - 1] / every) - 1) : 0 };
}

/** Distance travelled (m) at time tSec since the start, from a timeline (0 before, the full length after). */
export function distanceAtTime(tl, tSec) {
  const T = tl.t_s, D = tl.d_m;
  if (tSec <= T[0]) return D[0];
  if (tSec >= T[T.length - 1]) return D[D.length - 1];
  const i = bracket(T, tSec);
  const span = T[i + 1] - T[i];
  return span > 0 ? D[i] + ((tSec - T[i]) / span) * (D[i + 1] - D[i]) : D[i + 1];
}

/**
 * Terrain horizons (C3 shape) at points along the route, by the C9 ray march over the route grids (fine, coarse;
 * gridView) and the C5 far field sampled around the route centre.
 */
export function routeHorizons(T, points, { observer_height_m = 2, az_step_deg = 0.5, onProgress = null } = {}) {
  const plane = T.plan.plane;
  const out = [];
  for (let k = 0; k < points.length; k++) {
    const { lat_deg, lon_deg } = points[k];
    const grids = [T.fine, T.coarse].filter(Boolean).map((g) => gridView(plane, g, lat_deg, lon_deg));
    const hz = marchHorizon({ lat_deg, lon_deg, observer_height_m, az_step_deg, grids, far: T.far });
    out.push({
      id: null,
      lat_deg,
      lon_deg,
      ground_elev_m: hz.ground_elev_m,
      observer_height_m,
      az_step_deg,
      el_deg: hz.el_deg,
      dist_km: hz.dist_km,
      max_range_km: hz.max_range_km,
      dem_sources: T.meta.sources,
      source: "rover-route",
      approximate: false,
      label: `terrain: LOLA ${Math.round(T.fine.cell_m)} m route grid (Moon Trek) + LOLA tiles`,
      _generated_by: GENERATED_BY,
    });
    if (onProgress) onProgress((k + 1) / points.length);
  }
  return out;
}

/**
 * Hillshade preview of the fine grid (≤ maxPx pixels across): Lambertian shading (Horn gradient, light from the
 * north-west at 45°) with drivable-slope colouring: cells steeper than the rover's limit are tinted red.
 * @returns {{width, height, rgba: Uint8ClampedArray, x0, x1, y0, y1}} plane extent (m) of the image edges.
 */
export function hillshade(grid, field, { maxPx = 480 } = {}) {
  const n = grid.n, f = Math.max(1, Math.ceil(n / maxPx));
  const W = Math.floor(n / f), H = W;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const az = (315 * Math.PI) / 180, el = (45 * Math.PI) / 180;
  const se = Math.sin(az) * Math.cos(el), sn = Math.cos(az) * Math.cos(el), su = Math.sin(el);
  const off = Math.floor(f / 2);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = (j * f + off) * n + i * f + off;
      const o = 4 * (j * W + i);
      const gx = field.gx[k], gy = field.gy[k];
      if (!Number.isFinite(field.slope_deg[k])) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = 25;
        rgba[o + 3] = 255;
        continue;
      }
      const shade = Math.max(0, (-gx * se - gy * sn + su) / Math.sqrt(1 + gx * gx + gy * gy));
      const v = 30 + 215 * shade;
      if (field.passable[k]) {
        rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v;
      } else {
        rgba[o] = 0.7 * v + 0.3 * 235; rgba[o + 1] = 0.7 * v + 0.3 * 60; rgba[o + 2] = 0.7 * v + 0.3 * 50;
      }
      rgba[o + 3] = 255;
    }
  }
  const x0 = -grid.half_m, x1 = -grid.half_m + W * f * grid.cell_m;
  return { width: W, height: H, rgba, x0, x1, y0: grid.half_m - H * f * grid.cell_m, y1: grid.half_m };
}

const MESSAGES = {
  blocked: (r) => `No drivable route between these points: terrain steeper than ${r.max_slope_deg}° (or cross slopes over ${r.max_cross_deg}°) blocks every path inside the planning area. Try a steeper limit or other end points.`,
  start: (r) => `The start point is on terrain steeper than ${r.max_slope_deg}° and there is no drivable ground within a few hundred metres. Move it, or raise the slope limit.`,
  goal: (r) => `The end point is on terrain steeper than ${r.max_slope_deg}° and there is no drivable ground within a few hundred metres. Move it, or raise the slope limit.`,
};

/**
 * Plan a traverse.
 * @param {{lat_deg, lon_deg}} start, end
 * @param {object} rover   {preset, speed_mps, max_slope_deg, max_cross_deg, ...} (roverParams)
 * @param {object} [o]     fetchRouteTerrain options + {observer_height_m = 2, az_step_deg = 0.5, onProgress(stage, frac)}
 * @returns {Promise<object>} route result (see docs/CONTRACTS.md C10)
 */
export async function computeRoute(start, end, roverIn = {}, o = {}) {
  const t0 = now();
  const rover = roverParams(roverIn.preset, roverIn);
  const progress = (stage, frac) => o.onProgress && o.onProgress(stage, frac);
  progress("terrain", 0);
  const T = await fetchRouteTerrain(start, end, o);
  const tTerrain = now();
  progress("plan", 0);
  const { plan, fine } = T;
  const pg = plannerGrid(fine);
  const field = slopeField(pg, rover.max_slope_deg);
  const s = cellOf(fine, ...plan.start_xy), g = cellOf(fine, ...plan.end_xy);
  const snapCells = Math.max(3, Math.ceil(300 / fine.cell_m));
  const p = planPath(pg, s, g, rover, { field, snapCells });
  if (!p.ok) throw new RouteError(p.reason, MESSAGES[p.reason](rover));
  const tPlan = now();

  const N = p.cells.length;
  const path = { x: [], y: [], lat: [], lon: [], elev_m: [], slope_deg: [], dist_m: p.dist_m, time_s: p.time_s, along_deg: p.along_deg, cross_deg: p.cross_deg, speed_mps: p.speed_mps };
  for (let i = 0; i < N; i++) {
    const id = p.cells[i];
    const [x, y] = cellXY(fine, id);
    const ll = plan.plane.toLatLon(x, y);
    path.x.push(x); path.y.push(y); path.lat.push(ll.lat_deg); path.lon.push(ll.lon_deg);
    path.elev_m.push(fine.data[id]); path.slope_deg.push(field.slope_deg[id]);
  }
  const L = path.dist_m[N - 1];

  // Sample points every ~100–250 m, each with its own horizon.
  const nseg = L > 0 ? Math.max(1, Math.round(L / sampleSpacing(L))) : 0;
  const samples = { dist_m: [], lat: [], lon: [], elev_m: [], x: [], y: [], horizons: [] };
  for (let k = 0; k <= nseg; k++) {
    const d = nseg ? (k * L) / nseg : 0;
    const q = pointAtDistance(path, d);
    const ll = plan.plane.toLatLon(q.x, q.y);
    samples.dist_m.push(d); samples.x.push(q.x); samples.y.push(q.y);
    samples.lat.push(ll.lat_deg); samples.lon.push(ll.lon_deg); samples.elev_m.push(q.elev_m);
  }
  // With o.horizons === false the caller computes them (index.js spreads them over a pool of workers).
  if (o.horizons !== false) {
    progress("horizons", 0);
    samples.horizons = routeHorizons(T, samples.lat.map((lat, k) => ({ lat_deg: lat, lon_deg: samples.lon[k] })), {
      observer_height_m: o.observer_height_m ?? 2, az_step_deg: o.az_step_deg ?? 0.5, onProgress: (f) => progress("horizons", f),
    });
  } else samples.horizons = null;
  const tHz = now();

  let climb = 0, descent = 0, maxAlong = 0, maxCross = 0, maxSlope = 0;
  for (let i = 1; i < N; i++) {
    const dz = path.elev_m[i] - path.elev_m[i - 1];
    if (dz > 0) climb += dz; else descent -= dz;
    maxAlong = Math.max(maxAlong, Math.abs(path.along_deg[i]));
    maxCross = Math.max(maxCross, path.cross_deg[i]);
  }
  for (const v of path.slope_deg) if (v > maxSlope) maxSlope = v;
  const drive = path.time_s[N - 1];
  const sxy = plan.start_xy, exy = plan.end_xy;
  return {
    start: { lat_deg: start.lat_deg, lon_deg: start.lon_deg },
    end: { lat_deg: end.lat_deg, lon_deg: end.lon_deg },
    centre: { lat_deg: plan.mid.lat_deg, lon_deg: plan.mid.lon_deg },
    rover,
    path,
    samples,
    stats: {
      length_m: L,
      straight_m: plan.dist_m,
      drive_s: drive,
      mean_speed_mps: drive > 0 ? L / drive : 0,
      max_along_deg: maxAlong,
      max_cross_deg: maxCross,
      max_slope_deg: maxSlope,
      climb_m: climb,
      descent_m: descent,
      snapped_start_m: Math.hypot(path.x[0] - sxy[0], path.y[0] - sxy[1]),
      snapped_end_m: Math.hypot(path.x[N - 1] - exy[0], path.y[N - 1] - exy[1]),
    },
    preview: hillshade(fine, field),
    terrain: { fine: stripGrid(fine), coarse: T.coarse ? stripGrid(T.coarse) : null },
    meta: {
      sources: T.meta.sources,
      bytes: T.meta.bytes,
      grid_n: fine.n,
      fine_cell_m: fine.cell_m,
      coarse_cell_m: T.coarse?.cell_m ?? null,
      fine_layer: fine.layer,
      expanded: p.expanded,
      ms: { terrain: Math.round(tTerrain - t0), plan: Math.round(tPlan - tTerrain), horizons: Math.round(tHz - tPlan), total: Math.round(now() - t0) },
      n_samples: samples.dist_m.length,
      _generated_by: GENERATED_BY,
    },
  };
}

function stripGrid(g) {
  return { layer: g.layer, half_m: g.half_m, cell_m: g.cell_m, n: g.n, data: g.data, max_m: g.max_m };
}

/**
 * Horizons at some route points from a planned route's grids (a worker of the pool in index.js): rebuilds the route
 * terrain (plane at `centre`, fine/coarse grids, the C5 far field around the centre) and runs routeHorizons.
 * @param {object} m  {centre, fine, coarse, sources, points: [{lat_deg, lon_deg}], demBaseUrl, observer_height_m, az_step_deg}
 */
export async function horizonsAt(m, { fetchFn, onProgress } = {}) {
  const far = await farField(m.centre.lat_deg, m.centre.lon_deg, { baseUrl: m.demBaseUrl ?? "data/dem", fetchFn: fetchFn ?? ((u, i) => globalThis.fetch(u, i)) });
  const T = { plan: { plane: makePlane(m.centre.lat_deg, m.centre.lon_deg) }, fine: m.fine, coarse: m.coarse, far, meta: { sources: m.sources } };
  return routeHorizons(T, m.points, { observer_height_m: m.observer_height_m ?? 2, az_step_deg: m.az_step_deg ?? 0.5, onProgress });
}

/**
 * C4-shaped terrain patch (in memory, {meta, data} as createSkyView's `terrainPatch` takes it) around a point of a
 * planned route, built from the route grids by the C9 patch builder (web/js/terrain/march.js terrainPatch).
 * Cells without data (outside both grids) take the lowest value of the patch. A multi-stop trip (trip.js joinLegs) uses
 * the grids of leg `leg`, or of the leg with the horizon sample nearest to the point.
 */
export function routePatch(route, lat_deg, lon_deg, { half_extent_m = 6000, n = 257, leg = null } = {}) {
  if (route.legs) {
    let j = Number.isInteger(leg) ? leg : 0;
    if (!Number.isInteger(leg)) {
      const S = route.samples, c = Math.cos(lat_deg * Math.PI / 180);
      let best = Infinity;
      for (let k = 0; k < S.lat.length; k++) {
        const dl = ((S.lon[k] - lon_deg + 540) % 360) - 180;
        const e = (S.lat[k] - lat_deg) ** 2 + (dl * c) ** 2;
        if (e < best) { best = e; j = S.leg[k]; }
      }
    }
    return routePatch(route.legs[Math.max(0, Math.min(route.legs.length - 1, j))], lat_deg, lon_deg, { half_extent_m, n });
  }
  const plane = makePlane(route.centre.lat_deg, route.centre.lon_deg);
  const grids = [route.terrain.fine, route.terrain.coarse].filter(Boolean).map((g) => gridView(plane, g, lat_deg, lon_deg));
  const h0 = grids[0].at(0, 0);
  const p = terrainPatch({ lat_deg, lon_deg, grids, far: null, ground_elev_m: Number.isFinite(h0) ? h0 : 0, half_extent_m, n });
  if (p.nan_cells) {
    const lo = Number.isFinite(p.z_min_m) ? p.z_min_m : 0;
    for (let i = 0; i < p.z_up_m.length; i++) if (Number.isNaN(p.z_up_m[i])) p.z_up_m[i] = lo;
  }
  return {
    meta: { id: null, grid_n: p.grid_n, spacing_m: p.spacing_m, half_extent_m: p.half_extent_m, ground_elev_m: p.ground_elev_m, z_min_m: p.z_min_m, z_max_m: p.z_max_m, dem_sources: route.meta.sources },
    data: p.z_up_m,
  };
}
