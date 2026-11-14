// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Terrain module (web/js/terrain): offline checks of the ray march, the patch and the
// georeferencing of Moon Trek grids. Live accuracy against the C3 profiles is in
// docs/validation/terrain-everywhere.md (scripts/data/validate_terrain_everywhere.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, fileFetch } from './physics_helpers.mjs';
import { horizonFromTiles } from '../js/physics/index.js';
import { D2R, R_M, enuBasis, gridBilinear, stereoXY } from '../js/terrain/geom.js';
import { farField } from '../js/terrain/tiles.js';
import { marchHorizon, terrainPatch } from '../js/terrain/march.js';
import { computeTerrain } from '../js/terrain/core.js';
import { decodeLerc1 } from '../js/terrain/lerc1.js';
import { layerCovers, planLevels } from '../js/terrain/trek.js';

const DEM_DIR = join(REPO, 'web', 'data', 'dem');
const FIX = join(REPO, 'web', 'tests', 'fixtures');
const CASES = join(REPO, 'tests', 'fixtures', 'custom_horizon_cases.json');
const READY = existsSync(join(DEM_DIR, 'manifest.json')) && existsSync(CASES);
const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

// ---- helpers -----------------------------------------------------------------------------------
/** Unit vector of the ground point at stereographic plane coords (x, y) of a site. */
function unitFromPlane(enu, x, y) {
  const r = Math.hypot(x, y), th = 2 * Math.atan(r / (2 * R_M));
  const a = Math.atan2(x, y);
  return [0, 1, 2].map((i) => Math.cos(th) * enu.up[i] + Math.sin(th) * (Math.cos(a) * enu.north[i] + Math.sin(a) * enu.east[i]));
}
function makeGrid(enu, half_m, n, hFn) {
  const cell = (2 * half_m) / n, data = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const x = -half_m + (c + 0.5) * cell, y = half_m - (r + 0.5) * cell;
    data[r * n + c] = hFn(unitFromPlane(enu, x, y));
  }
  return { half_m, cell_m: cell, n, data };
}
const zeroFar = { height: () => 0, cells: [3790], smax: [Infinity], maxHeight: 0 };

// ---- tests -------------------------------------------------------------------------------------
test('stereographic plane: along a ray r = 2R tan(θ/2), x = r sin A, y = r cos A (any latitude)', () => {
  for (const [lat, lon] of [[0.67, 23.47], [26.13, 3.63], [-89.44, -137.19], [-90, 0], [90, 0], [-85.05, 30]]) {
    const enu = enuBasis(lat, lon);
    for (const [thDeg, aDeg] of [[0.1, 0], [0.5, 60], [2, 200], [10, 317]]) {
      const th = thDeg * D2R, a = aDeg * D2R;
      const u = [0, 1, 2].map((i) => Math.cos(th) * enu.up[i] + Math.sin(th) * (Math.cos(a) * enu.north[i] + Math.sin(a) * enu.east[i]));
      const [x, y] = stereoXY(enu, ...u);
      const r = 2 * R_M * Math.tan(th / 2);
      assert.ok(Math.abs(x - r * Math.sin(a)) < 1e-6 && Math.abs(y - r * Math.cos(a)) < 1e-6, `${lat},${lon} θ=${thDeg} A=${aDeg}`);
    }
  }
});

test('level plan: 20 m / 30 m polar near field, 118 m elsewhere, nested 4× levels', () => {
  const p = (lat) => planLevels(lat).map((l) => `${l.key}@${Math.round(l.cell_m)}`).join(' ');
  assert.equal(p(-89.44), 'south20@20 south20@80 south30@320');
  assert.equal(p(-90), 'south20@20 south20@80 south30@320');
  assert.equal(p(-86.0), 'south20@20 south20@80 south30@320');
  assert.equal(p(-80.1), 'south30@30 south30@120 south30@480');
  assert.equal(p(88), 'north30@30 north30@120 north30@480');
  assert.equal(p(0.67), 'global118@118 global237@474');
  assert.equal(p(-69.4), 'global118@118 global237@474');
  assert.equal(p(-76), 'south30@30 global118@120 global237@480');
  assert.ok(layerCovers('south20', -89, 4000) && !layerCovers('south20', -84, 4000));
  for (const l of planLevels(-89.44)) assert.equal(l.n % 2, 1, 'odd n puts the site on a pixel centre');
});

