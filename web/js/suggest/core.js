// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Suggested dates for a lunar site (contract C11 `suggest-dates`, docs/CONTRACTS.md). Definitions, method and
// validation: docs/validation/suggest.md. Runs in the module worker (worker.js) or inline (Node, no Worker).
//
// Method: one C6 series() pass over the whole range at a fixed step (10 min by default; 3 h when only eclipses are
// asked for), in 32-day chunks so that a cancel is seen between chunks. From these samples:
// - sun / earth / both: time averages over sliding windows of durationMs, best non-overlapping windows (windows.js);
// - eclipse: series() scans the Sun–Earth separation at the site and brackets every minimum that could reach contact
//   (once a month, near full Moon). Each candidate is refined at the site with a 30 s series (contacts to 1 s,
//   physics/eclipse.js) and kept if the Sun clears the terrain skyline during the eclipse;
// - earthrise: skyline crossings of the Earth's disk (visible fraction 0 → 1 or 1 → 0) with the Sun up.
// Times: UTC epoch ms inside, ISO-8601 strings in the result. Angles in degrees.

import { loadEphem, makeSite, series, skyState } from '../physics/index.js';
import { windowScores, pickWindows, rankPicks, longestRun, countPositive, meanOf, skylineCrossings } from './windows.js';
import { fmtDate, fmtTime, fmtDateTime, fmtDur, fmtPct, fmtDeg, iso } from './format.js';

const DAY = 86400e3, HOUR = 3600e3, MIN = 60e3;
const DEG = Math.PI / 180, RAD = 180 / Math.PI;

/** Mean synodic month (new Moon to new Moon), ms. */
export const SYNODIC_MONTH_MS = 29.530589 * DAY;
/** One lunar day (sunrise to sunset at the equator) = half a synodic month, about 14.77 d. The default window. */
export const LUNAR_DAY_MS = SYNODIC_MONTH_MS / 2;
/** The kinds of suggestion, in their default order. */
export const KINDS = ['sun', 'earth', 'both', 'eclipse', 'earthrise'];
/** Default search span from the start date: two calendar years (same date and time, two years later). */
export const DEFAULT_SPAN_YEARS = 2;
/** Default sampling step for the window kinds; longer ranges use a longer step (≤ 110 000 samples). */
export const FINE_STEP_MS = 10 * MIN;
/** Sampling step of the eclipse scan when no window kind is asked for (events between samples are still found). */
export const COARSE_STEP_MS = 3 * HOUR;
/** Default length of each kind's list. */
export const DEFAULT_LIMIT = 5;
/** Window scores within this much of a better one count as equal and are listed soonest first. */
export const NEAR_TIE = 0.005;

const CHUNK_MS = 32 * DAY;
const MAX_FINE_SAMPLES = 110_000;
const ECL_HALF_MS = 5 * HOUR; // refinement window around a candidate's greatest eclipse (site contacts span ≤ 5 h)
const ECL_STEP_MS = 30e3;
const MAX_CACHED = 4;
// A window whose longest unbroken stretch covers at least this share of it is titled by that stretch
// ("14.8 d of continuous sunlight"): a 14.75-day lunar day in a 14.77-day window is continuous sunlight.
const CONTINUOUS = 0.9;

/** An AbortError (DOMException where available). */
export function abortError() {
  try {
    return new DOMException('suggestDates cancelled', 'AbortError');
  } catch {
    const e = new Error('suggestDates cancelled');
    e.name = 'AbortError';
    return e;
  }
}

const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());
const yieldToEvents = () => new Promise((r) => setTimeout(r, 0));
const checkAbort = (signal) => {
  if (signal?.aborted) throw abortError();
};
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

// ---- ephemeris and range -------------------------------------------------------------------------------------------

const PROBE = makeSite({ lat_deg: 0, lon_deg: 0 });
const MANIFESTS = new Map(); // baseUrl -> Promise<manifest>
const joinUrl = (base, name) => `${String(base).replace(/\/+$/, '')}/${name}`;

/**
 * Makes sure the physics module has an ephemeris and returns its manifest (for the years covered). If the physics
 * module is already loaded (an empty series() call succeeds) only the manifest is fetched; otherwise loadEphem runs.
 */
