// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Riding with the rover in the sky view while the timelapse plays: the eye moves continuously along the whole trip
// at the planned speeds (parked at rest stops, at the end after arrival).
// - Sky (Sun, Earth, their visibility): at the exact position on the path, with a skyline interpolated between the two
//   nearest horizon samples (every 100–250 m). Each sample's profile is turned into the local frame of the position
//   first (near the pole the azimuth frame turns quickly with position), so the blend is of the same directions.
// - 3D ground and drawn skyline: rebuilt where the rover is (the position rounded to a few grid cells), at most every
//   REBUILD_MS while the time runs, and once more where it stops. The ground is a ±8 km patch of the route grids
//   (route.js routePatch), computed in a Web Worker (ground.js) while the frames go on; the view then gives its
//   meshes the new heights in place (sky/terrain.js setGround).
// - Decorative detail (bumps, small craters, rocks; sky/detail.js): anchored to the ground in the trip's map frame
//   (the stereographic plane of the route, as route.path x, y), computed with each ground in the worker. Between
//   rebuilds the view moves and turns its near field every frame (setEye) so the eye is at the rover's exact position:
//   the detail and the ground stream past instead of travelling with the rover.
// - Camera: keeps looking at the same physical direction as the local frame turns, or with "Driver's view" (the
//   timelapse bar's camera group: the "ahead" track mode of sky_panel.js, fed by lookAheadDirection) faces the way
//   the rover drives: the path's heading, slightly up or down with the slope.

import { routePatch, bracket } from "./route.js";
import { legAtDistance } from "./trip.js";
import { enuBasis, R_M } from "../terrain/geom.js";
import { unitVec, makePlane } from "./terrain.js";
import { makeSite } from "../physics/index.js";
import { groundAt } from "./ground.js";
import { groundDetail, laneSegments, toLocal } from "../sky/detail.js";

const PATCHES = new Map(); // `${key}|${groundIndex}` -> patch
const MAX_PATCHES = 80;
/** The 3D ground of a ride: a ±8 km C4 patch, 257 × 257 (route.js routePatch). */
const GROUND = { half_extent_m: 8000, n: 257 };
/** Fewest milliseconds between two rebuilds of a view's 3D ground while the time runs. */
export const REBUILD_MS = 160;
const D2R = Math.PI / 180;

/**
 * Ground step (m): the 3D ground and drawn skyline are rebuilt each time the rover moves this far (at most every
 * REBUILD_MS). Between rebuilds setEye moves the near field with the rover; a short step keeps the eye near the
 * mesh's finest rings, so the ground at the rover's feet stays as detailed as in a static view.
 */
function groundStep() {
  return 10;
}

/** Azimuth change (deg) of any fixed horizontal direction from site a's ENU frame to site b's: az_b = az_a + δ. */
export function frameTurnDeg(a, b) {
  const A = enuBasis(a.lat_deg, a.lon_deg), B = enuBasis(b.lat_deg, b.lon_deg);
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  return (Math.atan2(dot(A.north, B.east), dot(A.north, B.north)) * 180) / Math.PI;
}

/** Elevation (deg) of a C3 profile at a fractional azimuth (linear, wrapping). */
function elAt(h, az) {
  const n = h.el_deg.length, step = Number(h.az_step_deg) || 360 / n;
  let x = (((az % 360) + 360) % 360) / step;
  const k = Math.floor(x) % n;
  x -= Math.floor(x);
  return h.el_deg[k] * (1 - x) + h.el_deg[(k + 1) % n] * x;
}
function distAt(h, az) {
  if (!h.dist_km) return null;
  const n = h.dist_km.length, step = Number(h.az_step_deg) || 360 / n;
  const k = Math.round((((az % 360) + 360) % 360) / step) % n;
  return h.dist_km[k];
}

/**
 * The skyline (C3 shape, in the local frame of point p) at distance d along a route: the profiles of the two samples
 * around d, each turned into p's frame, blended linearly by distance.
 */