test('C5 tiles only: the march reproduces horizonFromTiles exactly', { skip: !READY && 'DEM tiles not present' }, async () => {
  const FX = JSON.parse(readFileSync(CASES, 'utf8'));
  for (const c of FX.cases) {
    const ref = await horizonFromTiles(c.lat_deg, c.lon_deg, { baseUrl: DEM_DIR, fetch: fileFetch, az_step_deg: FX.az_step_deg });
    const far = await farField(c.lat_deg, c.lon_deg, { baseUrl: DEM_DIR, fetchFn: fileFetch });
    const h = marchHorizon({ lat_deg: c.lat_deg, lon_deg: c.lon_deg, az_step_deg: FX.az_step_deg, grids: [], far });
    let mx = 0;
    for (let k = 0; k < ref.el_deg.length; k++) mx = Math.max(mx, Math.abs(h.el_deg[k] - ref.el_deg[k]), Math.abs(h.dist_km[k] - ref.dist_km[k]) / 100);
    assert.ok(mx <= 1e-9, `${c.name}: max diff ${mx}`);
    assert.equal(h.ground_elev_m, ref.ground_elev_m, c.name);
    assert.equal(h.max_range_km, ref.max_range_km, c.name);
    assert.equal(far.misses(), 0);
  }
  // and computeTerrain({online: false}) is the same thing in the C3 shape
  const c = FX.cases[0];
  const r = await computeTerrain(c.lat_deg, c.lon_deg, { online: false, fetch: fileFetch, demBaseUrl: DEM_DIR, az_step_deg: FX.az_step_deg });
  const ref = await horizonFromTiles(c.lat_deg, c.lon_deg, { baseUrl: DEM_DIR, fetch: fileFetch, az_step_deg: FX.az_step_deg });
  assert.deepEqual(r.horizon.el_deg, ref.el_deg);
  assert.equal(r.patch, null);
  assert.equal(r.horizon.approximate, true);
});

test('smooth sphere through nested grids: el = −acos(ρ/(ρ+h)) on every azimuth', () => {
  for (const [lat, lon, eye] of [[10, 20, 2], [-89.5, 40, 10], [-90, 0, 2]]) {
    const enu = enuBasis(lat, lon);
    const grids = [makeGrid(enu, 4010, 401, () => 0), makeGrid(enu, 16040, 401, () => 0), makeGrid(enu, 64160, 401, () => 0)];
    const h = marchHorizon({ lat_deg: lat, lon_deg: lon, observer_height_m: eye, az_step_deg: 1, grids, far: zeroFar });
    const exp = -Math.acos(R_M / (R_M + eye)) / D2R;
    for (const e of h.el_deg) assert.ok(Math.abs(e - exp) < 6e-5, `${lat}: ${e} vs ${exp}`); // output rounded to 1e-4°
    for (const d of h.dist_km) assert.ok(Math.abs(d - Math.sqrt(2 * R_M * eye) / 1000) < 0.03, `dist ${d}`);
    assert.equal(h.unterminated_rays, 0);
  }
});

test('Gaussian hill in a grid: horizon matches a dense brute-force march of the analytic surface', () => {
  const [lat, lon] = [-60, 100];
  const enu = enuBasis(lat, lon);
  const H = 2000, sig = 3000, dist = 15000, bearing = 60 * D2R;
  const thc = dist / R_M;
  const C = [0, 1, 2].map((i) => Math.cos(thc) * enu.up[i] + Math.sin(thc) * (Math.cos(bearing) * enu.north[i] + Math.sin(bearing) * enu.east[i]));
  const hill = (u) => { const d2 = ((u[0] - C[0]) ** 2 + (u[1] - C[1]) ** 2 + (u[2] - C[2]) ** 2) * R_M * R_M; return H * Math.exp(-d2 / (2 * sig * sig)); };
  const grids = [makeGrid(enu, 23750, 401, hill), makeGrid(enu, 95000, 401, hill)];
  const h = marchHorizon({ lat_deg: lat, lon_deg: lon, observer_height_m: 2, az_step_deg: 0.25, grids, far: zeroFar });
  const rE = R_M + hill(enu.up) + 2;
  for (const azDeg of [45, 55, 60, 63, 75]) {
    const a = azDeg * D2R;
    let best = -Infinity;
    for (let s = 1; s <= 40000; s += 2) {
      const th = s / R_M;
      const u = [0, 1, 2].map((i) => Math.cos(th) * enu.up[i] + Math.sin(th) * (Math.cos(a) * enu.north[i] + Math.sin(a) * enu.east[i]));
      const rho = R_M + hill(u);
      best = Math.max(best, Math.atan2(rho * Math.cos(th) - rE, rho * Math.sin(th)));
    }
    const k = Math.round(azDeg / 0.25);
    assert.ok(Math.abs(h.el_deg[k] - best / D2R) < 0.005, `az ${azDeg}: march ${h.el_deg[k]} vs brute ${best / D2R}`);
  }
  assert.ok(h.el_deg[240] > 6 && h.el_deg[240] < 8, `peak ${h.el_deg[240]}`);
});

