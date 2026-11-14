// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The app side of a rover traverse scenario (C7 + `route`, contract C10): turns the scenario into a planning request,
// and computes the item the sky views and the data under them show (same shape as a static scenario, plus `route`).

import { planRoute, routeTrack, routeSeries, RouteError } from "./index.js";
import { PRESETS, roverParams } from "./presets.js";
import { skyState } from "../physics/index.js";
import { parseUtc, chooseStep, physicsKey, HOUR_MS } from "../app/state.js";

/** Default `route` field of a new traverse scenario (end point still to pick). */
export function newRouteFields(preset = "viper") {
  const p = PRESETS[preset] || PRESETS.viper;
  return {
    end_lat_deg: null, end_lon_deg: null, preset: p.id, speed_mps: p.speed_mps, max_slope_deg: p.max_slope_deg,
    max_cross_deg: p.max_cross_deg, stop_every_km: 0, stop_h: 0,
  };
}

/** Planning request of a traverse scenario: {start, end, rover, stops, complete}. */
export function routeRequest(s) {
  const r = s.route || {};
  const base = PRESETS[r.preset] ? r.preset : "viper";
  const rover = { ...roverParams(base, r), preset: base };
  const start = { lat_deg: s.lat_deg, lon_deg: s.lon_deg };
  const end = { lat_deg: r.end_lat_deg, lon_deg: r.end_lon_deg };
  const ok = (p) => Number.isFinite(p.lat_deg) && Number.isFinite(p.lon_deg) && Math.abs(p.lat_deg) <= 90 && Math.abs(p.lon_deg) <= 180;
  return {
    start, end, rover,
    stops: { stop_every_km: Math.max(0, Number(r.stop_every_km) || 0), stop_h: Math.max(0, Number(r.stop_h) || 0) },
    complete: ok(start) && ok(end),
  };
}

/**
 * Compute a traverse scenario for the sky views and the data under them. Without an end time the window ends on arrival.
 * Returns { key, site, horizon, patch: null, t0, t1, span, state0, series, look: null, error: null, route } where
 * site/horizon are those of the start, series is routeSeries() (C6 + distance_km, position, ...) and
 * route = { result (planRoute), track (routeTrack), req }.
 */
export async function routeCore(s) {
  const req = routeRequest(s);
  if (!req.complete) throw new RouteError("incomplete", "Pick the start and the end of the traverse.");
  const result = await planRoute(req.start, req.end, req.rover);
  const track = routeTrack(result, req.stops);
  const t0 = parseUtc(s.t_start_utc);
  let t1 = s.t_end_utc ? parseUtc(s.t_end_utc) : t0 + Math.ceil(track.arrival_ms / 60e3) * 60e3;
  if (!(t1 > t0)) t1 = t0 + HOUR_MS; // a zero-length route still gets a short window
  const span = t1 - t0;
  const series = await routeSeries(result, t0, t1, chooseStep(span), { track });
  const { site } = track.siteAt(0);
  const state0 = await skyState(site, t0);
  return {
    key: physicsKey(s), site, horizon: result.samples.horizons[0], patch: null, t0, t1, span, state0, series, look: null, error: null,
    route: { result, track, req },
  };
}