export function horizonAlong(route, d, p) {
  const S = route.samples, H = S.horizons;
  const n = S.dist_m.length;
  const k = n < 2 ? 0 : bracket(S.dist_m, d);
  const k1 = Math.min(n - 1, k + 1);
  const span = S.dist_m[k1] - S.dist_m[k];
  const f = span > 0 ? Math.max(0, Math.min(1, (d - S.dist_m[k]) / span)) : 0;
  const ha = H[k], hb = H[k1];
  const ta = frameTurnDeg(p, { lat_deg: S.lat[k], lon_deg: S.lon[k] });
  const tb = frameTurnDeg(p, { lat_deg: S.lat[k1], lon_deg: S.lon[k1] });
  const m = ha.el_deg.length, step = Number(ha.az_step_deg) || 360 / m;
  const el = new Array(m), dist = ha.dist_km ? new Array(m) : null;
  for (let i = 0; i < m; i++) {
    const az = i * step;
    el[i] = (1 - f) * elAt(ha, az + ta) + f * elAt(hb, az + tb);
    if (dist) dist[i] = f < 0.5 ? distAt(ha, az + ta) : distAt(hb, az + tb);
  }
  return {
    ...ha, lat_deg: p.lat_deg, lon_deg: p.lon_deg,
    ground_elev_m: (1 - f) * ha.ground_elev_m + f * hb.ground_elev_m,
    el_deg: el, dist_km: dist, source: "rover-route",
  };
}

/** Direction of travel at distance d: {heading_deg (local azimuth at p), slope_deg (+ uphill)} over a short baseline. */
function headingAt(track, route, d, p) {
  const L = track.length_m;
  if (!(L > 0)) return { heading_deg: null, slope_deg: 0 };
  const base = Math.max(40, Math.min(300, 3 * (route.meta?.fine_cell_m || 30)));
  let a = Math.max(0, d - base), b = Math.min(L, d + base);
  if (b - a < base) (a === 0 ? (b = Math.min(L, 2 * base)) : (a = Math.max(0, L - 2 * base)));
  const pa = track.positionAt(a), pb = track.positionAt(b);
  const ua = unitVec(pa.lat_deg, pa.lon_deg), ub = unitVec(pb.lat_deg, pb.lon_deg);
  const v = [ub[0] - ua[0], ub[1] - ua[1], ub[2] - ua[2]];
  const { east, north } = enuBasis(p.lat_deg, p.lon_deg);
  const ve = v[0] * east[0] + v[1] * east[1] + v[2] * east[2];
  const vn = v[0] * north[0] + v[1] * north[1] + v[2] * north[2];
  const az = (Math.atan2(ve, vn) / D2R + 360) % 360;
  const slope = b > a ? Math.atan2(pb.elev_m - pa.elev_m, b - a) / D2R : 0;
  return { heading_deg: az, slope_deg: slope };
}

/**
 * The rover at time tMs of a trip item (routeCore() result): {site (C6 site at the exact position, with the blended
 * skyline), horizon, distance_m, position {lat_deg, lon_deg, elev_m}, heading_deg, slope_deg, leg, phase: "start" |
 * "driving" | "parked" | "arrived", ground: {index, lat_deg, lon_deg, distance_m} (where the 3D ground is built)}.
 */
export function rideAt(it, tMs) {
  const { result, track } = it.route;
  const dt = tMs - it.t0;
  const d = track.distanceAt(dt);
  const cache = it._ride;
  if (cache && cache.d === d && cache.dt === dt) return cache.ride;
  const p = track.positionAt(d);
  const horizon = horizonAlong(result, d, p);
  const site = makeSite({ lat_deg: p.lat_deg, lon_deg: p.lon_deg, ground_elev_m: horizon.ground_elev_m, observer_height_m: horizon.observer_height_m ?? 2, horizon });
  let phase = "driving";
  if (dt <= 0) phase = "start";
  else if (dt >= track.arrival_ms) phase = "arrived";
  else if (Math.abs(track.distanceAt(dt + 60e3) - d) < 1e-6) phase = "parked";
  const q = groundStep(result);
  const gi = Math.round(d / q);
  const gd = Math.max(0, Math.min(track.length_m, gi * q));
  const gp = gd === d ? p : track.positionAt(gd);
  const ride = {
    site, horizon, distance_m: d, position: p, ...headingAt(track, result, d, p), leg: legAtDistance(result, d), phase,
    ground: { index: gi, lat_deg: gp.lat_deg, lon_deg: gp.lon_deg, distance_m: gd },
  };
  Object.defineProperty(it, "_ride", { value: { d, dt, ride }, configurable: true, enumerable: false, writable: true });
  return ride;
}

const groundKey = (it, ride) => `${it.key}|${ride.ground.index}`;
const groundOpts = (route, g) => ({ ...GROUND, leg: legAtDistance(route, g.distance_m) });

const FRAMES = new WeakMap(); // route result -> its map frame

