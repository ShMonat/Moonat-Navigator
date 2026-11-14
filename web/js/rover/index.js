// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Public API of the rover trip planner (contract C10 `rover-traverse`, docs/CONTRACTS.md).
//
//   import { planTrip, planRoute, routeSeries } from './js/rover/index.js';
//   const route = await planTrip([A, B, C], {preset: 'viper'}, {onProgress});   // waypoints {lat_deg, lon_deg}
//   const leg = await planRoute(A, B, {preset: 'viper'}, {onProgress});          // one leg (= planTrip([A, B]))
//   const s = await routeSeries(route, t0Ms, t1Ms, stepMs);   // C6 series + distance_km, position, ...
//
// planRoute runs in a module Web Worker when one is available (Moon Trek fetch + A* + ~200 horizon ray marches take
// 5–20 s), inline in Node or with {worker: false}. Results are cached per (end points, rover); a trip is cached per
// (waypoints, rover) and reuses the cached legs, so adding a stop plans only the new legs.

import { computeRoute, routePatch, timeline, distanceAtTime, pointAtDistance } from "./route.js";
import { RouteError, MAX_ROUTE_KM, makePlane, greatCircle } from "./terrain.js";
import { PRESETS, DEFAULT_PRESET, roverParams, speedFactor } from "./presets.js";
import { routeSeries, routeTrack } from "./series.js";
import { joinLegs, tripCentre, waypointLetter, legAtDistance } from "./trip.js";

export { computeRoute, routePatch, timeline, distanceAtTime, pointAtDistance, RouteError, MAX_ROUTE_KM, makePlane };
export { PRESETS, DEFAULT_PRESET, roverParams, speedFactor, routeSeries, routeTrack, joinLegs, tripCentre, waypointLetter, legAtDistance };

const CACHE = new Map(); // key -> Promise<route>
const LISTENERS = new Map(); // key -> Set<fn(stage, frac)>
const LAST = new Map(); // key -> last progress {stage, frac}
let worker = null, nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (ev) => {
      const { id, result, error, code, progress } = ev.data;
      const p = pending.get(id);
      if (!p) return;
      if (progress) return p.onProgress(progress.stage, progress.frac);
      pending.delete(id);
      if (error) p.reject(new RouteError(code || "error", error));
      else p.resolve(result);
    };
    worker.onerror = (ev) => {
      for (const p of pending.values()) p.reject(new Error(`rover worker failed: ${ev.message || "error"}`));
      pending.clear();
      worker = false;
    };
  } catch {
    worker = false;
  }
  return worker;
}

function absolute(url) {
  try {
    const base = typeof document !== "undefined" ? document.baseURI : globalThis.location?.href;
    return base ? new URL(url, base).href : url;
  } catch {
    return url;
  }
}

/** A horizons job (worker.js type "horizons") for some sample indices of a planned route; the grids are copied. */
function horizonJob(route, ks, o) {
  const S = route.samples;
  return {
    centre: route.centre, fine: route.terrain.fine, coarse: route.terrain.coarse, sources: route.meta.sources,
    points: ks.map((k) => ({ lat_deg: S.lat[k], lon_deg: S.lon[k] })),
    demBaseUrl: o.demBaseUrl, observer_height_m: o.observer_height_m ?? 2, az_step_deg: o.az_step_deg ?? 0.5,
  };
}

/**
 * Horizons of all samples of a route, split over a few short-lived module workers (≤ 4, one per spare core).
 * Each ray-marches a contiguous block of samples; results come back in order.
 */
