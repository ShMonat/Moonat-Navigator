// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Eclipse of the Sun by the Earth seen from the Moon (web/js/physics/eclipse.js and its use in
// skyState/series): quadrature against the analytic lens area, the real 2025-03-14 and 1967-04-24
// eclipses at the Blue Ghost and Surveyor 3 sites, and agreement with the Python reference
// (tests/fixtures/eclipse_cases.json, written by tests/test_eclipse.py).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEphem, makeSite, skyState, series } from '../js/physics/index.js';
import { occultedFluxFraction, sunEclipseFrac, gaussLegendre } from '../js/physics/eclipse.js';
import { fileFetch, REPO } from './physics_helpers.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);
const horizon = async (id) => JSON.parse(await readFile(`${REPO}web/data/horizons/${id}.json`, 'utf8'));
const siteOf = (hz) => makeSite({ lat_deg: hz.lat_deg, lon_deg: hz.lon_deg, horizon: hz });

before(async () => {
  await loadEphem(`${REPO}web/data/ephem`, { fetch: fileFetch });
});

// Lens area of two circles (radii 1 and p, centre distance z) over the unit disk area.
function lens(z, p) {
  if (z >= 1 + p) return 0;
  if (z <= Math.abs(1 - p)) return Math.min(1, p * p);
  const a = Math.acos((z * z + 1 - p * p) / (2 * z));
  const b = p * p * Math.acos((z * z + p * p - 1) / (2 * z * p));
  const c = 0.5 * Math.sqrt((-z + 1 + p) * (z + 1 - p) * (z - 1 + p) * (z + 1 + p));
  return (a + b - c) / Math.PI;
}

test('Gauss–Legendre nodes integrate polynomials exactly', () => {
  const { x, w } = gaussLegendre(24);
  close(w.reduce((s, v) => s + v, 0), 2, 1e-13);
  close(x.reduce((s, v, i) => s + w[i] * v ** 46, 0), 2 / 47, 1e-13);
});

test('uniform disk: the covered fraction equals the analytic lens area (< 1e-8)', () => {
  let worst = 0;
  for (const p of [0.1, 0.5, 0.99, 1, 1.5, 3.4, 3.9]) {
    for (let k = 0; k <= 600; k++) {
      const z = (k / 600) * (1 + p + 0.1);
      worst = Math.max(worst, Math.abs(occultedFluxFraction(z, p, 0) - lens(z, p)));
    }
  }
  assert.ok(worst < 1e-8, `worst ${worst}`);
});

test('limb darkening: a central small occulter hides more flux than area, a limb one less', () => {
  const p = 0.2;
  // Central: I(centre) = 1 vs mean 1 − u/3 = 0.8, so the flux share is 1.25 × the area share.
  close(occultedFluxFraction(0, p, 0.6), (p * p * (1 - 0.6 * (1 - Math.sqrt(1 - 0.01)))) / 0.8, 2e-3);
  assert.ok(occultedFluxFraction(0.9, p, 0.6) < lens(0.9, p));
  assert.equal(occultedFluxFraction(1.2001, p, 0.6), 0);
  assert.equal(occultedFluxFraction(2.4, 3.5, 0.6), 1);
});

test('no overlap: separations beyond the sum of the radii give exactly 0', () => {
  const s = [1, 0, 0];
  const a = (0.27 + 0.95 + 1e-6) * Math.PI / 180;
  assert.equal(sunEclipseFrac(s, 0.27, [Math.cos(a), Math.sin(a), 0], 0.95), 0);
  const b = (0.27 + 0.95 - 0.01) * Math.PI / 180;
  assert.ok(sunEclipseFrac(s, 0.27, [Math.cos(b), Math.sin(b), 0], 0.95) > 0);
});

test('Blue Ghost, 2025-03-14: total eclipse of the Sun by the Earth, flux and terrain fields', async () => {
  const site = siteOf(await horizon('blueghost1'));
  const day = Date.UTC(2025, 2, 14);
  const r = await series(site, day, day + 86400000, 600e3);
  assert.equal(r.eclipses.length, 1);
  const e = r.eclipses[0];
  assert.equal(e.max_frac, 1);
  assert.ok(e.total_start_ms > Date.UTC(2025, 2, 14, 5, 9, 33) && e.total_start_ms < Date.UTC(2025, 2, 14, 6, 25, 59), 'U1 < C2 < U2');
  assert.ok(e.total_end_ms > Date.UTC(2025, 2, 14, 7, 31, 23) && e.total_end_ms < Date.UTC(2025, 2, 14, 8, 47, 48), 'U3 < C3 < U4');
  const mid = await skyState(site, e.max_ms);
  assert.equal(mid.sun.eclipse_frac, 1);
  assert.equal(mid.sun.flux_frac, 0);
  assert.equal(mid.sun.flux_normal_wm2, 0);
  assert.equal(mid.sun.vis_frac, 1, 'vis_frac stays terrain-only');
  const half = await skyState(site, 0.5 * (e.start_ms + e.total_start_ms));
  assert.ok(half.sun.eclipse_frac > 0.05 && half.sun.eclipse_frac < 0.95);
  close(half.sun.flux_frac, 1 - half.sun.eclipse_frac, 1e-15);
  // The series agrees with skyState, and a total eclipse is not "in sunlight".
  const i = r.t_ms.findIndex((t) => t > e.total_start_ms + 1200e3);
  close(r.sun_eclipse[i], (await skyState(site, r.t_ms[i])).sun.eclipse_frac, 1e-12);
  assert.equal(r.sun_flux_frac[i], 0);
  const lit = r.sun_flux_frac.filter((v) => v > 0).length;
  close(r.summary.sun_vis_pct, (100 * lit) / r.t_ms.length, 1e-12);
  assert.ok(r.summary.sun_vis_pct < (100 * r.sun_vis.filter((v) => v > 0).length) / r.t_ms.length);
});