/**
 * The trip's map frame: the stereographic plane of the route (tangent at route.centre; metres, x toward east and y
 * toward north there), the frame of route.path x, y. One frame for the whole trip.
 */
function mapFrame(route) {
  let f = FRAMES.get(route);
  if (!f) {
    f = { plane: makePlane(route.centre.lat_deg, route.centre.lon_deg), path: route.path };
    FRAMES.set(route, f);
  }
  return f;
}

/** Map position (m) of the point at local (east, north) m from p = {lat_deg, lon_deg} (along the sphere). */
function mapOffset(frame, p, east = 0, north = 0) {
  if (!east && !north) return frame.plane.toXY(p.lat_deg, p.lon_deg);
  const B = enuBasis(p.lat_deg, p.lon_deg), u = [0, 1, 2].map((i) => B.up[i] + (east * B.east[i] + north * B.north[i]) / R_M);
  const k = Math.hypot(u[0], u[1], u[2]);
  return frame.plane.toXY(Math.asin(u[2] / k) / D2R, Math.atan2(u[1], u[0]) / D2R);
}

/**
 * The anchor of the detail around ground point g (sky/detail.js): its map position and the map metres per metre east
 * and per metre north there (central differences over ±50 m).
 */
export function anchorAt(route, g) {
  const f = mapFrame(route), L = 50;
  const [x0, y0] = mapOffset(f, g), e1 = mapOffset(f, g, L, 0), e0 = mapOffset(f, g, -L, 0);
  const n1 = mapOffset(f, g, 0, L), n0 = mapOffset(f, g, 0, -L);
  return { x0, y0, ax: [(e1[0] - e0[0]) / (2 * L), (e1[1] - e0[1]) / (2 * L)], an: [(n1[0] - n0[0]) / (2 * L), (n1[1] - n0[1]) / (2 * L)] };
}

/** What the worker needs for the detail of ground point g: the anchor and the path near it (no rocks on the path). */
function detailRequest(route, g) {
  const anchor = anchorAt(route, g);
  return { anchor, lane: laneSegments(mapFrame(route).path, anchor.x0, anchor.y0, 600) };
}

/**
 * Where the eye is relative to a ground on show (sky/index.js setEye): the rover's local (east, north) m from the
 * ground point, and the turn of the azimuth frame from the ground point to the rover.
 */
export function eyeOffset(it, shown, ride) {
  const [x, y] = mapOffset(mapFrame(it.route.result), ride.position);
  const [east, north] = toLocal(shown.anchor, x, y);
  return { east, north, turn_deg: frameTurnDeg(shown.at, ride.position) };
}

/** Keep the ground of a ride point; the skyline drawn with it is the blended one at the ground point. */
function remember(key, it, ride, patch, detail) {
  const g = ride.ground, route = it.route.result;
  const horizon = g.distance_m === ride.distance_m ? ride.horizon : horizonAlong(route, g.distance_m, g);
  if (PATCHES.size >= MAX_PATCHES) PATCHES.delete(PATCHES.keys().next().value);
  PATCHES.set(key, { patch, horizon, detail, anchor: detail?.anchor ?? null, at: { lat_deg: g.lat_deg, lon_deg: g.lon_deg } });
  return PATCHES.get(key);
}

/**
 * In-memory C4 patch ({meta, data}), skyline and world-anchored detail of the ground point of a ride (cached),
 * computed here: {patch, horizon, detail, anchor, at (the ground point)}.
 */
export function rideGround(it, ride) {
  const key = groundKey(it, ride);
  if (PATCHES.has(key)) return PATCHES.get(key);
  const g = ride.ground, route = it.route.result;
  const patch = routePatch(route, g.lat_deg, g.lon_deg, groundOpts(route, g));
  return remember(key, it, ride, patch, groundDetail(patch.meta, detailRequest(route, g)));
}

/** The same as rideGround, computed in the Web Worker (ground.js). */
export async function rideGroundAsync(it, ride) {
  const key = groundKey(it, ride);
  if (PATCHES.has(key)) return PATCHES.get(key);
  const g = ride.ground, route = it.route.result;
  const { patch, detail } = await groundAt(route, g.lat_deg, g.lon_deg, groundOpts(route, g), detailRequest(route, g));
  return PATCHES.get(key) ?? remember(key, it, ride, patch, detail);
}

/**
 * The direction a trip's view faces in the driver's view (sky_panel.js setLookAheadSource, track mode "ahead"):
 * { az_deg: the path's heading at the rover, el_deg: slightly up or down with the slope (deg, local horizon frame of
 * ride.site) }, or null at a standstill without a heading. The view eases toward it (C8 setTrack).
 */
