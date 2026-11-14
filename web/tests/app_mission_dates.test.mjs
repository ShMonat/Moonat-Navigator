// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// A catalog mission's dates stay with the mission (web/js/app/state.js timesForPlaceChange, store.js setPlaceRule):
// moving the scenario to another place resets them to now (or the nearest covered year), while dates the user typed
// or picked stay. Links and stories carry no mark: their dates count as the mission's when the start is its landing.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeScenario, defaultTimes, hasMissionDates, timesForPlaceChange, encodeHash, decodeHash } from "../js/app/state.js";
import { setScenarios, updateScenario, setPlaceRule, store, addScenario, subscribe } from "../js/app/store.js";
import { QUICK_STARTS } from "../js/app/catalog.js";

const SITES = JSON.parse(readFileSync(fileURLToPath(new URL("../data/sites.json", import.meta.url)), "utf8")).sites;
const siteById = (id) => SITES.find((x) => x.id === id) || null;
const YEARS = [...Array.from({ length: 11 }, (_, i) => 1966 + i), ...Array.from({ length: 28 }, (_, i) => 2013 + i)];
const NOW = Date.UTC(2026, 10, 14, 15, 42, 37);
const ctx = { siteById, nowMs: NOW, years: YEARS };
const A11 = siteById("apollo11");
const RIM = siteById("shackleton_rim");

test("default times: now to the minute when covered, else 1 January of the nearest covered year; no end", () => {
  assert.deepEqual(defaultTimes(NOW, YEARS), { t_start_utc: "2026-11-14T15:42:00Z", t_end_utc: null });
  assert.deepEqual(defaultTimes(Date.UTC(2045, 5, 1), YEARS), { t_start_utc: "2040-01-01T00:00:00Z", t_end_utc: null });
  assert.deepEqual(defaultTimes(Date.UTC(2005, 5, 1), YEARS), { t_start_utc: "2013-01-01T00:00:00Z", t_end_utc: null });
  assert.deepEqual(defaultTimes(Date.UTC(1990, 0, 1), YEARS), { t_start_utc: "1976-01-01T00:00:00Z", t_end_utc: null });
  assert.equal(defaultTimes(NOW, []).t_start_utc, "2026-11-14T15:42:00Z");
});

test("mission dates: marked, or (links, stories) the start at the scenario's mission landing; the user's never", () => {
  const a = makeScenario({ site_id: "apollo11", lat_deg: A11.lat_deg, lon_deg: A11.lon_deg, t_start_utc: A11.t_start_utc, t_end_utc: A11.t_end_utc });
  assert.equal(hasMissionDates(a, A11), true, "a link or story: derived from the landing time");
  assert.equal(hasMissionDates({ ...a, t_src: "user" }, A11), false);
  assert.equal(hasMissionDates({ ...a, t_src: "default" }, A11), false);
  assert.equal(hasMissionDates({ ...a, t_start_utc: "1969-07-21T00:00:00Z" }, A11), false, "another start");
  assert.equal(hasMissionDates({ ...a, site_id: null, t_src: "mission" }, null), true, "marked");
  assert.equal(hasMissionDates({ ...a, t_start_utc: null }, A11), false);
  // The mark is not part of a link (the quick-start chips compare links).
  assert.ok(!encodeHash({ scenarios: [{ ...a, t_src: "mission" }] }).includes("mission"));
  assert.equal(makeScenario({ t_src: "mission" }).t_src, "mission");
  assert.equal("t_src" in makeScenario({ t_src: "bogus" }), false);
});