export function ensureEphem(baseUrl = 'data/ephem', fetchFn = null) {
  if (!MANIFESTS.has(baseUrl)) {
    const p = (async () => {
      const loaded = await series(PROBE, 1, 0, 1).then(() => true, () => false);
      if (!loaded) return loadEphem(baseUrl, fetchFn ? { fetch: fetchFn } : {});
      const f = fetchFn ?? ((u) => globalThis.fetch(u));
      const res = await f(joinUrl(baseUrl, 'manifest.json'));
      if (!res.ok) throw new Error(`suggestDates: cannot load the ephemeris manifest (${res.status})`);
      return res.json();
    })();
    MANIFESTS.set(baseUrl, p);
    p.catch(() => MANIFESTS.delete(baseUrl));
  }
  return MANIFESTS.get(baseUrl);
}

/** Contiguous coverage of the ephemeris years as [[t0, t1], ...] (UTC epoch ms; t1 = the last minute of the last year). */
export function coverageSegments(years) {
  const segs = [];
  for (const y of [...years].sort((a, b) => a - b)) {
    const last = segs[segs.length - 1];
    if (last && last[1] === y - 1) last[1] = y;
    else segs.push([y, y]);
  }
  return segs.map(([y0, y1]) => [Date.UTC(y0, 0, 1), Date.UTC(y1 + 1, 0, 1) - 60e3]);
}

/** UTC midnight at the start of the day of `ms`. */
export function startOfUtcDay(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Epoch ms of a Date, an epoch-ms number or an ISO string; null when absent. */
export function toMs(x) {
  if (x === undefined || x === null) return null;
  if (x instanceof Date) return x.getTime();
  return typeof x === 'number' ? x : Date.parse(x);
}

/**
 * The search range: from (default: today 00:00 UTC) to (default: from + 2 years), clipped to the first contiguous
 * ephemeris segment it overlaps (1966–1976 or 2013–2040). Throws a RangeError when nothing is covered.
 */
export function resolveRange(from, to, years) {
  const segs = coverageSegments(years);
  let t0 = toMs(from);
  if (t0 === null) t0 = startOfUtcDay(Date.now());
  let t1 = toMs(to);
  if (t1 === null) {
    const d = new Date(t0);
    d.setUTCFullYear(d.getUTCFullYear() + DEFAULT_SPAN_YEARS);
    t1 = d.getTime();
  }
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 > t0)) throw new RangeError('suggestDates: need from < to');
  const seg = segs.find(([a, b]) => b >= t0 && a <= t1);
  if (!seg) {
    const cov = segs.map(([a, b]) => `${new Date(a).getUTCFullYear()}–${new Date(b).getUTCFullYear()}`).join(', ');
    throw new RangeError(`suggestDates: ${iso(t0)} … ${iso(t1)} is outside the ephemeris coverage (${cov})`);
  }
  return { t0: Math.max(t0, seg[0]), t1: Math.min(t1, seg[1]), seg };
}

/** Sampling step for a span: 10 min, or longer (whole minutes) to stay within 110 000 samples. */
export function autoStep(spanMs) {
  return Math.max(FINE_STEP_MS, Math.ceil(spanMs / MAX_FINE_SAMPLES / MIN) * MIN);
}

/** Cache key of a site: position, heights and a fingerprint of the horizon profile. */
export function siteKey(spec) {
  const h = spec.horizon;
  let hz = 'smooth';
  if (h && h.el_deg) {
    let hash = 0;
    for (let i = 0; i < h.el_deg.length; i++) hash = (Math.imul(hash, 31) + Math.round(h.el_deg[i] * 1e4)) | 0;
    hz = `${h.id ?? ''}:${h.az_step_deg}:${h.el_deg.length}:${hash}`;
  }
  return [spec.lat_deg, spec.lon_deg, spec.ground_elev_m ?? h?.ground_elev_m ?? 0, spec.observer_height_m ?? 2, hz].join('|');
}

/** Angular distance (deg) of a site from the mean sub-Earth point (0°, 0°): < ~80° near side, > ~100° far side. */
export function subEarthDistanceDeg(lat_deg, lon_deg) {
  return Math.acos(Math.cos(lat_deg * DEG) * Math.cos(lon_deg * DEG)) * RAD;
}

// ---- sampling ------------------------------------------------------------------------------------------------------

/**
 * Samples a site from t0 to t1 every `step` ms with the C6 series(), in chunks. Returns typed arrays (sample i at
 * t0 + i·step): flux (sun_flux_frac, terrain + Earth), sunVis (terrain only), sunEl, fluxN/fluxH (W/m², Sun-facing
 * and level), earthVis, earthEl, earthPhase; range statistics; and the raw eclipse events of the chunks.
 */
