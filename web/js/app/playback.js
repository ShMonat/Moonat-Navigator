// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Timelapse playback and long missions (a Moon base like StarHab stays months to years): the speed menu, the default
// speed for a mission's length, the mission series with detail around eclipses, the chart downsampling (a min/max
// envelope per pixel column, so short dark spells stay visible) and the darkness statistics of the cards.
// Pure functions (no DOM), tested in web/tests/app_playback.test.mjs.

import { DAY_MS, HOUR_MS, chooseStep } from "./state.js";

/** One synodic month (new Moon to new Moon; one lunar day and night), ms. */
export const SYNODIC_MONTH_MS = 29.530589 * DAY_MS;
/** One Julian year (365.25 d), ms. */
export const JULIAN_YEAR_MS = 365.25 * DAY_MS;

/**
 * Timelapse speeds offered in the #sky-speed menu, slowest first: `ms` of scenario time per second of playback
 * (the option values, whole ms), `label` (the option text) and an optional `title`. web/index.html lists the same.
 */
export const SPEEDS = [
  { ms: 60e3, label: "1 min / s" },
  { ms: 600e3, label: "10 min / s" },
  { ms: HOUR_MS, label: "1 h / s" },
  { ms: 6 * HOUR_MS, label: "6 h / s" },
  { ms: DAY_MS, label: "1 day / s" },
  { ms: 7 * DAY_MS, label: "1 week / s" },
  { ms: Math.round(SYNODIC_MONTH_MS), label: "1 month / s", title: "One lunar day and night (synodic month, 29.53 days) per second" },
  { ms: Math.round(3 * SYNODIC_MONTH_MS), label: "3 months / s", title: "Three synodic months (88.6 days) per second" },
  { ms: Math.round(JULIAN_YEAR_MS), label: "1 year / s", title: "365.25 days per second" },
];

/** The automatic speed plays the longest scenario in about this long (s). */
export const TARGET_PLAY_S = 35;

/**
 * Default timelapse speed (ms per second, one of SPEEDS) for a mission of `spanMs`: the one whose full playback is
 * closest to TARGET_PLAY_S on a log scale. With the menu's steps that gives about 20–60 s: Apollo 11 (21.6 h) at
 * 1 h/s, a month at 1 day/s, a year at 1 week/s, five years at 3 months/s, ten years at 3 months/s.
 */
export function autoSpeed(spanMs) {
  if (!(spanMs > 0)) return SPEEDS[2].ms;
  let best = SPEEDS[0].ms, err = Infinity;
  for (const { ms } of SPEEDS) {
    const e = Math.abs(Math.log(spanMs / ms / TARGET_PLAY_S));
    if (e < err - 1e-12) { best = ms; err = e; }
  }
  return best;
}

/** Series steps above this get detail around eclipses (missionSeries). */
export const DETAIL_ABOVE_MS = 10 * 60e3;
/** Step of the detail around an eclipse, ms. */
export const DETAIL_STEP_MS = 2 * 60e3;

/**
 * The C6 series of a mission window [t0Ms, t1Ms] (epoch ms) for the cards and the charts. The step comes from the span
 * (state.js chooseStep: 5 min for a few days up to 3 h beyond 8 years). The eclipse search of C6 series() does not
 * depend on the step (events between samples are refined to 1 s), but a 1–3 h step samples a 2 h totality only once
 * or twice; so, for steps above DETAIL_ABOVE_MS, each eclipse gets `detail`: its own series every DETAIL_STEP_MS from
 * one step before the first contact to one step after the last. The charts draw it in place of the coarse samples; the
 * card statistics keep the evenly spaced samples (so every sample weighs the same).
 * seriesFn(site, t0Ms, t1Ms, stepMs) is the C6 series (physics_adapter seriesFor). Adds `step_ms` and `detail`
 * ([{ t_ms, sun_el, sun_flux_frac, sun_vis, sun_eclipse, flux_normal_wm2, flux_horiz_wm2 }], possibly empty).
 */
export async function missionSeries(site, t0Ms, t1Ms, seriesFn, stepMs = chooseStep(t1Ms - t0Ms)) {
  const se = await seriesFn(site, t0Ms, t1Ms, stepMs);
  se.step_ms = stepMs;
  se.detail = [];
  if (stepMs > DETAIL_ABOVE_MS) {
    for (const e of se.eclipses || []) {
      const a = Math.max(t0Ms, (e.start_ms ?? e.max_ms) - stepMs);
      const b = Math.min(t1Ms, (e.end_ms ?? e.max_ms) + stepMs);
      if (!(b - a >= 2 * DETAIL_STEP_MS)) continue;
      const d = await seriesFn(site, a, b, DETAIL_STEP_MS);
      se.detail.push({
        t_ms: d.t_ms, sun_el: d.sun_el, sun_flux_frac: d.sun_flux_frac, sun_vis: d.sun_vis, sun_eclipse: d.sun_eclipse,
        flux_normal_wm2: d.flux_normal_wm2, flux_horiz_wm2: d.flux_horiz_wm2,
      });
    }
  }
  return se;
}