test('a coarse 6-hour series still finds the eclipse and its contacts (between samples)', async () => {
  const site = siteOf(await horizon('surveyor3'));
  const t0 = Date.UTC(1967, 3, 20);
  const fine = await series(site, t0, t0 + 10 * 86400000, 600e3);
  const coarse = await series(site, t0, t0 + 10 * 86400000, 6 * 3600e3);
  assert.equal(fine.eclipses.length, 1);
  assert.equal(coarse.eclipses.length, 1);
  for (const k of ['start_ms', 'max_ms', 'end_ms', 'total_start_ms', 'total_end_ms']) close(coarse.eclipses[0][k], fine.eclipses[0][k], 2000, k);
});

test('no eclipse on an ordinary day or at a full Moon outside an eclipse season', async () => {
  const site = siteOf(await horizon('blueghost1'));
  for (const t0 of [Date.UTC(2025, 2, 7), Date.UTC(2025, 3, 12, 12)]) {
    const r = await series(site, t0, t0 + 86400000, 600e3);
    assert.equal(r.eclipses.length, 0);
    assert.ok(r.sun_eclipse.every((v) => v === 0));
    assert.equal((await skyState(site, t0 + 43200e3)).sun.eclipse_frac, 0);
  }
});

// ---- agreement with the Python reference (tests/fixtures/eclipse_cases.json) -------------------
const FIX = JSON.parse(await readFile(`${REPO}tests/fixtures/eclipse_cases.json`, 'utf8'));
const wall = (el) => ({ az_step_deg: 1, el_deg: new Array(360).fill(el) });

test('JS occultedFluxFraction equals the Python reference (1e-12)', () => {
  for (const c of FIX.occulted) close(occultedFluxFraction(c.z, c.p, c.u), c.frac, 1e-12, `z ${c.z} p ${c.p} u ${c.u}`);
});

test('JS skyState sun.eclipse_frac / vis_frac / flux_frac equal the Python reference', async () => {
  const sites = {};
  let worst = 0;
  for (const c of FIX.site_states) {
    const hz = (sites[c.site] ??= await horizon(c.site));
    const site = c.wall_deg === null
      ? siteOf(hz)
      : makeSite({ lat_deg: hz.lat_deg, lon_deg: hz.lon_deg, ground_elev_m: hz.ground_elev_m, horizon: wall(c.wall_deg) });
    const s = await skyState(site, c.t_ms);
    close(s.sun.eclipse_frac, c.eclipse_frac, 1e-9, `${c.site} ${c.t_ms} ecl`);
    close(s.sun.vis_frac, c.vis_frac, 1e-9, `${c.site} ${c.t_ms} vis`);
    close(s.sun.flux_frac, c.flux_frac, 1e-9, `${c.site} ${c.t_ms} flux`);
    worst = Math.max(worst, Math.abs(s.sun.eclipse_frac - c.eclipse_frac), Math.abs(s.sun.flux_frac - c.flux_frac));
  }
  console.log(`# ${FIX.site_states.length} states: worst JS − Python difference ${worst.toExponential(2)}`);
});

test('JS series eclipse contacts equal the Python reference (< 2 s)', async () => {
  for (const c of FIX.contacts) {
    const r = await series(siteOf(await horizon(c.site)), c.t0_ms, c.t1_ms, 600e3);
    assert.equal(r.eclipses.length, 1);
    const e = r.eclipses[0];
    const pairs = [['start_ms', 'c1'], ['total_start_ms', 'c2'], ['max_ms', 'max'], ['total_end_ms', 'c3'], ['end_ms', 'c4']];
    for (const [js, py] of pairs) close(e[js], c[py], 2000, `${c.site} ${py}`);
    close(e.max_frac, c.max_frac, 1e-12);
  }
});