test("place change: Apollo 11's dates do not follow the scenario to another place", () => {
  const a = makeScenario({ label: "Apollo 11", site_id: "apollo11", lat_deg: A11.lat_deg, lon_deg: A11.lon_deg, t_start_utc: A11.t_start_utc, t_end_utc: A11.t_end_utc, t_src: "mission" });
  const reset = { t_start_utc: "2026-11-14T15:42:00Z", t_end_utc: null, t_src: "default" };
  // A click on the globe (custom point), a place of interest without dates, typed coordinates.
  assert.deepEqual(timesForPlaceChange(a, { lat_deg: -10, lon_deg: 20, site_id: null }, ctx), reset);
  assert.deepEqual(timesForPlaceChange(a, { lat_deg: RIM.lat_deg, lon_deg: RIM.lon_deg, site_id: RIM.id }, ctx), reset);
  assert.deepEqual(timesForPlaceChange(a, { lat_deg: 0.7, site_id: null }, ctx), reset);
  // Not a move: the same site, a label, a coordinate field being retyped (empty), or new times in the same patch.
  assert.deepEqual(timesForPlaceChange(a, { lat_deg: A11.lat_deg, lon_deg: A11.lon_deg, site_id: "apollo11" }, ctx), {});
  assert.deepEqual(timesForPlaceChange(a, { label: "x" }, ctx), {});
  assert.deepEqual(timesForPlaceChange(a, { lat_deg: null, site_id: null }, ctx), {});
  assert.deepEqual(timesForPlaceChange(a, { site_id: "apollo15", lat_deg: 26.13, lon_deg: 3.63, t_start_utc: "1971-07-30T22:16:29Z" }, ctx), {});
  // Dates the user typed or picked stay with the scenario.
  assert.deepEqual(timesForPlaceChange({ ...a, t_src: "user" }, { lat_deg: -10, lon_deg: 20, site_id: null }, ctx), {});
  // A custom point's own dates stay too.
  const p = makeScenario({ lat_deg: 1, lon_deg: 2, t_start_utc: "1969-07-20T20:17:40Z" });
  assert.deepEqual(timesForPlaceChange(p, { lat_deg: 3, lon_deg: 4 }, ctx), {});
});

test("store: the place rule resets mission dates once, tells the card, and marks times set by hand as the user's", () => {
  setPlaceRule((s, patch) => timesForPlaceChange(s, patch, ctx));
  const events = [];
  const unsub = subscribe((k, d) => events.push([k, d]));
  try {
    // The first-visit story, Apollo 11 (as a link or a chip loads it: no mark, the start at the landing).
    setScenarios(QUICK_STARTS[0].resolve(SITES));
    const s = store.scenarios[0];
    assert.equal(s.t_start_utc, A11.t_start_utc);
    // A click on the globe moves it to a custom point: today's date, no end.
    updateScenario(s.id, { lat_deg: -12.5, lon_deg: 40.25, site_id: null, label: "Point" }, "field", { external: true });
    assert.equal(s.t_start_utc, "2026-11-14T15:42:00Z");
    assert.equal(s.t_end_utc, null);
    assert.equal(s.t_src, "default");
    assert.deepEqual(events.at(-1), ["field", { id: s.id, external: true, timesReset: true }]);
    // The next move keeps the (now default) dates.
    updateScenario(s.id, { lat_deg: -13, lon_deg: 41 });
    assert.equal(s.t_start_utc, "2026-11-14T15:42:00Z");
    assert.deepEqual(events.at(-1), ["field", { id: s.id }]);
    // Times typed or picked are the user's, and stay at a new place.
    updateScenario(s.id, { t_start_utc: "2027-01-19T00:00:00Z" });
    assert.equal(s.t_src, "user");
    updateScenario(s.id, { lat_deg: -89.9, lon_deg: 0 });
    assert.equal(s.t_start_utc, "2027-01-19T00:00:00Z");
    // A new place added after the mission scenario keeps the add button's meaning ("same times") until moved:
    // its times are not marked, and it has no site, so they stay.
    setScenarios(QUICK_STARTS[0].resolve(SITES));
    const b = addScenario({ t_start_utc: store.scenarios[0].t_start_utc, t_end_utc: store.scenarios[0].t_end_utc });
    updateScenario(b.id, { lat_deg: 5, lon_deg: 5, site_id: null });
    assert.equal(b.t_start_utc, A11.t_start_utc);
  } finally {
    unsub();
    setPlaceRule(null);
  }
});

test("a link round trip keeps the times, and a reopened Apollo 11 link still counts as the mission's dates", () => {
  setScenarios(QUICK_STARTS[0].resolve(SITES));
  const back = decodeHash(encodeHash({ scenarios: store.scenarios })).scenarios[0];
  assert.equal(back.t_start_utc, A11.t_start_utc);
  assert.equal(hasMissionDates(back, A11), true);
  assert.deepEqual(timesForPlaceChange(back, { lat_deg: 10, lon_deg: 10, site_id: null }, ctx).t_start_utc, "2026-11-14T15:42:00Z");
});
