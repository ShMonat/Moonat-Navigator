// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Ground patches for the sky view while a rover drives: the C4 patch around a point of a planned route (route.js
// routePatch, about 20–30 ms each), computed in a module Web Worker (worker.js "ground" messages), so the frame loop
// never waits for one. The worker keeps a copy of the grids of the few routes in use (sent once per route); without
// workers (Node tests), after a worker failure, or when a reply is late, the patch is computed inline. Same code, same
// grids: same patch. With a detail request the worker also computes the sky view's world-anchored detail there
// (sky/detail.js groundDetail).

import { routePatch } from "./route.js";
import { groundDetail } from "../sky/detail.js";

/** Routes whose grids the worker holds at most (the oldest is dropped first). */
export const KEEP_ROUTES = 3;
/** A patch the worker has not sent back after this long (ms) is computed inline, so a lost reply never stalls the ground. */
export const GROUND_TIMEOUT_MS = 3000;

let worker = null; // null: not tried yet; false: none (inline)
let nextId = 1, nextRoute = 1;
const pending = new Map(); // request id -> { resolve, reject, inline }
const routeIds = new WeakMap(); // route result -> route id in the worker
const loaded = []; // route ids the worker holds, oldest first

function getWorker() {
  if (worker !== null) return worker;
  if (typeof Worker === "undefined") return (worker = false);
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (ev) => {
      const { id, result, error } = ev.data;
      const p = pending.get(id);
      if (!p) return; // answered inline already (timeout)
      pending.delete(id);
      clearTimeout(p.timer);
      if (error) settleInline(p);
      else p.resolve(result);
    };
    worker.onerror = () => {
      worker = false;
      loaded.length = 0;
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        settleInline(p);
      }
      pending.clear();
    };
  } catch {
    worker = false;
  }
  return worker;
}

function settleInline(p) {
  try {
    p.resolve(p.inline());
  } catch (err) {
    p.reject(err);
  }
}

/** The parts of a planned route (C10, one leg or a joined trip) that routePatch reads: centres, grids, sources. */
export function patchSource(route) {
  const leg = (r) => ({ centre: r.centre, terrain: r.terrain, meta: { sources: r.meta?.sources } });
  if (!route.legs) return leg(route);
  const S = route.samples;
  return { legs: route.legs.map(leg), samples: { lat: S.lat, lon: S.lon, leg: S.leg }, meta: { sources: route.meta?.sources } };
}

/**
 * C4 patch {meta, data: Float32Array} around (lat_deg, lon_deg) of a planned route, as routePatch(route, lat_deg,
 * lon_deg, opts), computed in the worker. Resolves with the same patch routePatch returns inline.
 */
export function groundPatch(route, lat_deg, lon_deg, opts = {}) {
  return groundAt(route, lat_deg, lon_deg, opts).then((r) => r.patch);
}

/**
 * The patch (as groundPatch) and, with `detailReq` ({anchor, lane}: sky/detail.js groundDetail), the sky view's
 * world-anchored detail for it, both from the worker: resolves with {patch, detail} (detail null without a request).
 */
export function groundAt(route, lat_deg, lon_deg, opts = {}, detailReq = null) {
  const inline = () => {
    const patch = routePatch(route, lat_deg, lon_deg, opts);
    return { patch, detail: detailReq ? groundDetail(patch.meta, detailReq) : null };
  };
  const w = getWorker();
  if (!w) return new Promise((resolve) => resolve(inline()));
  let rid = routeIds.get(route);
  if (!rid) {
    rid = nextRoute++;
    routeIds.set(route, rid);
  }
  if (!loaded.includes(rid)) {
    w.postMessage({ type: "ground-route", rid, route: patchSource(route) });
    loaded.push(rid);
    while (loaded.length > KEEP_ROUTES) w.postMessage({ type: "ground-drop", rid: loaded.shift() });
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const p = { resolve, reject, inline };
    p.timer = setTimeout(() => {
      if (pending.delete(id)) settleInline(p);
    }, GROUND_TIMEOUT_MS);
    pending.set(id, p);
    w.postMessage({ id, type: "ground", rid, lat_deg, lon_deg, opts, detail: detailReq });
  });
}
