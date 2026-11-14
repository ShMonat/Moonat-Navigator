// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Timelapse playback and long missions (web/js/app/playback.js): the speed menu and its default, the mission series with
// detail around eclipses, the chart envelope and the darkness statistics, against the real ephemeris and LOLA horizon.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SPEEDS, autoSpeed, SYNODIC_MONTH_MS, missionSeries, withDetail, envelopeIndices, longestRun, DETAIL_STEP_MS,
} from "../js/app/playback.js";
import { chooseStep, DAY_MS, HOUR_MS } from "../js/app/state.js";
import { initPhysics, seriesFor } from "../js/app/physics_adapter.js";
import { makeSite } from "../js/physics/index.js";
import { fileFetch } from "./physics_helpers.mjs";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const YEAR = 365.25 * DAY_MS;

test("the speed menu in index.html is SPEEDS: 1 min/s to 1 year/s, with one synodic month", () => {
  const html = read("../index.html");
  const sel = /<select id="sky-speed"[\s\S]*?<\/select>/.exec(html)[0];
  const opts = [...sel.matchAll(/<option value="(\d+)"[^>]*>([^<]+)<\/option>/g)].map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(opts, SPEEDS.map((s) => [s.ms, s.label]));
  assert.deepEqual(SPEEDS.map((s) => s.label), [
    "1 min / s", "10 min / s", "1 h / s", "6 h / s", "1 day / s", "1 week / s", "1 month / s", "3 months / s", "1 year / s",
  ]);
  assert.equal(SPEEDS[6].ms, Math.round(29.530589 * DAY_MS));
  assert.ok(Math.abs(SYNODIC_MONTH_MS / DAY_MS - 29.53) < 0.001);
  for (let i = 1; i < SPEEDS.length; i++) assert.ok(SPEEDS[i].ms > SPEEDS[i - 1].ms, "slowest first");
});

test("autoSpeed: a full playback of about 20–60 s for missions from hours to decades", () => {
  const cases = [
    [21.6 * HOUR_MS, "1 h / s"], // Apollo 11
    [75 * HOUR_MS, "1 h / s"], // Apollo 17 (the "all Apollo" story)
    [5.85 * HOUR_MS, "10 min / s"], // the eclipse story
    [14 * DAY_MS, "6 h / s"], // far side
    [30 * DAY_MS, "1 day / s"],
    [62 * DAY_MS, "1 day / s"], // the pole story
    [YEAR, "1 week / s"],
    [2 * YEAR, "1 month / s"],
    [5 * YEAR, "3 months / s"],
    [10 * YEAR, "3 months / s"],
    [28 * YEAR, "1 year / s"],
    [HOUR_MS, "1 min / s"],
  ];
  for (const [span, label] of cases) {
    const v = autoSpeed(span);
    assert.equal(SPEEDS.find((s) => s.ms === v).label, label, `${(span / DAY_MS).toFixed(2)} d`);
    const playS = span / v;
    if (span >= 2 * HOUR_MS && span <= 30 * YEAR) assert.ok(playS >= 12 && playS <= 80, `${label}: ${playS.toFixed(1)} s`);
  }
});

test("envelopeIndices keeps a one-sample dip at full depth and at most 4 points per column", () => {
  const n = 100000;
  const t = Array.from({ length: n }, (_, i) => i * 1000);
  const y = t.map((_, i) => (i === 54321 ? 0 : 100 + Math.sin(i / 500)));
  const idx = envelopeIndices(t, y, 500);
  assert.ok(idx.length <= 4 * 500, `${idx.length} points`);
  assert.ok(idx.includes(54321), "the dip is kept");
  assert.equal(idx[0], 0);
  assert.equal(idx[idx.length - 1], n - 1);
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1], "ascending, no duplicates");
  // The envelope of each column spans the column's real min and max.
  const ys = idx.map((i) => y[i]);
  assert.equal(Math.min(...ys), 0);
  assert.ok(Math.abs(Math.max(...ys) - Math.max(...y)) < 1e-12);
  // Short series are drawn as they are.
  assert.deepEqual(envelopeIndices([0, 1, 2], [5, 6, 7], 500), [0, 1, 2]);
});

test("longestRun measures dark stretches to half a step, clipped to the window", () => {
  const t = [0, 10, 20, 30, 40, 50, 60, 70];
  const v = [1, 0, 0, 1, 1, 0, 0, 0];
  const r = longestRun(t, v);
  // Stretches 5–25 (20) and 45–70 (25, clipped at the window's end).
  assert.deepEqual([r.ms, r.start_ms, r.end_ms, r.count, r.total_ms], [25, 45, 70, 2, 45]);
  const none = longestRun(t, t.map(() => 1));
  assert.deepEqual([none.ms, none.start_ms, none.count], [0, null, 0]);
  const all = longestRun(t, t.map(() => 0));
  assert.equal(all.ms, 70);
});

