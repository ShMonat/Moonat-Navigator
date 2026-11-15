// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The turning solar panel with a fixed tilt (web/js/physics/metrics.js tiltPanelFlux, meanVisibleElevation):
// known values, the flat-ground and Sun-facing limits, synthetic missions and the real ephemeris.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, fileFetch } from './physics_helpers.mjs';
import { loadEphem, makeSite, series } from '../js/physics/index.js';
import { tiltPanelFlux, meanVisibleElevation, fluxHorizWm2, fluxNormalWm2 } from '../js/physics/metrics.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);
const DEG = Math.PI / 180;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

test('tiltPanelFlux: known values, e = eps0, no light, undefined tilt, back side', () => {
  close(tiltPanelFlux(1361, 30, 0), 1361 * Math.cos(30 * DEG), 1e-9); // 1178.66 W/m²
  close(tiltPanelFlux(1361, 30, 0), 1178.66, 0.01);
  for (const e of [-0.8, 0, 12.5, 57.3, 89]) assert.equal(tiltPanelFlux(1000, e, e), 1000, `e = eps0 = ${e}`);
  // Symmetric in e − eps0, and the tilt may be below 0° (a raised polar site).
  close(tiltPanelFlux(1361, 2, -0.5), tiltPanelFlux(1361, -3, -0.5), 1e-9);
  assert.equal(tiltPanelFlux(0, 20, 20), 0);
  assert.equal(tiltPanelFlux(1361, 20, NaN), 0);
  assert.equal(tiltPanelFlux(1361, 80, -20), 0); // 100° off the normal: the Sun is behind the panel
});

test('tiltPanelFlux with eps0 = 90° (normal at the zenith) is the flat-ground flux of C6', () => {
  for (const [d, f, e] of [[149597870.7, 1, 30], [1.5e8, 0.4, 3.2], [1.47e8, 1, 88], [1.52e8, 0.7, -1]]) {
    close(tiltPanelFlux(fluxNormalWm2(d, f), e, 90), fluxHorizWm2(d, f, e), 1e-9, `el ${e}`);
  }
  close(tiltPanelFlux(fluxNormalWm2(149597870.7, 1), 30, 90), 680.5, 1e-9);
});

test('meanVisibleElevation: lit samples only, NaN when never lit, not clamped', () => {
  // Synthetic series: night samples (vis 0) are left out of the tilt.
  const se = { sun_el: [-20, -5, 10, 20, 30, 40, -10], sun_vis: [0, 0, 1, 1, 0.5, 1, 0] };
  assert.equal(meanVisibleElevation(se), 25);
  // Mean flux on that series with F_normal = 1000 when lit: cos of 15, 5, 5, 15 degrees.
  const fn = se.sun_vis.map((v) => 1000 * v);
  const f = fn.map((x, i) => tiltPanelFlux(x, se.sun_el[i], 25));
  const want = (1000 * Math.cos(15 * DEG) + 1000 * Math.cos(5 * DEG) + 500 * Math.cos(5 * DEG) + 1000 * Math.cos(15 * DEG)) / 7;
  close(mean(f), want, 1e-9);
  close(mean(f), 489.45, 0.01); // (2 · 965.93 + 996.19 + 498.10) / 7
  assert.ok(Number.isNaN(meanVisibleElevation({ sun_el: [-10, -20], sun_vis: [0, 0] })));
  assert.ok(Number.isNaN(meanVisibleElevation({ sun_el: [], sun_vis: [] })));
  // A raised polar site: the visible Sun below 0° gives a negative tilt, kept as it is.
  close(meanVisibleElevation({ sun_el: [-0.6, -0.2, 0.1], sun_vis: [0.3, 1, 1] }), -0.7 / 3, 1e-12);
});

test('polar site, Sun within ±1.5°: the tilted panel is within 0.04 % of the Sun-facing one', () => {
  const n = 2000;
  const el = Array.from({ length: n }, (_, i) => 1.5 * Math.sin((2 * Math.PI * i) / n));
  const fn = el.map(() => 1361);
  const eps0 = meanVisibleElevation({ sun_el: el, sun_vis: el.map(() => 1) });
  close(eps0, 0, 1e-9);
  const f = fn.map((x, i) => tiltPanelFlux(x, el[i], eps0));
  for (let i = 0; i < n; i++) assert.ok(f[i] / fn[i] >= Math.cos(1.5 * DEG) - 1e-12);
  assert.ok(Math.cos(1.5 * DEG) > 0.9996);
  assert.ok(mean(f) / mean(fn) > 0.9996);
});

