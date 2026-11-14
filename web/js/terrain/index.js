// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Public API of the terrain module: real LOLA terrain for ANY point on the Moon, computed in the
// browser. Near and mid field: on-demand grids from NASA Moon Trek (20 m / 30 m near the poles,
// 118 m elsewhere); far field: the shipped C5 tiles. Details and validation:
// docs/research/terrain-everywhere.md, docs/validation/terrain-everywhere.md.
//
//   import { terrainAt } from './js/terrain/index.js';
//   const { horizon, patch, meta } = await terrainAt(-89.44, -137.19);
//   // horizon: C3 object (az_step 0.25°, el_deg[1440], dist_km[1440], ...), usable as makeSite({horizon})
//   // patch:   C4 fields + z_up_m (Float32Array, grid_n²) in site ENU, or null without near-field data
//   // meta:    {sources, resolution_m, ms, bytes, levels, fallback}
//
// The work runs in a module Web Worker when one is available (fetch + LERC decode + ray march take
// ~0.1 s of CPU on top of the network time); in Node or with {worker: false} it runs inline.

import { abortError, computeTerrain } from './core.js';

const CACHE = new Map(); // key -> Promise<result>
let worker = null, nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, result, error, aborted } = ev.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (aborted) p.reject(abortError());
      else if (error) p.reject(new Error(error));
      else p.resolve(result);
    };
    worker.onerror = (ev) => {
      for (const p of pending.values()) p.reject(new Error(`terrain worker failed: ${ev.message || 'error'}`));
      pending.clear();
      worker = false; // fall back to the main thread from now on
    };
  } catch {
    worker = false;
  }
  return worker;
}

function absolute(url) {
  try {
    const base = typeof document !== 'undefined' ? document.baseURI : globalThis.location?.href;
    return base ? new URL(url, base).href : url;
  } catch {
    return url;
  }
}

/**
 * Terrain at any lunar point.
 * @param {number} lat_deg  selenographic latitude (deg), MOON_ME
 * @param {number} lon_deg  east longitude (deg)
 * @param {object} [opts]
 * @param {number} [opts.radius_km]        outer half-width of the on-demand (Moon Trek) data
 * @param {number} [opts.observer_height_m=2]
 * @param {number} [opts.az_step_deg=0.25]
 * @param {boolean}[opts.patch=true]       build the C4 patch (±12 km, 385²)
 * @param {boolean}[opts.online=true]      false: shipped C5 tiles only
 * @param {string} [opts.demBaseUrl='data/dem']
 * @param {boolean}[opts.worker=true]      use a Web Worker when available
 * @param {AbortSignal}[opts.signal]       cancel: the Moon Trek requests stop and the promise rejects
 *                                         with an AbortError (the request is then dropped from the cache)
 * @param {function}[opts.fetch]           fetch replacement (forces inline execution)
 * @returns {Promise<{horizon: object, patch: object|null, meta: object}>}
 *   Results are cached per (lat, lon, options) for the page's lifetime. If Moon Trek cannot be
 *   reached the promise still resolves, with the tiles-only horizon, horizon.approximate = true,
 *   patch = null and meta.fallback giving the reason.
 */
export function terrainAt(lat_deg, lon_deg, opts = {}) {
  const { worker: useWorker = true, fetch: fetchFn, trekFetch, signal, ...rest } = opts;
  if (signal?.aborted) return Promise.reject(abortError());
  const o = { ...rest, demBaseUrl: absolute(rest.demBaseUrl ?? 'data/dem') };
  const key = JSON.stringify([lat_deg, lon_deg, o]);
  const cacheable = !fetchFn && !trekFetch;
  if (cacheable && CACHE.has(key)) return CACHE.get(key);
  let p;
  const w = useWorker && cacheable && typeof Worker !== 'undefined' ? getWorker() : false;
  if (w) {
    const id = nextId++;
    p = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, lat_deg, lon_deg, opts: o });
      signal?.addEventListener('abort', () => {
        if (!pending.has(id)) return;
        pending.delete(id);
        w.postMessage({ cancel: id });
        reject(abortError());
      }, { once: true });
    }).catch((e) => {
      if (e && e.name === 'AbortError') throw e;
      return computeTerrain(lat_deg, lon_deg, { ...o, signal }); // worker trouble: run inline
    });
  } else {
    p = computeTerrain(lat_deg, lon_deg, { ...o, fetch: fetchFn, trekFetch, signal });
  }
  if (cacheable) {
    CACHE.set(key, p);
    p.catch(() => CACHE.delete(key));
  }
  return p;
}

export { computeTerrain };
