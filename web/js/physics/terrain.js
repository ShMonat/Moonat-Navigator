// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Terrain horizon of any lunar point from the coarse DEM tiles (contract C5 `dem-tiles`), in the
// C3 `horizon-profile` shape. Port of moonat.terrain.horizon run on moonat.terrain.tiles.tiles_dem:
//
// - Frame MOON_ME, sphere R = 1737.4 km. Eye at R + h0 + observer height along up (radial).
// - Ray for true azimuth A: great circle u(θ) = cos θ·up + sin θ·d, d = cos A·north + sin A·east.
//   Terrain point P = (R + h(u))·u; elevation from the eye el = atan2(ρ cos θ − r_E, ρ sin θ)
//   (exact curvature, no refraction). Horizon = max el along the ray; dist_km = R·θ at that point.
// - Heights: bilinear on the finest level that covers the sample (south480 within 450 km for
//   |lat| ≥ 78°, else global8); no data cannot occlude. Step = the finest level's cell size.
// - Stop rule (rigorous): with ρ ≤ ρ_max (highest terrain within 0.25 rad + 300 m), no point beyond
//   θ = acos(r_E cos el*/ρ_max) − el* can exceed el*.
// Limits: global8 is ~3.8 km/px and south480 480 m/px, so near-field relief (first few km) is
// missing; the result is labelled approximate. Longitude wraps across 0/360 (the Python reference
// leaves a 0.125° gap at the seam).

const R_M = 1737400;
const REGION_RAD = 0.25; // central angle over which the max terrain height bounds the rays
const HEIGHT_MARGIN_M = 300;
const POLAR_SMAX_M = 450000;
const POLAR_MIN_ABS_LAT = 78;
const D2R = Math.PI / 180;

let DEM = null; // {base, fetchFn, manifest, cyl, polar}
const TILE_CACHE = new Map(); // url -> Promise<Float32Array>
const RESULT_CACHE = new Map();

function joinUrl(base, name) {
  return base ? `${String(base).replace(/\/+$/, '')}/${name}` : name;
}

async function openDem(base, fetchFn) {
  if (DEM && DEM.base === base && DEM.fetchFn === fetchFn) return DEM;
  const res = await fetchFn(joinUrl(base, 'manifest.json'));
  if (!res.ok) throw new Error(`dem: cannot load manifest (${res.status}) from ${base}`);
  const manifest = await res.json();
  const lv = (id) => manifest.levels.find((l) => l.id === id || (id === 'cyl' ? l.projection === 'simple_cylindrical' : l.projection === 'polar_stereographic'));
  const mk = (l) => l && { ...l, ntr: l.tiles[0], ntc: l.tiles[1], data: new Array(l.tiles[0] * l.tiles[1]).fill(null) };
  DEM = { base, fetchFn, manifest, cyl: mk(lv('cyl')), polar: mk(lv('polar')) };
  if (!DEM.cyl) throw new Error('dem: manifest has no simple_cylindrical level');
  return DEM;
}

