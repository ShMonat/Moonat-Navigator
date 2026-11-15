// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Quick starts (web/js/app/catalog.js) and the first-visit page (web/index.html): how each story opens (the Sun | Earth
// switch, the charts' time axis, the sky's opening moment), the numbers its "what to look for" caption quotes, and
// the story buttons of the page.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QUICK_STARTS, SYNODIC_MS, scenarioFieldsFromSite, dirWord, sunEvents, beresheetOpening, eventSpeed } from "../js/app/catalog.js";
import { initPhysics, stateAt, seriesFor } from "../js/app/physics_adapter.js";
import { makeSite } from "../js/physics/index.js";
import { fileFetch } from "./physics_helpers.mjs";
import { parseUtc, isoUtc, formatUtc, makeScenario, encodeHash, decodeHash, scenarioTimes, DAY_MS } from "../js/app/state.js";
import { missionSeries, SPEEDS } from "../js/app/playback.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SITES = JSON.parse(read("../data/sites.json")).sites;
const HTML = read("../index.html");
const byKey = (k) => QUICK_STARTS.find((q) => q.key === k);

test("the first six quick starts keep their order (the demo video clicks them by position)", () => {
  assert.deepEqual(QUICK_STARTS.slice(0, 6).map((q) => q.key), ["apollo11", "apollo-all", "pole", "farside", "eclipse", "rover"]);
});

test("the Beresheet story is the last chip and opens the crash site now, for one lunar day-night cycle", () => {
  const q = QUICK_STARTS.at(-1);
  assert.equal(q.key, "beresheet-now");
  assert.equal(q.live, true);
  assert.equal(q.label, "Beresheet: the sky now");
  assert.ok(QUICK_STARTS.slice(0, -1).every((x) => !x.live), "only the Beresheet story is live");
  const now = Date.UTC(2026, 10, 15, 9, 26, 41);
  const [p] = q.resolve(SITES, now);
  assert.equal(p.site_id, "beresheet");
  assert.equal(p.t_start_utc, "2026-11-15T09:26:00Z"); // the current minute
  assert.equal(parseUtc(p.t_end_utc) - parseUtc(p.t_start_utc), SYNODIC_MS);
  assert.ok(Math.abs(SYNODIC_MS / DAY_MS - 29.530589) < 1 / 1440); // 29 d 12 h 44 min
  // Without a time it opens at the moment it is pressed.
  const [p2] = q.resolve(SITES);
  assert.ok(Math.abs(parseUtc(p2.t_start_utc) - Date.now()) < 61e3);
});

test("the live story is recognised again from a link or Back (resolved at its start), not from the catalog mission", () => {
  const q = byKey("beresheet-now");
  const sig = (partials) => {
    const list = [];
    for (const p of partials) list.push(makeScenario(p, list));
    return encodeHash({ scenarios: list });
  };
  const opened = q.resolve(SITES, Date.UTC(2026, 10, 15, 9, 26, 41));
  const link = decodeHash(sig(opened)); // what a shared link or a Back step restores
  const again = q.resolve(SITES, parseUtc(link.scenarios[0].t_start_utc));
  assert.equal(encodeHash({ scenarios: link.scenarios }), sig(again));
  // Picking Beresheet from the search loads the crash itself (2019), which is not the story.
  const mission = scenarioFieldsFromSite(SITES.find((s) => s.id === "beresheet"));
  assert.equal(mission.t_start_utc, "2019-04-11T19:23:00Z");
  assert.notEqual(sig([mission]), sig(q.resolve(SITES, parseUtc(mission.t_start_utc))));
});

// The Beresheet story's scenario computed at a fixed start (as main.js computes it), for its caption and opening.
async function beresheetAt(iso) {
  await initPhysics(fileURLToPath(new URL("../data/ephem", import.meta.url)), { fetch: fileFetch });
  const [p] = byKey("beresheet-now").resolve(SITES, parseUtc(iso));
  const horizon = JSON.parse(read("../data/horizons/beresheet.json"));
  const site = makeSite({ lat_deg: p.lat_deg, lon_deg: p.lon_deg, horizon });
  const { t0, t1 } = scenarioTimes(makeScenario(p));
  return { site, horizon, t0, state0: await stateAt(site, t0), series: await missionSeries(site, t0, t1, seriesFor) };
}

