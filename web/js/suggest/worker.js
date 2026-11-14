// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Web Worker entry for suggestDates (index.js): loads the ephemeris once (absolute URL from the page), samples the
// site and ranks the suggestions off the main thread (core.js). Messages in: {id, site, opts} starts a job,
// {cancel: id} aborts it (seen between 32-day chunks). Out: {id, progress} while sampling, then {id, result}
// ({items, meta}) or {id, error, aborted}.

import { computeSuggestions } from './core.js';

const jobs = new Map(); // id -> AbortController

self.onmessage = async (ev) => {
  if (ev.data && ev.data.cancel !== undefined) {
    jobs.get(ev.data.cancel)?.abort();
    return;
  }
  const { id, site, opts } = ev.data;
  const ctl = new AbortController();
  jobs.set(id, ctl);
  let last = 0;
  const onProgress = (frac) => {
    const t = Date.now();
    if (frac >= 1 || t - last > 150) {
      last = t;
      self.postMessage({ id, progress: frac });
    }
  };
  try {
    const result = await computeSuggestions(site, { ...opts, signal: ctl.signal, onProgress });
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: String((e && e.message) || e), aborted: !!(e && e.name === 'AbortError') });
  } finally {
    jobs.delete(id);
  }
};
