// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Reader of the shipped C5 DEM tiles (web/data/dem, format moonat-dem-tiles/1) for the far field.
// Same maths as horizonFromTiles in web/js/physics/terrain.js (bilinear, finest level that covers
// the sample: south480 within 450 km when the site is at |lat| ≥ 78° S, else global8; longitude
// wraps), kept separate so the terrain module does not depend on physics internals. The test
// web/tests/terrain_everywhere.test.mjs checks that the march over these tiles alone reproduces
// horizonFromTiles exactly.

import { D2R, R_M, enuBasis } from './geom.js';

export const REGION_RAD = 0.25; // central angle over which the max terrain height bounds the rays
export const POLAR_SMAX_M = 450000;
export const POLAR_MIN_ABS_LAT = 78;

const DEMS = new Map(); // base -> Promise<dem>
const TILE_CACHE = new Map(); // url -> Promise<Float32Array>

function joinUrl(base, name) {
  return base ? `${String(base).replace(/\/+$/, '')}/${name}` : name;
}

/** Open the C5 manifest at `base` (cached per base). */
export function openDem(base, fetchFn) {
  if (!DEMS.has(base)) {
    const p = (async () => {
      const res = await fetchFn(joinUrl(base, 'manifest.json'));
      if (!res.ok) throw new Error(`dem: cannot load manifest (${res.status}) from ${base}`);
      const manifest = await res.json();
      const lv = (cyl) => manifest.levels.find((l) => (cyl ? l.projection === 'simple_cylindrical' : l.projection === 'polar_stereographic'));
      const mk = (l) => l && { ...l, ntr: l.tiles[0], ntc: l.tiles[1], data: new Array(l.tiles[0] * l.tiles[1]).fill(null) };
      const dem = { base, fetchFn, manifest, cyl: mk(lv(true)), polar: mk(lv(false)), bytes: 0 };
      if (!dem.cyl) throw new Error('dem: manifest has no simple_cylindrical level');
      return dem;
    })();
    DEMS.set(base, p);
    p.catch(() => DEMS.delete(base));
  }
  return DEMS.get(base);
}

function loadTile(dem, level, tr, tc) {
  const url = joinUrl(dem.base, level.url.replace('{tr}', tr).replace('{tc}', tc));
  if (!TILE_CACHE.has(url)) {
    const p = (async () => {
      const res = await dem.fetchFn(url);
      if (!res.ok) throw new Error(`dem: cannot load ${url} (${res.status})`);
      const buf = await res.arrayBuffer();
      dem.bytes += buf.byteLength;
      const dv = new DataView(buf);
      const n = level.tile_size * level.tile_size;
      const out = new Float32Array(n);
      const nod = dem.manifest.nodata;
      for (let i = 0; i < n; i++) {
        const v = dv.getInt16(2 * i, true);
        out[i] = v === nod ? NaN : v;
      }
      return out;
    })();
    TILE_CACHE.set(url, p);
    p.catch(() => TILE_CACHE.delete(url));
  }
  return TILE_CACHE.get(url).then((a) => { level.data[tr * level.ntc + tc] = a; });
}

function px(level, r, c) {
  if (r < 0 || c < 0 || r >= level.lines || c >= level.samples) return NaN;
  const ts = level.tile_size;
  const tr = (r / ts) | 0, tc = (c / ts) | 0;
  const t = level.data[tr * level.ntc + tc];
  if (!t) { level.misses = (level.misses || 0) + 1; return NaN; }
  return t[(r - tr * ts) * ts + (c - tc * ts)];
}

function bilinear(level, r, c, wrapCols) {
  const nr = level.lines, nc = level.samples;
  if (wrapCols) { c %= nc; if (c < 0) c += nc; } else if (c < 0 || c > nc - 1) return NaN;
  if (!(r >= 0 && r <= nr - 1)) return NaN;
  const i = Math.min(Math.floor(r), nr - 2);
  let j = Math.floor(c);
  if (!wrapCols) j = Math.min(j, nc - 2);
  const j1 = wrapCols && j + 1 >= nc ? 0 : j + 1;
  const fr = r - i, fc = c - j;
  return px(level, i, j) * (1 - fr) * (1 - fc) + px(level, i, j1) * (1 - fr) * fc
    + px(level, i + 1, j) * fr * (1 - fc) + px(level, i + 1, j1) * fr * fc;
}