test("the Beresheet caption is written from the computed sky: Sun up or down, the next sunset or sunrise, Earth", async () => {
  const q = byKey("beresheet-now");
  const computed = beresheetAt;
  // The first moment (to 1 s) the Sun's disk clears the skyline after tA, by bisection on the C6 state itself.
  const riseBetween = async (site, tA, tB) => {
    while (tB - tA > 1000) {
      const m = (tA + tB) / 2;
      if ((await stateAt(site, m)).sun.vis_frac > 0.001) tB = m;
      else tA = m;
    }
    return tB;
  };
  // Lunar morning at the crash site (20 Nov 2026): the Sun high in the south-east, a crescent Earth in the south-west.
  const day = await computed("2026-11-20T00:00:00Z");
  assert.ok(day.state0.sun.vis_frac > 0.999 && day.state0.sun.el_deg > 40);
  const c1 = q.caption(day, day.t0 + 60e3);
  assert.match(c1, /^Right now, where Beresheet's tardigrades lie, the Sun is 43° up in the south-east and sets in 10 d \(30 Nov, 02:\d\d UTC\); Earth is 46° up in the south-west, 26 % lit\. Press play to watch the sunset\.$/);
  assert.equal(dirWord(day.state0.earth.az_deg), "south-west");
  // The sunset agrees with the C6 summary's (refined to 1 s by bisection) within 2 min (the disk takes over an hour to set).
  const ev1 = sunEvents(day.series, day.horizon, day.state0.sun.ang_radius_deg);
  assert.ok(Math.abs(ev1.nextSet - day.series.summary.next_sunset_ms) < 120e3, `${ev1.nextSet - day.series.summary.next_sunset_ms} ms`);
  // Just before sunrise (15 Nov 2026, 09:34 UTC): night, the Earth first, then the coming sunrise.
  const dawn = await computed("2026-11-15T09:34:00Z");
  const c0 = q.caption(dawn, dawn.t0 + 30e3);
  assert.match(c0, /^Right now it is night where Beresheet's tardigrades lie: Earth is 53° up in the south-west, 70 % lit\. The Sun rises in 1 h 2\d min \(15 Nov, 10:5\d UTC\): switch to Sun and press play to watch it\.$/);
  // Lunar night (3 Dec 2026): the Sun below the horizon; it rises on 15 Dec. A link opened later names the date.
  const night = await computed("2026-12-03T00:00:00Z");
  assert.equal(night.state0.sun.vis_frac, 0);
  const c2 = q.caption(night, night.t0 + 5 * DAY_MS);
  assert.match(c2, /^On 3 Dec 2026, 00:00 UTC, it is night where Beresheet's tardigrades lie: Earth is 59° up in the south-west, 68 % lit\. The Sun rises in 12 d \(15 Dec, 0\d:\d\d UTC\): switch to Sun and press play to watch it\.$/);
  for (const c of [c0, c1, c2]) assert.ok(c.length < 220 && !c.includes("\n"), c);
  // The sunrise agrees with a bisection on the sky state within 2 min, wherever the story starts in the 20 min step.
  for (const it of [dawn, night]) {
    const ev = sunEvents(it.series, it.horizon, it.state0.sun.ang_radius_deg);
    const k = it.series.sun_vis.findIndex((v) => v > 0.001);
    const exact = await riseBetween(it.site, it.series.t_ms[k - 1], it.series.t_ms[k]);
    assert.ok(Math.abs(ev.nextRise - exact) < 120e3, `${ev.nextRise - exact} ms`);
  }
  const ev2 = sunEvents(night.series, night.horizon, night.state0.sun.ang_radius_deg);
  assert.ok(c2.includes(`(${formatUtc(ev2.nextRise).replace(" 2026,", ",")})`));
  assert.equal(isoUtc(night.t0), "2026-12-03T00:00:00Z");
});

test("the Beresheet story opens on the Earth at night and on the Sun by day, at a speed set by the next event", async () => {
  assert.equal(byKey("beresheet-now").opening, beresheetOpening);
  // Night, sunrise in 1 h 21 min: the Earth view at 10 min/s (the sunrise after about 8 s of playback).
  assert.deepEqual(beresheetOpening(await beresheetAt("2026-11-15T09:34:00Z")), { body: "earth", speedMs: 10 * 60e3 });
  // Day, sunset in 10 d: the Sun view at 1 day/s (about 10 s).
  assert.deepEqual(beresheetOpening(await beresheetAt("2026-11-20T00:00:00Z")), { body: "sun", speedMs: DAY_MS });
  // Night, sunrise in 12 d: the Earth view at 1 day/s (about 12 s).
  assert.deepEqual(beresheetOpening(await beresheetAt("2026-12-03T00:00:00Z")), { body: "earth", speedMs: DAY_MS });
  // Before the sky is computed: the defaults (Sun view, 1 day/s).
  assert.deepEqual(beresheetOpening(null), { body: "sun", speedMs: DAY_MS });
});

test("eventSpeed: a menu speed that brings the event after 5-15 s of playback; 1 day/s without one", () => {
  const menu = SPEEDS.map((x) => x.ms);
  const H = 3600e3;
  const cases = [[81 * 60e3, 600e3], [10 * 60e3, 60e3], [2 * H, 600e3], [12 * H, H], [2 * DAY_MS, 6 * H], [10 * DAY_MS, DAY_MS], [14 * DAY_MS, DAY_MS]];
  for (const [dt, want] of cases) {
    const got = eventSpeed(dt);
    assert.equal(got, want, `${dt / 60e3} min`);
    assert.ok(menu.includes(got));
  }
  // Where a menu speed fits the 5-15 s window, it is the one chosen.
  for (const dt of [81 * 60e3, 12 * H, 2 * DAY_MS, 10 * DAY_MS]) {
    const s = dt / eventSpeed(dt);
    assert.ok(s >= 5 && s <= 15, `${dt / 60e3} min -> ${s} s`);
  }
  assert.equal(eventSpeed(null), DAY_MS);
  assert.equal(eventSpeed(-5), DAY_MS);
});

test("each quick start opens with a valid body, axis and moment, and a one-line caption", () => {
  for (const q of QUICK_STARTS) {
    assert.equal(q.tab, undefined, q.key); // one page: no tabs
    if (q.xaxis !== undefined) assert.ok(["met", "utc", "dist"].includes(q.xaxis), q.key);
    if (q.body !== undefined) assert.ok(["sun", "earth"].includes(q.body), q.key);
    if (q.offsetMs !== undefined) assert.ok(Number.isFinite(q.offsetMs) && q.offsetMs >= 0, q.key);
    // A live story writes its caption from the computed sky (a placeholder line until then).
    const caption = q.live ? q.caption(null) : q.caption;
    assert.equal(typeof q.caption, q.live ? "function" : "string", q.key);
    assert.ok(caption.length > 40 && caption.length < 200 && !caption.includes("\n"), q.key);
  }
  // Each story turns the sky views to the body it is about (the opening view of a first visit faces the Earth, C8).
  assert.equal(byKey("apollo11").body, "earth");
  assert.equal(byKey("farside").body, "earth");
  for (const k of ["apollo-all", "pole", "eclipse", "rover"]) assert.equal(byKey(k).body ?? "sun", "sun", k);
  assert.equal(byKey("beresheet-now").body, undefined); // chosen from its sky at the start (beresheetOpening)
  assert.equal(byKey("eclipse").xaxis, "utc"); // NASA gives the eclipse contacts in UTC
});

test("the first-visit caption in index.html is the Apollo 11 caption", () => {
  const m = /<span class="qs-cap-text">([^<]*)<\/span>/.exec(HTML);
  assert.ok(m);
  assert.equal(m[1].replace(/\s+/g, " ").trim(), QUICK_STARTS[0].caption);
});

test("every story button written in index.html runs an existing quick start; the chips come from QUICK_STARTS", () => {
  for (const [, k] of HTML.matchAll(/data-qs="([^"]+)"/g)) assert.ok(byKey(k), k);
  assert.match(HTML, /<div class="chips" id="quickstarts"><\/div>/);
  // The stories sit right under the scenario box, before the sky (one flow: place and time, then the sky).
  const iCards = HTML.indexOf('id="cards"'), iStories = HTML.indexOf('id="quickstarts"'), iSky = HTML.indexOf('id="sky-panel"');
  assert.ok(iCards > 0 && iCards < iStories && iStories < iSky);
});

test("the eclipse quick start opens the sky at 81 % cover, inside the window and before totality", async () => {
  await initPhysics(fileURLToPath(new URL("../data/ephem", import.meta.url)), { fetch: fileFetch });
  const q = byKey("eclipse");
  const [p] = q.resolve(SITES);
  const horizon = JSON.parse(read(`../data/horizons/${p.site_id}.json`));
  const site = makeSite({ lat_deg: p.lat_deg, lon_deg: p.lon_deg, horizon });
  const t = parseUtc(p.t_start_utc) + q.offsetMs;
  assert.equal(new Date(t).toISOString(), "2025-03-14T05:57:30.000Z");
  assert.ok(t < parseUtc(p.t_end_utc));
  const st = await stateAt(site, t);
  assert.ok(Math.abs(st.sun.eclipse_frac - 0.81) < 0.02, `eclipse_frac ${st.sun.eclipse_frac}`);
  assert.match(q.caption, /81 %/);
});

test("the Apollo 11 caption quotes the sky at landing (Earth 59° up in the west, 67 % lit; Sun low in the east)", async () => {
  await initPhysics(fileURLToPath(new URL("../data/ephem", import.meta.url)), { fetch: fileFetch });
  const [p] = byKey("apollo11").resolve(SITES);
  const horizon = JSON.parse(read(`../data/horizons/${p.site_id}.json`));
  const st = await stateAt(makeSite({ lat_deg: p.lat_deg, lon_deg: p.lon_deg, horizon }), parseUtc(p.t_start_utc));
  assert.equal(Math.round(st.earth.el_deg), 59);
  assert.ok(st.earth.az_deg > 247.5 && st.earth.az_deg < 292.5, `Earth az ${st.earth.az_deg}`); // west
  assert.equal(Math.round(st.earth.phase_frac * 100), 67);
  assert.ok(st.sun.el_deg > 5 && st.sun.el_deg < 15 && st.sun.az_deg > 67.5 && st.sun.az_deg < 112.5); // low in the east
});