export function lookAheadDirection(it, tMs, ride) {
  if (!ride || !Number.isFinite(ride.heading_deg)) return null;
  return { az_deg: ride.heading_deg, el_deg: Math.max(-8, Math.min(10, 0.7 * ride.slope_deg)) + 1.5 };
}

/**
 * Before a view shows a new moment of the ride: keep the camera on the same physical direction while the local frame
 * turns (near the pole it turns quickly with position). In the driver's view (ahead) the track mode aims it instead.
 * The view's near field is moved so the eye is at the rover's exact position (setEye; the ground on show was built
 * around a ground point up to one rebuild behind).
 */
export function rideCamera(rec, ride, { ahead = false } = {}) {
  const view = rec.view;
  if (view && !ahead && rec.rideSite && view.getView) {
    const turn = frameTurnDeg(rec.rideSite, ride.site);
    if (Math.abs(turn) > 0.02) {
      const v = view.getView();
      view.lookAt(v.az_deg + turn, v.el_deg);
    }
  }
  rec.rideSite = ride.site;
  rec.rideLast = ride;
  const shown = PATCHES.get(rec.rideGroundKey) ?? rec.rideShown;
  if (view?.setEye && shown?.anchor && rec.it?.route) view.setEye(eyeOffset(rec.it, shown, ride));
}

/**
 * After a view shows a new moment of the ride: rebuild its 3D ground and drawn skyline at the rover's ground point
 * when it moved there, at most every REBUILD_MS (a last rebuild follows when the time stops). The ground comes from
 * `ground(it, ride)` (default rideGroundAsync: the patch is computed in the worker), one at a time per view: while one
 * is on its way, newer points only replace the pending one, and the next build takes the latest. A ground that
 * arrives after the card changed trip is dropped.
 */
export function rideTerrain(rec, it, ride, { ground = rideGroundAsync } = {}) {
  if (!rec.view?.setTerrain) return;
  const key = groundKey(it, ride);
  if (rec.rideGroundKey === key) {
    rec.ridePending = null;
    return;
  }
  rec.ridePending = { it, ride, key, ground };
  if (!rec.rideTimer && !rec.rideBusy) scheduleGround(rec);
}

function scheduleGround(rec) {
  const wait = rec.rideBuiltAt ? REBUILD_MS - (performance.now() - rec.rideBuiltAt) : 0;
  if (wait <= 0) buildGround(rec);
  else {
    rec.rideTimer = setTimeout(() => {
      rec.rideTimer = 0;
      buildGround(rec);
    }, wait);
  }
}

async function buildGround(rec) {
  const p = rec.ridePending;
  rec.ridePending = null;
  if (!p || !rec.view || rec.rideGroundKey === p.key) return;
  rec.rideBusy = true;
  rec.rideBuiltAt = performance.now();
  let g = null;
  try {
    g = await p.ground(p.it, p.ride);
  } catch (err) {
    console.warn("[moonat] rover ground failed", err);
  } finally {
    rec.rideBusy = false;
  }
  if (g && rec.view?.setTerrain && rec.it === p.it && rec.rideGroundKey !== p.key) {
    rec.rideGroundKey = p.key;
    rec.rideShown = g;
    // The eye where the rover is now, relative to the new ground point, in the same render.
    const eye = g.anchor && p.it.route ? eyeOffset(p.it, g, rec.rideLast ?? p.ride) : null;
    rec.view.setTerrain({ horizon: g.horizon, patch: g.patch, detail: g.detail, eye });
  }
  if (rec.ridePending) scheduleGround(rec);
}

/** Footer text of a trip's sky card. */
export function rideNote(it, ride) {
  const L = it.route.track.length_m / 1000;
  const d = ride.distance_m / 1000;
  const what = { start: "at the start", driving: "driving", parked: "resting", arrived: "arrived" }[ride.phase];
  const legs = it.route.result.leg_info;
  const leg = legs && ride.phase !== "arrived" ? ` (${String.fromCharCode(65 + ride.leg)} → ${String.fromCharCode(66 + ride.leg)})` : "";
  return `Rover ${d.toFixed(d < 10 ? 2 : 1)} of ${L.toFixed(1)} km · ${what}${leg} · terrain: LOLA ${Math.round(it.route.result.meta.fine_cell_m)} m route grid`;
}