export function sampleCyl(level, ux, uy, uz) {
  const lat = Math.atan2(uz, Math.hypot(ux, uy)) / D2R;
  let lon = Math.atan2(uy, ux) / D2R - level.lon_left_deg;
  lon %= 360; if (lon < 0) lon += 360;
  return bilinear(level, (level.lat_top_deg - lat) * level.res_ppd - 0.5, lon * level.res_ppd - 0.5, true);
}

function polarRowCol(level, ux, uy, uz) {
  const s = level.pole;
  const k = (2 * R_M) / (1 + s * uz);
  return [level.row0 + (s * k * ux) / level.scale_m, level.col0 + (k * uy) / level.scale_m];
}

export function samplePolar(level, ux, uy, uz) {
  const [r, c] = polarRowCol(level, ux, uy, uz);
  return Number.isFinite(r) && Number.isFinite(c) ? bilinear(level, r, c, false) : NaN;
}

function neededTiles(dem, lat_deg, lon_deg, usePolar) {
  const out = [];
  const cyl = dem.cyl;
  const rDeg = REGION_RAD / D2R + 2 / cyl.res_ppd;
  const rowOf = (lat) => (cyl.lat_top_deg - lat) * cyl.res_ppd - 0.5;
  const r0 = Math.max(0, Math.floor(rowOf(Math.min(90, lat_deg + rDeg))) - 1);
  const r1 = Math.min(cyl.lines - 1, Math.ceil(rowOf(Math.max(-90, lat_deg - rDeg))) + 1);
  const trs = new Set();
  for (let r = r0; r <= r1; r += 1) trs.add((r / cyl.tile_size) | 0);
  const tcs = new Set();
  const sinRatio = Math.sin(REGION_RAD) / Math.cos(lat_deg * D2R);
  if (Math.abs(lat_deg) + rDeg >= 90 || sinRatio >= 1) {
    for (let tc = 0; tc < cyl.ntc; tc++) tcs.add(tc);
  } else {
    const dlon = Math.asin(sinRatio) / D2R + 2 / cyl.res_ppd;
    const c0 = Math.floor(((lon_deg - dlon - cyl.lon_left_deg) * cyl.res_ppd) - 1);
    const c1 = Math.ceil(((lon_deg + dlon - cyl.lon_left_deg) * cyl.res_ppd) + 1);
    for (let c = c0; c <= c1; c++) tcs.add(((((c % cyl.samples) + cyl.samples) % cyl.samples) / cyl.tile_size) | 0);
  }
  for (const tr of trs) for (const tc of tcs) out.push([cyl, tr, tc]);

  const pol = dem.polar;
  if (usePolar && pol) {
    const { east, north, up } = enuBasis(lat_deg, lon_deg);
    let rmin = Infinity, rmax = -Infinity, cmin = Infinity, cmax = -Infinity;
    const ct = Math.cos(REGION_RAD), st = Math.sin(REGION_RAD);
    for (let k = 0; k < 720; k++) {
      const a = (k * Math.PI) / 360;
      const u = [0, 1, 2].map((i) => ct * up[i] + st * (Math.cos(a) * north[i] + Math.sin(a) * east[i]));
      const [r, c] = polarRowCol(pol, ...u);
      rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); cmin = Math.min(cmin, c); cmax = Math.max(cmax, c);
    }
    const ts = pol.tile_size;
    const tr0 = Math.max(0, Math.floor((rmin - 2) / ts)), tr1 = Math.min(pol.ntr - 1, Math.floor((rmax + 2) / ts));
    const tc0 = Math.max(0, Math.floor((cmin - 2) / ts)), tc1 = Math.min(pol.ntc - 1, Math.floor((cmax + 2) / ts));
    for (let tr = tr0; tr <= tr1; tr++) for (let tc = tc0; tc <= tc1; tc++) out.push([pol, tr, tc]);
  }
  return out;
}