async function sampleSite(site, t0, t1, step, signal, onProgress) {
  const n = Math.floor((t1 - t0) / step) + 1;
  const F = () => new Float32Array(n);
  const S = {
    t0, t1: t0 + (n - 1) * step, step, n,
    flux: F(), sunVis: F(), sunEl: F(), fluxN: F(), fluxH: F(), earthVis: F(), earthEl: F(), earthPhase: F(),
    fluxMax: 0, earthVisMin: Infinity, earthVisMax: 0, earthVisSum: 0, earthElMin: Infinity, earthElMax: -Infinity,
    earthTopMax: -Infinity, eclipses: [],
  };
  const per = Math.max(1, Math.floor(CHUNK_MS / step));
  let lastYield = now();
  for (let a = 0; a < n; a += per) {
    const b = Math.min(n, a + per);
    const r = await series(site, t0 + a * step, t0 + (b - 1) * step, step);
    for (let k = 0; k < b - a; k++) {
      const i = a + k;
      S.flux[i] = r.sun_flux_frac[k];
      S.sunVis[i] = r.sun_vis[k];
      S.sunEl[i] = r.sun_el[k];
      S.fluxN[i] = r.flux_normal_wm2[k];
      S.fluxH[i] = r.flux_horiz_wm2[k];
      const ev = r.earth_vis[k];
      S.earthVis[i] = ev;
      S.earthEl[i] = r.earth_el[k];
      S.earthPhase[i] = r.earth_phase[k];
      if (r.sun_flux_frac[k] > S.fluxMax) S.fluxMax = r.sun_flux_frac[k];
      if (ev < S.earthVisMin) S.earthVisMin = ev;
      if (ev > S.earthVisMax) S.earthVisMax = ev;
      S.earthVisSum += ev;
      if (r.earth_el[k] < S.earthElMin) S.earthElMin = r.earth_el[k];
      if (r.earth_el[k] > S.earthElMax) S.earthElMax = r.earth_el[k];
      const top = r.earth_el[k] + r.earth_ang_diam_deg[k] / 2;
      if (top > S.earthTopMax) S.earthTopMax = top;
    }
    S.eclipses.push(...r.eclipses);
    onProgress?.(0.9 * (b / n));
    if (now() - lastYield > 25) {
      await yieldToEvents(); // lets a worker see a cancel message
      lastYield = now();
    }
    checkAbort(signal);
  }
  return S;
}

const SAMPLES = new Map(); // key -> samples (LRU, MAX_CACHED entries)

async function samplesFor(site, key, t0, t1, step, signal, onProgress) {
  const k = `${key}|${t0}|${t1}|${step}`;
  if (SAMPLES.has(k)) {
    const v = SAMPLES.get(k);
    SAMPLES.delete(k);
    SAMPLES.set(k, v);
    return v;
  }
  const S = await sampleSite(site, t0, t1, step, signal, onProgress);
  SAMPLES.set(k, S);
  while (SAMPLES.size > MAX_CACHED) SAMPLES.delete(SAMPLES.keys().next().value);
  return S;
}

// ---- items ---------------------------------------------------------------------------------------------------------

function item(kind, rank, tStart, tEnd, score, title, detail, extra = {}) {
  return { kind, rank, t_start_utc: iso(tStart), t_end_utc: iso(tEnd), score: round(score), title, detail, ...extra };
}

// The Sun's height in words. On a high rim the skyline can dip below the level horizon, so a visible Sun may be at
// a negative elevation.
const sunHeight = (el) => (el >= 0
  ? `The Sun stands ${fmtDeg(el)} above the level horizon.`
  : `The Sun is ${fmtDeg(-el)} below the level horizon, yet above the skyline (the site looks out over lower ground).`);

// "14:05 UTC", or "3 Feb 2027, 14:05 UTC" when the date differs from the reference time's.
const when = (ms, refMs) => (fmtDate(ms) === fmtDate(refMs) ? `${fmtTime(ms)} UTC` : fmtDateTime(ms));

/** Best windows of W samples over v: ranked picks (≤ limit), how many are near-equal to the best, and the best. */
function selectWindows(v, W, limit) {
  const picks = pickWindows(windowScores(v, W), W);
  if (!picks.length) return { ranked: [], nearBest: 0, best: 0 };
  const best = picks.reduce((m, p) => Math.max(m, p.mean), 0);
  const kept = picks.filter((p) => p.mean >= 0.5 * best);
  return {
    ranked: rankPicks(kept, NEAR_TIE).slice(0, limit),
    nearBest: kept.filter((p) => p.mean >= best - NEAR_TIE).length,
    best,
  };
}

