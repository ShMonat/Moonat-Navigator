// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// A trip's "traffic", as Google Maps colours a drive time: the planned route's time over the time the same rover would
// need on flat ground along the straight lines (great circles) between consecutive points. Detours around no-go terrain
// and the uphill slowdown both raise the ratio; a straight flat route scores 1.0. Pure functions (node tests import them).

import { greatCircle } from "./terrain.js";
import { speedFactor } from "./presets.js";
import { timeline } from "./route.js";
import { formatDuration } from "../app/state.js";

/**
 * Colour thresholds of the delay ratio: below `orange` the duration is green, from `orange` to below `red` orange,
 * from `red` on red. Defaults pending Shay's review.
 */
export const DELAY_LEVELS = Object.freeze({ orange: 1.2, red: 1.5 });

/** "green" (ratio < 1.2), "orange" (1.2 to < 1.5) or "red" (≥ 1.5) with DELAY_LEVELS; null for a ratio that is not a number. */
export function delayLevel(ratio, levels = DELAY_LEVELS) {
  if (!Number.isFinite(ratio)) return null;
  if (ratio >= levels.red) return "red";
  if (ratio >= levels.orange) return "orange";
  return "green";
}

/**
 * Rest stops on a drive of `dist_m` metres under the route timeline's rule (route.js timeline): the rover parks
 * `stop_h` hours every `stop_every_km` km of driving, not at the end point. 0 when either setting is 0.
 */
export function restStops(dist_m, { stop_every_km = 0, stop_h = 0 } = {}) {
  if (!(stop_every_km > 0 && stop_h > 0) || !(dist_m > 0)) return 0;
  return Math.max(0, Math.ceil(dist_m / (stop_every_km * 1000)) - 1);
}

/**
 * The straight flat drive through `points` [{lat_deg, lon_deg}] (selenographic, deg): the great-circle lengths of the
 * legs on the 1737.4 km sphere, driven at the speed model's flat-ground speed (presets.js speedFactor at 0° slope,
 * i.e. `rover.speed_mps`), plus the rest stops of the same rule.
 * @returns {{length_m: number, drive_s: number, rest_s: number, total_s: number}}
 */
export function straightDrive(points, rover, stops = {}) {
  let length_m = 0;
  for (let i = 1; i < points.length; i++) length_m += greatCircle(points[i - 1], points[i]).dist_m;
  const v = rover.speed_mps * speedFactor(0, rover.mu ?? 0.1, rover.power_margin ?? 1);
  const drive_s = v > 0 ? length_m / v : NaN;
  const rest_s = restStops(length_m, stops) * (stops.stop_h || 0) * 3600;
  return { length_m, drive_s, rest_s, total_s: drive_s + rest_s };
}

/**
 * Delay of a planned route (planTrip / planRoute result, C10) against the straight flat drive through its points.
 * `stops` {stop_every_km, stop_h}: the rest stops (applied to both drives). `arrivalMs`: the route's drive time with
 * its stops (routeTrack().arrival_ms) when the caller has it; otherwise it comes from the route's own timeline.
 * @returns {{ratio, level, route_ms, straight_ms, delay_ms, length_m, straight_m, length_ratio}} times in ms, lengths in
 *   m; ratio = route_ms / straight_ms (NaN for points that coincide); length_ratio = length_m / straight_m.
 */
export function tripDelay(route, stops = {}, arrivalMs = null) {
  const points = route.waypoints || [route.start, route.end];
  const flat = straightDrive(points, route.rover, stops);
  const route_ms = Number.isFinite(arrivalMs) ? arrivalMs : timeline(route.path, stops).arrival_s * 1000;
  const straight_ms = flat.total_s * 1000;
  const ratio = straight_ms > 0 ? route_ms / straight_ms : NaN;
  const length_m = route.stats.length_m;
  return {
    ratio, level: delayLevel(ratio), route_ms, straight_ms, delay_ms: route_ms - straight_ms,
    length_m, straight_m: flat.length_m, length_ratio: flat.length_m > 0 ? length_m / flat.length_m : NaN,
  };
}

const km = (m) => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
const times = (x) => `${x.toFixed(x < 1.1 ? 2 : 1)}×`;

/**
 * The line under a trip's duration, like Google Maps' "+15 min due to traffic": "+14 h vs. a straight drive · route
 * 1.6× the straight line (21.0 km)"; under a minute of delay "As fast as a straight drive · …".
 */
export function delayText(d) {
  if (!Number.isFinite(d.ratio)) return "";
  const line = Number.isFinite(d.length_ratio) ? ` · route ${times(d.length_ratio)} the straight line (${km(d.straight_m)})` : "";
  if (!(d.delay_ms >= 60e3)) return `As fast as a straight drive${line}`;
  return `+${formatDuration(d.delay_ms)} vs. a straight drive${line}`;
}