/** Highest loaded tile terrain (m) within REGION_RAD of `up`. */
export function regionMaxHeight(dem, up, usePolar) {
  const cmin = Math.cos(REGION_RAD);
  let best = -Infinity;
  const cyl = dem.cyl, ts = cyl.tile_size;
  for (let tr = 0; tr < cyl.ntr; tr++) {
    for (let tc = 0; tc < cyl.ntc; tc++) {
      const t = cyl.data[tr * cyl.ntc + tc];
      if (!t) continue;
      for (let i = 0; i < ts; i++) {
        const r = tr * ts + i;
        if (r >= cyl.lines) break;
        const lat = (cyl.lat_top_deg - (r + 0.5) / cyl.res_ppd) * D2R;
        const sl = Math.sin(lat) * up[2], cl = Math.cos(lat);
        for (let j = 0; j < ts; j++) {
          const v = t[i * ts + j];
          if (!(v > best)) continue;
          const lon = (cyl.lon_left_deg + (tc * ts + j + 0.5) / cyl.res_ppd) * D2R;
          if (sl + cl * (Math.cos(lon) * up[0] + Math.sin(lon) * up[1]) >= cmin) best = v;
        }
      }
    }
  }
  const pol = dem.polar;
  if (usePolar && pol) {
    const K = 4 * R_M * R_M, s = pol.pole, pts = pol.tile_size;
    for (let tr = 0; tr < pol.ntr; tr++) {
      for (let tc = 0; tc < pol.ntc; tc++) {
        const t = pol.data[tr * pol.ntc + tc];
        if (!t) continue;
        for (let i = 0; i < pts; i++) {
          const yUp = (pol.row0 - (tr * pts + i)) * pol.scale_m;
          for (let j = 0; j < pts; j++) {
            const v = t[i * pts + j];
            if (!(v > best)) continue;
            const x = (tc * pts + j - pol.col0) * pol.scale_m;
            const r2 = x * x + yUp * yUp;
            const f = (4 * R_M) / (K + r2);
            const cosd = -s * yUp * f * up[0] + x * f * up[1] + (s * (K - r2)) / (K + r2) * up[2];
            if (cosd >= cmin) best = v;
          }
        }
      }
    }
  }
  return best;
}

/**
 * Load the C5 tiles around a site and return a far-field sampler.
 * @returns {Promise<{height(ux,uy,uz,s):number, cells:number[], smax:number[], maxHeight:number,
 *   sources:string[], bytes:number, misses():number}>}
 *   `cells`/`smax`: ray-schedule segments (step = level cell, used up to ground distance smax).
 */
export async function farField(lat_deg, lon_deg, { baseUrl = 'data/dem', fetchFn }) {
  const dem = await openDem(baseUrl, fetchFn);
  const usePolar = Math.abs(lat_deg) >= POLAR_MIN_ABS_LAT && !!dem.polar;
  const polarData = usePolar && lat_deg < 0; // the polar level covers the south pole only
  const before = dem.bytes;
  await Promise.all(neededTiles(dem, lat_deg, lon_deg, polarData).map(([lv, tr, tc]) => loadTile(dem, lv, tr, tc)));
  const { up } = enuBasis(lat_deg, lon_deg);
  const cyl = dem.cyl, pol = dem.polar;
  const height = (ux, uy, uz, s) => {
    let h = NaN;
    if (polarData && s < POLAR_SMAX_M) h = samplePolar(pol, ux, uy, uz);
    if (Number.isNaN(h)) h = sampleCyl(cyl, ux, uy, uz);
    return h;
  };
  const cells = [], smax = [];
  if (usePolar) {
    cells.push(pol.scale_m * (1 + Math.cos((90 - Math.abs(lat_deg)) * D2R)) / 2);
    smax.push(POLAR_SMAX_M);
  }
  cells.push((Math.PI * R_M) / 180 / cyl.res_ppd);
  smax.push(Infinity);
  return {
    height,
    cells,
    smax,
    maxHeight: regionMaxHeight(dem, up, polarData),
    sources: [...(polarData ? [pol.source] : []), cyl.source],
    bytes: dem.bytes - before,
    misses: () => (cyl.misses || 0) + ((pol && pol.misses) || 0),
  };
}