function nearTieSentence(sel, rank) {
  return rank === 1 && sel.nearBest >= 2
    ? ` ${sel.nearBest} windows in this range score within 0.5 points of the best, so they are listed soonest first.`
    : '';
}

// Unique eclipse events of the raw chunk lists (a chunk boundary can split one event; keep the deepest).
function mergeEclipses(list) {
  const sorted = [...list].sort((a, b) => a.max_ms - b.max_ms);
  const out = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && e.max_ms - last.max_ms < 6 * HOUR) {
      if (e.max_frac > last.max_frac) out[out.length - 1] = e;
    } else {
      out.push(e);
    }
  }
  return out;
}

function eclipsesIn(ctx, tS, tE) {
  return mergeEclipses(ctx.S.eclipses).filter((e) => e.max_ms >= tS && e.max_ms <= tE && e.max_frac > 0 && e.sun_vis_at_max > 0);
}

const POLE_N = makeSite({ lat_deg: 90, lon_deg: 0 });

/** Selenographic latitude of the subsolar point (deg) at tMs: the Sun's elevation seen from the north pole. */
async function subsolarLatDeg(tMs) {
  return (await skyState(POLE_N, tMs)).sun.el_deg;
}

async function sunItems(ctx) {
  const { S, W, limit, spec } = ctx;
  if (S.fluxMax <= 0) {
    return [item('sun', 1, null, null, 0, 'No sunlight here in this range',
      `The Sun never clears the skyline at this site between ${fmtDate(S.t0)} and ${fmtDate(S.t1)}: it lies in shadow ` +
      'for the whole range. Solar power would need a mast or panels on a nearby sunlit ridge.', { note: true, stats: { sunlit_pct: 0 } })];
  }
  const sel = selectWindows(S.flux, W, limit);
  const out = [];
  for (const [k, p] of sel.ranked.entries()) {
    const rank = k + 1;
    const a = p.s, b = p.s + W;
    const tS = S.t0 + a * S.step, tE = S.t0 + b * S.step;
    const lit = countPositive(S.flux, a, b) / W;
    const run = longestRun(S.flux, a, b);
    const fluxN = meanOf(S.fluxN, a, b), fluxH = meanOf(S.fluxH, a, b);
    const continuous = run.len >= CONTINUOUS * W; // the title then names the unbroken stretch
    const title = continuous
      ? `${fmtDur(run.len * S.step)} of continuous sunlight from ${fmtDate(S.t0 + run.start * S.step)}`
      : `Sunlight ${fmtPct(lit)} of ${fmtDur(W * S.step)} from ${fmtDate(tS)}`;
    let detail = `Sunlit ${fmtPct(lit)} of the time from ${fmtDateTime(tS)} to ${fmtDateTime(tE)} (terrain and eclipses ` +
      `included); on average the site gets ${fmtPct(p.mean)} of the full Sun's light.`;
    let dark = false;
    for (let i = Math.max(0, a - Math.round(HOUR / S.step)); i <= a; i++) if (S.flux[i] <= 0) dark = true;
    if (dark) detail += ' The window opens at local sunrise.';
    if (!continuous && run.len > 0) detail += ` Longest unbroken sunlight: ${fmtDur(run.len * S.step)} from ${fmtDateTime(S.t0 + run.start * S.step)}.`;
    detail += ` Mean irradiance ${Math.round(fluxN)} W/m² on a panel facing the Sun, ${Math.round(fluxH)} W/m² on level ground.`;
    for (const e of eclipsesIn(ctx, tS, tE)) {
      detail += ` Includes the eclipse of the Sun by the Earth on ${fmtDate(e.max_ms)} (${e.total_start_ms !== null ? 'total' : `${fmtPct(e.max_frac)} covered`}).`;
    }
    const stats = {
      mean_flux_frac: round(p.mean), sunlit_pct: round(100 * lit, 2), longest_sunlit_h: round((run.len * S.step) / HOUR, 2),
      longest_sunlit_start_utc: run.len ? iso(S.t0 + run.start * S.step) : null,
      mean_flux_normal_wm2: round(fluxN, 1), mean_flux_horiz_wm2: round(fluxH, 1), starts_at_sunrise: dark,
    };
    if (Math.abs(spec.lat_deg) >= 75) {
      const beta = await subsolarLatDeg(0.5 * (tS + tE));
      stats.subsolar_lat_deg = round(beta, 3);
      const side = spec.lat_deg < 0 ? 'south' : 'north';
      detail += ` Season: mid-window the Sun is ${fmtDeg(Math.abs(beta))} ${beta < 0 ? 'south' : 'north'} of the lunar ` +
        `equator (it swings within ±1.54° over the 346.6-day eclipse year); ${side}-polar sites get the most sunlight when it is ${side}.`;
    }
    detail += nearTieSentence(sel, rank);
    out.push(item('sun', rank, tS, tE, p.mean, title, detail, { stats }));
  }
  return out;
}

