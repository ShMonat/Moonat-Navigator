// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// C6 API (loadEphem, makeSite, skyState, series) on a synthetic analytic ephemeris written in the
// C1 binary layout: checks the table reader, interpolation, topocentric geometry, the year
// boundary, series consistency, set-time refinement and speed.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadEphem, makeSite, skyState, series } from '../js/physics/index.js';
import { siteFrame, enuToAzEl, matVec } from '../js/physics/frames.js';
import { buildSynthTables, memFetch, synthModel, PLANETS, mv } from './physics_helpers.mjs';

const BASE = 'mem://ephem';
const STEP_H = 2;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const angle = (u, v) => {
  const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
  return Math.acos(Math.min(1, Math.max(-1, c))) * 180 / Math.PI;
};

before(async () => {
  const files = buildSynthTables(BASE, [2025, 2026], STEP_H);
  const m = await loadEphem(BASE, { fetch: memFetch(files) });
  assert.equal(m.step_hours, STEP_H);
});

// Truth: topocentric az/el straight from the analytic model.
function truth(site, tMs) {
  const m = synthModel(tMs);
  const f = siteFrame(site.lat_deg, site.lon_deg, site.ground_elev_m, site.observer_height_m);
  const rel = (p) => matVec(f.r_me_to_enu, [p[0] - f.pos_me[0], p[1] - f.pos_me[1], p[2] - f.pos_me[2]]);
  return { m, f, sun: enuToAzEl(rel(m.sunMe)), earth: enuToAzEl(rel(m.earthMe)) };
}

const SITES = [
  makeSite({ lat_deg: 0.674, lon_deg: 23.473 }),
  makeSite({ lat_deg: -89.45, lon_deg: 222.7 - 360, ground_elev_m: 1800 }),
  makeSite({ lat_deg: 33, lon_deg: -170, observer_height_m: 10 }),
];

test('skyState matches the analytic model between table records (< 0.5 arcsec)', async () => {
  let worst = 0;
  for (const site of SITES) {
    for (let k = 0; k < 40; k++) {
      const t = Date.UTC(2025, 0, 1) + k * 9.137 * 86400000 + 1234567; // off-grid times
      const s = await skyState(site, t);
      const tr = truth(site, t);
      for (const [a, b] of [[s.sun, tr.sun], [s.earth, tr.earth]]) {
        const sep = angle(a.enu, [Math.cos(b.el_deg * Math.PI / 180) * Math.sin(b.az_deg * Math.PI / 180),
          Math.cos(b.el_deg * Math.PI / 180) * Math.cos(b.az_deg * Math.PI / 180), Math.sin(b.el_deg * Math.PI / 180)]);
        worst = Math.max(worst, sep);
        close(a.el_deg, b.el_deg, 1.4e-4);
        close(a.dist_km / b.r, 1, 1e-8);
      }
    }
  }
  console.log(`# synthetic table, ${STEP_H} h step: worst Sun/Earth direction error = ${(worst * 3600).toFixed(4)} arcsec`);
  assert.ok(worst * 3600 < 0.5);
});

test('skyState fields: C6 shape, units and consistency', async () => {
  const site = SITES[0];
  const t = Date.UTC(2026, 6, 20, 20, 17, 40);
  const s = await skyState(site, t);
  assert.equal(s.t_ms, t);
  for (const k of ['az_deg', 'el_deg', 'dist_km', 'ang_radius_deg', 'vis_frac', 'flux_frac']) assert.equal(typeof s.sun[k], 'number', k);
  for (const k of ['az_deg', 'el_deg', 'dist_km', 'ang_radius_deg', 'vis_frac', 'phase_frac', 'era_deg']) assert.equal(typeof s.earth[k], 'number', k);
  assert.equal(s.sun.enu.length, 3);
  assert.equal(s.earth.sun_dir_enu.length, 3);
  assert.equal(s.r_icrs_to_enu.length, 9);
  assert.deepEqual(s.planets.map((p) => p.name), PLANETS);
  // Angular radii: Sun ≈ 0.267 deg at ~1 au, Earth ≈ 0.9-1.0 deg at ~364-404 Mm.
  close(s.sun.ang_radius_deg, Math.asin(696000 / s.sun.dist_km) * 180 / Math.PI, 1e-12);
  assert.ok(s.sun.ang_radius_deg > 0.26 && s.sun.ang_radius_deg < 0.275);
  assert.ok(s.earth.ang_radius_deg > 0.85 && s.earth.ang_radius_deg < 1.05);
  // r_icrs_to_enu is a rotation and maps the ICRS Sun direction onto the ENU Sun direction
  // (up to the site parallax of 1737 km at 1 au = 0.0007 deg).
  const R = s.r_icrs_to_enu;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const d = R[3 * i] * R[3 * j] + R[3 * i + 1] * R[3 * j + 1] + R[3 * i + 2] * R[3 * j + 2];
    close(d, i === j ? 1 : 0, 1e-12);
  }
  const m = synthModel(t);
  assert.ok(angle(matVec(R, m.sunIcrs), s.sun.enu) < 0.001);
  // Planets: ENU = R · ICRS direction (f4 storage: ~1e-7 rad).
  m.planetsIcrs.forEach((p, k) => assert.ok(angle(matVec(R, p), s.planets[k].enu) < 1e-4));
  // Earth phase: (1 + cos α)/2 with α the Sun–Earth–observer angle (model truth).
  const f = siteFrame(site.lat_deg, site.lon_deg, 0, 2);
  const es = m.sunMe.map((x, i) => x - m.earthMe[i]);
  const eo = f.pos_me.map((x, i) => x - m.earthMe[i]);
  close(s.earth.phase_frac, 0.5 * (1 + Math.cos(angle(es, eo) * Math.PI / 180)), 1e-6);
  // sun_dir_enu: unit, Earth→Sun direction.
  close(Math.hypot(...s.earth.sun_dir_enu), 1, 1e-12);
  assert.ok(angle(s.earth.sun_dir_enu, matVec(f.r_me_to_enu, es)) < 1e-4);
  // Flux consistency.
  close(s.sun.flux_horiz_wm2, s.sun.flux_normal_wm2 * Math.max(0, Math.sin(s.sun.el_deg * Math.PI / 180)), 1e-9);
});