test('terrain patch on a sphere: z = curvature drop; on a grid, matches a direct evaluation', () => {
  const enu = enuBasis(-45, 10);
  const grids = [makeGrid(enu, 16040, 401, () => 500)];
  const p = terrainPatch({ lat_deg: -45, lon_deg: 10, grids, far: null, ground_elev_m: 500, half_extent_m: 12000, n: 49 });
  const Rh = R_M + 500;
  for (const [r, c] of [[0, 0], [24, 24], [0, 48], [48, 13]]) {
    const x = -12000 + c * p.spacing_m, y = 12000 - r * p.spacing_m, s2 = x * x + y * y;
    const exp = Math.sqrt(Rh * Rh - s2) - Rh;
    assert.ok(Math.abs(p.z_up_m[r * 49 + c] - exp) < 1e-3, `(${r},${c}) ${p.z_up_m[r * 49 + c]} vs ${exp}`);
  }
  assert.equal(p.nan_cells, 0);
});

// Georeferencing: Moon Trek grids (fixtures) vs the shipped C4 patches built from PDS LOLA/SLDEM.
// Both are converted to the C4 quantity (ENU up of the surface vs the ground point) at the same
// ENU positions; the RMS difference is minimised over shifts of up to ±200 m. A wrong sign,
// rotation or half-pixel convention would show up as a large RMS or a shifted minimum.
// Polar sites compare LOLA 20 m with LOLA 20 m (expect ~1 m). Apollo 15 compares LOLA-only 118 m
// with SLDEM2015 (59 m, stereo + LOLA): the products differ by ~15 m RMS on flats and 30–50 m on the
// steep Hadley Delta slopes, but the best shift stays at ~10 m.
for (const [fx, site, maxShift, maxRms] of [['apollo15_global', 'apollo15', 60, 30], ['shackleton20m', 'shackleton_rim', 30, 6], ['southpole20m', 'south_pole', 30, 6]]) {
  test(`Moon Trek grid georeferencing vs the C4 patch: ${site}`, () => {
    const meta = JSON.parse(readFileSync(join(FIX, 'trek_fixtures.json'), 'utf8')).cases.find((c) => c.name === fx);
    const g = decodeLerc1(ab(join(FIX, `trek_${fx}.lerc`)));
    const grid = { half_m: meta.half, cell_m: (2 * meta.half) / meta.n, n: meta.n, data: g.pixels };
    const c4 = JSON.parse(readFileSync(join(REPO, 'web', 'data', 'terrain', `${site}.json`), 'utf8'));
    const z4 = new Float32Array(ab(join(REPO, 'web', 'data', 'terrain', `${site}.bin`)));
    const c4grid = { half_m: c4.half_extent_m + c4.spacing_m / 2, cell_m: c4.spacing_m, n: c4.grid_n, data: z4 };
    const h0 = gridBilinear(grid, 0, 0);
    const pts = [];
    for (let r = 2; r < meta.n - 2; r++) for (let c = 2; c < meta.n - 2; c++) {
      const x = -meta.half + (c + 0.5) * grid.cell_m, y = meta.half - (r + 0.5) * grid.cell_m;
      const h = grid.data[r * meta.n + c];
      const rp = Math.hypot(x, y), th = 2 * Math.atan(rp / (2 * R_M)), rho = R_M + h;
      const sh = rho * Math.sin(th), f = rp > 0 ? sh / rp : 1;
      pts.push([x * f, y * f, rho * Math.cos(th) - (R_M + c4.ground_elev_m)]);
    }
    let best = { rms: Infinity };
    for (let dx = -200; dx <= 200; dx += 10) for (let dy = -200; dy <= 200; dy += 10) {
      let s2 = 0, n = 0;
      for (const [x, y, z] of pts) { const v = gridBilinear(c4grid, x + dx, y + dy); if (Number.isFinite(v)) { s2 += (z - v) ** 2; n++; } }
      const rms = Math.sqrt(s2 / n);
      if (rms < best.rms) best = { rms, dx, dy };
    }
    let s0 = 0;
    for (const [x, y, z] of pts) s0 += (z - gridBilinear(c4grid, x, y)) ** 2;
    const rms0 = Math.sqrt(s0 / pts.length);
    console.log(`# ${site}: ground ${h0.toFixed(1)} m (C4 ${c4.ground_elev_m}); RMS dz ${rms0.toFixed(2)} m unshifted, ${best.rms.toFixed(2)} m at shift (${best.dx}, ${best.dy}) m`);
    assert.ok(Math.hypot(best.dx, best.dy) <= maxShift, `best shift ${best.dx},${best.dy}`);
    assert.ok(rms0 < maxRms, `RMS ${rms0}`);
  });
}