function earthNote(ctx, kind) {
  const { S, spec } = ctx;
  const g = subEarthDistanceDeg(spec.lat_deg, spec.lon_deg);
  if (S.earthVisMax <= 0) {
    const geometric = S.earthTopMax < 0;
    const why = geometric
      ? `The Earth never rises at this site: it is on the Moon's far side (${Math.round(g)}° from the point under the ` +
        `Earth), where even libration (which rocks the Earth by up to about 8°) cannot bring its disk above the horizon` +
        ` (its top stays ${fmtDeg(-S.earthTopMax)} below at best). Direct-to-Earth radio needs a relay satellite here.`
      : `The Earth climbs to ${fmtDeg(S.earthTopMax)} above the level horizon at most, but the terrain hides it for the whole range.`;
    const title = kind === 'both' ? 'No combined window: the Earth is never in view here' : 'No direct-to-Earth contact here';
    return item(kind, 1, null, null, 0, title, why, {
      note: true, stats: { in_view_pct: 0, reason: geometric ? 'far-side' : 'terrain', earth_top_max_deg: round(S.earthTopMax, 3) },
    });
  }
  // Earth in view at every sample (near side).
  const mean = S.earthVisSum / S.n;
  let detail = `This site is on the Moon's near side (${Math.round(g)}° from the point under the Earth), so the Earth ` +
    `never sets: direct-to-Earth contact is possible at any time from ${fmtDate(S.t0)} to ${fmtDate(S.t1)}. The Earth only ` +
    `wobbles a few degrees in the sky (libration), between ${fmtDeg(S.earthElMin)} and ${fmtDeg(S.earthElMax)} elevation.`;
  if (S.earthVisMin < 0.999) detail += ` The terrain hides up to ${fmtPct(1 - S.earthVisMin)} of its disk at times.`;
  return item('earth', 1, S.t0, S.t1, mean, 'Earth always in view: any date works', detail, {
    note: true,
    stats: {
      in_view_pct: 100, mean_vis_frac: round(mean), min_vis_frac: round(S.earthVisMin),
      earth_el_min_deg: round(S.earthElMin, 3), earth_el_max_deg: round(S.earthElMax, 3),
    },
  });
}

async function earthItems(ctx) {
  const { S, W, limit } = ctx;
  if (S.earthVisMax <= 0 || S.earthVisMin > 0) return [earthNote(ctx, 'earth')];
  const sel = selectWindows(S.earthVis, W, limit);
  return sel.ranked.map((p, k) => {
    const rank = k + 1;
    const a = p.s, b = p.s + W;
    const tS = S.t0 + a * S.step, tE = S.t0 + b * S.step;
    const inView = countPositive(S.earthVis, a, b) / W;
    const run = longestRun(S.earthVis, a, b);
    const continuous = run.len >= CONTINUOUS * W; // the title then names the unbroken stretch
    const title = continuous
      ? `${fmtDur(run.len * S.step)} of continuous Earth contact from ${fmtDate(S.t0 + run.start * S.step)}`
      : `Earth in view ${fmtPct(inView)} of ${fmtDur(W * S.step)} from ${fmtDate(tS)}`;
    let detail = `The Earth is above the skyline ${fmtPct(inView)} of the time from ${fmtDateTime(tS)} to ${fmtDateTime(tE)}` +
      ` (on average ${fmtPct(p.mean)} of its disk visible).`;
    if (!continuous && run.len > 0) detail += ` Longest unbroken contact: ${fmtDur(run.len * S.step)} from ${fmtDateTime(S.t0 + run.start * S.step)}.`;
    detail += nearTieSentence(sel, rank);
    return item('earth', rank, tS, tE, p.mean, title, detail, {
      stats: {
        mean_vis_frac: round(p.mean), in_view_pct: round(100 * inView, 2), longest_in_view_h: round((run.len * S.step) / HOUR, 2),
        longest_in_view_start_utc: run.len ? iso(S.t0 + run.start * S.step) : null,
      },
    });
  });
}

