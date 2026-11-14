// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Live validation of web/js/terrain (terrainAt) against the precomputed C3 horizons and C4 patches.
// For each catalog site: on-demand terrain (Moon Trek grids + C5 tiles), the old tiles-only horizon,
// and the precomputed C3 profile; statistics, cold-load time and bytes fetched. Needs network access
// to trek.nasa.gov. Writes outputs/terrain_everywhere/<id>.json (horizons, for the figure and the
// Sun statistics in validate_terrain_everywhere.py) and outputs/terrain_everywhere/summary.json.
//
// Usage: node scripts/data/validate_terrain_everywhere.mjs [site_id ...]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const { computeTerrain } = await import(pathToFileURL(join(REPO, 'web/js/terrain/core.js')).href);

const SITES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'apollo11', 'apollo15', 'apollo16', 'apollo17', 'surveyor7', 'change4', 'chandrayaan3',
  'shackleton_rim', 'malapert_massif', 'south_pole', 'art_haworth', 'degerlache_rim',
];
const NEAR_SITES = ['apollo11', 'apollo16']; // horizon set by terrain within ~1 km (see terrain.md §7)
const OUT = join(REPO, 'outputs', 'terrain_everywhere');
mkdirSync(OUT, { recursive: true });

// fetch(): network for http(s), local files otherwise (the C5 tiles).
let tileBytes = 0;
async function anyFetch(url, init) {
  if (/^https?:/.test(url)) return fetch(url, init);
  try {
    const b = await readFile(url);
    tileBytes += b.byteLength;
    return { ok: true, status: 200, json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  } catch {
    return { ok: false, status: 404 };
  }
}

function stats(a, b, sel = () => true) {
  let s2 = 0, sum = 0, mx = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    if (!sel(i)) continue;
    const d = a[i] - b[i];
    s2 += d * d; sum += d; mx = Math.max(mx, Math.abs(d)); n++;
  }
  return n ? { rms: +Math.sqrt(s2 / n).toFixed(3), bias: +(sum / n).toFixed(3), max: +mx.toFixed(3), n } : null;
}

function patchStats(p, id) {
  if (!p) return null;
  const meta = JSON.parse(readFileSync(join(REPO, 'web/data/terrain', `${id}.json`), 'utf8'));
  const b = readFileSync(join(REPO, 'web/data/terrain', `${id}.bin`));
  const z4 = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  if (meta.grid_n !== p.grid_n || Math.abs(meta.half_extent_m - p.half_extent_m) > 1e-6) return null;
  const a = [], c = [];
  for (let i = 0; i < z4.length; i++) if (Number.isFinite(p.z_up_m[i]) && Number.isFinite(z4[i])) { a.push(p.z_up_m[i]); c.push(z4[i]); }
  const s = stats(a, c);
  return { rms_m: +s.rms.toFixed(2), bias_m: +s.bias.toFixed(2), max_m: +s.max.toFixed(1), c4_sources: meta.dem_sources };
}

