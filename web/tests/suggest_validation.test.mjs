// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Validation of the suggested dates (web/js/suggest, contract C11) on real sites and the real ephemeris:
// Blue Ghost's 2025-03-14 eclipse (docs/validation/eclipse.md), NASA's lunar eclipse list 2025–2030 (Espenak) at two
// near-side equatorial sites, Apollo 11 sunrise windows, the Shackleton rim's best 2027 month against a brute-force
// scan, far-side and near-side notes, Earthrises, speed, cancel and cache. Results: docs/validation/suggest.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeSite, series, skyState } from '../js/physics/index.js';
import { suggestDates, SYNODIC_MONTH_MS } from '../js/suggest/index.js';
import { fileFetch, REPO } from './physics_helpers.mjs';

const EPHEM = `${REPO}web/data/ephem`;
const HOUR = 3600e3, DAY = 86400e3;
const horizon = async (id) => JSON.parse(await readFile(`${REPO}web/data/horizons/${id}.json`, 'utf8'));
const specOf = (hz) => ({ lat_deg: hz.lat_deg, lon_deg: hz.lon_deg, horizon: hz });
const suggest = (spec, opts) => suggestDates(spec, { ephemBaseUrl: EPHEM, fetch: fileFetch, ...opts });
const ms = (s) => Date.parse(s);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);

// NASA lunar eclipses 2025–2030 (F. Espenak, eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html): greatest eclipse (TD),
// type and umbral magnitude. UT = TD − ΔT, ΔT ≈ 75 s in NASA's predictions for these years.
const NASA = [
  ['2025-03-14T06:59:56Z', 'Total', 1.178], ['2025-09-07T18:12:58Z', 'Total', 1.362],
  ['2026-03-03T11:34:52Z', 'Total', 1.151], ['2026-08-28T04:14:04Z', 'Partial', 0.930],
  ['2027-02-20T23:14:06Z', 'Penumbral', -0.057], ['2027-07-18T16:04:09Z', 'Penumbral', -1.068],
  ['2027-08-17T07:14:59Z', 'Penumbral', -0.525], ['2028-01-12T04:14:13Z', 'Partial', 0.066],
  ['2028-07-06T18:20:57Z', 'Partial', 0.389], ['2028-12-31T16:53:15Z', 'Total', 1.246],
  ['2029-06-26T03:23:22Z', 'Total', 1.844], ['2029-12-20T22:43:12Z', 'Total', 1.117],
  ['2030-06-15T18:34:34Z', 'Partial', 0.502], ['2030-12-09T22:28:51Z', 'Penumbral', -0.163],
].map(([td, type, umag]) => ({ ut: ms(td) - 75e3, type, umag }));

test('Blue Ghost 2025: the 14 March total eclipse, contacts as in docs/validation/eclipse.md', async () => {
  const list = await suggest(specOf(await horizon('blueghost1')), {
    from: '2025-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z', kinds: ['eclipse'],
  });
  const e = list.find((x) => x.t_max_utc.startsWith('2025-03-14'));
  assert.ok(e, list.map((x) => x.title).join(' | '));
  assert.equal(e.stats.type, 'total');
  assert.equal(e.score, 1);
  close(ms(e.t_start_utc), ms('2025-03-14T05:00:42Z'), 2000, 'C1');
  close(ms(e.stats.total_start_utc), ms('2025-03-14T06:17:24Z'), 2000, 'C2');
  close(ms(e.t_max_utc), ms('2025-03-14T07:25:54Z'), 2000, 'max');
  close(ms(e.stats.total_end_utc), ms('2025-03-14T08:34:24Z'), 2000, 'C3 (diamond ring)');
  close(ms(e.t_end_utc), ms('2025-03-14T09:51:10Z'), 2000, 'C4');
  assert.equal(e.title, 'Total eclipse of the Sun by the Earth, 14 Mar 2025, 2 h 17 min');
  // 2025 has a second total lunar eclipse (7 September); the Sun is up at Blue Ghost for both.
  assert.deepEqual(list.map((x) => x.t_max_utc.slice(0, 10)).sort(), ['2025-03-14', '2025-09-07']);
  console.log(`# Blue Ghost 2025: ${list.map((x) => `${x.title} [${x.t_start_utc} … ${x.t_end_utc}]`).join('; ')}`);
});

