// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Pure window search of the suggested dates (web/js/suggest/windows.js) and the text helpers (format.js),
// against brute-force sums and hand-made sample series.

import test from 'node:test';
import assert from 'node:assert/strict';
import { windowScores, pickWindows, rankPicks, longestRun, countPositive, skylineCrossings, FRONT_WEIGHT } from '../js/suggest/windows.js';
import { fmtDur, fmtPct, fmtDate, iso } from '../js/suggest/format.js';
import { coverageSegments, resolveRange, autoStep, subEarthDistanceDeg } from '../js/suggest/core.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);

test('windowScores equals brute-force means and front-weighted means', () => {
  const v = Float32Array.from({ length: 500 }, (_, i) => Math.max(0, Math.sin(i / 17)) * (i % 7 ? 1 : 0.5));
  const W = 61;
  const { mean, objective } = windowScores(v, W);
  assert.equal(mean.length, v.length - W + 1);
  for (const s of [0, 1, 100, 250, 439]) {
    let m = 0, f = 0;
    for (let k = 0; k < W; k++) { m += v[s + k]; f += v[s + k] * (1 - k / W); }
    close(mean[s], m / W, 1e-12, `mean ${s}`);
    close(objective[s], m / W + FRONT_WEIGHT * f / W, 1e-12, `objective ${s}`);
  }
  assert.equal(windowScores(v, 501).mean.length, 0);
});

test('a lunar-day-like square wave: the best window starts at "sunrise", not before', () => {
  // 30 dark samples, then 40 lit samples with a 3-sample ramp at each end, repeated; window = 40 samples.
  const period = 70, n = 7 * period;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i % period;
    v[i] = p < 30 ? 0 : p < 33 ? (p - 29) / 4 : p < 67 ? 1 : (70 - p) / 4;
  }
  const W = 40;
  const picks = pickWindows(windowScores(v, W), W);
  const ranked = rankPicks(picks.filter((p) => p.mean > 0.5));
  // Every lit period gives one window; each starts on the ramp (samples 30–32 of its period).
  assert.equal(ranked.length, 7);
  for (const p of ranked) assert.ok(p.s % period >= 30 && p.s % period <= 33, `start ${p.s % period}`);
  // Equal scores: listed soonest first.
  assert.deepEqual(ranked.map((p) => p.s), [...ranked.map((p) => p.s)].sort((a, b) => a - b));
  // Picks never overlap.
  const s = picks.map((p) => p.s).sort((a, b) => a - b);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] - s[i - 1] >= W);
});

test('pickWindows: float noise on a plateau does not move the pick (earliest within 1e-9 wins)', () => {
  const objective = Float64Array.from([0.2, 1 - 4e-16, 1, 1 + 3e-16, 1, 0.5, 0.1]);
  const picks = pickWindows({ mean: objective, objective }, 2);
  assert.deepEqual(picks.map((p) => p.s), [1, 3, 5]);
});

test('rankPicks: better first, near-equal (within tol) soonest first', () => {
  const r = rankPicks([{ s: 5, mean: 0.9 }, { s: 1, mean: 0.897 }, { s: 9, mean: 0.95 }, { s: 3, mean: 0.5 }], 0.005);
  assert.deepEqual(r.map((p) => p.s), [9, 1, 5, 3]);
});

test('longestRun / countPositive', () => {
  const v = [0, 1, 1, 0, 1, 1, 1, 0.2, 0, 1];
  assert.deepEqual(longestRun(v, 0, v.length), { start: 4, len: 4 });
  assert.deepEqual(longestRun(v, 5, 8), { start: 5, len: 3 });
  assert.equal(countPositive(v, 0, v.length), 7);
  assert.deepEqual(longestRun([0, 0], 0, 2), { start: 0, len: 0 });
});

test('skylineCrossings: rises and sets, grazes skipped, half-disk sample found', () => {
  const v = [0, 0, 0.2, 0.6, 1, 1, 0.7, 0.4, 0, 0, 0.3, 0, 0, 0.5, 1, 0.8, 1];
  const xs = skylineCrossings(v);
  assert.deepEqual(xs, [
    { dir: 'rise', i0: 1, i1: 4, iMid: 3 },
    { dir: 'set', i0: 5, i1: 8, iMid: 7 },
    { dir: 'rise', i0: 12, i1: 14, iMid: 13 },
  ]);
});

test('text helpers', () => {
  assert.equal(fmtDur(2 * 3600e3 + 10 * 60e3), '2 h 10 min');
  assert.equal(fmtDur(14.765 * 86400e3), '14.8 d');
  assert.equal(fmtDur(14 * 86400e3), '14 d');
  assert.equal(fmtDur(45 * 60e3), '45 min');
  assert.equal(fmtPct(0.004), '<1 %');
  assert.equal(fmtPct(0.996), '>99 %');
  assert.equal(fmtPct(1), '100 %');
  assert.equal(fmtDate(Date.UTC(2027, 0, 19, 23, 59, 40)), '20 Jan 2027');
  assert.equal(iso(Date.UTC(2025, 2, 14, 6, 17, 25, 400)), '2025-03-14T06:17:25Z');
});

test('range: default two years, clipped to the ephemeris coverage', () => {
  const years = [1966, 1967, 1968, 1969, 1970, 1971, 1972, 1973, 1974, 1975, 1976, ...Array.from({ length: 28 }, (_, k) => 2013 + k)];
  const segs = coverageSegments(years);
  assert.equal(segs.length, 2);
  assert.equal(iso(segs[1][1]), '2040-12-31T23:59:00Z');
  const r = resolveRange('2039-06-01T00:00:00Z', undefined, years);
  assert.equal(iso(r.t0), '2039-06-01T00:00:00Z');
  assert.equal(r.t1, segs[1][1]);
  const g = resolveRange('1990-01-01T00:00:00Z', '2014-01-01T00:00:00Z', years);
  assert.equal(iso(g.t0), '2013-01-01T00:00:00Z');
  assert.throws(() => resolveRange('1990-01-01T00:00:00Z', '1991-01-01T00:00:00Z', years), RangeError);
  assert.equal(autoStep(2 * 365.25 * 86400e3), 600e3);
  assert.equal(autoStep(6 * 365.25 * 86400e3), 29 * 60e3);
  close(subEarthDistanceDeg(0, 0), 0, 1e-12);
  close(subEarthDistanceDeg(0, 90), 90, 1e-12);
});
