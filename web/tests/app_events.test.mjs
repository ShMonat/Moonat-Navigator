// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The event hint under the timelapse (web/js/app/events.js): an eclipse or an Earthrise in the scenarios on screen,
// against the real Blue Ghost eclipse window (C6 series, real ephemeris) and small synthetic series.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pickHint, firstEarthrise, ECLIPSE_PAD_MS, EARTHRISE_LEAD_MS } from "../js/app/events.js";
import { QUICK_STARTS } from "../js/app/catalog.js";
import { initPhysics, seriesFor } from "../js/app/physics_adapter.js";
import { makeSite } from "../js/physics/index.js";
import { fileFetch } from "./physics_helpers.mjs";
import { parseUtc, chooseStep } from "../js/app/state.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SITES = JSON.parse(read("../data/sites.json")).sites;
const H = 3600e3;

test("the eclipse story's window: the hint offers the eclipse until the sky shows it, then nothing", async () => {
  await initPhysics(fileURLToPath(new URL("../data/ephem", import.meta.url)), { fetch: fileFetch });
  const q = QUICK_STARTS.find((x) => x.key === "eclipse");
  const [p] = q.resolve(SITES);
  const horizon = JSON.parse(read(`../data/horizons/${p.site_id}.json`));
  const site = makeSite({ lat_deg: p.lat_deg, lon_deg: p.lon_deg, horizon });
  const t0 = parseUtc(p.t_start_utc);
  const t1 = parseUtc(p.t_end_utc);
  const series = await seriesFor(site, t0, t1, chooseStep(t1 - t0));
  const it = { s: p, label: "Blue Ghost eclipse", t0, span: t1 - t0, series, look: null };
  const e = series.eclipses[0];
  // Before the first contact (05:00:42 UTC): "Show me" jumps to the maximum, on the Sun.
  const h = pickHint([it], 0);
  assert.equal(h.kind, "eclipse");
  assert.equal(h.body, "sun");
  assert.equal(h.offsetMs, e.max_ms - t0);
  assert.match(h.text, /eclipses the Sun from here on 14 Mar 2025 \(total\)/);
  // The story opens at 81 % covered, inside the eclipse: no hint.
  assert.equal(pickHint([it], q.offsetMs), null);
  // After the last contact (09:51 UTC) the hint comes back.
  assert.equal(pickHint([it], t1 - t0).kind, "eclipse");
});

test("a single instant with an eclipse in the next 30 days gets a window around it", () => {
  const t0 = Date.UTC(2025, 2, 1);
  const e = { start_ms: Date.UTC(2025, 2, 14, 5, 0, 42), end_ms: Date.UTC(2025, 2, 14, 9, 51, 11), max_ms: Date.UTC(2025, 2, 14, 7, 26), max_frac: 1 };
  const it = { s: {}, label: "Site", t0, span: 0, series: null, look: { t_ms: [t0], eclipses: [e] } };
  const h = pickHint([it], 0);
  assert.equal(h.kind, "eclipse-window");
  assert.equal(parseUtc(h.t_start_utc), Math.round((e.start_ms - ECLIPSE_PAD_MS) / 60e3) * 60e3);
  assert.equal(parseUtc(h.t_end_utc), Math.round((e.end_ms + ECLIPSE_PAD_MS) / 60e3) * 60e3);
  assert.match(h.text, /on 14 Mar 2025 \(total\)/);
  // Several scenarios: the hint names the one it is about.
  assert.match(pickHint([{ ...it, label: "A", look: null }, { ...it, label: "Malapert" }], 0).text, /from Malapert on/);
});

test("Earthrise: the first time the Earth clears the skyline after being hidden", () => {
  const t = [0, 1, 2, 3, 4, 5].map((k) => k * H);
  assert.equal(firstEarthrise({ t_ms: t, earth_vis: [0, 0, 0.2, 1, 1, 1] }), 2 * H);
  assert.equal(firstEarthrise({ t_ms: t, earth_vis: [1, 1, 0, 0, 0.5, 1] }), 4 * H); // sets first, then rises
  assert.equal(firstEarthrise({ t_ms: t, earth_vis: [1, 1, 1, 1, 1, 1] }), null);
  assert.equal(firstEarthrise({ t_ms: t, earth_vis: [0, 0, 0, 0, 0, 0] }), null); // the far side
  const it = { s: {}, label: "Limb", t0: 0, span: 5 * H, series: { t_ms: t, earth_vis: [0, 0, 0.2, 1, 1, 1], eclipses: [] }, look: null };
  const h = pickHint([it], 0);
  assert.equal(h.kind, "earthrise");
  assert.equal(h.body, "earth");
  assert.equal(h.offsetMs, 2 * H + EARTHRISE_LEAD_MS);
  assert.equal(pickHint([it], 3 * H), null); // already risen on screen
});
