// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Regressions found in QA round 4 (docs/validation/qa4.md).
// Run: node --test web/tests/app_qa4.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { placeResults } from "../js/app/place_search.js";
import { HOME_SITE_ID } from "../js/app/catalog.js";
import { suggestKey, suggestCaveat } from "../js/app/suggest_adapter.js";
import { fetchGrid } from "../js/terrain/trek.js";

const SITES = JSON.parse(readFileSync(fileURLToPath(new URL("../data/sites.json", import.meta.url)), "utf8")).sites;

/** The order the search box lists its results in (places.js): Home first or last, the groups between. */
function listed(q) {
  const r = placeResults(q, SITES);
  const ids = r.groups.flatMap((g) => g.sites.map((s) => s.id));
  if (!r.home) return ids;
  return r.homeFirst ? [r.home.id, ...ids] : [...ids, r.home.id];
}

test("search: Enter (the first result) picks the place typed, not Home found through its description", () => {
  // "Luna 9" and "luna" match StarHab's "lunar base" blurb; "malapert" its "Malapert massif" blurb.
  assert.equal(listed("Luna 9")[0], "luna9");
  assert.equal(listed("luna")[0], "luna9");
  assert.equal(listed("Luna 9").at(-1), HOME_SITE_ID, "Home is still offered, after the missions");
  assert.notEqual(listed("malapert")[0], HOME_SITE_ID);
  assert.ok(listed("malapert").includes(HOME_SITE_ID));
});

test("search: Enter picks the best match, a name match before a description match of an earlier group", () => {
  const best = (q) => placeResults(q, SITES).best?.id ?? null;
  // "de Gerlache Rim 2" (a potential Artemis site, listed before the places of interest) only mentions Shackleton.
  assert.equal(best("Shackleton"), "shackleton_rim");
  assert.equal(best("pole"), "south_pole");
  assert.equal(best("Luna 9"), "luna9");
  assert.equal(best("home"), HOME_SITE_ID);
  assert.equal(best("armstrong"), "apollo11");
  assert.equal(best(""), null, "no query: the list waits for the arrow keys");
  assert.equal(best("89.5S 130E"), null, "coordinates: Go to … comes first");
  assert.equal(best("zzzz"), null);
});

test("search: Home leads the list for an empty query and for its own name", () => {
  for (const q of ["", "home", "Home base", "starhab", "StarHab home"]) {
    const r = placeResults(q, SITES);
    assert.equal(r.home?.id, HOME_SITE_ID, q);
    assert.equal(r.homeFirst, true, q);
  }
  assert.equal(placeResults("apollo", SITES).home, null);
  assert.equal(placeResults("apollo", SITES).homeFirst, false);
});

test("suggested dates of a custom point follow its terrain: a new key when the real horizon arrives", () => {
  const pin = { site_id: null, lat_deg: -85.5, lon_deg: 30 };
  // Waiting, loading or never asked: the same "approximate" key (no search again until the terrain changes).
  assert.equal(suggestKey(pin, "waiting"), suggestKey(pin, "loading"));
  assert.equal(suggestKey(pin, "none"), suggestKey(pin, "loading"));
  assert.notEqual(suggestKey(pin, "loading"), suggestKey(pin, "ready"));
  assert.notEqual(suggestKey(pin, "loading"), suggestKey(pin, "fallback"));
  assert.notEqual(suggestKey(pin, "ready"), suggestKey({ ...pin, lat_deg: -85.6 }, "ready"));
  // A catalog site has precomputed terrain: one key whatever the live terrain status.
  const site = { site_id: "apollo11", lat_deg: 0.6741, lon_deg: 23.473 };
  assert.equal(suggestKey(site, "loading"), suggestKey(site, "ready"));
});

// A captured 65 × 65 Moon Trek grid (web/tests/fixtures/trek_fixtures.json): the answer of the fake server.
const LERC = (() => {
  const b = readFileSync(fileURLToPath(new URL("./fixtures/trek_apollo15_global.lerc", import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
})();

/** A fake Moon Trek: the given answers in turn ("500", "net", "ok", "stall"), counting the calls. */
function fakeTrek(answers) {
  const f = async (url, init) => {
    const a = answers[Math.min(f.calls++, answers.length - 1)];
    if (a === "500") return { ok: false, status: 500 };
    if (a === "net") throw new TypeError("Failed to fetch");
    if (a === "stall") {
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    return { ok: true, status: 200, arrayBuffer: async () => LERC.slice(0) };
  };
  f.calls = 0;
  return f;
}

test("Moon Trek grids: one server error or dropped connection is retried, a timeout is not", async () => {
  const get = (fetchFn, o = {}) => fetchGrid("global118", 26.1, 3.6, 3850, 65, { fetchFn, retryDelayMs: 1, ...o });
  // Rover route grids ask for one retry (web/js/rover/terrain.js).
  for (const first of ["500", "net"]) {
    const f = fakeTrek([first, "ok"]);
    const g = await get(f, { retries: 1 });
    assert.equal(f.calls, 2, first);
    assert.equal(g.n, 65);
    assert.equal(g.data.length, 65 * 65);
  }
  // Without retries (the default), and after the retry is spent, the error comes through.
  await assert.rejects(get(fakeTrek(["500", "ok"])), /HTTP 500/);
  const twice = fakeTrek(["500", "500", "ok"]);
  await assert.rejects(get(twice, { retries: 1 }), /HTTP 500/);
  assert.equal(twice.calls, 2);
  // A timeout is not retried (the route grids wait up to 90 s; a second wait would double it).
  const slow = fakeTrek(["stall", "ok"]);
  await assert.rejects(get(slow, { retries: 1, timeout_ms: 20 }), (e) => e.name === "AbortError");
  assert.equal(slow.calls, 1);
});

test("suggested dates of a custom point carry a caveat until the real terrain is there", () => {
  const pin = { site_id: null, lat_deg: -85.5, lon_deg: 30 };
  assert.match(suggestCaveat(pin, "loading"), /until NASA terrain arrives/);
  assert.match(suggestCaveat(pin, "fallback"), /could not be reached/);
  assert.equal(suggestCaveat(pin, "ready"), null);
  assert.equal(suggestCaveat({ site_id: "apollo11", lat_deg: 0.6741, lon_deg: 23.473 }, "loading"), null);
  assert.equal(suggestCaveat({ site_id: null, lat_deg: null, lon_deg: null }, "none"), null);
});