test('equatorial lunar day, e(t) = 90° sin: eps0 ≈ 57.3°, flat < tilted < Sun-facing', () => {
  // One synodic day: e = 90° sin(2π t/P), lit while e > 0 (half the time).
  const n = 36000;
  const el = Array.from({ length: n }, (_, i) => 90 * Math.sin((2 * Math.PI * (i + 0.5)) / n));
  const vis = el.map((e) => (e > 0 ? 1 : 0));
  const fn = vis.map((v) => 1361 * v);
  const eps0 = meanVisibleElevation({ sun_el: el, sun_vis: vis });
  close(eps0, 180 / Math.PI, 0.01); // 90° · 2/π = 57.30°
  const tilt = mean(fn.map((x, i) => tiltPanelFlux(x, el[i], eps0)));
  const flat = mean(fn.map((x, i) => x * Math.max(0, Math.sin(el[i] * DEG))));
  const normal = mean(fn);
  close(normal, 680.5, 1e-6);
  assert.ok(flat < tilt && tilt < normal, `${flat} < ${tilt} < ${normal}`);
  console.log(`# 90° sin day: eps0 ${eps0.toFixed(2)}°, mean flat ${flat.toFixed(1)}, tilted ${tilt.toFixed(1)}, Sun-facing ${normal.toFixed(1)} W/m²`);
});

const EPHEM_DIR = join(REPO, 'web', 'data', 'ephem');
const READY = existsSync(join(EPHEM_DIR, 'manifest.json'));

test('real ephemeris: equator (linear elevation) and south pole', { skip: !READY && 'ephem tables not present' }, async () => {
  await loadEphem(EPHEM_DIR, { fetch: fileFetch });
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  const run = async (lat, lon) => {
    const se = await series(makeSite({ lat_deg: lat, lon_deg: lon }), t0, t0 + 59 * 86400e3, 3600e3);
    const eps0 = meanVisibleElevation(se);
    const tilt = se.flux_normal_wm2.map((f, i) => tiltPanelFlux(f, se.sun_el[i], eps0));
    return { eps0, normal: mean(se.flux_normal_wm2), tilt: mean(tilt), flat: mean(se.flux_horiz_wm2) };
  };
  // Apollo 11 site, flat horizon. Near the equator the Sun climbs at a constant rate (e = 90° − |hour angle|), so the
  // daytime elevation is uniform on [0°, 90°]: eps0 = 45°, tilted / Sun-facing = mean cos(e − 45°) = 2√2/π = 0.900,
  // flat / Sun-facing = mean sin e = 2/π = 0.637.
  const eq = await run(0.67416, 23.47314);
  close(eq.eps0, 45, 1.5, 'equator eps0');
  close(eq.tilt / eq.normal, (2 * Math.SQRT2) / Math.PI, 0.005, 'equator tilted / Sun-facing');
  close(eq.flat / eq.normal, 2 / Math.PI, 0.005, 'equator flat / Sun-facing');
  // Near the south pole (flat horizon) the Sun stays within 1.5° of the horizon: tilted ≈ Sun-facing.
  const sp = await run(-89.9, 0);
  assert.ok(Math.abs(sp.eps0) < 1.5, `pole eps0 ${sp.eps0}`);
  assert.ok(sp.tilt / sp.normal > 0.9996, `pole ratio ${sp.tilt / sp.normal}`);
  console.log(`# equator: eps0 ${eq.eps0.toFixed(2)}°, means flat ${eq.flat.toFixed(1)} / tilted ${eq.tilt.toFixed(1)} / Sun-facing ${eq.normal.toFixed(1)} W/m²`);
  console.log(`# 89.9° S: eps0 ${sp.eps0.toFixed(2)}°, tilted / Sun-facing ${(sp.tilt / sp.normal).toFixed(6)}`);
});
