// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Terrain horizon of any lunar point from the coarse DEM tiles (contract C5 `dem-tiles`), in the
// C3 `horizon-profile` shape. Port of moonat.terrain.horizon run on moonat.terrain.tiles.tiles_dem.
// The tile reader and the ray march are shared with the live-terrain module (web/js/terrain/tiles.js
// and march.js, contract C9); this file keeps the C5 API and its labels.
//
// - Frame MOON_ME, sphere R = 1737.4 km. Eye at R + h0 + observer height along up (radial).
// - Ray for true azimuth A: great circle u(θ) = cos θ·up + sin θ·d, d = cos A·north + sin A·east.
//   Terrain point P = (R + h(u))·u; elevation from the eye el = atan2(ρ cos θ − r_E, ρ sin θ)
//   (exact curvature, no refraction). Horizon = max el along the ray; dist_km = R·θ at that point.
// - Heights: bilinear on the finest level that covers the sample (south480 within 450 km for
//   |lat| ≥ 78° S, else global8); no data cannot occlude. Step = the finest level's cell size.
// - Stop rule (rigorous): with ρ ≤ ρ_max (highest terrain within 0.25 rad + 300 m), no point beyond
//   θ = acos(r_E cos(el_star) / ρ_max) − el_star can exceed el_star.
// Limits: global8 is ~3.8 km/px and south480 480 m/px, so near-field relief (first few km) is
// missing; the result is labelled approximate. Longitude wraps across 0/360 (the Python reference
// leaves a 0.125° gap at the seam).

import { farField } from '../terrain/tiles.js';
import { marchHorizon } from '../terrain/march.js';

const RESULT_CACHE = new Map();
let lastFar = null;

/**
 * Terrain horizon of any point from the C5 DEM tiles, in the C3 shape plus
 * {source: "dem-tiles", approximate: true, label}. Fetches only the tiles within ~434 km.
 * lat/lon: selenographic MOON_ME (deg, east-positive). Options: observer_height_m (2),
 * az_step_deg (0.5), baseUrl ("data/dem"), fetch (global fetch; tests inject a file reader).
 */
export async function horizonFromTiles(lat_deg, lon_deg, opts = {}) {
  const { observer_height_m = 2, az_step_deg = 0.5, baseUrl = 'data/dem' } = opts;
  const fetchFn = opts.fetch ?? ((url) => globalThis.fetch(url));
  if (!Number.isFinite(lat_deg) || !Number.isFinite(lon_deg)) throw new Error('horizonFromTiles: lat_deg and lon_deg are required');
  const key = `${baseUrl}|${lat_deg}|${lon_deg}|${observer_height_m}|${az_step_deg}`;
  if (RESULT_CACHE.has(key)) return RESULT_CACHE.get(key);

  const far = await farField(lat_deg, lon_deg, { baseUrl, fetchFn });
  lastFar = far;
  const h = marchHorizon({ lat_deg, lon_deg, observer_height_m, az_step_deg, grids: [], far });
  const result = {
    id: null,
    lat_deg,
    lon_deg,
    ground_elev_m: h.ground_elev_m,
    observer_height_m,
    az_step_deg,
    el_deg: h.el_deg,
    dist_km: h.dist_km,
    max_range_km: h.max_range_km,
    dem_sources: far.sources,
    source: 'dem-tiles',
    approximate: true,
    label: 'approximate terrain (coarse)',
    unterminated_rays: h.unterminated_rays,
  };
  RESULT_CACHE.set(key, result);
  return result;
}

/** Test hook: number of tile-pixel reads that hit a tile that was not loaded (should be 0). */
export function _demMisses() {
  return lastFar ? lastFar.misses() : 0;
}
