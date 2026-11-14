// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Multi-stop rover trips (contract C10): a trip through waypoints A → B → C … is planned leg by leg with the
// single-leg planner (route.js, one terrain grid and one A* search per leg), then the legs are joined here into one
// route of the same shape as a single leg (path, samples, stats), with distance and driving time cumulative over the
// whole trip. Pure functions (no workers, no fetch), so node tests can run them on synthetic legs.

import { makePlane, greatCircle, unitVec } from "./terrain.js";
import { bracket } from "./route.js";

const GENERATED_BY = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.";
const D2R = Math.PI / 180;

/**
 * Centre of a set of points {lat_deg, lon_deg} on the sphere: the normalised mean of their unit vectors (the
 * tangent point of the trip's stereographic plane). One point: itself.
 */
export function tripCentre(points) {
  if (points.length === 1) return { lat_deg: points[0].lat_deg, lon_deg: points[0].lon_deg };
  const m = [0, 0, 0];
  for (const p of points) {
    const u = unitVec(p.lat_deg, p.lon_deg);
    m[0] += u[0]; m[1] += u[1]; m[2] += u[2];
  }
  const n = Math.hypot(m[0], m[1], m[2]);
  if (n < 1e-12) return { lat_deg: points[0].lat_deg, lon_deg: points[0].lon_deg };
  return { lat_deg: Math.asin(Math.max(-1, Math.min(1, m[2] / n))) / D2R, lon_deg: Math.atan2(m[1], m[0]) / D2R };
}

/** Letter of waypoint i (0 = A, the start). */
export function waypointLetter(i) {
  return String.fromCharCode(65 + (i % 26));
}

/**
 * Join planned legs (single-leg routes, route.js computeRoute / index.js planRoute results, leg j from waypoint j to
 * j+1) into one trip route. One leg is returned as it is.
 *
 * Joined route (C10 shape plus `legs` and `leg_info`):
 *   path:    vertices of all legs in order; x, y in the trip's own stereographic plane (tangent at `centre`, the
 *            centroid of the waypoints; the plane scale is 1 + r²/4R², below 1.0005 within 100 km of the centre);
 *            dist_m and time_s cumulative from the trip start. Between legs, the last vertex of leg j and the first
 *            of leg j+1 (both within a grid cell, or the 300 m snap, of the shared waypoint) are joined by a straight
 *            segment driven at the level speed; along_deg/cross_deg/speed_mps of that segment sit at the first vertex
 *            of leg j+1.
 *   samples: the legs' horizon samples, with cumulative dist_m, x, y in the trip plane, and `leg` (leg index).
 *   stats:   sums (length, straight lines of the legs, driving time, climb, descent) and maxima (slopes).
 *   legs:    the leg routes (their terrain grids and previews, used by routePatch and the route map).
 *   leg_info: per leg {from, to, dist0_m, time0_s, length_m, drive_s, straight_m, sample0, vertex0}.
 *   preview, terrain: null (each leg has its own).
 */
