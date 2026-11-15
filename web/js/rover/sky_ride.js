// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Riding with the rover in the sky view while the timelapse plays: the eye moves continuously along the whole trip
// at the planned speeds (parked at rest stops, at the end after arrival).
// - Sky (Sun, Earth, their visibility): at the exact position on the path, with a skyline interpolated between the two
//   nearest horizon samples (every 100–250 m). Each sample's profile is turned into the local frame of the position
//   first (near the pole the azimuth frame turns quickly with position), so the blend is of the same directions.
// - 3D ground and drawn skyline: rebuilt where the rover is (the position rounded to a few grid cells), at most every
//   REBUILD_MS while the time runs, and once more where it stops. The ground is a ±8 km patch of the route grids
//   (route.js routePatch).
// - Camera: keeps looking at the same physical direction as the local frame turns, or with "Driver's view" (the
//   timelapse bar's camera group: the "ahead" track mode of sky_panel.js, fed by lookAheadDirection) faces the way
//   the rover drives: the path's heading, slightly up or down with the slope.

import { routePatch, bracket } from "./route.js";
import { legAtDistance } from "./trip.js";
import { enuBasis } from "../terrain/geom.js";
import { unitVec } from "./terrain.js";
import { makeSite } from "../physics/index.js";

const PATCHES = new Map(); // `${key}|${groundIndex}` -> patch
/** Fewest milliseconds between two rebuilds of a view's 3D ground while the time runs. */
const REBUILD_MS = 160;
const D2R = Math.PI / 180;

/** Ground step (m): the 3D ground and drawn skyline are rebuilt each time the rover moves this far. */
function groundStep(route) {
  return Math.max(20, Math.min(120, route.meta?.fine_cell_m || 30));
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

/** In-memory C4 patch ({meta, data}) and skyline of the ground point of a ride (cached). */
export function rideGround(it, ride) {
  const key = `${it.key}|${ride.ground.index}`;
  if (!PATCHES.has(key)) {
    if (PATCHES.size > 80) PATCHES.delete(PATCHES.keys().next().value);
    const g = ride.ground;
    const route = it.route.result;
    const patch = routePatch(route, g.lat_deg, g.lon_deg, { half_extent_m: 8000, n: 257, leg: legAtDistance(route, g.distance_m) });
    const horizon = g.distance_m === ride.distance_m ? ride.horizon : horizonAlong(route, g.distance_m, g);
    PATCHES.set(key, { patch, horizon });
  }
  return PATCHES.get(key);
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
}

/**
 * After a view shows a new moment of the ride: rebuild its 3D ground and drawn skyline at the rover's ground point
 * when it moved there, at most every REBUILD_MS (a last rebuild follows when the time stops).
 */
export function rideTerrain(rec, it, ride) {
  if (!rec.view?.setTerrain) return;
  const key = `${it.key}|${ride.ground.index}`;
  if (rec.rideGroundKey === key) {
    rec.ridePending = null;
    return;
  }
  rec.ridePending = { it, ride, key }; // a scheduled build takes the latest point
  if (rec.rideTimer) return;
  const build = () => {
    rec.rideTimer = 0;
    const p = rec.ridePending;
    rec.ridePending = null;
    if (!p || !rec.view || rec.rideGroundKey === p.key) return;
    const g = rideGround(p.it, p.ride);
    rec.rideGroundKey = p.key;
    rec.rideBuiltAt = performance.now();
    rec.view.setTerrain({ horizon: g.horizon, patch: g.patch });
  };
  const wait = REBUILD_MS - (performance.now() - (rec.rideBuiltAt || 0));
  if (wait <= 0) build();
  else rec.rideTimer = setTimeout(build, wait);
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
