// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Terrain for a rover route: one LOLA elevation grid from NASA Moon Trek that covers both end points plus a margin,
// in a local stereographic plane centred on the great-circle midpoint, and a 4×-coarser grid around it for the
// mid-field of the horizons. Reuses the terrain module (web/js/terrain: Moon Trek fetch, LERC decoder, projection,
// C5 far-field tiles, ray march), so heights, frames and conventions are those of C3/C4/C9:
// - frame MOON_ME, sphere R = 1737.4 km, heights in m above the sphere;
// - plane x toward ENU east and y toward ENU north at the centre, x = 2R (u·e)/(1 + u·up), y = 2R (u·n)/(1 + u·up);
// - grid rows from north to south, columns from west to east, pixel centres at ±(half − (k + 0.5)·cell).

import { R_M, D2R, enuBasis, stereoXY, gridBilinear } from "../terrain/geom.js";
import { LAYERS, fetchGrid, layerCovers } from "../terrain/trek.js";
import { farField } from "../terrain/tiles.js";

export const MAX_ROUTE_KM = 60;
export const MAX_GRID_N = 1001;
const INV_4R2 = 1 / (4 * R_M * R_M);

/** A planning problem the user can fix (too long, no drivable path...). `code` is machine-readable. */
export class RouteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Unit vector in MOON_ME of a selenographic point (deg, east-positive longitude). */
export function unitVec(lat_deg, lon_deg) {
  const la = lat_deg * D2R, lo = lon_deg * D2R;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

function latLonOf(u) {
  const n = Math.hypot(u[0], u[1], u[2]);
  return { lat_deg: Math.asin(Math.max(-1, Math.min(1, u[2] / n))) / D2R, lon_deg: Math.atan2(u[1], u[0]) / D2R };
}

/** Great-circle distance (m, on the 1737.4 km sphere) and midpoint of two points {lat_deg, lon_deg}. */
export function greatCircle(a, b) {
  const ua = unitVec(a.lat_deg, a.lon_deg), ub = unitVec(b.lat_deg, b.lon_deg);
  const cr = [ua[1] * ub[2] - ua[2] * ub[1], ua[2] * ub[0] - ua[0] * ub[2], ua[0] * ub[1] - ua[1] * ub[0]];
  const ang = Math.atan2(Math.hypot(...cr), ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2]);
  const mid = ang < 1e-12 ? { lat_deg: a.lat_deg, lon_deg: a.lon_deg } : latLonOf([ua[0] + ub[0], ua[1] + ub[1], ua[2] + ub[2]]);
  return { dist_m: ang * R_M, mid };
}

/**
 * Local stereographic plane tangent at (lat_deg, lon_deg) (the C9 site plane; exactly at a pole, +y points to the
 * 0° meridian as in enuBasis). toXY/toLatLon convert points; scale(x, y) = plane metres per ground metre
 * = 1 + (x² + y²)/(4R²).
 */
export function makePlane(lat_deg, lon_deg) {
  const enu = enuBasis(lat_deg, lon_deg);
  const { east: e, north: n, up } = enu;
  return {
    lat_deg,
    lon_deg,
    enu,
    toXY(lat, lon) {
      const u = unitVec(lat, lon);
      return stereoXY(enu, u[0], u[1], u[2]);
    },
    toLatLon(x, y) {
      const t2 = (x * x + y * y) * INV_4R2;
      const c = (1 - t2) / (1 + t2), f = 1 / (R_M * (1 + t2));
      return latLonOf([0, 1, 2].map((i) => c * up[i] + f * (x * e[i] + y * n[i])));
    },
    scale(x, y) {
      return 1 + (x * x + y * y) * INV_4R2;
    },
  };
}

/**
 * Grid plan for a route: the fine grid (finest LOLA layer that covers the box: 20 m south of 85°S, 30 m poleward
 * of 75°, else 118 m; coarser cells when the box needs more than `max_n` pixels across) and a coarse grid of 401²
 * cells covering max(2.2 × the fine half-width, 64 km near the poles / 95 km elsewhere), like the outer levels of C9.
 * Margin around the end points: max(3 km, 30 % of the distance), room for detours.
 * @throws RouteError("too_long") above max_km.
 */
