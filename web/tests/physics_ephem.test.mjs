// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The browser physics on the real ephemeris tables (web/data/ephem/, from the `ephem` work item)
// must reproduce the Python reference cases in tests/fixtures/ephem_cases.json (written by
// scripts/make_ephem_cases.py from moonat.ephem.table), within the fixture's own tolerances
// (az/el 0.001 deg, phase 0.001, relative distance 1e-6, matrix elements 1e-6).
// Skipped while the tables or the fixture are not in this checkout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, fileFetch } from './physics_helpers.mjs';
import { loadEphem, makeSite, skyState } from '../js/physics/index.js';

const EPHEM_DIR = join(REPO, 'web', 'data', 'ephem');
const FIXTURE = join(REPO, 'tests', 'fixtures', 'ephem_cases.json');
const READY = existsSync(join(EPHEM_DIR, 'manifest.json')) && existsSync(FIXTURE);

const dAz = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const maxAbs = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));

test('skyState on the real tables matches tests/fixtures/ephem_cases.json', { skip: !READY && 'ephem tables or fixture not present' }, async () => {
  await loadEphem(EPHEM_DIR, { fetch: fileFetch });
  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const tol = fx.tolerances;
  assert.ok(fx.cases.length >= 10);
  const worst = { azel: 0, phase: 0, dist: 0, rho: 0, matrix: 0, era: 0, sundir: 0, planets: 0 };
  for (const c of fx.cases) {
    const inp = c.inputs, exp = c.expected;
    const t = inp.t_ms ?? (inp.t_posix !== undefined ? inp.t_posix * 1000 : Date.parse(inp.t_utc));
    assert.ok(Number.isFinite(t), `bad time in ${c.name}`);
    const site = makeSite({
      lat_deg: inp.lat_deg, lon_deg: inp.lon_deg,
      ground_elev_m: inp.ground_elev_m ?? 0, observer_height_m: inp.observer_height_m ?? 2,
    });
    const st = await skyState(site, t);
    const msg = (what, a, b) => `${c.name} ${what}: ${a} vs ${b}`;
    for (const b of ['sun', 'earth']) {
      const g = st[b], e = exp[b];
      const daz = dAz(g.az_deg, e.az_deg) * Math.cos((e.el_deg * Math.PI) / 180);
      const del = Math.abs(g.el_deg - e.el_deg);
      worst.azel = Math.max(worst.azel, daz, del);
      assert.ok(daz <= tol.az_el_deg, msg(`${b} az`, g.az_deg, e.az_deg));
      assert.ok(del <= tol.az_el_deg, msg(`${b} el`, g.el_deg, e.el_deg));
      const dr = Math.abs(g.dist_km / e.dist_km - 1);
      worst.dist = Math.max(worst.dist, dr);
      assert.ok(dr <= tol.dist_rel, msg(`${b} dist`, g.dist_km, e.dist_km));
      worst.rho = Math.max(worst.rho, Math.abs(g.ang_radius_deg - e.ang_radius_deg));
      assert.ok(Math.abs(g.ang_radius_deg - e.ang_radius_deg) <= tol.az_el_deg, msg(`${b} ang_radius`, g.ang_radius_deg, e.ang_radius_deg));
    }
    const dph = Math.abs(st.earth.phase_frac - exp.earth.phase_frac);
    worst.phase = Math.max(worst.phase, dph);
    assert.ok(dph <= tol.phase_frac, msg('phase', st.earth.phase_frac, exp.earth.phase_frac));
    const dsd = maxAbs(st.earth.sun_dir_enu, exp.earth.sun_dir_enu);
    worst.sundir = Math.max(worst.sundir, dsd);
    assert.ok(dsd <= tol.matrix, `${c.name} sun_dir_enu`);
    const dm = maxAbs(st.r_icrs_to_enu, exp.r_icrs_to_enu);
    worst.matrix = Math.max(worst.matrix, dm);
    assert.ok(dm <= tol.matrix, `${c.name} r_icrs_to_enu`);
    const dera = dAz(st.earth.era_deg, exp.earth.era_deg ?? exp.era_deg);
    worst.era = Math.max(worst.era, dera);
    assert.ok(dera <= tol.az_el_deg, `${c.name} era`);
    for (const ep of exp.planets ?? []) {
      const gp = st.planets.find((p) => p.name === ep.name);
      assert.ok(gp, `${c.name} missing planet ${ep.name}`);
      const d = Math.max(dAz(gp.az_deg, ep.az_deg) * Math.cos((ep.el_deg * Math.PI) / 180), Math.abs(gp.el_deg - ep.el_deg));
      worst.planets = Math.max(worst.planets, d);
      assert.ok(d <= tol.az_el_deg, msg(`${ep.name} az/el`, [gp.az_deg, gp.el_deg], [ep.az_deg, ep.el_deg]));
    }
  }
  const f = (x) => x.toExponential(1);
  console.log(`# real tables, ${fx.cases.length} cases, worst |JS − Python|: Sun/Earth az/el ${f(worst.azel)}°, planets ${f(worst.planets)}°, `
    + `phase ${f(worst.phase)}, dist ${f(worst.dist)} (rel), ang radius ${f(worst.rho)}°, r_icrs_to_enu ${f(worst.matrix)}, `
    + `sun_dir_enu ${f(worst.sundir)}, ERA ${f(worst.era)}°`);
});