export function joinLegs(legs) {
  if (!legs.length) throw new Error("joinLegs: no legs");
  if (legs.length === 1) return legs[0];
  const waypoints = [legs[0].start, ...legs.map((L) => L.end)];
  const centre = tripCentre(waypoints);
  const plane = makePlane(centre.lat_deg, centre.lon_deg);
  const rover = legs[0].rover;
  const path = { x: [], y: [], lat: [], lon: [], elev_m: [], slope_deg: [], dist_m: [], time_s: [], along_deg: [], cross_deg: [], speed_mps: [] };
  const samples = { dist_m: [], lat: [], lon: [], elev_m: [], x: [], y: [], horizons: [], leg: [] };
  const legInfo = [];
  let d0 = 0, t0 = 0, climb = 0, descent = 0, maxAlong = 0, maxCross = 0, maxSlope = 0, straight = 0;
  legs.forEach((L, j) => {
    const P = L.path, S = L.samples;
    let gap = 0, gapT = 0, gapAlong = 0;
    if (j > 0) {
      const a = { lat_deg: path.lat.at(-1), lon_deg: path.lon.at(-1) };
      gap = greatCircle(a, { lat_deg: P.lat[0], lon_deg: P.lon[0] }).dist_m;
      gapT = gap > 0 ? gap / rover.speed_mps : 0;
      const dz = P.elev_m[0] - path.elev_m.at(-1);
      gapAlong = gap > 0 ? Math.atan2(dz, gap) / D2R : 0;
      if (dz > 0) climb += dz; else descent -= dz;
      maxAlong = Math.max(maxAlong, Math.abs(gapAlong));
    }
    const ld = d0 + gap, lt = t0 + gapT;
    legInfo.push({
      from: L.start, to: L.end, dist0_m: ld, time0_s: lt, length_m: P.dist_m.at(-1), drive_s: P.time_s.at(-1),
      straight_m: L.stats.straight_m, sample0: samples.dist_m.length, vertex0: path.dist_m.length,
    });
    for (let i = 0; i < P.dist_m.length; i++) {
      const [x, y] = plane.toXY(P.lat[i], P.lon[i]);
      path.x.push(x); path.y.push(y); path.lat.push(P.lat[i]); path.lon.push(P.lon[i]);
      path.elev_m.push(P.elev_m[i]); path.slope_deg.push(P.slope_deg[i]);
      path.dist_m.push(ld + P.dist_m[i]); path.time_s.push(lt + P.time_s[i]);
      const joint = j > 0 && i === 0;
      path.along_deg.push(joint ? gapAlong : P.along_deg[i]);
      path.cross_deg.push(joint ? 0 : P.cross_deg[i]);
      path.speed_mps.push(joint ? rover.speed_mps : P.speed_mps[i]);
    }
    for (let k = 0; k < S.dist_m.length; k++) {
      const [x, y] = plane.toXY(S.lat[k], S.lon[k]);
      samples.dist_m.push(ld + S.dist_m[k]); samples.lat.push(S.lat[k]); samples.lon.push(S.lon[k]);
      samples.elev_m.push(S.elev_m[k]); samples.x.push(x); samples.y.push(y);
      samples.horizons.push(S.horizons ? S.horizons[k] : null); samples.leg.push(j);
    }
    climb += L.stats.climb_m;
    descent += L.stats.descent_m;
    maxAlong = Math.max(maxAlong, L.stats.max_along_deg);
    maxCross = Math.max(maxCross, L.stats.max_cross_deg);
    maxSlope = Math.max(maxSlope, L.stats.max_slope_deg);
    straight += L.stats.straight_m;
    d0 = ld + P.dist_m.at(-1);
    t0 = lt + P.time_s.at(-1);
  });
  const sum = (f) => legs.reduce((a, L) => a + (f(L) || 0), 0);
  const max = (f) => Math.max(...legs.map((L) => f(L) || 0));
  return {
    start: { ...legs[0].start },
    end: { ...legs.at(-1).end },
    waypoints: waypoints.map((p) => ({ lat_deg: p.lat_deg, lon_deg: p.lon_deg })),
    centre,
    rover,
    path,
    samples,
    stats: {
      length_m: d0,
      straight_m: straight,
      drive_s: t0,
      mean_speed_mps: t0 > 0 ? d0 / t0 : 0,
      max_along_deg: maxAlong,
      max_cross_deg: maxCross,
      max_slope_deg: maxSlope,
      climb_m: climb,
      descent_m: descent,
      snapped_start_m: legs[0].stats.snapped_start_m,
      snapped_end_m: legs.at(-1).stats.snapped_end_m,
    },
    preview: null,
    terrain: null,
    legs,
    leg_info: legInfo,
    meta: {
      sources: [...new Set(legs.flatMap((L) => L.meta.sources || []))],
      bytes: sum((L) => L.meta.bytes),
      grid_n: max((L) => L.meta.grid_n),
      fine_cell_m: max((L) => L.meta.fine_cell_m),
      coarse_cell_m: max((L) => L.meta.coarse_cell_m),
      expanded: sum((L) => L.meta.expanded),
      ms: {
        terrain: sum((L) => L.meta.ms?.terrain), plan: sum((L) => L.meta.ms?.plan),
        horizons: sum((L) => L.meta.ms?.horizons), total: sum((L) => L.meta.ms?.total),
      },
      n_samples: samples.dist_m.length,
      n_legs: legs.length,
      _generated_by: GENERATED_BY,
    },
  };
}

/** Index of the leg a trip distance d (m) falls in (0 for a single-leg route). */
export function legAtDistance(route, d) {
  if (!route.leg_info) return 0;
  const starts = route.leg_info.map((l) => l.dist0_m);
  return d <= starts[0] ? 0 : bracket([...starts, Infinity], d);
}
