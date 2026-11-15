// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The page's side of the suggested dates (web/js/app/suggest_adapter.js, contract C11): the window a chosen
// suggestion opens, the Sun | Earth choice of each kind, and a real list for the Blue Ghost site in March 2025.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { suggestWindow, suggestBody, suggestIcon, SUGGEST_KINDS, EVENT_PAD_MS } from "../js/app/suggest_adapter.js";
import { suggestDates } from "../js/suggest/index.js";
import { icon } from "../js/app/icons.js";
import { fileFetch } from "./physics_helpers.mjs";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("a window opens as it is; an eclipse or an Earthrise opens around itself, at its maximum; a note opens nothing", () => {
  const sun = { kind: "sun", t_start_utc: "2027-01-19T00:00:00Z", t_end_utc: "2027-02-02T18:30:00Z", title: "x" };
  assert.deepEqual(suggestWindow(sun), { t_start_utc: sun.t_start_utc, t_end_utc: sun.t_end_utc, at_utc: null });
  const ecl = { kind: "eclipse", t_start_utc: "2025-03-14T05:00:42Z", t_end_utc: "2025-03-14T09:51:10Z", t_max_utc: "2025-03-14T07:25:53Z" };
  const w = suggestWindow(ecl);
  assert.equal(Date.parse(w.t_start_utc), Math.round((Date.parse(ecl.t_start_utc) - EVENT_PAD_MS) / 60e3) * 60e3);
  assert.equal(Date.parse(w.t_end_utc), Math.round((Date.parse(ecl.t_end_utc) + EVENT_PAD_MS) / 60e3) * 60e3);
  assert.equal(Date.parse(w.at_utc), Date.parse(ecl.t_max_utc));
  assert.equal(suggestWindow({ kind: "earth", note: true, t_start_utc: null, t_end_utc: null }), null);
  assert.equal(suggestWindow(null), null);
});

test("each kind turns the switch to its body and has an icon", () => {
  assert.deepEqual(SUGGEST_KINDS.map((k) => k.kind), ["sun", "earth", "both", "eclipse", "earthrise"]);
  assert.equal(suggestBody("sun"), "sun");
  assert.equal(suggestBody("eclipse"), "sun");
  assert.equal(suggestBody("earth"), "earth");
  assert.equal(suggestBody("earthrise"), "earth");
  assert.equal(suggestBody("both"), null);
  // Icons are SVG line icons (web/js/app/icons.js), never emoji: one per kind, two for "both", the sparkle otherwise.
  assert.equal(suggestIcon("eclipse"), icon("eclipse"));
  assert.equal(suggestIcon("both"), icon("sun") + icon("earth"));
  assert.equal(suggestIcon("mystery"), icon("suggest"));
  for (const k of SUGGEST_KINDS) assert.match(suggestIcon(k.kind), /^<svg /, k.kind);
});

test("Blue Ghost, March 2025: the list holds the total eclipse of 14 March, and it opens at its maximum", async () => {
  const site = JSON.parse(read("../data/sites.json")).sites.find((x) => x.id === "blueghost1");
  const horizon = JSON.parse(read("../data/horizons/blueghost1.json"));
  const list = await suggestDates({ lat_deg: site.lat_deg, lon_deg: site.lon_deg, horizon }, {
    from: Date.UTC(2025, 2, 1), to: Date.UTC(2025, 3, 1), kinds: ["eclipse"], worker: false, fetch: fileFetch,
    ephemBaseUrl: fileURLToPath(new URL("../data/ephem", import.meta.url)),
  });
  const ecl = list.find((g) => g.kind === "eclipse");
  assert.ok(ecl, JSON.stringify(list));
  assert.equal(ecl.t_max_utc.slice(0, 13), "2025-03-14T07");
  const w = suggestWindow(ecl);
  assert.ok(Date.parse(w.t_start_utc) < Date.parse(w.at_utc) && Date.parse(w.at_utc) < Date.parse(w.t_end_utc));
});
