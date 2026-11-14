// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Riding with the rover in the Sky tab: where the rover is at a time, and the sky site, skyline and 3D ground of the
// "station" it has reached. Stations are every few horizon samples (at most MAX_STATIONS per traverse, so a
// timelapse stays smooth); the sky state, the skyline and the ground of a station share one ENU frame (near the
// pole the azimuth frame turns quickly with position, so they must not be mixed). The 3D ground is a ±8 km patch
// built from the route grids (route.js routePatch). When the rover moves to the next station the camera is turned by
// the change of the local frame (frameTurnDeg), so it keeps looking at the same physical direction.

import { routePatch } from "./route.js";
import { enuBasis } from "../terrain/geom.js";

const MAX_STATIONS = 60;
const PATCHES = new Map(); // `${key}|${stationK}` -> patch

/** Samples per station for a route (≥ 1). */
function stride(route) {
  return Math.max(1, Math.ceil(route.samples.dist_m.length / MAX_STATIONS));
}

/**
 * The rover at time tMs of a traverse item (routeCore() result): {site (C6 site of the station), stationK (its
 * horizon sample), distance_m (exact distance driven), horizon (of the station), phase: "start" | "driving" |
 * "parked" | "arrived"}.
 */
export function rideAt(it, tMs) {
  const { result, track } = it.route;
  const dt = tMs - it.t0;
  const distance_m = track.distanceAt(dt);
  const k = track.sampleAt(distance_m);
  const s = stride(result);
  const n = result.samples.dist_m.length;
  const stationK = Math.min(n - 1, Math.round(k / s) * s);
  let phase = "driving";
  if (dt <= 0) phase = "start";
  else if (dt >= track.arrival_ms) phase = "arrived";
  else if (Math.abs(track.distanceAt(dt + 60e3) - distance_m) < 1e-6) phase = "parked";
  return { site: track.siteOf(stationK), stationK, distance_m, horizon: result.samples.horizons[stationK], phase };
}

/** In-memory C4 patch ({meta, data}) around the station of a ride (cached). */
export function ridePatch(it, ride) {
  const key = `${it.key}|${ride.stationK}`;
  if (!PATCHES.has(key)) {
    if (PATCHES.size > 80) PATCHES.delete(PATCHES.keys().next().value);
    const S = it.route.result.samples;
    PATCHES.set(key, routePatch(it.route.result, S.lat[ride.stationK], S.lon[ride.stationK], { half_extent_m: 8000, n: 257 }));
  }
  return PATCHES.get(key);
}

/**
 * Azimuth change (deg) of any fixed horizontal direction from site a's ENU frame to site b's: az_b = az_a + δ.
 * δ = azimuth of a's north in b's frame (exact for parallel "up" vectors; the sites are metres to km apart).
 */
export function frameTurnDeg(a, b) {
  const A = enuBasis(a.lat_deg, a.lon_deg), B = enuBasis(b.lat_deg, b.lon_deg);
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  return (Math.atan2(dot(A.north, B.east), dot(A.north, B.north)) * 180) / Math.PI;
}

/** Footer text of a rover card in the Sky tab. */
export function rideNote(it, ride) {
  const L = it.route.track.length_m / 1000;
  const d = ride.distance_m / 1000;
  const what = { start: "at the start", driving: "driving", parked: "parked", arrived: "arrived" }[ride.phase];
  return `🛞 Rover ${d.toFixed(d < 10 ? 2 : 1)} of ${L.toFixed(1)} km · ${what} · terrain: LOLA ${Math.round(it.route.result.meta.fine_cell_m)} m route grid`;
}
