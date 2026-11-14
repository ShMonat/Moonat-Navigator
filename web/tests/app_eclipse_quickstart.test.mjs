// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The "Eclipse from the Moon" quick start (web/js/app/catalog.js): its position (the demo video clicks the first four by
// position), its site and window, and the eclipse it shows (C6 eclipse_frac and series().eclipses, real ephemeris).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QUICK_STARTS } from "../js/app/catalog.js";
import { initPhysics, stateAt, seriesFor } from "../js/app/physics_adapter.js";
import { makeSite } from "../js/physics/index.js";
import { fileFetch } from "./physics_helpers.mjs";
import { parseUtc, chooseStep } from "../js/app/state.js";

const SITES = JSON.parse(readFileSync(fileURLToPath(new URL("../data/sites.json", import.meta.url)), "utf8")).sites;
const ephemDir = fileURLToPath(new URL("../data/ephem", import.meta.url));
const MIN = 60e3;

test("the eclipse quick start is appended after the original four, which keep their order", () => {
  assert.deepEqual(QUICK_STARTS.slice(0, 4).map((q) => q.key), ["apollo11", "apollo-all", "pole", "farside"]);
  const q = QUICK_STARTS[4];
  assert.equal(q.key, "eclipse");
  assert.equal(q.label, "Eclipse from the Moon");
  assert.match(q.title, /14 March 2025.*Blue Ghost.*eclipse the Sun.*Mare Crisium/);
  const list = q.resolve(SITES);
  assert.equal(list.length, 1);
  assert.equal(list[0].site_id, "blueghost1");
  assert.equal(list[0].t_start_utc, "2025-03-14T04:30:00Z");
  assert.equal(list[0].t_end_utc, "2025-03-14T10:20:00Z");
  // Without the catalog file, the built-in Blue Ghost entry gives the same scenario.
  const fb = q.resolve([])[0];
  assert.equal(fb.site_id, "blueghost1");
  assert.ok(Math.abs(fb.lat_deg - 18.5623) < 1e-9 && Math.abs(fb.lon_deg - 61.8103) < 1e-9);
});

test("the window holds the whole eclipse seen from Blue Ghost, with ~30 min on each side", async () => {
  await initPhysics(ephemDir, { fetch: fileFetch });
  const [p] = QUICK_STARTS[4].resolve(SITES);
  const horizon = JSON.parse(readFileSync(fileURLToPath(new URL(`../data/horizons/${p.site_id}.json`, import.meta.url)), "utf8"));
  const site = makeSite({ lat_deg: p.lat_deg, lon_deg: p.lon_deg, horizon });
  const t0 = parseUtc(p.t_start_utc), t1 = parseUtc(p.t_end_utc);
  const ser = await seriesFor(site, t0, t1, chooseStep(t1 - t0));
  assert.equal(ser.eclipses.length, 1);
  const e = ser.eclipses[0];
  assert.equal(e.max_frac, 1);
  assert.equal(e.sun_vis_at_max, 1);
  for (const [k, iso] of [
    ["start_ms", "2025-03-14T05:00:42Z"], ["total_start_ms", "2025-03-14T06:17:24Z"], ["max_ms", "2025-03-14T07:25:54Z"],
    ["total_end_ms", "2025-03-14T08:34:24Z"], ["end_ms", "2025-03-14T09:51:10Z"],
  ]) {
    assert.ok(Math.abs(e[k] - parseUtc(iso)) < 5000, `${k} ${new Date(e[k]).toISOString()} vs ${iso}`);
  }
  assert.ok(e.start_ms - t0 > 25 * MIN && t1 - e.end_ms > 25 * MIN);
  // The opening instant has no eclipse yet; totality has no sunlight; the summary counts it as dark.
  assert.equal(ser.sun_eclipse[0], 0);
  const mid = await stateAt(site, e.max_ms);
  assert.equal(mid.sun.eclipse_frac, 1);
  assert.equal(mid.sun.flux_frac, 0);
  const total = (e.total_end_ms - e.total_start_ms) / (t1 - t0);
  assert.ok(Math.abs(ser.summary.sun_vis_pct - 100 * (1 - total)) < 2, `sunlit ${ser.summary.sun_vis_pct}%`);
  // Half way into the partial phase about half the flux is gone.
  const half = await stateAt(site, parseUtc("2025-03-14T05:40:00Z"));
  assert.ok(half.sun.eclipse_frac > 0.3 && half.sun.eclipse_frac < 0.7, `ecl ${half.sun.eclipse_frac}`);
});