async function poolHorizons(route, o, onProgress) {
  const n = route.samples.lat.length;
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2;
  const P = Math.max(1, Math.min(4, cores - 1, Math.ceil(n / 15)));
  const done = new Array(P).fill(0);
  const blocks = Array.from({ length: P }, (_, j) => {
    const a = Math.floor((j * n) / P), b = Math.floor(((j + 1) * n) / P);
    return Array.from({ length: b - a }, (_, i) => a + i);
  });
  const workers = [];
  try {
    const parts = await Promise.all(blocks.map((ks, j) => new Promise((resolve, reject) => {
      const wk = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      workers.push(wk);
      wk.onmessage = (ev) => {
        const { result, error, progress } = ev.data;
        if (progress) {
          done[j] = progress.frac * ks.length;
          onProgress(done.reduce((s, v) => s + v, 0) / n);
          return;
        }
        if (error) reject(new Error(error));
        else resolve(result);
      };
      wk.onerror = (ev) => reject(new Error(ev.message || "horizon worker failed"));
      wk.postMessage({ id: 1, type: "horizons", job: horizonJob(route, ks, o) });
    })));
    return parts.flat();
  } finally {
    for (const wk of workers) wk.terminate();
  }
}

/** Cache key of a planning request (end points to 1e-5°, rover parameters). */
export function routeKey(start, end, rover) {
  const r = roverParams(rover?.preset, rover || {});
  const f = (x) => Math.round(x * 1e5) / 1e5;
  return JSON.stringify([f(start.lat_deg), f(start.lon_deg), f(end.lat_deg), f(end.lon_deg), r.speed_mps, r.max_slope_deg, r.max_cross_deg, r.mu, r.power_margin]);
}

/** Follow the progress of a planning request: fn(stage: "terrain" | "plan" | "horizons", frac 0..1). Returns an unsubscribe. */
export function onRouteProgress(key, fn) {
  if (!LISTENERS.has(key)) LISTENERS.set(key, new Set());
  LISTENERS.get(key).add(fn);
  if (LAST.has(key)) fn(LAST.get(key).stage, LAST.get(key).frac);
  return () => LISTENERS.get(key)?.delete(fn);
}

/** The cached planning promise for a key, or null. */
export function cachedRoute(key) {
  return CACHE.get(key) || null;
}

/**
 * Plan a traverse (cached). See route.js computeRoute for the result.
 * @param {{lat_deg, lon_deg}} start, end
 * @param {object} rover  {preset, speed_mps, max_slope_deg, max_cross_deg}
 * @param {object} [opts] {worker = true, demBaseUrl = "data/dem", fetch, onProgress}
 */
export function planRoute(start, end, rover = {}, opts = {}) {
  const key = routeKey(start, end, rover);
  const { worker: useWorker = true, fetch: fetchFn, onProgress, ...rest } = opts;
  if (onProgress) onRouteProgress(key, onProgress);
  if (CACHE.has(key) && !fetchFn) return CACHE.get(key);
  const o = { ...rest, demBaseUrl: absolute(rest.demBaseUrl ?? "data/dem") };
  const emit = (stage, frac) => {
    LAST.set(key, { stage, frac });
    for (const fn of LISTENERS.get(key) || []) fn(stage, frac);
  };
  const w = useWorker && !fetchFn && typeof Worker !== "undefined" ? getWorker() : false;
  let p;
  if (w) {
    const call = (msg, onProg) => {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress: onProg });
        w.postMessage({ id, ...msg });
      });
    };
    p = (async () => {
      const t0 = Date.now();
      const route = await call({ type: "plan", start, end, rover, opts: { ...o, horizons: false } }, emit);
      emit("horizons", 0);
      try {
        route.samples.horizons = await poolHorizons(route, o, (f) => emit("horizons", f));
      } catch (err) {
        console.warn("[moonat] horizon worker pool failed, using one worker:", err);
        route.samples.horizons = await call({ type: "horizons", job: horizonJob(route, route.samples.lat.map((_, k) => k), o) },
          (stage, f) => emit("horizons", f));
      }
      route.meta.ms.horizons = Date.now() - t0 - route.meta.ms.total;
      route.meta.ms.total = Date.now() - t0;
      return route;
    })();
  } else {
    p = computeRoute(start, end, rover, { ...o, fetchFn, onProgress: emit });
  }
  if (!fetchFn) {
    CACHE.set(key, p);
    p.catch(() => CACHE.delete(key));
  }
  return p;
}

