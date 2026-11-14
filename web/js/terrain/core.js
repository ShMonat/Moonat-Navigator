// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Terrain for any point on the Moon: on-demand LOLA grids from NASA Moon Trek for the near and
// mid field (trek.js) plus the shipped C5 tiles for the far field (tiles.js), one ray march
// (march.js). Runs anywhere (browser main thread, Web Worker, Node); index.js wraps it.

import { farField } from './tiles.js';
import { fetchGrid, planLevels, LAYERS } from './trek.js';
import { marchHorizon, terrainPatch } from './march.js';

const GENERATED_BY = 'AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.';
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Horizon (C3 shape) and terrain patch (C4 shape, in memory) for any site.
 * @param {number} lat_deg  selenographic latitude (deg, MOON_ME)
 * @param {number} lon_deg  east longitude (deg)
 * @param {object} [o]
 * @param {number} [o.radius_km]          outer half-width of the on-demand data (default: plan)
 * @param {number} [o.observer_height_m=2]
 * @param {number} [o.az_step_deg=0.25]
 * @param {boolean}[o.patch=true]         also build the C4 patch (±o.patch_half_extent_km, o.patch_n)
 * @param {string} [o.demBaseUrl='data/dem']  C5 tiles (absolute URL inside a worker)
 * @param {boolean}[o.online=true]        false = C5 tiles only (the previous behaviour)
 * @param {function}[o.fetch]             fetch replacement (tests)
 * @param {function}[o.trekFetch]         fetch used for Moon Trek (default o.fetch / global fetch)
 * @returns {Promise<{horizon, patch, meta}>}
 */
export async function computeTerrain(lat_deg, lon_deg, o = {}) {
  if (!Number.isFinite(lat_deg) || !Number.isFinite(lon_deg)) throw new Error('terrainAt: lat_deg and lon_deg are required');
  const t0 = now();
  const fetchFn = o.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const trekFetch = o.trekFetch ?? fetchFn;
  const {
    observer_height_m = 2, az_step_deg = 0.25, demBaseUrl = 'data/dem', online = true,
    patch = true, patch_half_extent_km = 12, patch_n = 385, n_px = 401, tolerance_m = 0.05,
  } = o;
  const plan = online ? planLevels(lat_deg, { n: n_px, radius_km: o.radius_km }) : [];

  // Fetch the far-field tiles and the Moon Trek grids in parallel; a failed grid is skipped.
  const farP = farField(lat_deg, lon_deg, { baseUrl: demBaseUrl, fetchFn });
  const gridP = plan.map((lv, i) => fetchGrid(lv.key, lat_deg, lon_deg, lv.half_m, lv.n, {
    fetchFn: trekFetch, tolerance_m: i === 0 ? Math.min(tolerance_m, 0.02) : tolerance_m, base: o.trekBase,
  }).catch((e) => ({ error: String(e.message || e), key: lv.key })));
  const [far, ...got] = await Promise.all([farP, ...gridP]);
  const tFetch = now();
  const grids = got.filter((g) => !g.error);
  const errors = got.filter((g) => g.error).map((g) => g.error);

  const hz = marchHorizon({ lat_deg, lon_deg, observer_height_m, az_step_deg, grids, far, min_dist_m: o.min_dist_m || 0 });
  const tMarch = now();
  const gridSources = [...new Set(grids.map((g) => `${LAYERS[g.layer].label}, NASA Moon Trek (JPL) ImageServer`))];
  const sources = [...gridSources, ...far.sources];
  const fine = grids.length ? grids[0].cell_m : far.cells[0];
  const label = grids.length
    ? `terrain: LOLA ${Math.round(fine)} m near field (Moon Trek) + LOLA tiles`
    : 'approximate terrain (coarse)';
  const horizon = {
    id: null,
    lat_deg,
    lon_deg,
    ground_elev_m: hz.ground_elev_m,
    observer_height_m,
    az_step_deg,
    el_deg: hz.el_deg,
    dist_km: hz.dist_km,
    max_range_km: hz.max_range_km,
    dem_sources: sources,
    source: grids.length ? 'moon-trek+dem-tiles' : 'dem-tiles',
    approximate: grids.length === 0,
    label,
    unterminated_rays: hz.unterminated_rays,
    _generated_by: GENERATED_BY,
  };

  let tp = null;
  if (patch && grids.length) {
    const p = terrainPatch({ lat_deg, lon_deg, grids, far, ground_elev_m: hz.ground_elev_m, half_extent_m: patch_half_extent_km * 1000, n: patch_n });
    tp = {
      id: null,
      lat_deg,
      lon_deg,
      grid_n: p.grid_n,
      spacing_m: p.spacing_m,
      half_extent_m: p.half_extent_m,
      encoding: 'float32, row-major, row 0 = north edge, col 0 = west edge (in memory: z_up_m)',
      values: 'z_up_m: ENU up-coordinate of the terrain surface relative to the GROUND point (includes curvature drop)',
      albedo: null,
      ground_elev_m: p.ground_elev_m,
      z_min_m: p.z_min_m,
      z_max_m: p.z_max_m,
      dem_sources: gridSources,
      z_up_m: p.z_up_m,
      _generated_by: GENERATED_BY,
    };
  }
  const tEnd = now();
  const bytes = grids.reduce((a, g) => a + g.bytes, 0) + far.bytes;
  return {
    horizon,
    patch: tp,
    meta: {
      sources,
      resolution_m: Math.round(fine * 10) / 10,
      ms: Math.round(tEnd - t0),
      timing_ms: { fetch: Math.round(tFetch - t0), march: Math.round(tMarch - tFetch), patch: Math.round(tEnd - tMarch) },
      bytes,
      levels: grids.map((g) => ({ layer: LAYERS[g.layer].id, half_km: g.half_m / 1000, cell_m: Math.round(g.cell_m * 100) / 100, n: g.n, bytes: g.bytes, ms: g.ms })),
      tile_bytes: far.bytes,
      samples_per_ray: hz.samples_per_ray,
      errors,
      fallback: online && grids.length === 0 ? `Moon Trek unavailable: ${errors[0] || 'no levels'}` : null,
    },
  };
}
