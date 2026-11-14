// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// On-demand LOLA elevation from NASA Moon Trek (Solar System Treks, JPL): the ArcGIS ImageServer
// `exportImage` operation returns raw float32 heights (m above the 1737.4 km sphere) for any box,
// resampled by the server into any projection we pass. We ask for a square in the site-centred
// stereographic plane (geom.js stereoWkt), so one code path serves every latitude including the
// poles. Responses carry `Access-Control-Allow-Origin: *`, so a static page can call it directly.
// Research and measurements: docs/research/terrain-everywhere.md.

import { decodeLerc1 } from './lerc1.js';
import { stereoWkt } from './geom.js';

export const TREK_BASE = 'https://trek.nasa.gov/moon/trekarcgis/rest/services';

/**
 * Moon Trek DEM layers used here (all LOLA, heights in m above R = 1737.4 km, MOON_ME lat/lon).
 * `polar_r_m`: radius of valid data around the pole in that layer's polar stereographic plane.
 */
export const LAYERS = {
  south20: { id: 'ldem_85s_20m_Spole_float_SP', res_m: 20, pole: -1, polar_r_m: 151680, label: 'LOLA 20 m south polar (85–90°S)' },
  south30: { id: 'LRO_LOLA_DEM_SPole75_30mp_v04', res_m: 30, pole: -1, polar_r_m: 457440, label: 'LOLA 30 m south polar v4 (75–90°S)' },
  north30: { id: 'LRO_LOLA_DEM_NPole75_30mp_v04', res_m: 30, pole: 1, polar_r_m: 457440, label: 'LOLA 30 m north polar v4 (75–90°N)' },
  global118: { id: 'LRO_LOLA_DEM_Global_256ppd_v06', res_m: 118.45, pole: 0, polar_r_m: Infinity, label: 'LOLA 256 px/deg global v6 (~118 m)' },
  global237: { id: 'LRO_LOLA_DEM_Global_128ppd_v04', res_m: 236.9, pole: 0, polar_r_m: Infinity, label: 'LOLA LDEM_128 global v4 (~237 m)' },
};

/** Esri exportImage URL for an n × n float32 grid of half-width half_m centred on the site. */
export function exportUrl(layerId, lat_deg, lon_deg, half_m, n, { format = 'lerc', tolerance_m = 0.05, base = TREK_BASE } = {}) {
  const sr = JSON.stringify({ wkt: stereoWkt(lat_deg, lon_deg) });
  const q = new URLSearchParams({
    bbox: `${-half_m},${-half_m},${half_m},${half_m}`,
    bboxSR: sr,
    imageSR: sr,
    size: `${n},${n}`,
    format,
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });
  if (format === 'lerc') q.set('compressionTolerance', String(tolerance_m));
  return `${base}/${layerId}/ImageServer/exportImage?${q}`;
}

/** Decode `format=bsq` output: float32 LE row-major, then a validity bitset (MSB first, 1 = valid). */
export function decodeBsq(buf, width, height) {
  const n = width * height;
  const pixels = new Float32Array(buf.slice(0, 4 * n));
  const bits = new Uint8Array(buf, 4 * n, Math.ceil(n / 8));
  for (let i = 0; i < n; i++) if (!(bits[i >> 3] & (0x80 >> (i & 7)))) pixels[i] = NaN;
  return { width, height, pixels };
}

/**
 * Fetch one site-centred grid from Moon Trek.
 * @returns {Promise<{layer, half_m, cell_m, n, data: Float32Array, bytes, ms, url}>}
 */
export async function fetchGrid(layerKey, lat_deg, lon_deg, half_m, n, { fetchFn, tolerance_m = 0.05, timeout_ms = 30000, base = TREK_BASE } = {}) {
  const layer = LAYERS[layerKey];
  const url = exportUrl(layer.id, lat_deg, lon_deg, half_m, n, { tolerance_m, base });
  const t0 = Date.now();
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeout_ms) : null;
  try {
    const res = await fetchFn(url, ctl ? { signal: ctl.signal } : undefined);
    if (!res.ok) throw new Error(`Moon Trek ${layer.id}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(10, buf.byteLength));
    if (head[0] === 0x7b) throw new Error(`Moon Trek ${layer.id}: ${new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(200, buf.byteLength)))}`);
    const img = decodeLerc1(buf);
    if (img.width !== n || img.height !== n) throw new Error(`Moon Trek ${layer.id}: got ${img.width}×${img.height}, asked ${n}×${n}`);
    return { layer: layerKey, label: layer.label, half_m, cell_m: (2 * half_m) / n, n, data: img.pixels, bytes: buf.byteLength, ms: Date.now() - t0, url };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Polar stereographic distance (m) of a site from the pole of a polar layer (k = 2R tan(colat/2)),
 * or Infinity for a site in the other hemisphere.
 */
export function polarRadius(layer, lat_deg) {
  if (!layer.pole || Math.sign(lat_deg) !== layer.pole) return layer.pole ? Infinity : 0;
  const colat = (90 - Math.abs(lat_deg)) * (Math.PI / 180);
  return 2 * 1737400 * Math.tan(colat / 2);
}

/** True if a site-centred square of half-width half_m lies inside the layer's valid disc. */
export function layerCovers(layerKey, lat_deg, half_m) {
  const L = LAYERS[layerKey];
  return polarRadius(L, lat_deg) + Math.SQRT2 * half_m * 1.01 <= L.polar_r_m;
}

/**
 * Level plan for a site: nested site-centred grids of n × n pixels (n odd), finest first.
 * - L0: the finest LOLA layer that covers ±n/2 cells at its own resolution: 20 m (85–90°S),
 *   30 m (75–90°N/S), else the 118 m global layer (cells: 20, 30 or 118 m);
 * - L1: 4× coarser, from the same layer when it covers it (polar sites);
 * - L2 (polar sites only): 16× coarser.
 * Levels after L0 prefer the 30 m polar layers, else LDEM_128 (237 m): for wide boxes the server
 * answers 30–50 % faster from these than from the 20 m or 118 m layers. `radius_km` (optional)
 * sets the half-width of the last level, the outer edge of the on-demand data; the C5 tiles serve
 * the rest.
 */
export function planLevels(lat_deg, { n = 401, radius_km = null } = {}) {
  const half = (cell) => (cell * n) / 2;
  const fineKey = ['south20', 'south30', 'north30'].find((k) => layerCovers(k, lat_deg, half(LAYERS[k].res_m))) || 'global118';
  const c0 = LAYERS[fineKey].res_m;
  const cells = fineKey === 'global118' ? [c0, 4 * c0] : [c0, 4 * c0, 16 * c0];
  if (radius_km) cells[cells.length - 1] = Math.max(cells[cells.length - 2] * 1.5, (2 * radius_km * 1000) / n);
  return cells.map((cell, i) => {
    const h = half(cell);
    const cand = [...(i === 1 && fineKey !== 'global118' ? [fineKey] : []), 'south30', 'north30', 'global237'];
    const key = i === 0 ? fineKey : (cand.find((k) => LAYERS[k].res_m <= cell / 2 && layerCovers(k, lat_deg, h)) || 'global118');
    return { key, half_m: h, cell_m: cell, n };
  });
}