async function bothItems(ctx) {
  const { S, W, limit } = ctx;
  if (S.earthVisMax <= 0) return [earthNote(ctx, 'both')];
  const v = new Float32Array(S.n);
  let vMax = 0;
  for (let i = 0; i < S.n; i++) {
    v[i] = Math.min(S.flux[i], S.earthVis[i]);
    if (v[i] > vMax) vMax = v[i];
  }
  if (vMax <= 0) {
    return [item('both', 1, null, null, 0, 'The Sun and the Earth are never up together here',
      `Between ${fmtDate(S.t0)} and ${fmtDate(S.t1)} the Earth is never in view while the Sun shines at this site, so ` +
      'operations need batteries to bridge sunlight and contact.', { note: true, stats: { both_pct: 0 } })];
  }
  const alwaysEarth = S.earthVisMin > 0;
  const sel = selectWindows(v, W, limit);
  return sel.ranked.map((p, k) => {
    const rank = k + 1;
    const a = p.s, b = p.s + W;
    const tS = S.t0 + a * S.step, tE = S.t0 + b * S.step;
    const both = countPositive(v, a, b) / W;
    const run = longestRun(v, a, b);
    const meanSun = meanOf(S.flux, a, b), meanEarth = meanOf(S.earthVis, a, b);
    const continuous = run.len >= CONTINUOUS * W; // the title then names the unbroken stretch
    const title = continuous
      ? `${fmtDur(run.len * S.step)} of sunlight with the Earth in view from ${fmtDate(S.t0 + run.start * S.step)}`
      : `Sun and Earth together ${fmtPct(both)} of ${fmtDur(W * S.step)} from ${fmtDate(tS)}`;
    let detail = `Sunlight and a line of sight to the Earth at the same time ${fmtPct(both)} of the time from ` +
      `${fmtDateTime(tS)} to ${fmtDateTime(tE)}. Separately: ${fmtPct(meanSun)} of the Sun's light and ${fmtPct(meanEarth)} ` +
      'of the Earth\'s disk on average.';
    if (!continuous && run.len > 0) detail += ` Longest stretch with both: ${fmtDur(run.len * S.step)} from ${fmtDateTime(S.t0 + run.start * S.step)}.`;
    if (alwaysEarth) detail += ' The Earth is always in view here, so this is also the best solar window.';
    detail += nearTieSentence(sel, rank);
    return item('both', rank, tS, tE, p.mean, title, detail, {
      stats: {
        mean_min_frac: round(p.mean), both_pct: round(100 * both, 2), longest_both_h: round((run.len * S.step) / HOUR, 2),
        mean_flux_frac: round(meanSun), mean_earth_vis_frac: round(meanEarth),
      },
    });
  });
}

/**
 * Refines one eclipse candidate at the site: a 30 s series over ±5 h around the guess, the event nearest to it
 * (contacts to 1 s by physics/eclipse.js), and when the Sun's disk is above the terrain skyline during it.
 * Returns the C6 event fields + {sun_up_ms, max_frac_sun_up, sun_el_at_max, sun_up_at_start, sun_up_at_end}, or null.
 */
export async function refineEclipse(site, tGuess, seg) {
  const a = Math.max(seg[0], tGuess - ECL_HALF_MS);
  const b = Math.min(seg[1], tGuess + ECL_HALF_MS);
  const n = Math.floor((b - a) / ECL_STEP_MS);
  const r = await series(site, a, a + n * ECL_STEP_MS, ECL_STEP_MS);
  if (!r.eclipses.length) return null;
  const e = r.eclipses.reduce((x, y) => (Math.abs(y.max_ms - tGuess) < Math.abs(x.max_ms - tGuess) ? y : x));
  const last = r.t_ms.length - 1;
  const i0 = e.start_ms === null ? 0 : Math.min(last, Math.ceil((e.start_ms - a) / ECL_STEP_MS));
  const i1 = e.end_ms === null ? last : Math.max(0, Math.floor((e.end_ms - a) / ECL_STEP_MS));
  let up = 0, maxUp = 0;
  for (let i = i0; i <= i1; i++) {
    if (r.sun_vis[i] > 0) {
      up++;
      if (r.sun_eclipse[i] > maxUp) maxUp = r.sun_eclipse[i];
    }
  }
  if (e.sun_vis_at_max > 0) maxUp = Math.max(maxUp, e.max_frac);
  const iMax = Math.max(0, Math.min(last, Math.round((e.max_ms - a) / ECL_STEP_MS)));
  return {
    ...e, sun_up_ms: up * ECL_STEP_MS, max_frac_sun_up: maxUp, sun_el_at_max: r.sun_el[iMax],
    sun_up_at_start: r.sun_vis[i0] > 0, sun_up_at_end: r.sun_vis[i1] > 0,
  };
}