function loadTile(dem, level, tr, tc) {
  const url = joinUrl(dem.base, level.url.replace('{tr}', tr).replace('{tc}', tc));
  if (!TILE_CACHE.has(url)) {
    const p = (async () => {
      const res = await dem.fetchFn(url);
      if (!res.ok) throw new Error(`dem: cannot load ${url} (${res.status})`);
      const dv = new DataView(await res.arrayBuffer());
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

// Pixel value of a level at integer (r, c), NaN outside the image or in a tile that is not loaded.
function px(level, r, c) {
  if (r < 0 || c < 0 || r >= level.lines || c >= level.samples) return NaN;
  const ts = level.tile_size;
  const tr = (r / ts) | 0, tc = (c / ts) | 0;
  const t = level.data[tr * level.ntc + tc];
  if (!t) { level.misses = (level.misses || 0) + 1; return NaN; }
  return t[(r - tr * ts) * ts + (c - tc * ts)];
}

// Bilinear height (m) at fractional (row, col); NaN outside the image (like moonat.terrain.dem.bilinear).
// `wrapCols` makes columns periodic (cylindrical level).
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

function sampleCyl(level, ux, uy, uz) {
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

function samplePolar(level, ux, uy, uz) {
  const [r, c] = polarRowCol(level, ux, uy, uz);
  return Number.isFinite(r) && Number.isFinite(c) ? bilinear(level, r, c, false) : NaN;
}

/** ENU basis (rows east, north, up) in MOON_ME, as moonat.terrain.pds.enu_basis. */
function enuBasis(lat_deg, lon_deg) {
  const la = lat_deg * D2R, lo = lon_deg * D2R;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  let north, east;
  if (Math.abs(lat_deg) > 89.9999) {
    const dn = up[0];
    north = [1 - dn * up[0], -dn * up[1], -dn * up[2]];
    const n = Math.hypot(...north);
    north = north.map((x) => x / n);
    east = [north[1] * up[2] - north[2] * up[1], north[2] * up[0] - north[0] * up[2], north[0] * up[1] - north[1] * up[0]];
  } else {
    east = [-Math.sin(lo), Math.cos(lo), 0];
    north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
  }
  return { east, north, up };
}

// Tiles of each level that hold any pixel within REGION_RAD of the site (plus a 2-pixel margin).
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
    // The stereographic image of the region (a spherical cap) is a disc: bound it by its edge.
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

// Highest loaded terrain (m) within REGION_RAD of `up` (as LayeredDEM.max_height_m(0.25)).
function regionMaxHeight(dem, up, usePolar) {
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

function stopAngle(rEye, elStar, rhoMax) {
  const c = Math.max(-1, Math.min(1, (rEye * Math.cos(elStar)) / rhoMax));
  return Math.acos(c) - elStar;
}

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

  const dem = await openDem(baseUrl, fetchFn);
  const usePolar = Math.abs(lat_deg) >= POLAR_MIN_ABS_LAT && !!dem.polar;
  const polarData = usePolar && lat_deg < 0; // the polar level covers the south pole only
  await Promise.all(neededTiles(dem, lat_deg, lon_deg, polarData).map(([lv, tr, tc]) => loadTile(dem, lv, tr, tc)));

  const { east, north, up } = enuBasis(lat_deg, lon_deg);
  const cyl = dem.cyl, pol = dem.polar;
  const height = (ux, uy, uz, s) => {
    let h = NaN;
    if (polarData && s < POLAR_SMAX_M) h = samplePolar(pol, ux, uy, uz);
    if (Number.isNaN(h)) h = sampleCyl(cyl, ux, uy, uz);
    return h;
  };
  const h0Raw = height(up[0], up[1], up[2], 0);
  const h0 = Number.isFinite(h0Raw) ? h0Raw : 0;
  const rhoMax = R_M + regionMaxHeight(dem, up, polarData) + HEIGHT_MARGIN_M;
  const rEye = R_M + h0 + observer_height_m;
  const thCap = Math.min(stopAngle(rEye, -5 * D2R, rhoMax), REGION_RAD);
  const sCap = thCap * R_M;

  // Ray schedule (moonat.terrain.horizon.ray_schedule): steps of the finest layer's cell.
  const cylCell = (Math.PI * R_M) / 180 / cyl.res_ppd;
  const cells = [], smax = [];
  if (usePolar) {
    cells.push(pol.scale_m * (1 + Math.cos((90 - Math.abs(lat_deg)) * D2R)) / 2);
    smax.push(POLAR_SMAX_M);
  }
  cells.push(cylCell); smax.push(Infinity);
  const sched = [];
  let s = 0;
  for (let k = 0; k < cells.length; k++) {
    const end = Math.min(smax[k], sCap);
    if (end <= s) continue;
    const n = Math.ceil((end - s) / cells[k]);
    const s0 = s;
    for (let i = 1; i <= n; i++) sched.push(s0 + cells[k] * i);
    s = sched[sched.length - 1];
    if (s >= sCap) break;
  }
  const th = Float64Array.from(sched, (x) => x / R_M);
  const cth = th.map(Math.cos), sth = th.map(Math.sin);

  const nAz = Math.round(360 / az_step_deg);
  const elOut = new Array(nAz), distOut = new Array(nAz);
  let rangeNeeded = 0, unterminated = 0;
  for (let k = 0; k < nAz; k++) {
    const a = k * az_step_deg * D2R;
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = ca * north[0] + sa * east[0], dy = ca * north[1] + sa * east[1], dz = ca * north[2] + sa * east[2];
    let elBest = -Math.PI / 2, thBest = 0, thStop = stopAngle(rEye, elBest, rhoMax), done = false;
    for (let i = 0; i < th.length; i++) {
      const c = cth[i], sn = sth[i];
      const h = height(c * up[0] + sn * dx, c * up[1] + sn * dy, c * up[2] + sn * dz, sched[i]);
      if (!Number.isNaN(h)) {
        const rho = R_M + h;
        const el = Math.atan2(rho * c - rEye, rho * sn);
        if (el > elBest) { elBest = el; thBest = th[i]; thStop = stopAngle(rEye, elBest, rhoMax); }
      }
      if (thStop <= th[i]) { done = true; break; }
    }
    if (!done) unterminated++;
    rangeNeeded = Math.max(rangeNeeded, thStop);
    elOut[k] = Math.round((elBest / D2R) * 1e4) / 1e4;
    distOut[k] = Math.round(thBest * R_M) / 1e3;
  }

  const result = {
    id: null,
    lat_deg,
    lon_deg,
    ground_elev_m: Math.round(h0 * 100) / 100,
    observer_height_m,
    az_step_deg,
    el_deg: elOut,
    dist_km: distOut,
    max_range_km: Math.round((rangeNeeded * R_M) / 100) / 10,
    dem_sources: [...(polarData ? [pol.source] : []), cyl.source],
    source: 'dem-tiles',
    approximate: true,
    label: 'approximate terrain (coarse)',
    unterminated_rays: unterminated,
  };
  RESULT_CACHE.set(key, result);
  return result;
}

/** Test hook: number of tile-pixel reads that hit a tile that was not loaded (should be 0). */
export function _demMisses() {
  return DEM ? (DEM.cyl.misses || 0) + ((DEM.polar && DEM.polar.misses) || 0) : 0;
}
