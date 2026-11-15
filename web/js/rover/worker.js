// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Web Worker entry for the rover planner (index.js planRoute), off the main thread:
// - {id, type: "plan", start, end, rover, opts}: fetch the route terrain and plan the path (route.js computeRoute);
// - {id, type: "horizons", job}: ray-march the horizons of some route points (route.js horizonsAt); several workers
//   share the points of one route.
// - ground patches for the sky view while a rover drives (ground.js): {type: "ground-route", rid, route} keeps the
//   grids of a route (ground.js patchSource), {type: "ground-drop", rid} forgets them, {id, type: "ground", rid,
//   lat_deg, lon_deg, opts, detail} computes route.js routePatch there, and with `detail` ({anchor, lane}) the
//   world-anchored detail of the sky view (sky/detail.js groundDetail); result {patch, detail}.
// Out: {id, progress: {stage, frac}} while working, then {id, result} or {id, error, code}. Grid and image buffers
// of a plan, and the heights of a ground patch, are transferred, not copied.

import { computeRoute, horizonsAt, routePatch } from "./route.js";
import { groundDetail } from "../sky/detail.js";

const routes = new Map(); // ground patches: route id -> the parts of the route that routePatch reads

self.onmessage = async (ev) => {
  const { id, type = "plan", start, end, rover, opts, job } = ev.data;
  if (type === "ground-route") return void routes.set(ev.data.rid, ev.data.route);
  if (type === "ground-drop") return void routes.delete(ev.data.rid);
  if (type === "ground") {
    try {
      const route = routes.get(ev.data.rid);
      if (!route) throw new Error(`ground: route ${ev.data.rid} is not loaded`);
      const patch = routePatch(route, ev.data.lat_deg, ev.data.lon_deg, opts);
      const detail = ev.data.detail ? groundDetail(patch.meta, ev.data.detail) : null;
      const transfer = [patch.data.buffer];
      if (detail) transfer.push(detail.lift.buffer, detail.rocks.buffer);
      self.postMessage({ id, result: { patch, detail } }, transfer);
    } catch (e) {
      self.postMessage({ id, error: String((e && e.message) || e) });
    }
    return;
  }
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