for (const id of ['surveyor6', 'apollo11']) {
  test(`${id}: every umbral lunar eclipse 2025–2030 in NASA's list is found, totals are total, nothing spurious`, async () => {
    const list = await suggest(specOf(await horizon(id)), {
      from: '2025-01-01T00:00:00Z', to: '2031-01-01T00:00:00Z', kinds: ['eclipse'], limit: Infinity,
    });
    const rows = [];
    for (const n of NASA) {
      const e = list.find((x) => Math.abs(ms(x.t_max_utc) - n.ut) < 45 * 60e3);
      rows.push(`${new Date(n.ut).toISOString().slice(0, 10)} ${n.type}: ${e ? `${e.stats.type} ${Math.round(100 * e.stats.max_frac)} % (site max ${((ms(e.t_max_utc) - n.ut) / 60e3).toFixed(1)} min from NASA)` : 'not seen from the site'}`);
      if (n.type === 'Penumbral') continue;
      assert.ok(e, `${id}: missing the ${n.type} eclipse of ${new Date(n.ut).toISOString()}`);
      assert.ok(e.stats.sun_up_min > 0);
      if (n.type === 'Total') assert.equal(e.stats.type, 'total', `${id} ${new Date(n.ut).toISOString()}`);
    }
    for (const e of list) assert.ok(NASA.some((n) => Math.abs(ms(e.t_max_utc) - n.ut) < 45 * 60e3), `spurious ${e.title}`);
    console.log(`# ${id}:\n#   ${rows.join('\n#   ')}`);
  });
}

test('Apollo 11: the solar windows start within 1 h of local sunrise', async () => {
  const hz = await horizon('apollo11');
  const list = await suggest(specOf(hz), { from: '2027-01-01T00:00:00Z', to: '2028-01-01T00:00:00Z', kinds: ['sun'], limit: 12 });
  assert.ok(list.length >= 10);
  const site = makeSite(specOf(hz));
  const offsets = [];
  for (const w of list) {
    const t = ms(w.t_start_utc);
    // Sunrise: the first minute with sunlight (flux_frac > 0) after the night, from an independent 1-min series.
    const r = await series(site, t - DAY, t + DAY, 60e3);
    let best = null;
    for (let i = 1; i < r.t_ms.length; i++) {
      if (r.sun_flux_frac[i - 1] <= 0 && r.sun_flux_frac[i] > 0 && (best === null || Math.abs(r.t_ms[i] - t) < Math.abs(best - t))) best = r.t_ms[i];
    }
    assert.ok(best !== null, `no sunrise near ${w.t_start_utc}`);
    offsets.push((t - best) / 60e3);
    assert.ok(Math.abs(t - best) <= HOUR, `${w.t_start_utc} vs sunrise ${new Date(best).toISOString()}`);
    assert.equal(w.stats.starts_at_sunrise, true);
  }
  console.log(`# Apollo 11 2027: window start − sunrise (min): ${offsets.map((x) => x.toFixed(0)).join(', ')}`);
});

test('Shackleton rim: the best sunlight month of 2027 matches a brute-force scan', async () => {
  const hz = await horizon('shackleton_rim');
  const t0 = Date.UTC(2027, 0, 1), t1 = Date.UTC(2028, 0, 1);
  const list = await suggest(specOf(hz), { from: t0, to: t1, kinds: ['sun'], durationMs: SYNODIC_MONTH_MS, limit: 20 });
  // Brute force: skyState every hour, every window start every 3 h, direct sums.
  const site = makeSite(specOf(hz));
  const f = [];
  for (let t = t0; t <= t1; t += HOUR) f.push((await skyState(site, t)).sun.flux_frac);
  const W = Math.round(SYNODIC_MONTH_MS / HOUR);
  const brute = (start) => {
    const s = Math.round((start - t0) / HOUR);
    let sum = 0;
    for (let k = 0; k < W; k++) sum += f[s + k];
    return sum / W;
  };
  // Every start (hourly), then the best non-overlapping months by plain sorting (no prefix sums, no tie-break).
  const all = [];
  for (let t = t0; t + W * HOUR <= t1; t += HOUR) all.push({ t, m: brute(t) });
  all.sort((a, b) => b.m - a.m);
  const greedy = [];
  for (const c of all) if (greedy.every((g) => Math.abs(g.t - c.t) >= W * HOUR)) greedy.push(c);
  const [best] = greedy;
  const top = list.reduce((a, b) => (b.score > a.score ? b : a));
  close(top.score, best.m, 0.003, 'best score');
  for (const w of list) close(brute(ms(w.t_start_utc)), w.score, 0.003, `brute force at ${w.t_start_utc}`);
  assert.ok(list[0].score >= best.m - 0.005 - 0.003, 'rank 1 is near-best');
  // The list of months (scores, best first) agrees with the brute-force greedy list.
  const ours = list.map((w) => w.score).sort((a, b) => b - a);
  const theirs = greedy.slice(0, ours.length).map((g) => g.m);
  for (let k = 0; k < Math.min(6, ours.length); k++) close(ours[k], theirs[k], 0.01, `month #${k + 1}`);
  const fmt = (t, m) => `${new Date(t).toISOString().slice(0, 16)}Z ${m.toFixed(4)}`;
  console.log(`# Shackleton 2027, months by sunlight: brute force ${greedy.slice(0, 6).map((g) => fmt(g.t, g.m)).join(', ')}`);
  console.log(`#   ours (score order) ${[...list].sort((a, b) => b.score - a.score).slice(0, 6).map((w) => fmt(ms(w.t_start_utc), w.score)).join(', ')}`);
});

