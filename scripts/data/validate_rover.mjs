// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Live validation of the rover traverse planner (web/js/rover) against NASA Moon Trek:
// 1. plans two real routes (planner speed, grid size, bytes);
// 2. at five points along each route, compares the route horizon (route grid + C5 tiles) with terrainAt
//    (site-centred Moon Trek grids + C5 tiles, the C9 way), over all azimuths: RMS / bias / max, ground height.
// Usage: node scripts/data/validate_rover.mjs   (needs trek.nasa.gov; writes docs/validation/rover.json)

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { computeRoute } from "../../web/js/rover/route.js";
import { computeTerrain } from "../../web/js/terrain/core.js";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const DEM = join(REPO, "web", "data", "dem");
const GEN = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.";

async function fileFetch(url) {
  try {
    const b = await readFile(url);
    return { ok: true, status: 200, json: async () => JSON.parse(b.toString("utf8")), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  } catch {
    return { ok: false, status: 404 };
  }
}
const fetchFn = (u, init) => (String(u).startsWith("http") ? fetch(u, init) : fileFetch(u));

const ROUTES = [
  { id: "ridge", label: "Shackleton rim -> de Gerlache rim (connecting ridge)", start: { lat_deg: -89.4395, lon_deg: -137.1934 }, end: { lat_deg: -89.0056, lon_deg: -96.6455 }, rover: { preset: "viper" } },
  { id: "apollo15", label: "Apollo 15 landing site -> 9 km south-east (Hadley plain)", start: { lat_deg: 26.13222, lon_deg: 3.63386 }, end: { lat_deg: 26.06, lon_deg: 3.85 }, rover: { preset: "lrv" } },
];

const out = { _generated_by: GEN, date: new Date().toISOString(), az_step_deg: 0.5, routes: [] };
for (const R of ROUTES) {
  const t0 = Date.now();
  const r = await computeRoute(R.start, R.end, R.rover, { fetchFn, demBaseUrl: DEM, az_step_deg: 0.5 });
  const wall = Date.now() - t0;
  const S = r.samples, n = S.dist_m.length;
  const picks = [0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n - 1];
  const points = [];
  for (const k of picks) {
    const ref = await computeTerrain(S.lat[k], S.lon[k], { fetch: fetchFn, demBaseUrl: DEM, az_step_deg: 0.5, patch: false });
    const a = S.horizons[k].el_deg, b = ref.horizon.el_deg;
    let ss = 0, sum = 0, mx = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      ss += d * d; sum += d; mx = Math.max(mx, Math.abs(d));
    }
    points.push({
      k, dist_km: +(S.dist_m[k] / 1000).toFixed(3), lat_deg: +S.lat[k].toFixed(5), lon_deg: +S.lon[k].toFixed(5),
      rms_deg: +Math.sqrt(ss / a.length).toFixed(3), bias_deg: +(sum / a.length).toFixed(3), max_deg: +mx.toFixed(3),
      ground_route_m: S.horizons[k].ground_elev_m, ground_terrainAt_m: ref.horizon.ground_elev_m,
      mean_el_route_deg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3), mean_el_terrainAt_deg: +(b.reduce((x, y) => x + y, 0) / b.length).toFixed(3),
      terrainAt_cell_m: ref.meta.resolution_m,
    });
    console.log(R.id, k, points.at(-1));
  }
  const st = r.stats;
  out.routes.push({
    id: R.id, label: R.label, start: R.start, end: R.end, rover: r.rover,
    straight_km: +(st.straight_m / 1000).toFixed(2), length_km: +(st.length_m / 1000).toFixed(2), drive_h: +(st.drive_s / 3600).toFixed(2),
    mean_speed_mps: +st.mean_speed_mps.toFixed(3), max_along_deg: +st.max_along_deg.toFixed(1), max_cross_deg: +st.max_cross_deg.toFixed(1),
    max_terrain_slope_deg: +st.max_slope_deg.toFixed(1), climb_m: Math.round(st.climb_m), descent_m: Math.round(st.descent_m),
    grid_n: r.meta.grid_n, fine_cell_m: +r.meta.fine_cell_m.toFixed(2), coarse_cell_m: +(r.meta.coarse_cell_m || 0).toFixed(1), fine_layer: r.meta.fine_layer,
    n_samples: r.meta.n_samples, expanded_cells: r.meta.expanded, bytes: r.meta.bytes, ms: r.meta.ms, wall_ms: wall,
    horizon_check: points,
  });
  console.log(R.id, JSON.stringify(out.routes.at(-1).ms), "length", st.length_m, "drive h", st.drive_s / 3600);
}
await writeFile(join(REPO, "docs", "validation", "rover.json"), JSON.stringify(out, null, 1) + "\n");
console.log("wrote docs/validation/rover.json");