const sites = JSON.parse(readFileSync(join(REPO, 'web/data/sites.json'), 'utf8')).sites;
const rows = [];
for (const id of SITES) {
  const c3 = JSON.parse(readFileSync(join(REPO, 'web/data/horizons', `${id}.json`), 'utf8'));
  const name = sites.find((s) => s.id === id)?.name ?? id;
  tileBytes = 0;
  const t0 = Date.now();
  const r = await computeTerrain(c3.lat_deg, c3.lon_deg, { fetch: anyFetch, demBaseUrl: join(REPO, 'web/data/dem') });
  const coldMs = Date.now() - t0;
  const tiles = await computeTerrain(c3.lat_deg, c3.lon_deg, { fetch: anyFetch, demBaseUrl: join(REPO, 'web/data/dem'), online: false });
  // Near-field sensitivity: the same on-demand horizon ignoring terrain closer than 500 m (compared
  // in validate_terrain_everywhere.py with moonat.terrain.horizon_profile(min_dist_m=500)).
  const min500 = NEAR_SITES.includes(id)
    ? await computeTerrain(c3.lat_deg, c3.lon_deg, { fetch: anyFetch, demBaseUrl: join(REPO, 'web/data/dem'), min_dist_m: 500, patch: false })
    : null;
  const el = r.horizon.el_deg, ref = c3.el_deg;
  const far = (i) => c3.dist_km[i] > 5;
  const row = {
    id,
    name,
    lat_deg: c3.lat_deg,
    lon_deg: c3.lon_deg,
    c3_near_field: c3.dem_sources[0],
    ground_m: { on_demand: r.horizon.ground_elev_m, c3: c3.ground_elev_m },
    on_demand_vs_c3: stats(el, ref),
    on_demand_vs_c3_far_gt5km: stats(el, ref, far),
    tiles_vs_c3: stats(tiles.horizon.el_deg, ref),
    patch_vs_c4: patchStats(r.patch, id),
    levels: r.meta.levels.map((l) => `${l.layer} ${l.cell_m} m ±${l.half_km.toFixed(1)} km`),
    resolution_m: r.meta.resolution_m,
    cold_ms: coldMs,
    timing_ms: r.meta.timing_ms,
    trek_bytes: r.meta.levels.reduce((s, l) => s + l.bytes, 0),
    trek_ms_per_level: r.meta.levels.map((l) => l.ms),
    c5_tile_bytes_new: tileBytes - 0,
    unterminated_rays: r.horizon.unterminated_rays,
    errors: r.meta.errors,
  };
  rows.push(row);
  console.log(JSON.stringify({ id, vs_c3: row.on_demand_vs_c3, tiles: row.tiles_vs_c3, patch: row.patch_vs_c4, cold_ms: coldMs, trek_kB: Math.round(row.trek_bytes / 1024), ground: row.ground_m }));
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify({
    id, lat_deg: c3.lat_deg, lon_deg: c3.lon_deg, az_step_deg: 0.25,
    on_demand: { ground_elev_m: r.horizon.ground_elev_m, el_deg: el, dist_km: r.horizon.dist_km, dem_sources: r.horizon.dem_sources },
    tiles_only: { ground_elev_m: tiles.horizon.ground_elev_m, el_deg: tiles.horizon.el_deg, az_step_deg: tiles.horizon.az_step_deg },
    ...(min500 ? { on_demand_min500: { el_deg: min500.horizon.el_deg } } : {}),
  }));
}
// Cold-load timing at fresh random points (new every run, so no server or HTTP cache helps).
// The catalog runs above may hit server-side caches when the script is rerun.
const rnd = (a, b) => a + Math.random() * (b - a);
const FRESH = [
  ...[0, 1, 2, 3].map(() => ['|lat| < 60', rnd(-55, 55), rnd(-180, 180)]),
  ...[0, 1].map(() => ['75–85°S (30 m)', rnd(-84, -78), rnd(-180, 180)]),
  ...[0, 1].map(() => ['85–90°S (20 m)', rnd(-89.5, -86.5), rnd(-180, 180)]),
  ['75–90°N (30 m)', rnd(80, 86), rnd(-180, 180)],
];
const fresh = [];
for (const [band, lat, lon] of FRESH) {
  tileBytes = 0;
  const t0 = Date.now();
  const r = await computeTerrain(lat, lon, { fetch: anyFetch, demBaseUrl: join(REPO, 'web/data/dem') });
  const row = {
    band, lat_deg: +lat.toFixed(4), lon_deg: +lon.toFixed(4), cold_ms: Date.now() - t0,
    compute_ms: r.meta.timing_ms.march + r.meta.timing_ms.patch,
    trek_bytes: r.meta.levels.reduce((s, l) => s + l.bytes, 0), trek_ms_per_level: r.meta.levels.map((l) => l.ms),
    c5_tile_bytes_new: tileBytes, levels: r.meta.levels.length, errors: r.meta.errors,
  };
  fresh.push(row);
  console.log('fresh', JSON.stringify(row));
}

writeFileSync(join(OUT, 'summary.json'), JSON.stringify({
  fresh_points: fresh,
  _generated_by: 'AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.',
  run_utc: new Date().toISOString(),
  note: 'on-demand = web/js/terrain computeTerrain (Moon Trek LOLA grids + C5 tiles); tiles = C5 tiles only (horizonFromTiles); C3 = web/data/horizons. Angles in deg, heights in m, times in ms.',
  sites: rows,
}, null, 1));
console.log('wrote', join(OUT, 'summary.json'));
