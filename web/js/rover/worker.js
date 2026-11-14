// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Web Worker entry for the rover planner (index.js planRoute), off the main thread:
// - {id, type: "plan", start, end, rover, opts}: fetch the route terrain and plan the path (route.js computeRoute);
// - {id, type: "horizons", job}: ray-march the horizons of some route points (route.js horizonsAt); several workers
//   share the points of one route.
// Out: {id, progress: {stage, frac}} while working, then {id, result} or {id, error, code}. Grid and image buffers
// of a plan are transferred, not copied.

import { computeRoute, horizonsAt } from "./route.js";

self.onmessage = async (ev) => {
  const { id, type = "plan", start, end, rover, opts, job } = ev.data;
  let last = 0;
  const onProgress = (stage, frac) => {
    const t = Date.now();
    if (frac === 0 || frac === 1 || t - last > 150) {
      last = t;
      self.postMessage({ id, progress: { stage, frac } });
    }
  };
  try {
    if (type === "horizons") {
      const result = await horizonsAt(job, { onProgress: (f) => onProgress("horizons", f) });
      self.postMessage({ id, result });
      return;
    }
    const result = await computeRoute(start, end, rover, { ...opts, onProgress });
    const transfer = [result.preview.rgba.buffer, result.terrain.fine.data.buffer];
    if (result.terrain.coarse) transfer.push(result.terrain.coarse.data.buffer);
    self.postMessage({ id, result }, transfer);
  } catch (e) {
    self.postMessage({ id, error: String((e && e.message) || e), code: e && e.code });
  }
};
