// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Tests for derived quantities (web/js/app/derive.js): horizon interpolation, rise/set events, stats.

import test from "node:test";
import assert from "node:assert/strict";
import { horizonElAt, findEvents, stats, pctAbove, compassPoint } from "../js/app/derive.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("horizonElAt: linear interpolation with wrap-around; null = smooth horizon", () => {
  const el = new Array(1440).fill(0);
  el[0] = 2;
  el[1] = 4;
  el[1439] = 1;
  const h = { az_step_deg: 0.25, el_deg: el };
  close(horizonElAt(h, 0), 2);
  close(horizonElAt(h, 0.125), 3);
  close(horizonElAt(h, 359.875), 1.5); // between sample 1439 (1°) and sample 0 (2°)
  close(horizonElAt(h, -0.125), 1.5);
  close(horizonElAt(h, 360.125), 3);
  assert.equal(horizonElAt(null, 123), 0);
});

test("findEvents: set and rise times with linear interpolation", () => {
  const t = [0, 10, 20, 30, 40];
  const vis = [1, 1, 0.5, 0, 0];
  // vis 0.5 -> 0 between t=20 and t=30 crosses 0 at t=30 (threshold 0, value reaches 0 at the sample).
  const ev = findEvents(t, vis);
  assert.equal(ev.upAtStart, true);
  close(ev.nextSet, 30);
  assert.equal(ev.nextRise, null);

  const ev2 = findEvents([0, 10, 20], [0, 0, 1]);
  assert.equal(ev2.upAtStart, false);
  close(ev2.nextRise, 10);
});

test("stats, pctAbove and compass points", () => {
  assert.deepEqual(stats([1, 2, 3, NaN]), { min: 1, max: 3, mean: 2 });
  assert.equal(pctAbove([0, 0.2, 0, 1]), 50);
  assert.equal(compassPoint(0), "N");
  assert.equal(compassPoint(90), "E");
  assert.equal(compassPoint(200), "SSW");
  assert.equal(compassPoint(359), "N");
});