test('far side (Chang\'e 4): no Earth windows, one note with the reason; both likewise', async () => {
  const list = await suggest(specOf(await horizon('change4')), { from: '2027-01-01T00:00:00Z', kinds: ['earth', 'both', 'earthrise'] });
  assert.equal(list.length, 2);
  for (const x of list) {
    assert.equal(x.note, true);
    assert.equal(x.t_start_utc, null);
    assert.equal(x.score, 0);
    assert.equal(x.stats.reason, 'far-side');
    assert.match(x.detail, /far side/);
  }
  assert.equal(list[0].kind, 'earth');
  assert.equal(list[0].title, 'No direct-to-Earth contact here');
});

test('near side (Apollo 11): one "Earth always in view" note, no Earthrises', async () => {
  const list = await suggest(specOf(await horizon('apollo11')), { from: '2027-01-01T00:00:00Z', kinds: ['earth', 'earthrise'] });
  assert.equal(list.length, 1);
  assert.equal(list[0].note, true);
  assert.equal(list[0].title, 'Earth always in view: any date works');
  assert.equal(list[0].stats.in_view_pct, 100);
});

test('Shackleton rim: Earthrises and Earthsets with the Sun up, half the disk at the reported moment', async () => {
  const hz = await horizon('shackleton_rim');
  const list = await suggest(specOf(hz), { from: '2027-01-01T00:00:00Z', to: '2028-01-01T00:00:00Z', kinds: ['earthrise'] });
  assert.ok(list.length >= 1 && list.length <= 5);
  const site = makeSite(specOf(hz));
  for (const x of list) {
    const s = await skyState(site, ms(x.t_max_utc));
    close(s.earth.vis_frac, 0.5, 0.05, x.title);
    assert.ok(s.sun.flux_frac > 0);
    assert.ok(ms(x.t_start_utc) < ms(x.t_max_utc) && ms(x.t_max_utc) < ms(x.t_end_utc));
  }
});

test('speed: a two-year search at the Shackleton rim, all kinds', async () => {
  const spec = specOf(await horizon('shackleton_rim'));
  const t = performance.now();
  const list = await suggest(spec, { from: '2031-01-01T00:00:00Z' });
  const dt = performance.now() - t;
  const kinds = [...new Set(list.map((x) => x.kind))];
  assert.deepEqual(kinds, ['sun', 'earth', 'both', 'eclipse', 'earthrise']);
  assert.equal(list.meta.from_utc, '2031-01-01T00:00:00Z');
  assert.equal(list.meta.to_utc, '2033-01-01T00:00:00Z', 'default range: two calendar years');
  assert.equal(list.meta.step_ms, 600e3);
  assert.ok(dt < 5000, `${dt} ms`);
  console.log(`# Shackleton rim, 2 years, all kinds, inline in Node: ${dt.toFixed(0)} ms (${list.meta.samples} samples)`);
});

test('cancel: an AbortSignal rejects with an AbortError (before and during the work)', async () => {
  const spec = specOf(await horizon('shackleton_rim'));
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(suggest(spec, { from: '2033-01-01T00:00:00Z', signal: ctl.signal }), { name: 'AbortError' });
  const ctl2 = new AbortController();
  const p = suggest(spec, { from: '2033-01-01T00:00:00Z', signal: ctl2.signal });
  setTimeout(() => ctl2.abort(), 30);
  await assert.rejects(p, { name: 'AbortError' });
});

test('cache: the same site and options return the same result without recomputing', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fileFetch; // the cacheable path uses the global fetch
  try {
    const spec = specOf(await horizon('apollo11'));
    const opts = { from: '2027-03-01T00:00:00Z', to: '2027-09-01T00:00:00Z', ephemBaseUrl: EPHEM };
    const a = await suggestDates(spec, opts);
    const t = performance.now();
    const b = await suggestDates(spec, opts);
    assert.equal(b, a);
    assert.ok(performance.now() - t < 20);
  } finally {
    globalThis.fetch = realFetch;
  }
});