/** Cache key of a trip (waypoints to 1e-5°, rover parameters); a 2-point trip has its leg's key (routeKey). */
export function tripKey(points, rover) {
  if (points.length === 2) return routeKey(points[0], points[1], rover);
  const r = roverParams(rover?.preset, rover || {});
  const f = (x) => Math.round(x * 1e5) / 1e5;
  return JSON.stringify(["trip", ...points.map((p) => [f(p.lat_deg), f(p.lon_deg)]), r.speed_mps, r.max_slope_deg, r.max_cross_deg, r.mu, r.power_margin]);
}

/**
 * Problems with a trip before planning (messages naming the leg, e.g. "B → C is 75.2 km apart …"), empty when it can
 * be planned: every waypoint inside −90..90° / −180..180°, every leg's straight line ≤ MAX_ROUTE_KM.
 */
export function tripProblems(points) {
  const out = [];
  points.forEach((p, i) => {
    if (!Number.isFinite(p?.lat_deg) || !Number.isFinite(p?.lon_deg) || Math.abs(p.lat_deg) > 90 || Math.abs(p.lon_deg) > 180) {
      out.push(`Set point ${waypointLetter(i)} (search a place or pick it on the globe).`);
    }
  });
  if (out.length) return out;
  for (let j = 0; j + 1 < points.length; j++) {
    const km = greatCircle(points[j], points[j + 1]).dist_m / 1000;
    if (km > MAX_ROUTE_KM) {
      out.push(`${waypointLetter(j)} → ${waypointLetter(j + 1)} is ${km.toFixed(1)} km in a straight line: keep each leg under ${MAX_ROUTE_KM} km (add a stop in between).`);
    }
  }
  return out;
}

/**
 * Plan a trip through waypoints [A, B, C, …] ({lat_deg, lon_deg}, at least 2), leg by leg (planRoute, cached per leg),
 * joined into one route (trip.js joinLegs: cumulative distance and time; a 2-point trip is its leg). Cached per trip.
 * Progress: onProgress(stage, frac, leg, legs) and onRouteProgress(tripKey(...)). A leg that cannot be planned rejects
 * with its RouteError, the message prefixed with the leg ("B → C: …").
 * @param {object[]} points  waypoints
 * @param {object} rover     {preset, speed_mps, max_slope_deg, max_cross_deg}
 * @param {object} [opts]    planRoute options; planLeg (tests): fn(start, end, rover, opts) -> Promise<route>
 */
export function planTrip(points, rover = {}, opts = {}) {
  if (!Array.isArray(points) || points.length < 2) return Promise.reject(new RouteError("incomplete", "A trip needs a start and an end."));
  const key = tripKey(points, rover);
  const { onProgress, planLeg = planRoute, ...rest } = opts;
  if (onProgress) onRouteProgress(key, onProgress);
  if (points.length === 2 && planLeg === planRoute) return planRoute(points[0], points[1], rover, rest);
  if (CACHE.has(key) && planLeg === planRoute) return CACHE.get(key);
  const probs = tripProblems(points);
  if (probs.length) return Promise.reject(new RouteError("too_long", probs[0]));
  const n = points.length - 1;
  const emit = (stage, frac, leg) => {
    LAST.set(key, { stage, frac, leg, legs: n });
    for (const fn of LISTENERS.get(key) || []) fn(stage, frac, leg, n);
  };
  const p = (async () => {
    const legs = [];
    for (let j = 0; j < n; j++) {
      const lk = routeKey(points[j], points[j + 1], rover);
      const off = onRouteProgress(lk, (stage, frac) => emit(stage, frac, j));
      try {
        legs.push(await planLeg(points[j], points[j + 1], rover, rest));
      } catch (err) {
        if (err instanceof RouteError || err?.code) throw new RouteError(err.code || "error", `${waypointLetter(j)} → ${waypointLetter(j + 1)}: ${err.message}`);
        throw err;
      } finally {
        off();
      }
    }
    emit("horizons", 1, n - 1);
    return joinLegs(legs);
  })();
  if (planLeg === planRoute) {
    CACHE.set(key, p);
    p.catch(() => CACHE.delete(key));
  }
  return p;
}