/**
 * A series field with the eclipse detail spliced in: { t, y } where the coarse samples inside each detail window are
 * replaced by the detail's own. `key` is a field of both (e.g. "sun_flux_frac"); `map` transforms each value (e.g. to
 * per cent). Without detail it returns the series' own arrays (mapped).
 */
export function withDetail(series, key, map = null) {
  const f = map || ((v) => v);
  const det = (series.detail || []).filter((d) => d.t_ms?.length && Array.isArray(d[key]));
  const tc = series.t_ms, yc = series[key];
  if (!det.length) return { t: tc, y: map ? yc.map(f) : yc };
  const t = [], y = [];
  let k = 0;
  for (let i = 0; i < tc.length; i++) {
    while (k < det.length && det[k].t_ms[0] <= tc[i]) {
      const d = det[k++];
      for (let j = 0; j < d.t_ms.length; j++) { t.push(d.t_ms[j]); y.push(f(d[key][j])); }
      const end = d.t_ms[d.t_ms.length - 1];
      while (i < tc.length && tc[i] <= end) i++;
    }
    if (i < tc.length) { t.push(tc[i]); y.push(f(yc[i])); }
  }
  while (k < det.length) {
    const d = det[k++];
    for (let j = 0; j < d.t_ms.length; j++) { t.push(d.t_ms[j]); y.push(f(d[key][j])); }
  }
  return { t, y };
}

/**
 * Indices to draw for a long series: the time range is cut into `bins` equal columns (about one per pixel), and each
 * column keeps its first, lowest, highest and last samples in time order (the "M4" envelope). A dip that lasts a
 * single sample, such as a short shadow or an eclipse in a five-year series, keeps its full depth, and the line still
 * joins the columns where it really goes. t: sample times (ascending), y: values (non-finite values are skipped for
 * the extremes). Returns all indices when there are at most 4 per column anyway.
 */
export function envelopeIndices(t, y, bins = 1000) {
  const n = t.length;
  bins = Math.max(1, Math.floor(bins));
  if (n <= 4 * bins) return Array.from({ length: n }, (_, i) => i);
  const t0 = t[0], span = t[n - 1] - t0 || 1;
  const out = [];
  let i = 0;
  while (i < n) {
    const b = Math.min(bins - 1, Math.floor(((t[i] - t0) / span) * bins));
    let j = i, lo = -1, hi = -1;
    while (j < n && Math.min(bins - 1, Math.floor(((t[j] - t0) / span) * bins)) === b) {
      const v = y[j];
      if (Number.isFinite(v)) {
        if (lo < 0 || v < y[lo]) lo = j;
        if (hi < 0 || v > y[hi]) hi = j;
      }
      j++;
    }
    const keep = new Set([i, j - 1]);
    if (lo >= 0) keep.add(lo);
    if (hi >= 0) keep.add(hi);
    for (const k of [...keep].sort((a, c) => a - c)) out.push(k);
    i = j;
  }
  return out;
}

/**
 * The longest stretch of a series where `off(value)` holds (e.g. no sunlight), as { ms, start_ms, end_ms }, or
 * { ms: 0, start_ms: null, end_ms: null } when there is none. A stretch runs from halfway between its first sample and
 * the one before it to halfway between its last sample and the one after it (so its length is good to half a step),
 * clipped to the window at both ends. Also returns `count` (the number of stretches) and `total_ms` (their sum).
 */
export function longestRun(t, values, off = (v) => !(v > 0)) {
  const n = t?.length || 0;
  const res = { ms: 0, start_ms: null, end_ms: null, count: 0, total_ms: 0 };
  let i = 0;
  while (i < n) {
    if (!off(values[i])) { i++; continue; }
    let j = i;
    while (j + 1 < n && off(values[j + 1])) j++;
    const a = i === 0 ? t[0] : (t[i - 1] + t[i]) / 2;
    const b = j === n - 1 ? t[n - 1] : (t[j] + t[j + 1]) / 2;
    res.count++;
    res.total_ms += b - a;
    if (b - a > res.ms) Object.assign(res, { ms: b - a, start_ms: a, end_ms: b });
    i = j + 1;
  }
  return res;
}
