// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Public API of the suggested-dates engine (contract C11 `suggest-dates`, docs/CONTRACTS.md; definitions and
// validation: docs/validation/suggest.md). For one lunar site it proposes mission dates: the best windows for solar
// power ("sun"), for direct-to-Earth contact ("earth") and for both at once ("both"), eclipses of the Sun by the
// Earth seen from the site ("eclipse") and Earthrises/Earthsets with the Sun up ("earthrise").
//
//   import { suggestDates } from './js/suggest/index.js';
//   const list = await suggestDates({ lat_deg, lon_deg, horizon }, { from: '2027-01-01', signal });
//   // [{kind, rank, t_start_utc, t_end_utc, score, title, detail, stats, t_max_utc?, note?}, ...]; list.meta
//
// The work (a C6 series over the whole range, ~0.1–0.6 s of CPU for two years) runs in a module Web Worker when one
// is available; in Node, with {worker: false} or with a custom fetch it runs inline.

import { computeSuggestions, abortError, KINDS, LUNAR_DAY_MS, SYNODIC_MONTH_MS, DEFAULT_LIMIT, siteKey, startOfUtcDay, toMs } from './core.js';

export { KINDS, LUNAR_DAY_MS, SYNODIC_MONTH_MS, DEFAULT_LIMIT };

const JOBS = new Map(); // cache key -> {promise, ctl | id, waiters}
let worker = null, nextId = 1;
const pending = new Map(); // worker job id -> {resolve, reject, onProgress}

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, result, error, aborted, progress } = ev.data;
      const p = pending.get(id);
      if (!p) return;
      if (progress !== undefined) {
        p.onProgress?.(progress);
        return;
      }
      pending.delete(id);
      if (aborted) p.reject(abortError());
      else if (error) p.reject(new Error(error));
      else p.resolve(result);
    };
    worker.onerror = (ev) => {
      const err = new Error(`suggest worker failed: ${ev.message || 'error'}`);
      err.workerFailed = true;
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker = false; // run inline from now on
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

// The fields of a site the engine uses, as a plain cloneable object (the horizon trimmed to what makeSite reads).
function siteSpec(site) {
  const h = site.horizon;
  return {
    lat_deg: site.lat_deg, lon_deg: site.lon_deg, ground_elev_m: site.ground_elev_m, observer_height_m: site.observer_height_m ?? 2,
    horizon: h ? { id: h.id, az_step_deg: h.az_step_deg, el_deg: Array.from(h.el_deg), ground_elev_m: h.ground_elev_m } : null,
  };
}

function withArrayMeta({ items, meta }) {
  const out = [...items];
  Object.defineProperty(out, 'meta', { value: meta, enumerable: false });
  return out;
}

// Starts the computation (worker or inline) and returns {promise, cancel}.
function start(spec, o, useWorker, fetchFn, onProgress) {
  const w = useWorker && !fetchFn && typeof Worker !== 'undefined' ? getWorker() : false;
  const ctl = new AbortController();
  if (w) {
    const id = nextId++;
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      w.postMessage({ id, site: spec, opts: o });
    }).catch((e) => {
      if (!(e && e.workerFailed)) throw e; // an error of the computation itself (or a cancel) stands
      return computeSuggestions(spec, { ...o, signal: ctl.signal, onProgress }); // the worker could not run: inline
    });
    const cancel = () => {
      ctl.abort();
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      w.postMessage({ cancel: id });
      p.reject(abortError());
    };
    return { promise, cancel };
  }
  const promise = computeSuggestions(spec, { ...o, fetch: fetchFn, signal: ctl.signal, onProgress });
  return { promise, cancel: () => ctl.abort() };
}

/**
 * Suggested dates for a lunar site (contract C11).
 * @param {object} site  {lat_deg, lon_deg, horizon (C3) | null, ground_elev_m?, observer_height_m?}; a makeSite() object works
 * @param {object} [opts]
 * @param {Date|number|string} [opts.from]  start of the search (default: today 00:00 UTC)
 * @param {Date|number|string} [opts.to]    end (default: from + 2 years); the range is clipped to the ephemeris
 *                                          coverage (1966–1976, 2013–2040)
 * @param {number} [opts.durationMs]        window length for sun/earth/both (default one lunar day, 14.77 d)
 * @param {string[]} [opts.kinds]           any of "sun", "earth", "both", "eclipse", "earthrise" (default all)
 * @param {number} [opts.limit=5]           items per kind
 * @param {number} [opts.stepMs]            sampling step (default 10 min; longer for ranges over ~2 years)
 * @param {AbortSignal} [opts.signal]       cancel: the promise rejects with an AbortError
 * @param {function} [opts.onProgress]      called with 0..1 while sampling
 * @param {string} [opts.ephemBaseUrl='data/ephem']
 * @param {boolean} [opts.worker=true]      use a module Web Worker when available
 * @param {function} [opts.fetch]           fetch replacement (Node tests; forces inline, no cache)
 * @returns {Promise<object[]>} items {kind, rank, t_start_utc, t_end_utc, score, title, detail, stats, t_max_utc?, note?}
 *   in the order of `kinds`, ranked within each kind; the array's non-enumerable `meta` gives the range actually
 *   searched {from_utc, to_utc, step_ms, duration_ms, samples, ms}. Results are cached per site and options.
 */
export function suggestDates(site, opts = {}) {
  const { signal, worker: useWorker = true, fetch: fetchFn = null, onProgress, ...rest } = opts;
  if (signal?.aborted) return Promise.reject(abortError());
  const spec = siteSpec(site);
  const from = toMs(rest.from) ?? startOfUtcDay(Date.now());
  const o = {
    from, to: toMs(rest.to) ?? undefined, durationMs: rest.durationMs ?? LUNAR_DAY_MS, kinds: rest.kinds ?? KINDS,
    limit: rest.limit ?? DEFAULT_LIMIT, stepMs: rest.stepMs, ephemBaseUrl: absolute(rest.ephemBaseUrl ?? 'data/ephem'),
  };
  if (fetchFn) o.ephemBaseUrl = rest.ephemBaseUrl ?? 'data/ephem';
  const key = `${siteKey(spec)}#${JSON.stringify(o)}`;
  const cacheable = !fetchFn;
  let job = cacheable ? JOBS.get(key) : null;
  if (!job) {
    const s = start(spec, o, useWorker, fetchFn, onProgress);
    job = { promise: s.promise.then(withArrayMeta), cancel: s.cancel, waiters: 0, done: false };
    job.promise.then(() => { job.done = true; }, () => { job.done = true; if (JOBS.get(key) === job) JOBS.delete(key); });
    if (cacheable) JOBS.set(key, job);
  }
  // Each caller may cancel its own wait; the computation stops when no caller is left waiting.
  job.waiters++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, v) => {
      if (settled) return;
      settled = true;
      job.waiters--;
      signal?.removeEventListener('abort', onAbort);
      fn(v);
    };
    const onAbort = () => {
      settle(reject, abortError());
      if (job.waiters === 0 && !job.done) {
        if (JOBS.get(key) === job) JOBS.delete(key);
        job.cancel();
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    job.promise.then((v) => settle(resolve, v), (e) => settle(reject, e));
  });
}
