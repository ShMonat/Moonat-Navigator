// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The ONE adapter between the UI and the browser physics (contract C6 `sky-state`, web/js/physics/index.js).
// The UI only uses: initPhysics, physicsError, physicsCoverage, siteFor, stateAt, seriesFor, loadHorizon, useLiveTerrain.

import { loadEphem, makeSite, skyState, series, horizonFromTiles } from "../physics/index.js";

let coverage = null; // years covered by the ephemeris tables
let loadError = null;
const horizonCache = new Map();
let demOpts = { baseUrl: "data/dem" }; // C5 DEM tiles, for custom points

/**
 * Load the ephemeris manifest (year tables load lazily). Resolves to true on success, false on failure (then
 * physicsError() holds the reason). `opts` is passed to loadEphem (the Node tests pass a file reader as opts.fetch).
 * The DEM tiles for custom points are read from `opts.demBase` (default: the "dem" folder next to the ephemeris).
 */
export async function initPhysics(ephemBase = "data/ephem", opts = {}) {
  demOpts = {
    baseUrl: opts.demBase ?? String(ephemBase).replace(/ephem\/?$/, "dem"),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  };
  try {
    const manifest = await loadEphem(ephemBase, opts);
    coverage = Array.isArray(manifest.years) ? manifest.years : null;
    loadError = null;
    return true;
  } catch (err) {
    console.error("[moonat] ephemeris failed to load", err);
    loadError = err;
    return false;
  }
}

export function physicsError() {
  return loadError;
}

/** Years covered by the ephemeris tables (e.g. 1966–1976 and 2013–2040), or null before loading. */
export function physicsCoverage() {
  return coverage;
}

/** Fetch the C3 horizon profile of a catalog site, or null when there is none. Cached. */
export function loadHorizon(siteId, fetchFn = (u) => fetch(u)) {
  if (!siteId) return Promise.resolve(null);
  if (!horizonCache.has(siteId)) {
    const p = fetchFn(`data/horizons/${encodeURIComponent(siteId)}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((h) => (h && Array.isArray(h.el_deg) ? h : null))
      .catch(() => null);
    horizonCache.set(siteId, p);
  }
  return horizonCache.get(siteId);
}

let live = null; // live terrain for custom points ({ ready(lat, lon), ensure(lat, lon) }), set by the app

/**
 * Let custom points use real terrain (contract C9 via web/js/app/terrain_live.js): `ready(lat, lon)` returns the
 * terrainAt result once it has arrived (else null), `ensure(lat, lon)` starts fetching it. Without this (the default,
 * and in the Node tests) custom points keep the coarse tiles horizon.
 */
export function useLiveTerrain(api) {
  live = api;
}

/**
 * Build a C6 site for a scenario. Catalog sites get their terrain horizon (C3) when the file exists, and with it the
 * ground height. Custom points (no site_id) get the real Moon Trek horizon when live terrain has it (with its C4-shaped
 * `patch` for the sky view); until then, an approximate horizon from the coarse DEM tiles (C5; it has
 * `approximate: true` and `label: "approximate terrain (coarse)"`), or null (the smooth local horizontal plane) if the
 * tiles cannot be loaded. Returns { site, horizon, patch } (patch: terrainAt patch or null).
 */
export async function siteFor(scenario) {
  let horizon = null;
  let patch = null;
  if (scenario.site_id) horizon = await loadHorizon(scenario.site_id);
  else {
    const real = live?.ready(scenario.lat_deg, scenario.lon_deg);
    if (real) {
      horizon = real.horizon;
      patch = real.patch;
    } else {
      live?.ensure(scenario.lat_deg, scenario.lon_deg);
      horizon = await customHorizon(scenario.lat_deg, scenario.lon_deg);
    }
  }
  const site = makeSite({ lat_deg: scenario.lat_deg, lon_deg: scenario.lon_deg, observer_height_m: 2, horizon });
  return { site, horizon, patch };
}

/** Approximate horizon of a custom point from the DEM tiles, or null if they cannot be loaded. */
export async function customHorizon(lat_deg, lon_deg) {
  if (!Number.isFinite(lat_deg) || !Number.isFinite(lon_deg)) return null;
  try {
    return await horizonFromTiles(lat_deg, lon_deg, demOpts);
  } catch (err) {
    console.warn("[moonat] DEM tiles unavailable, using the smooth horizon", err);
    return null;
  }
}

/** C6 skyState(site, tMs). */
export function stateAt(site, tMs) {
  return skyState(site, tMs);
}

/** C6 series(site, t0Ms, t1Ms, stepMs). */
export function seriesFor(site, t0Ms, t1Ms, stepMs) {
  return series(site, t0Ms, t1Ms, stepMs);
}