test('record times are reproduced exactly and the year boundary is smooth', async () => {
  const site = SITES[1];
  const t0 = Date.UTC(2026, 0, 1);
  for (const dt of [-3 * 3600e3, -3600e3, -1, 0, 1, 1800e3, 3600e3, 5 * 3600e3]) {
    const s = await skyState(site, t0 + dt);
    const tr = truth(site, t0 + dt);
    assert.ok(angDiff(s.sun.az_deg, tr.sun.az_deg) * Math.cos(tr.sun.el_deg * Math.PI / 180) < 1.4e-4, `dt ${dt}`);
    close(s.earth.el_deg, tr.earth.el_deg, 1.4e-4, `dt ${dt}`);
  }
  const m = synthModel(t0 + 7200e3);
  const s = await skyState(makeSite({ lat_deg: 0, lon_deg: 0, observer_height_m: 0 }), t0 + 7200e3);
  const exact = enuToAzEl(matVec(siteFrame(0, 0, 0, 0).r_me_to_enu, [m.sunMe[0] - 1737.4, m.sunMe[1], m.sunMe[2]]));
  close(s.sun.el_deg, exact.el_deg, 1e-9);
});

test('a time outside the tables is a clear error', async () => {
  await assert.rejects(skyState(SITES[0], Date.UTC(2031, 0, 1)), /no table for year 2031/);
});

test('series equals skyState at the samples, and the summary is consistent', async () => {
  const site = makeSite({ lat_deg: 20, lon_deg: 30, horizon: ruggedHorizon() });
  const t0 = Date.UTC(2025, 2, 1), step = 3 * 3600e3;
  const r = await series(site, t0, t0 + 40 * 86400000, step);
  const n = 40 * 8 + 1;
  for (const k of ['t_ms', 'sun_el', 'sun_az', 'sun_vis', 'flux_horiz_wm2', 'flux_normal_wm2', 'earth_el', 'earth_az', 'earth_vis', 'earth_phase', 'earth_ang_diam_deg']) {
    assert.equal(r[k].length, n, k);
  }
  for (const i of [0, 17, 200, n - 1]) {
    const s = await skyState(site, r.t_ms[i]);
    close(r.sun_el[i], s.sun.el_deg, 1e-12);
    close(r.sun_vis[i], s.sun.vis_frac, 1e-12);
    close(r.flux_horiz_wm2[i], s.sun.flux_horiz_wm2, 1e-9);
    close(r.earth_vis[i], s.earth.vis_frac, 1e-12);
    close(r.earth_phase[i], s.earth.phase_frac, 1e-12);
    close(r.earth_ang_diam_deg[i], 2 * s.earth.ang_radius_deg, 1e-12);
  }
  const pct = (100 * r.sun_vis.filter((v) => v > 0).length) / n;
  close(r.summary.sun_vis_pct, pct, 1e-12);
  // About half of a lunar month is daylight at a mid-latitude site.
  assert.ok(pct > 35 && pct < 65, `sun_vis_pct ${pct}`);
  // The refined sunset: the disk is gone at the returned time and still visible 2 s before it.
  const ts = r.summary.next_sunset_ms;
  assert.ok(ts !== null);
  assert.equal((await skyState(site, ts)).sun.vis_frac, 0);
  assert.ok((await skyState(site, ts - 2000)).sun.vis_frac > 0);
  // Earth from a near-side site never sets in the synthetic model.
  assert.equal(r.summary.next_earthset_ms, null);
  assert.equal(r.summary.earth_vis_pct, 100);
});

test('series of 30 days at 10-minute steps with a terrain horizon runs in < 1 s', async () => {
  const site = makeSite({ lat_deg: -89.45, lon_deg: -137.3, horizon: ruggedHorizon() });
  const t0 = Date.UTC(2026, 0, 10), step = 600e3;
  await series(site, t0, t0 + 86400000, step); // warm-up (JIT, year load)
  const t = performance.now();
  const r = await series(site, t0, t0 + 30 * 86400000, step);
  const ms = performance.now() - t;
  assert.equal(r.t_ms.length, 4321);
  console.log(`# series: 4321 samples with a 1440-point horizon in ${ms.toFixed(0)} ms`);
  assert.ok(ms < 1000, `${ms} ms`);
});

function ruggedHorizon() {
  const el = Array.from({ length: 1440 }, (_, k) => {
    const a = (k * 0.25 * Math.PI) / 180;
    return 1.5 + 1.2 * Math.sin(a) + 0.6 * Math.sin(7 * a) + 0.3 * Math.sin(29 * a + 1);
  });
  return { id: 'synthetic', lat_deg: 0, lon_deg: 0, ground_elev_m: 0, observer_height_m: 2, az_step_deg: 0.25, el_deg: el };
}

export { mv };
