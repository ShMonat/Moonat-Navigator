// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Live terrain for custom points (any point not in the catalog): asks web/js/terrain (terrainAt, contract C9) for the
// real LOLA horizon and 3D patch from NASA Moon Trek, and tells the app when it arrives. Until then (and if Moon Trek
// fails) the app keeps the coarse tiles horizon. Catalog sites never come here: they have precomputed C3/C4 files.
//
// - Points are cached by a key rounded to 0.0003° (about 9 m), and the terrain is computed at the rounded point.
// - A request starts after the point has been stable for DEBOUNCE_MS (rapid map clicks start nothing).
// - keepOnly(points) cancels waiting and running requests for points no scenario uses any more.
// - Listeners (onTerrainChange) hear about every status change.

import { terrainAt } from "../terrain/index.js";

const ROUND_DEG = 3e-4;
const DEBOUNCE_MS = 350;
const MAX_ENTRIES = 40;

const entries = new Map(); // key -> { key, lat, lon, status: "waiting" | "loading" | "ready" | "fallback", result, ctl, timer }
const listeners = new Set();
let opts = {};

/** Options passed to terrainAt (tests inject fetch and demBaseUrl). */
export function configureLiveTerrain(o = {}) {
  opts = { ...o };
}

const round = (x) => Math.round(x / ROUND_DEG) * ROUND_DEG;

/** Cache key of a point (lat/lon rounded to about 9 m). */
export function pointKey(lat_deg, lon_deg) {
  return `${round(lat_deg).toFixed(4)},${round(lon_deg).toFixed(4)}`;
}

/** Subscribe to status changes; returns an unsubscribe function. */
export function onTerrainChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(e) {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch (err) {
      console.error("[moonat] terrain listener failed", err);
    }
  }
}

/** The terrainAt result ({horizon, patch, meta}) of a point once real terrain has arrived, else null. */
export function readyTerrain(lat_deg, lon_deg) {
  const e = entries.get(pointKey(lat_deg, lon_deg));
  return e && e.status === "ready" ? e.result : null;
}

/** Status of a point: "none" (never asked), "waiting", "loading", "ready" or "fallback". */
export function terrainState(lat_deg, lon_deg) {
  const e = entries.get(pointKey(lat_deg, lon_deg));
  return e ? e.status : "none";
}

/** Short status text for the scenario card. */
export function terrainStatusText(lat_deg, lon_deg) {
  const e = entries.get(pointKey(lat_deg, lon_deg));
  if (!e || e.status === "waiting" || e.status === "loading") return "Loading NASA terrain…";
  if (e.status === "ready") return `Real terrain: NASA LOLA via Moon Trek (${Math.round(e.result.meta.resolution_m)} m)`;
  return "Approximate horizon (coarse tiles)";
}

/** Make sure real terrain is (being) fetched for this point. Cheap to call repeatedly. */
export function ensureTerrain(lat_deg, lon_deg) {
  if (!Number.isFinite(lat_deg) || !Number.isFinite(lon_deg)) return;
  const key = pointKey(lat_deg, lon_deg);
  if (entries.has(key)) return;
  const e = { key, lat: round(lat_deg), lon: round(lon_deg), status: "waiting", result: null, ctl: null, timer: 0 };
  entries.set(key, e);
  e.timer = setTimeout(() => start(e), DEBOUNCE_MS);
  prune();
}

function start(e) {
  if (entries.get(e.key) !== e) return;
  e.timer = 0;
  e.status = "loading";
  e.ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  emit({ key: e.key, status: e.status });
  terrainAt(e.lat, e.lon, { ...opts, signal: e.ctl?.signal })
    .then((r) => {
      if (entries.get(e.key) !== e) return; // cancelled meanwhile
      e.result = r;
      e.status = r.horizon && !r.horizon.approximate ? "ready" : "fallback";
      if (e.status === "fallback") console.warn("[moonat] Moon Trek terrain unavailable, keeping the coarse horizon:", r.meta?.fallback);
      emit({ key: e.key, status: e.status });
    })
    .catch((err) => {
      if (entries.get(e.key) !== e) return;
      if (err && err.name === "AbortError") return;
      console.warn("[moonat] live terrain failed, keeping the coarse horizon:", err);
      e.status = "fallback";
      emit({ key: e.key, status: e.status });
    })
    .finally(() => (e.ctl = null));
}

function cancel(e) {
  if (e.timer) clearTimeout(e.timer);
  if (e.ctl) e.ctl.abort();
  entries.delete(e.key);
}

/** Cancel the requests (waiting or running) of points that are not in `points` ([[lat, lon], ...]). */
export function keepOnly(points) {
  const want = new Set(points.map(([la, lo]) => pointKey(la, lo)));
  for (const e of [...entries.values()]) {
    if ((e.status === "waiting" || e.status === "loading") && !want.has(e.key)) cancel(e);
  }
}

/** Keep the cache bounded: drop the oldest finished entries. */
function prune() {
  if (entries.size <= MAX_ENTRIES) return;
  for (const e of entries.values()) {
    if (entries.size <= MAX_ENTRIES) break;
    if (e.status === "ready" || e.status === "fallback") entries.delete(e.key);
  }
}