export function planRouteGrid(start, end, { max_km = MAX_ROUTE_KM, max_n = MAX_GRID_N, margin_m = null } = {}) {
  const { dist_m, mid } = greatCircle(start, end);
  if (dist_m > max_km * 1000) {
    throw new RouteError("too_long", `The end points are ${(dist_m / 1000).toFixed(1)} km apart. Please keep a traverse under ${max_km} km (straight line).`);
  }
  const plane = makePlane(mid.lat_deg, mid.lon_deg);
  const s = plane.toXY(start.lat_deg, start.lon_deg), e = plane.toXY(end.lat_deg, end.lon_deg);
  const margin = margin_m ?? Math.max(3000, 0.3 * dist_m);
  const need = Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(e[0]), Math.abs(e[1])) + margin;
  // At least the near-field extent of terrainAt (401 px at the layer's resolution), so the horizons along the route
  // see nearby massifs at full resolution, as C9 does.
  const halfFor = (k) => Math.max(need, 200.5 * LAYERS[k].res_m);
  const fineKey = ["south20", "south30", "north30"].find((k) => layerCovers(k, mid.lat_deg, halfFor(k))) || "global118";
  const half = halfFor(fineKey);
  const res = LAYERS[fineKey].res_m;
  let n = Math.ceil((2 * half) / res);
  if (n % 2 === 0) n++;
  n = Math.min(n, max_n % 2 ? max_n : max_n - 1);
  const polar = Math.abs(mid.lat_deg) >= 75;
  const halfC = Math.max(2.2 * half, polar ? 64000 : 95000);
  const nC = 401, cellC = (2 * halfC) / nC;
  const coarseKey = ["south30", "north30", "global237"].find((k) => LAYERS[k].res_m <= cellC / 2 && layerCovers(k, mid.lat_deg, halfC)) || "global118";
  return {
    plane,
    dist_m,
    mid,
    start_xy: s,
    end_xy: e,
    fine: { key: fineKey, half_m: half, n, cell_m: (2 * half) / n },
    coarse: { key: coarseKey, half_m: halfC, n: nC, cell_m: cellC },
  };
}

/** Highest finite value of a grid (m). */
function gridMax(data) {
  let m = -Infinity;
  for (const v of data) if (v > m) m = v;
  return m;
}

/**
 * Fetch the route terrain: fine and coarse grids from Moon Trek (in parallel) and the C5 far-field sampler at the
 * route centre. A failed coarse grid is skipped (the tiles serve the mid-field); a failed fine grid throws.
 * @param {object} start, end      {lat_deg, lon_deg}
 * @param {object} [o]             {fetchFn, trekFetch, demBaseUrl = "data/dem", trekBase, grids: {fine, coarse} (tests)}
 * @returns {Promise<{plan, fine, coarse, far, meta: {bytes, ms, sources, fine_cell_m}}>}
 */
export async function fetchRouteTerrain(start, end, o = {}) {
  const t0 = Date.now();
  const plan = planRouteGrid(start, end, o);
  const fetchFn = o.fetchFn ?? ((u, init) => globalThis.fetch(u, init));
  const trekFetch = o.trekFetch ?? fetchFn;
  const { lat_deg, lon_deg } = plan.mid;
  // Moon Trek sometimes answers one request with a server error: one retry (a 90 s timeout is not retried).
  const get = (lv, tol) => fetchGrid(lv.key, lat_deg, lon_deg, lv.half_m, lv.n, {
    fetchFn: trekFetch, tolerance_m: tol, timeout_ms: 90000, base: o.trekBase, retries: 1, retryDelayMs: o.retryDelayMs ?? 800,
  });
  const [fine, coarse, far] = await Promise.all([
    o.grids?.fine ?? get(plan.fine, 0.05),
    (o.grids ? Promise.resolve(o.grids.coarse ?? null) : get(plan.coarse, 0.1)).catch(() => null),
    o.far ? Promise.resolve(o.far) : farField(lat_deg, lon_deg, { baseUrl: o.demBaseUrl ?? "data/dem", fetchFn }),
  ]);
  for (const g of [fine, coarse]) if (g) g.max_m = gridMax(g.data);
  const sources = [...new Set([fine, coarse].filter(Boolean).map((g) => `${LAYERS[g.layer]?.label ?? g.layer}, NASA Moon Trek (JPL) ImageServer`)), ...(far.sources || [])];
  return {
    plan,
    fine,
    coarse,
    far,
    meta: { bytes: (fine.bytes || 0) + (coarse?.bytes || 0) + (far.bytes || 0), ms: Date.now() - t0, sources, fine_cell_m: fine.cell_m },
  };
}

