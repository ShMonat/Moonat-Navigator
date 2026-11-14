// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Scan used to pick the south-pole quick start window (web/js/app/catalog.js POLE_START / POLE_END): Sun and Earth
// at the quick start's site (LOLA horizon) at 30 min steps, a daily summary, the best instants, and window statistics.
// Usage: node scripts/pole_window_scan.mjs <scan start> <scan end> [<cand. start> <cand. end> [<window start> <end>...]]
// e.g.   node scripts/pole_window_scan.mjs 2026-12-15T00:00:00Z 2027-03-25T00:00:00Z x y 2027-01-19T00:00:00Z 2027-03-22T00:00:00Z
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initPhysics, seriesFor } from "../web/js/app/physics_adapter.js";
import { makeSite } from "../web/js/physics/index.js";
import { fileFetch } from "../web/tests/physics_helpers.mjs";
import { QUICK_STARTS } from "../web/js/app/catalog.js";

const SITES = JSON.parse(readFileSync(fileURLToPath(new URL("../web/data/sites.json", import.meta.url)), "utf8")).sites;
await initPhysics(fileURLToPath(new URL("../web/data/ephem", import.meta.url)), { fetch: fileFetch });
const [p] = QUICK_STARTS.find((q) => q.key === "pole").resolve(SITES);
console.log(p.site_id, p.lat_deg, p.lon_deg, p.t_start_utc, p.t_end_utc);
const horizon = JSON.parse(readFileSync(fileURLToPath(new URL(`../web/data/horizons/${p.site_id}.json`, import.meta.url)), "utf8"));
const site = makeSite({ lat_deg: p.lat_deg, lon_deg: p.lon_deg, horizon });
const t0 = Date.parse(process.argv[2] || "2027-03-20T00:00:00Z"), t1 = Date.parse(process.argv[3] || "2027-05-10T00:00:00Z");
const s = await seriesFor(site, t0, t1, 1800e3);
const rows = [];
for (let i = 0; i < s.t_ms.length; i++) {
  const dAz = Math.abs(((s.sun_az[i] - s.earth_az[i] + 540) % 360) - 180);
  rows.push({ t: new Date(s.t_ms[i]).toISOString().slice(0, 16), sunEl: s.sun_el[i], sunVis: s.sun_vis[i], sunAz: s.sun_az[i], eEl: s.earth_el[i], eVis: s.earth_vis[i], eAz: s.earth_az[i], dAz, ph: s.earth_phase[i] });
}
const good = rows.filter((r) => r.sunVis > 0.99 && r.eVis > 0.99 && r.sunEl > 0.2);
console.log("instants with Sun and Earth fully up:", good.length, "of", rows.length);
// Daily summary of sunlight and Earth visibility.
const byDay = new Map();
for (const r of rows) {
  const d = r.t.slice(0, 10);
  const o = byDay.get(d) || { n: 0, sun: 0, earth: 0, both: 0, sunElMax: -9, eElMax: -9 };
  o.n++; o.sun += r.sunVis > 0.5; o.earth += r.eVis > 0.5; o.both += r.sunVis > 0.99 && r.eVis > 0.99; o.sunElMax = Math.max(o.sunElMax, r.sunEl); o.eElMax = Math.max(o.eElMax, r.eEl);
  byDay.set(d, o);
}
for (const [d, o] of byDay) console.log(d, `sun ${(o.sun / o.n * 100).toFixed(0)}%  earth ${(o.earth / o.n * 100).toFixed(0)}%  both ${o.both}  sunElMax ${o.sunElMax.toFixed(2)}  eElMax ${o.eElMax.toFixed(2)}`);
const score = (r) => r.sunEl * 1.0 + Math.min(r.eEl, 4) * 0.6 - Math.abs(r.dAz - 70) / 40;
good.sort((a, b) => score(b) - score(a));
console.log("best:");
for (const r of good.slice(0, 5)) console.log(r.t, `sun el ${r.sunEl.toFixed(2)} az ${r.sunAz.toFixed(1)} | earth el ${r.eEl.toFixed(2)} az ${r.eAz.toFixed(1)} ph ${(r.ph * 100).toFixed(0)}% | dAz ${r.dAz.toFixed(0)}`);
console.log("6-hourly table:");
for (const r of rows) if (/T(00|06|12|18):00/.test(r.t)) console.log(r.t, `sun ${r.sunEl.toFixed(2)} az ${r.sunAz.toFixed(0)} vis ${r.sunVis.toFixed(2)} | earth ${r.eEl.toFixed(2)} az ${r.eAz.toFixed(0)} vis ${r.eVis.toFixed(2)} ph ${(r.ph * 100).toFixed(0)} | dAz ${r.dAz.toFixed(0)}`);
if (process.argv[6]) {
  const ts = Date.parse(process.argv[6]);
  for (const end of process.argv.slice(7)) {
    const w = await seriesFor(site, ts, Date.parse(end), 1800e3);
    let sunsets = 0; const when = [];
    for (let i = 1; i < w.sun_vis.length; i++) if (w.sun_vis[i - 1] > 0 && w.sun_vis[i] === 0) { sunsets++; when.push(new Date(w.t_ms[i]).toISOString().slice(5, 13)); }
    console.log(`window ${process.argv[6]} -> ${end}: ${sunsets} sunsets (${when.join(", ")}), ${w.summary.sun_vis_pct.toFixed(1)}% sun, ${w.summary.earth_vis_pct.toFixed(0)}% earth, sun el ${Math.min(...w.sun_el).toFixed(2)}..${Math.max(...w.sun_el).toFixed(2)}`);
  }
  process.exit(0);
}
// Candidate windows: start at a good instant in [argv4, argv5], several lengths.
const c0 = Date.parse(process.argv[4] || "2027-02-06T00:00:00Z"), c1 = Date.parse(process.argv[5] || "2027-02-11T00:00:00Z");
const cands = rows.filter((r) => { const t = Date.parse(r.t + ":00Z"); return t >= c0 && t <= c1 && r.sunVis > 0.99 && r.eVis > 0.99 && r.sunEl > 0.15; });
cands.sort((a, b) => score(b) - score(a));
console.log("window candidates:");
for (const r of cands.slice(0, 6)) {
  const ts = Date.parse(r.t + ":00Z");
  console.log(r.t, `sun el ${r.sunEl.toFixed(2)} az ${r.sunAz.toFixed(1)} | earth el ${r.eEl.toFixed(2)} az ${r.eAz.toFixed(1)} ph ${(r.ph * 100).toFixed(0)}% | dAz ${r.dAz.toFixed(0)}`);
  for (const days of [29, 30, 35, 40]) {
    const w = await seriesFor(site, ts, ts + days * 864e5, 3600e3);
    let sunsets = 0;
    for (let i = 1; i < w.sun_vis.length; i++) if (w.sun_vis[i - 1] > 0 && w.sun_vis[i] === 0) sunsets++;
    console.log(`    ${days}d: ${sunsets} sunsets, ${w.summary.sun_vis_pct.toFixed(0)}% sun, ${w.summary.earth_vis_pct.toFixed(0)}% earth, el ${Math.min(...w.sun_el).toFixed(2)}..${Math.max(...w.sun_el).toFixed(2)}`);
  }
}