test("withDetail splices the eclipse detail in place of the coarse samples", () => {
  const se = {
    t_ms: [0, 100, 200, 300, 400], v: [1, 1, 1, 1, 1],
    detail: [{ t_ms: [150, 175, 200, 225, 250], v: [1, 0.5, 0, 0.5, 1] }],
  };
  const { t, y } = withDetail(se, "v", (x) => x * 100);
  assert.deepEqual(t, [0, 100, 150, 175, 200, 225, 250, 300, 400]);
  assert.deepEqual(y, [100, 100, 100, 50, 0, 50, 100, 100, 100]);
  assert.deepEqual(withDetail({ t_ms: [0, 1], v: [2, 3] }, "v"), { t: [0, 1], y: [2, 3] });
});

test("five years at the Shackleton rim: quick, eclipses in detail, and the coarse step matches a 10 min reference", async () => {
  await initPhysics(fileURLToPath(new URL("../data/ephem", import.meta.url)), { fetch: fileFetch });
  const hz = JSON.parse(read("../data/horizons/shackleton_rim.json"));
  const site = makeSite({ lat_deg: hz.lat_deg, lon_deg: hz.lon_deg, horizon: hz });
  const t0 = Date.UTC(2030, 0, 1), t1 = Date.UTC(2035, 0, 1);
  const a = performance.now();
  const se = await missionSeries(site, t0, t1, seriesFor);
  const ms = performance.now() - a;
  assert.equal(se.step_ms, 2 * HOUR_MS);
  assert.ok(se.t_ms.length > 21000 && se.t_ms.length < 22000, `${se.t_ms.length} samples`);
  assert.ok(ms < 4000, `${ms.toFixed(0)} ms (Node; about 0.1 s on a laptop)`);
  // Eight eclipses of the Sun by the Earth, five of them total; each has 2-min detail with the dark totality in it.
  assert.equal(se.eclipses.length, 8);
  assert.equal(se.detail.length, 8);
  for (const [k, d] of se.detail.entries()) {
    assert.ok(d.t_ms[1] - d.t_ms[0] === DETAIL_STEP_MS);
    if (se.eclipses[k].max_frac >= 1) assert.equal(Math.min(...d.sun_flux_frac), 0, `eclipse ${k} totality`);
  }
  // Reference: the first year at 10 min. The 2 h series agrees on the share of sunlight and the longest darkness.
  const yEnd = Date.UTC(2031, 0, 1);
  const ref = await seriesFor(site, t0, yEnd, 10 * 60e3);
  const n1 = se.t_ms.findIndex((t) => t > yEnd);
  const pct = (arr) => (100 * arr.filter((v) => v > 0).length) / arr.length;
  const coarse = { t: se.t_ms.slice(0, n1), f: se.sun_flux_frac.slice(0, n1), e: se.earth_vis.slice(0, n1) };
  assert.ok(Math.abs(pct(coarse.f) - pct(ref.sun_flux_frac)) < 0.3, `sunlit ${pct(coarse.f)} vs ${pct(ref.sun_flux_frac)}`);
  const dc = longestRun(coarse.t, coarse.f), dr = longestRun(ref.t_ms, ref.sun_flux_frac);
  assert.ok(Math.abs(dc.ms - dr.ms) <= HOUR_MS, `longest darkness ${dc.ms / HOUR_MS} h vs ${dr.ms / HOUR_MS} h`);
  const ec = longestRun(coarse.t, coarse.e), er = longestRun(ref.t_ms, ref.earth_vis);
  assert.ok(Math.abs(ec.ms - er.ms) <= HOUR_MS, `longest Earth blackout ${ec.ms / HOUR_MS} h vs ${er.ms / HOUR_MS} h`);
  // The charts' envelope of the spliced series keeps every totality at 0 %.
  const { t, y } = withDetail(se, "sun_flux_frac");
  const idx = envelopeIndices(t, y, 900);
  assert.ok(idx.length <= 3600);
  for (const e of se.eclipses.filter((x) => x.max_frac >= 1)) {
    assert.ok(idx.some((i) => y[i] === 0 && t[i] >= e.total_start_ms && t[i] <= e.total_end_ms), `totality ${new Date(e.max_ms).toISOString()}`);
  }
});

test("chooseStep and missionSeries: no detail for short missions (the step already resolves an eclipse)", async () => {
  await initPhysics(fileURLToPath(new URL("../data/ephem", import.meta.url)), { fetch: fileFetch });
  const site = makeSite({ lat_deg: 18.56, lon_deg: 61.81 });
  const t0 = Date.UTC(2025, 2, 14, 4), t1 = Date.UTC(2025, 2, 14, 11);
  const se = await missionSeries(site, t0, t1, seriesFor);
  assert.equal(se.step_ms, chooseStep(t1 - t0));
  assert.equal(se.detail.length, 0);
  assert.equal(se.eclipses.length, 1);
});