async function eclipseItems(ctx) {
  const { S, site, range, limit, signal } = ctx;
  const events = [];
  for (const c of mergeEclipses(S.eclipses)) {
    checkAbort(signal);
    const e = await refineEclipse(site, c.max_ms, range.seg);
    if (!e || !(e.max_frac_sun_up > 0)) continue; // the Sun is below the skyline for the whole eclipse
    if (e.max_ms < range.t0 || e.max_ms > range.t1) continue;
    if (events.some((x) => Math.abs(x.max_ms - e.max_ms) < MIN)) continue;
    events.push(e);
  }
  const totality = (e) => (e.total_start_ms !== null && e.total_end_ms !== null ? e.total_end_ms - e.total_start_ms : 0);
  events.sort((x, y) => y.max_frac_sun_up - x.max_frac_sun_up || totality(y) - totality(x) || x.max_ms - y.max_ms);
  return events.slice(0, limit).map((e, k) => {
    const total = totality(e) > 0;
    const title = total
      ? `Total eclipse of the Sun by the Earth, ${fmtDate(e.max_ms)}, ${fmtDur(totality(e))}`
      : `Partial eclipse of the Sun by the Earth, ${fmtDate(e.max_ms)}, ${fmtPct(e.max_frac)} covered`;
    const ref = e.max_ms;
    let detail = 'Seen from this site, the Earth ';
    detail += e.start_ms !== null ? `starts to cover the Sun at ${when(e.start_ms, ref)}` : 'already covers part of the Sun at the start of the range';
    detail += total
      ? `, hides it completely from ${when(e.total_start_ms, ref)} to ${when(e.total_end_ms, ref)} (greatest eclipse ${when(ref, ref)})`
      : `, covers ${fmtPct(e.max_frac)} of its light at ${when(ref, ref)}`;
    detail += e.end_ms !== null ? ` and clears it at ${when(e.end_ms, ref)}` : '';
    if (e.start_ms !== null && e.end_ms !== null) detail += ` (${fmtDur(e.end_ms - e.start_ms)} in all)`;
    detail += '.';
    const whole = e.start_ms !== null && e.end_ms !== null ? e.end_ms - e.start_ms : null;
    if (whole !== null && e.sun_up_ms < whole - 2 * ECL_STEP_MS) {
      const how = e.sun_up_at_start && !e.sun_up_at_end ? 'the Sun sets during the eclipse'
        : !e.sun_up_at_start && e.sun_up_at_end ? 'the Sun rises during the eclipse' : 'the terrain hides the Sun for part of it';
      detail += ` The Sun is above the skyline for ${fmtDur(e.sun_up_ms)} of it: ${how}.`;
    } else {
      detail += ` ${sunHeight(e.sun_el_at_max)}`;
    }
    detail += ' On Earth this is a lunar eclipse: the Moon passes through the Earth\'s shadow.';
    return item('eclipse', k + 1, e.start_ms, e.end_ms, e.max_frac_sun_up, title, detail, {
      t_max_utc: iso(e.max_ms),
      stats: {
        type: total ? 'total' : 'partial', max_frac: round(e.max_frac, 4), max_frac_sun_up: round(e.max_frac_sun_up, 4),
        total_start_utc: iso(e.total_start_ms), total_end_utc: iso(e.total_end_ms), totality_min: round(totality(e) / MIN, 2),
        duration_min: whole === null ? null : round(whole / MIN, 2), sun_up_min: round(e.sun_up_ms / MIN, 1),
        sun_vis_at_max: round(e.sun_vis_at_max, 4), sun_el_at_max_deg: round(e.sun_el_at_max, 3),
      },
    });
  });
}

