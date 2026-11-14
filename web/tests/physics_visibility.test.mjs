// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The JS visibility and metrics must reproduce the Python reference fixtures
// (tests/fixtures/metrics_cases.json, written by tests/test_metrics_fixtures.py).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './physics_helpers.mjs';
import { visibleFraction, prepareHorizon, horizonElAt } from '../js/physics/visibility.js';
import { fluxHorizWm2, fluxNormalWm2, earthPhaseFrac, nextSetTime, seriesSummary } from '../js/physics/metrics.js';

const FX = JSON.parse(readFileSync(join(REPO, 'tests', 'fixtures', 'metrics_cases.json'), 'utf8'));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);

test('visible and flux fractions match the Python reference', () => {
  const hz = Object.fromEntries(Object.entries(FX.horizons).map(([k, v]) => [k, prepareHorizon(v)]));
  let worst = 0;
  for (const c of FX.visibility) {
    const v = visibleFraction(c.az_deg, c.el_deg, c.ang_radius_deg, hz[c.horizon]);
    const f = visibleFraction(c.az_deg, c.el_deg, c.ang_radius_deg, hz[c.horizon], FX.limb_darkening_u);
    worst = Math.max(worst, Math.abs(v - c.vis_frac), Math.abs(f - c.flux_frac));
    close(v, c.vis_frac, 1e-9, `vis ${JSON.stringify([c.horizon, c.az_deg, c.el_deg])}`);
    close(f, c.flux_frac, 1e-9, `flux ${JSON.stringify([c.horizon, c.az_deg, c.el_deg])}`);
  }
  assert.ok(FX.visibility.length > 80);
  console.log(`# visibility: ${FX.visibility.length} cases, worst |JS − Python| = ${worst.toExponential(2)}`);
});

test('raw C3 horizon objects are accepted directly', () => {
  const c = FX.visibility.find((x) => x.horizon === 'rugged' && x.vis_frac > 0.1 && x.vis_frac < 0.9);
  close(visibleFraction(c.az_deg, c.el_deg, c.ang_radius_deg, FX.horizons.rugged), c.vis_frac, 1e-9);
});

test('horizon interpolation is periodic and linear', () => {
  const hz = prepareHorizon({ az_step_deg: 90, el_deg: [0, 4, 8, 4] });
  close(horizonElAt(hz, 45), 2, 1e-12);
  close(horizonElAt(hz, 315), 2, 1e-12);
  close(horizonElAt(hz, -45), 2, 1e-12);
  close(horizonElAt(hz, 900), 8, 1e-12);
  assert.equal(horizonElAt(null, 12), 0);
});

test('flux and Earth phase match the Python reference', () => {
  for (const c of FX.flux) {
    close(fluxHorizWm2(c.dist_km, c.flux_frac, c.el_deg), c.flux_horiz_wm2, 1e-9);
    close(fluxNormalWm2(c.dist_km, c.flux_frac), c.flux_normal_wm2, 1e-9);
  }
  for (const c of FX.phase) close(earthPhaseFrac(c.earth_km, c.sun_km, c.observer_km), c.phase_frac, 1e-12);
});

test('next set time: bisection, first event, none', () => {
  const tSet = 1_700_000_123_456;
  const f = (t) => Math.min(1, Math.max(0, (tSet - t) / 3.6e6));
  const t = Array.from({ length: 144 }, (_, i) => 1_700_000_000_000 + i * 600_000);
  const v = t.map(f);
  const got = nextSetTime(t, v, f, 1000);
  assert.ok(got >= tSet && got - tSet <= 1000);
  assert.equal(nextSetTime([0, 1, 2, 3, 4, 5, 6, 7], [0, 0, 1, 1, 0, 0, 1, 0]), 4);
  assert.equal(nextSetTime([0, 1, 2], [0, 0, 0]), null);
  const s = seriesSummary([0, 600000, 1200000, 1800000], [1, 0.5, 0, 0], [1, 1, 1, 0], [100, 50, 0, 0]);
  assert.deepEqual(s, {
    sun_vis_pct: 50, earth_vis_pct: 75, next_sunset_ms: 1200000, next_earthset_ms: 1800000, mean_flux_horiz_wm2: 37.5,
  });
});