/** The fine grid as a planner grid (web/js/rover/planner.js): rows north to south, plane coordinates, curvature. */
export function plannerGrid(grid) {
  const { n, half_m, cell_m, data } = grid;
  return { nx: n, ny: n, cell_m, z: data, x0: -half_m + 0.5 * cell_m, y0: half_m - 0.5 * cell_m, inv4R2: INV_4R2 };
}

/** Nearest cell {r, c} of a grid to plane point (x, y), clamped to the grid. */
export function cellOf(grid, x, y) {
  const { n, half_m, cell_m } = grid;
  const c = Math.round((x + half_m) / cell_m - 0.5), r = Math.round((half_m - y) / cell_m - 0.5);
  return { r: Math.max(0, Math.min(n - 1, r)), c: Math.max(0, Math.min(n - 1, c)) };
}

/** Plane coordinates (m) of the centre of cell index `id` of a square grid. */
export function cellXY(grid, id) {
  const r = Math.floor(id / grid.n), c = id - r * grid.n;
  return [-grid.half_m + (c + 0.5) * grid.cell_m, grid.half_m - (r + 0.5) * grid.cell_m];
}

/**
 * A route grid seen from another site (lat_deg, lon_deg), in the shape the terrain ray march and patch builder take
 * (web/js/terrain/march.js: {half_m, cell_m, n, data} + the `at` sampler hook of gridBilinear):
 * at(x, y) maps a point of the SITE's stereographic plane to the sphere (exact inverse projection,
 * u = cos θ·up + (x·e + y·n)/(R(1 + t²)), t = r/2R, cos θ = (1 − t²)/(1 + t²)) and then into the ROUTE plane, and
 * samples the grid bilinearly there (NaN outside it, so the march falls through to the next source).
 * half_m is set so that the march tries the grid out to the farthest grid edge from the site; `data` holds only the
 * grid maximum (the march uses it for its stop rule).
 */
export function gridView(plane, grid, lat_deg, lon_deg) {
  const S = enuBasis(lat_deg, lon_deg), P = plane.enu;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const uu = dot(S.up, P.up), eu = dot(S.east, P.up), nu = dot(S.north, P.up);
  const ue = dot(S.up, P.east), ee = dot(S.east, P.east), ne = dot(S.north, P.east);
  const un = dot(S.up, P.north), en = dot(S.east, P.north), nn = dot(S.north, P.north);
  const K2 = 2 * R_M;
  const at = (x, y) => {
    const t2 = (x * x + y * y) * INV_4R2;
    const c = (1 - t2) / (1 + t2), f = 1 / (R_M * (1 + t2));
    const dU = c * uu + f * (x * eu + y * nu);
    const k = K2 / (1 + dU);
    return gridBilinear(grid, k * (c * ue + f * (x * ee + y * ne)), k * (c * un + f * (x * en + y * nn)));
  };
  const [X, Y] = plane.toXY(lat_deg, lon_deg);
  const h = grid.half_m;
  const reach = Math.max(h - X, h + X, h - Y, h + Y);
  return { at, half_m: reach + grid.cell_m, cell_m: grid.cell_m, n: grid.n, data: Float32Array.of(grid.max_m ?? gridMax(grid.data)) };
}