async function earthriseItems(ctx) {
  const { S, site, limit, signal } = ctx;
  const xs = skylineCrossings(S.earthVis);
  const evs = [];
  for (const x of xs) {
    checkAbort(signal);
    // Half the disk visible: bisection between the bracketing samples (to ~2 s).
    let lo = S.t0 + (x.iMid - 1) * S.step, hi = S.t0 + x.iMid * S.step;
    const past = async (t) => {
      const v = (await skyState(site, t)).earth.vis_frac;
      return x.dir === 'rise' ? v >= 0.5 : v < 0.5;
    };
    while (hi - lo > 2000) {
      const m = 0.5 * (lo + hi);
      if (await past(m)) hi = m; else lo = m;
    }
    const st = await skyState(site, hi);
    if (!(st.sun.vis_frac > 0 && st.sun.flux_frac > 0)) continue;
    evs.push({
      dir: x.dir, s: hi, mean: st.earth.phase_frac * st.sun.flux_frac, tA: S.t0 + x.i0 * S.step, tB: S.t0 + x.i1 * S.step,
      phase: st.earth.phase_frac, earthAz: st.earth.az_deg, earthEl: st.earth.el_deg, sunAz: st.sun.az_deg, sunEl: st.sun.el_deg,
      sunFlux: st.sun.flux_frac,
    });
  }
  return rankPicks(evs, 0.05).slice(0, limit).map((e, k) => {
    const rise = e.dir === 'rise';
    const title = `${rise ? 'Earthrise' : 'Earthset'} with the Sun up, ${fmtDateTime(e.s)}`;
    const detail = `The Earth (${fmtPct(e.phase)} lit) ${rise ? 'rises over' : 'sets behind'} the skyline at azimuth ` +
      `${Math.round(e.earthAz)}°: ${rise ? 'first limb' : 'disk starts to dip'} ${fmtDateTime(e.tA)}, ` +
      `${rise ? 'fully up' : 'gone'} ${fmtDateTime(e.tB)} (${fmtDur(e.tB - e.tA)}; libration moves it slowly). ` +
      `Half the disk shows at ${fmtTime(e.s)} UTC. ${sunHeight(e.sunEl)} Its azimuth is ${Math.round(e.sunAz)}°.`;
    return item('earthrise', k + 1, e.tA, e.tB, e.mean, title, detail, {
      t_max_utc: iso(e.s),
      stats: {
        direction: e.dir, earth_phase_frac: round(e.phase), earth_az_deg: round(e.earthAz, 2), earth_el_deg: round(e.earthEl, 3),
        sun_el_deg: round(e.sunEl, 3), sun_az_deg: round(e.sunAz, 2), sun_flux_frac: round(e.sunFlux),
      },
    });
  });
}

const KIND_FN = { sun: sunItems, earth: earthItems, both: bothItems, eclipse: eclipseItems, earthrise: earthriseItems };

/**
 * Suggested dates for one site (contract C11). `spec`: {lat_deg, lon_deg, ground_elev_m?, observer_height_m?,
 * horizon (C3) | null}. Options: from, to (Date | epoch ms | ISO), durationMs (default LUNAR_DAY_MS), kinds
 * (default KINDS), limit (default 5 per kind), stepMs (default autoStep), ephemBaseUrl, fetch, signal, onProgress.
 * Returns {items, meta}; items in the order of `kinds`, each kind ranked (see docs/validation/suggest.md).
 */
export async function computeSuggestions(spec, opts = {}) {
  const t = now();
  const {
    from, to, durationMs = LUNAR_DAY_MS, kinds = KINDS, limit = DEFAULT_LIMIT, stepMs,
    ephemBaseUrl = 'data/ephem', fetch: fetchFn = null, signal, onProgress,
  } = opts;
  for (const k of kinds) if (!KIND_FN[k]) throw new Error(`suggestDates: unknown kind "${k}" (use ${KINDS.join(', ')})`);
  if (!(durationMs > 0)) throw new RangeError('suggestDates: durationMs must be > 0');
  if (!Number.isFinite(spec?.lat_deg) || !Number.isFinite(spec?.lon_deg)) throw new Error('suggestDates: lat_deg and lon_deg are required');
  checkAbort(signal);
  const manifest = await ensureEphem(ephemBaseUrl, fetchFn);
  checkAbort(signal);
  const range = resolveRange(from, to, manifest.years);
  const site = makeSite(spec);
  const fine = kinds.some((k) => k !== 'eclipse');
  const step = fine ? stepMs ?? autoStep(range.t1 - range.t0) : COARSE_STEP_MS;
  const S = await samplesFor(site, siteKey(spec), range.t0, range.t1, step, signal, onProgress);
  const W = Math.max(1, Math.min(S.n, Math.round(durationMs / S.step)));
  const ctx = { spec, site, S, range, W, limit, signal };
  const items = [];
  for (const k of kinds) {
    checkAbort(signal);
    items.push(...(await KIND_FN[k](ctx)));
  }
  onProgress?.(1);
  return {
    items,
    meta: {
      from_utc: iso(range.t0), to_utc: iso(range.t1), step_ms: S.step, duration_ms: W * S.step, samples: S.n,
      ms: Math.round(now() - t),
    },
  };
}
