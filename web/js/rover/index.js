// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Public API of the rover traverse planner (contract C10 `rover-traverse`, docs/CONTRACTS.md).
//
//   import { planRoute, routeSeries } from './js/rover/index.js';
//   const route = await planRoute({lat_deg, lon_deg}, {lat_deg, lon_deg}, {preset: 'viper'}, {onProgress});
//   const s = await routeSeries(route, t0Ms, t1Ms, stepMs);   // C6 series + distance_km, position, ...
//
// planRoute runs in a module Web Worker when one is available (Moon Trek fetch + A* + ~200 horizon ray marches take
// 5–20 s), inline in Node or with {worker: false}. Results are cached per (end points, rover).

import { computeRoute, routePatch, timeline, distanceAtTime, pointAtDistance } from "./route.js";
import { RouteError, MAX_ROUTE_KM, makePlane } from "./terrain.js";
import { PRESETS, DEFAULT_PRESET, roverParams, speedFactor } from "./presets.js";
import { routeSeries, routeTrack } from "./series.js";

export { computeRoute, routePatch, timeline, distanceAtTime, pointAtDistance, RouteError, MAX_ROUTE_KM, makePlane };
export { PRESETS, DEFAULT_PRESET, roverParams, speedFactor, routeSeries, routeTrack };

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
