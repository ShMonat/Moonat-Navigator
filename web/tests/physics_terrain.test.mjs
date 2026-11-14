// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// horizonFromTiles (C5 DEM tiles -> C3-shaped horizon) must reproduce the Python reference
// (tests/fixtures/custom_horizon_cases.json, from tests/test_custom_horizon_fixtures.py), fetch only
// the tiles it needs, and be fast. Also measures how far the coarse tile horizons are from the
// full-resolution C3 profiles (web/data/horizons/), i.e. the missing near field.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, fileFetch } from './physics_helpers.mjs';
import { horizonFromTiles } from '../js/physics/index.js';
import { _demMisses } from '../js/physics/terrain.js';

const DEM_DIR = join(REPO, 'web', 'data', 'dem');
const FIXTURE = join(REPO, 'tests', 'fixtures', 'custom_horizon_cases.json');
const READY = existsSync(join(DEM_DIR, 'manifest.json')) && existsSync(FIXTURE);
const FX = READY ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : { cases: [] };

const fetched = [];
const countingFetch = (url) => { fetched.push(url); return fileFetch(url); };
const opts = { baseUrl: DEM_DIR, fetch: countingFetch, az_step_deg: FX.az_step_deg };

function stats(a, b) {
  let s2 = 0, sum = 0, mx = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s2 += d * d; sum += d; mx = Math.max(mx, Math.abs(d));
  }
  return { rms: Math.sqrt(s2 / a.length), bias: sum / a.length, max: mx };
}

// C3 profile value at azimuth az (linear, periodic).
function c3At(h, az) {
  const n = h.el_deg.length, x = (az % 360) / h.az_step_deg;
  const k = Math.floor(x), f = x - k;
  return h.el_deg[k % n] * (1 - f) + h.el_deg[(k + 1) % n] * f;
}

test('tile horizons match the Python reference (C5 + moonat.terrain.horizon)', { skip: !READY && 'DEM tiles or fixture not present' }, async () => {
  const lines = [];
  for (const c of FX.cases) {
    fetched.length = 0;
    const t = performance.now();
    const h = await horizonFromTiles(c.lat_deg, c.lon_deg, opts);
    const ms = performance.now() - t;
    const st = stats(h.el_deg, c.el_deg);
    const nBin = fetched.filter((u) => u.endsWith('.bin')).length;
    lines.push(`${c.name.padEnd(15)} RMS ${st.rms.toExponential(1)}° max ${st.max.toExponential(1)}°  ${nBin} new tiles  ${ms.toFixed(0)} ms`);
    assert.equal(h.el_deg.length, c.el_deg.length, c.name);
    assert.ok(st.rms <= 0.3, `${c.name}: RMS ${st.rms}`);
    assert.ok(st.max <= 0.01, `${c.name}: max |JS − Python| ${st.max}°`);
    assert.ok(Math.abs(h.ground_elev_m - c.ground_elev_m) <= 0.01, `${c.name} ground ${h.ground_elev_m} vs ${c.ground_elev_m}`);
    assert.equal(h.unterminated_rays, 0, c.name);
  }
  assert.equal(_demMisses(), 0, 'a ray sample needed a tile that was not fetched');
  console.log(`# JS vs Python tile horizons (az step ${FX.az_step_deg}°):\n#   ${lines.join('\n#   ')}`);
});

test('C3 shape, labels, caching and lazy tile loading', { skip: !READY && 'DEM tiles not present' }, async () => {
  const h = await horizonFromTiles(0.6741, 23.473, opts);
  for (const k of ['lat_deg', 'lon_deg', 'ground_elev_m', 'observer_height_m', 'az_step_deg', 'el_deg', 'dist_km', 'max_range_km', 'dem_sources']) assert.ok(k in h, k);
  assert.equal(h.source, 'dem-tiles');
  assert.equal(h.approximate, true);
  assert.equal(h.label, 'approximate terrain (coarse)');
  assert.equal(h.el_deg.length, 720);
  assert.equal(await horizonFromTiles(0.6741, 23.473, opts), h, 'cached');
  // A fresh equatorial point needs only the global tiles around it (4 of the 72 here).
  fetched.length = 0;
  await horizonFromTiles(-3.01, 23.9, opts);
  assert.ok(fetched.length <= 4, `fetched ${fetched.length}`);
  assert.ok(fetched.every((u) => /global8/.test(u)));
});

test('tile horizons vs the full-resolution C3 profiles (missing near field)', { skip: !READY && 'DEM tiles not present' }, async () => {
  const lines = [];
  for (const c of FX.cases.filter((x) => x.c3_id)) {
    const c3 = JSON.parse(readFileSync(join(REPO, 'web', 'data', 'horizons', `${c.c3_id}.json`), 'utf8'));
    const h = await horizonFromTiles(c.lat_deg, c.lon_deg, opts);
    const full = h.el_deg.map((_, k) => c3At(c3, k * h.az_step_deg));
    const flat = full.map(() => 0);
    const st = stats(h.el_deg, full), sf = stats(flat, full);
    lines.push(`${c.name.padEnd(15)} tiles−C3 RMS ${st.rms.toFixed(2)}° bias ${st.bias >= 0 ? '+' : ''}${st.bias.toFixed(2)}°   (flat−C3 RMS ${sf.rms.toFixed(2)}°)`);
    assert.ok(st.rms < 8, c.name);
  }
  console.log(`# tile horizons vs full C3 profiles:\n#   ${lines.join('\n#   ')}`);
});
