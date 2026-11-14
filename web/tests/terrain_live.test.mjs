// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Live terrain for custom points (web/js/app/terrain_live.js) and terrainAt cancellation, offline: the Moon Trek
// responses come from a fake fetch (a captured LERC fixture, or a failure), the far field from the shipped C5 tiles.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, fileFetch } from './physics_helpers.mjs';
import {
  configureLiveTerrain, ensureTerrain, keepOnly, onTerrainChange, pointKey, readyTerrain, terrainState, terrainStatusText,
} from '../js/app/terrain_live.js';
import { terrainAt } from '../js/terrain/index.js';

const DEM_DIR = join(REPO, 'web', 'data', 'dem');
const blob = (() => {
  const b = readFileSync(join(REPO, 'web', 'tests', 'fixtures', 'trek_apollo15_global.lerc'));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
})();
let trekCalls = 0;
let trekMode = 'ok';
const seenUrls = new Set();
const trekFetch = async (url, init) => {
  trekCalls++;
  await new Promise((r) => setTimeout(r, 30));
  if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  if (trekMode === 'fail') throw new TypeError('Failed to fetch');
  if (trekMode === 'flaky' && !seenUrls.has(url)) {
    seenUrls.add(url);
    throw new TypeError('Failed to fetch'); // the first try of every grid fails
  }
  return { ok: true, status: 200, arrayBuffer: async () => blob.slice(0) };
};
// 65 px grids: the size of the captured fixture.
configureLiveTerrain({ fetch: fileFetch, trekFetch, demBaseUrl: DEM_DIR, n_px: 65 });
const until = (fn, ms = 8000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => (fn() ? resolve() : Date.now() - t0 > ms ? reject(new Error('timeout')) : setTimeout(tick, 20));
  tick();
});

test('points are cached by a ~9 m key', () => {
  assert.equal(pointKey(26.13221, 3.63391), pointKey(26.1322, 3.6339));
  assert.notEqual(pointKey(26.1322, 3.6339), pointKey(26.1328, 3.6339));
});

test('rapid clicks: a point that is replaced before the debounce never reaches Moon Trek', async () => {
  trekCalls = 0;
  ensureTerrain(10.0, 20.0);
  assert.equal(terrainState(10.0, 20.0), 'waiting');
  assert.equal(terrainStatusText(10.0, 20.0), 'Loading NASA terrain…');
  keepOnly([[10.5, 20.0]]); // the scenario moved on
  assert.equal(terrainState(10.0, 20.0), 'none');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(trekCalls, 0);
});

test('real terrain arrives: status, horizon and patch, and listeners hear it', async () => {
  trekMode = 'ok';
  const seen = [];
  const off = onTerrainChange((e) => seen.push(e.status));
  ensureTerrain(26.1322, 3.6339);
  await until(() => terrainState(26.1322, 3.6339) === 'ready');
  off();
  const r = readyTerrain(26.1322, 3.6339);
  assert.equal(r.horizon.el_deg.length, 1440);
  assert.equal(r.horizon.approximate, false);
  assert.ok(r.patch && r.patch.z_up_m.length === 385 * 385);
  assert.match(terrainStatusText(26.1322, 3.6339), /^Real terrain: NASA LOLA via Moon Trek \(\d+ m\)$/);
  assert.deepEqual(seen, ['loading', 'ready']);
});

test('Moon Trek unreachable: the point falls back to the coarse horizon', async () => {
  trekMode = 'fail';
  ensureTerrain(-30.0, 50.0);
  await until(() => terrainState(-30.0, 50.0) === 'fallback');
  assert.equal(readyTerrain(-30.0, 50.0), null);
  assert.equal(terrainStatusText(-30.0, 50.0), 'Approximate horizon (coarse tiles)');
});

test('a grid that fails once is retried', async () => {
  trekMode = 'flaky';
  trekCalls = 0;
  const r = await terrainAt(-12.0, 40.0, { fetch: fileFetch, trekFetch, demBaseUrl: DEM_DIR, n_px: 65 });
  assert.equal(r.horizon.approximate, false);
  assert.equal(r.meta.levels.length, 2);
  assert.equal(trekCalls, 4); // 2 levels × (failed try + retry)
  trekMode = 'ok';
});

test('terrainAt: an aborted request rejects with AbortError; a fresh one still works', async () => {
  trekMode = 'ok';
  const ctl = new AbortController();
  const p = terrainAt(5.0, 6.0, { fetch: fileFetch, trekFetch, demBaseUrl: DEM_DIR, n_px: 65, signal: ctl.signal });
  setTimeout(() => ctl.abort(), 5);
  await assert.rejects(p, (e) => e.name === 'AbortError');
  const r = await terrainAt(5.0, 6.0, { fetch: fileFetch, trekFetch, demBaseUrl: DEM_DIR, n_px: 65 });
  assert.equal(r.horizon.approximate, false);
  await assert.rejects(terrainAt(5.0, 6.0, { signal: AbortSignal.abort() }), (e) => e.name === 'AbortError');
});
