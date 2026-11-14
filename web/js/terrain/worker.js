// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Web Worker entry for terrainAt (index.js): fetches the Moon Trek grids and the C5 tiles, decodes
// LERC and ray-marches off the main thread. Message in: {id, lat_deg, lon_deg, opts};
// message out: {id, result} or {id, error}. The patch array is transferred, not copied.

import { computeTerrain } from './core.js';

self.onmessage = async (ev) => {
  const { id, lat_deg, lon_deg, opts } = ev.data;
  try {
    const result = await computeTerrain(lat_deg, lon_deg, opts);
    const transfer = result.patch ? [result.patch.z_up_m.buffer] : [];
    self.postMessage({ id, result }, transfer);
  } catch (e) {
    self.postMessage({ id, error: String((e && e.message) || e) });
  }
};
