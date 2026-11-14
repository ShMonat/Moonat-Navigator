// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Web Worker entry for terrainAt (index.js): fetches the Moon Trek grids and the C5 tiles, decodes
// LERC and ray-marches off the main thread. Messages in: {id, lat_deg, lon_deg, opts} starts a job,
// {cancel: id} aborts it. Message out: {id, result} or {id, error, aborted}. The patch array is
// transferred, not copied.

import { computeTerrain } from './core.js';

const jobs = new Map(); // id -> AbortController

self.onmessage = async (ev) => {
  if (ev.data && ev.data.cancel !== undefined) {
    jobs.get(ev.data.cancel)?.abort();
    return;
  }
  const { id, lat_deg, lon_deg, opts } = ev.data;
  const ctl = new AbortController();
  jobs.set(id, ctl);
  try {
    const result = await computeTerrain(lat_deg, lon_deg, { ...opts, signal: ctl.signal });
    const transfer = result.patch ? [result.patch.z_up_m.buffer] : [];
    self.postMessage({ id, result }, transfer);
  } catch (e) {
    self.postMessage({ id, error: String((e && e.message) || e), aborted: !!(e && e.name === 'AbortError') });
  } finally {
    jobs.delete(id);
  }
};
