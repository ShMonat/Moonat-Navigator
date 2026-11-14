// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Quick starts (web/js/app/catalog.js) and the first-visit page (web/index.html): how each story opens (tab, Compare
// axis and section, Sky-tab moment), the numbers its "what to look for" caption quotes, and the story links of the
// introduction line.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QUICK_STARTS } from "../js/app/catalog.js";
import { initPhysics, stateAt } from "../js/app/physics_adapter.js";
import { makeSite } from "../js/physics/index.js";
import { fileFetch } from "./physics_helpers.mjs";
import { parseUtc } from "../js/app/state.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SITES = JSON.parse(read("../data/sites.json")).sites;
const HTML = read("../index.html");
const byKey = (k) => QUICK_STARTS.find((q) => q.key === k);

test("the first six quick starts keep their order (the demo video clicks them by position)", () => {
  assert.deepEqual(QUICK_STARTS.slice(0, 6).map((q) => q.key), ["apollo11", "apollo-all", "pole", "farside", "eclipse", "rover"]);
});

test("each quick start opens on a valid tab, axis and section, with a one-line caption", () => {
  for (const q of QUICK_STARTS) {
    if (q.tab !== undefined) assert.ok(["sky", "compare"].includes(q.tab), q.key);
    if (q.xaxis !== undefined) assert.ok(["met", "utc", "dist"].includes(q.xaxis), q.key);
    if (q.body !== undefined) assert.ok(["sun", "earth"].includes(q.body), q.key);
    if (q.offsetMs !== undefined) assert.ok(Number.isFinite(q.offsetMs) && q.offsetMs >= 0, q.key);
    assert.equal(typeof q.caption, "string", q.key);
    assert.ok(q.caption.length > 40 && q.caption.length < 200 && !q.caption.includes("\n"), q.key);
  }
  // The stories open where they are best seen.
  assert.equal(byKey("apollo11").tab, "sky");
  assert.equal(byKey("apollo-all").tab, "compare");
  assert.equal(byKey("eclipse").tab, "sky");
  assert.equal(byKey("eclipse").xaxis, "utc"); // NASA gives the eclipse contacts in UTC
});

test("the first-visit caption in index.html is the Apollo 11 caption", () => {
  const m = /<span class="qs-cap-text">([^<]*)<\/span>/.exec(HTML);
  assert.ok(m);
  assert.equal(m[1].replace(/\s+/g, " ").trim(), QUICK_STARTS[0].caption);
});

test("every story link of the introduction line runs an existing quick start", () => {
  const keys = [...HTML.matchAll(/data-qs="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["apollo11", "apollo-all", "pole", "farside", "eclipse"]);
  for (const k of keys) assert.ok(byKey(k), k);
});

test("the eclipse quick start opens the Sky tab at 81 % cover, inside the window and before totality", async () => {
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
