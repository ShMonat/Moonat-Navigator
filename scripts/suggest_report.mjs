// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Tables for docs/validation/suggest.md: polar seasons at the Shackleton rim, the eclipses of 2025–2030 seen from
// four sites next to NASA's lunar eclipse list, example outputs, and Node timings.
// Run: node scripts/suggest_report.mjs   (prints Markdown)

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEphem, makeSite, series, skyState } from '../web/js/physics/index.js';
import { suggestDates } from '../web/js/suggest/index.js';
import { fileFetch } from '../web/tests/physics_helpers.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const EPHEM = `${REPO}web/data/ephem`;
await loadEphem(EPHEM, { fetch: fileFetch });
const horizon = async (id) => JSON.parse(await readFile(`${REPO}web/data/horizons/${id}.json`, 'utf8'));
const specOf = (hz) => ({ lat_deg: hz.lat_deg, lon_deg: hz.lon_deg, horizon: hz });
const suggest = (spec, opts) => suggestDates(spec, { ephemBaseUrl: EPHEM, fetch: fileFetch, ...opts });
const pct = (x) => `${(100 * x).toFixed(1)} %`;

// 1. Seasons at the Shackleton rim.
const shack = specOf(await horizon('shackleton_rim'));
const site = makeSite(shack);
const pole = makeSite({ lat_deg: 90, lon_deg: 0 });
console.log('### Shackleton rim by month (10-min samples)\n');
console.log('| Month | Subsolar latitude mid-month | Sunlit | Mean flux_frac | Earth in view |');
console.log('|---|---|---|---|---|');
for (let y = 2027; y <= 2028; y++) {
  for (let m = 0; m < 12; m++) {
    const a = Date.UTC(y, m, 1), b = Date.UTC(y, m + 1, 1) - 600e3;
    const r = await series(site, a, b, 600e3);
    const beta = (await skyState(pole, 0.5 * (a + b))).sun.el_deg;
    const n = r.t_ms.length;
    const lit = r.sun_flux_frac.filter((v) => v > 0).length / n;
    const flux = r.sun_flux_frac.reduce((s, v) => s + v, 0) / n;
    const earth = r.earth_vis.filter((v) => v > 0).length / n;
    console.log(`| ${new Date(a).toISOString().slice(0, 7)} | ${beta >= 0 ? '+' : '−'}${Math.abs(beta).toFixed(2)}° | ${pct(lit)} | ${flux.toFixed(3)} | ${pct(earth)} |`);
  }
}

// 2. Eclipses 2025–2030 at four sites.
const NASA = [
  ['2025-03-14T06:59:56Z', 'Total', 1.178], ['2025-09-07T18:12:58Z', 'Total', 1.362],
  ['2026-03-03T11:34:52Z', 'Total', 1.151], ['2026-08-28T04:14:04Z', 'Partial', 0.930],
  ['2027-02-20T23:14:06Z', 'Penumbral', -0.057], ['2027-07-18T16:04:09Z', 'Penumbral', -1.068],
  ['2027-08-17T07:14:59Z', 'Penumbral', -0.525], ['2028-01-12T04:14:13Z', 'Partial', 0.066],
  ['2028-07-06T18:20:57Z', 'Partial', 0.389], ['2028-12-31T16:53:15Z', 'Total', 1.246],
  ['2029-06-26T03:23:22Z', 'Total', 1.844], ['2029-12-20T22:43:12Z', 'Total', 1.117],
  ['2030-06-15T18:34:34Z', 'Partial', 0.502], ['2030-12-09T22:28:51Z', 'Penumbral', -0.163],
].map(([td, type, umag]) => ({ ut: Date.parse(td) - 75e3, type, umag }));
const sites = ['surveyor6', 'apollo11', 'blueghost1', 'shackleton_rim'];
const lists = {};
for (const id of sites) {
  lists[id] = await suggest(specOf(await horizon(id)), { from: '2025-01-01T00:00:00Z', to: '2031-01-01T00:00:00Z', kinds: ['eclipse'], limit: Infinity });
}
console.log('\n### Eclipses of the Sun by the Earth seen from four sites, 2025–2030\n');
console.log(`| NASA lunar eclipse (greatest, UT) | Type, umbral mag. | ${sites.join(' | ')} |`);
console.log(`|---|---|${sites.map(() => '---').join('|')}|`);
for (const n of NASA) {
  const cells = sites.map((id) => {
    const e = lists[id].find((x) => Math.abs(Date.parse(x.t_max_utc) - n.ut) < 45 * 60e3);
    if (!e) return '—';
    const dt = ((Date.parse(e.t_max_utc) - n.ut) / 60e3).toFixed(0);
    const what = e.stats.type === 'total' ? `**total ${Math.round(e.stats.totality_min)} min**` : `partial ${e.stats.max_frac < 0.005 ? (100 * e.stats.max_frac).toFixed(2) : Math.round(100 * e.stats.max_frac)} %`;
    const up = e.stats.sun_up_min < e.stats.duration_min - 1 ? `, Sun up ${Math.round(e.stats.sun_up_min)} of ${Math.round(e.stats.duration_min)} min` : '';
    return `${what} (${dt >= 0 ? '+' : ''}${dt} min${up})`;
  });
  console.log(`| ${new Date(n.ut).toISOString().slice(0, 16).replace('T', ' ')} | ${n.type}, ${n.umag.toFixed(3)} | ${cells.join(' | ')} |`);
}
const extra = sites.flatMap((id) => lists[id].filter((e) => !NASA.some((n) => Math.abs(Date.parse(e.t_max_utc) - n.ut) < 45 * 60e3)).map((e) => `${id}: ${e.title}`));
console.log(`\nEvents not in NASA's list: ${extra.length ? extra.join('; ') : 'none'}.`);

// 3. Example outputs (default options from 2027-01-01) and timings.
console.log('\n### Example output, two years from 1 Jan 2027 (titles)\n');
for (const id of ['apollo11', 'shackleton_rim', 'art_malapert', 'change4']) {
  const spec = specOf(await horizon(id));
  const t = performance.now();
  const list = await suggest(spec, { from: '2027-01-01T00:00:00Z' });
  const dt = performance.now() - t;
  console.log(`**${id}** (${dt.toFixed(0)} ms in Node, ${list.meta.samples} samples):\n`);
  for (const x of list) console.log(`- \`${x.kind}\` #${x.rank}: ${x.title} (score ${x.score})`);
  console.log('');
}
