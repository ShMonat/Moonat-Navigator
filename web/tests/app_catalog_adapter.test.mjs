// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Tests for the catalog helpers (search, quick starts against the real sites.json) and the C6 adapter (real ephemeris).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { searchSites, QUICK_STARTS, scenarioFieldsFromSite, isTrimmedMission, matchSite } from "../js/app/catalog.js";
import { initPhysics, physicsCoverage, siteFor, stateAt, seriesFor } from "../js/app/physics_adapter.js";
import { makeSite } from "../js/physics/index.js";
import { fileFetch } from "./physics_helpers.mjs";
import { validateScenario, makeScenario, parseUtc, DAY_MS } from "../js/app/state.js";

const sitesUrl = new URL("../data/sites.json", import.meta.url);
const SITES = JSON.parse(readFileSync(fileURLToPath(sitesUrl), "utf8")).sites;

test("searchSites matches names, crew and agencies, ranking name hits first", () => {
  const r = searchSites("apollo 11", SITES);
  assert.equal(r[0].id, "apollo11");
  assert.ok(searchSites("armstrong", SITES).some((s) => s.id === "apollo11"));
  assert.ok(searchSites("chang", SITES).every((s) => /chang/i.test(s.name)));
  assert.ok(searchSites("", SITES).length === SITES.length);
  assert.equal(searchSites("zzzz-no-such-site", SITES).length, 0);
  // The candidate regions are found by their programme name, which only their group label carries.
  const artemis = searchSites("artemis", SITES);
  assert.ok(artemis.length >= 9 && artemis.every((s) => s.kind === "candidate"), artemis.map((s) => s.id).join());
});

test("every quick start resolves to valid scenarios against the real catalog", () => {
  for (const q of QUICK_STARTS) {
    const list = q.resolve(SITES);
    assert.ok(list.length >= 1, q.key);
    for (const p of list) {
      const v = validateScenario(makeScenario(p));
      assert.ok(v.ok, `${q.key}: ${JSON.stringify(v.errors)}`);
      assert.ok(p.site_id || p.route, `${q.key} uses a catalog site (or is a rover traverse)`);
    }
  }
  assert.equal(QUICK_STARTS.find((q) => q.key === "apollo-all").resolve(SITES).length, 6);
});

test("Beresheet is in the catalog: the LROC impact point, the crash time, sourced, with its LOLA terrain files", () => {
  const b = matchSite(["beresheet"], null, null, SITES);
  assert.equal(b.kind, "mission");
  assert.equal(b.name, "Beresheet (SpaceIL)");
  assert.equal(b.agency, "SpaceIL");
  assert.equal(b.outcome, "crash");
  assert.equal(b.lat_deg, 32.5956); // LROC: darkest pixel of the impact smudge
  assert.equal(b.lon_deg, 19.3496);
  assert.equal(b.t_start_utc, "2019-04-11T19:23:00Z"); // loss of signal
  // One lunar day-night cycle after the crash (29.53 d), inside the 2013-2040 sky tables; not trimmed.
  const span = parseUtc(b.t_end_utc) - parseUtc(b.t_start_utc);
  assert.ok(Math.abs(span / DAY_MS - 29.53) < 0.01, span);
  assert.ok(validateScenario(makeScenario(scenarioFieldsFromSite(b)), physicsCoverage() || [2019]).ok);
  assert.match(b.blurb, /tardigrades/);
  assert.ok(b.sources.some((u) => u.endsWith("/images/1101")), "LROC impact-site release");
  assert.ok(b.sources.includes("https://doi.org/10.1089/ast.2020.2405"), "Traspas & Burchell 2021");
  const h = JSON.parse(readFileSync(fileURLToPath(new URL("../data/horizons/beresheet.json", import.meta.url)), "utf8"));
  assert.equal(h.el_deg.length, 1440);
  assert.equal(h.lat_deg, b.lat_deg);
  assert.equal(h.lon_deg, b.lon_deg);
  assert.match(h.dem_sources[0], /SLDEM2015/);
  // A flat mare: the skyline stays within about a degree of the horizontal everywhere.
  assert.ok(Math.max(...h.el_deg) < 1.5 && Math.min(...h.el_deg) > -1);
  const t = JSON.parse(readFileSync(fileURLToPath(new URL("../data/terrain/beresheet.json", import.meta.url)), "utf8"));
  assert.equal(t.lat_deg, b.lat_deg);
  assert.equal(t.ground_elev_m, h.ground_elev_m);
});

test("long catalog missions load trimmed to 30 days", () => {
  const lunokhod = matchSite(["luna17"], null, null, SITES);
  const f = scenarioFieldsFromSite(lunokhod);
  assert.equal(parseUtc(f.t_end_utc) - parseUtc(f.t_start_utc), 30 * DAY_MS);
  assert.ok(isTrimmedMission(f, lunokhod));
  const a11 = matchSite(["apollo11"], null, null, SITES);
  assert.equal(scenarioFieldsFromSite(a11).t_end_utc, a11.t_end_utc);
});

const C6_SUN = ["az_deg", "el_deg", "dist_km", "ang_radius_deg", "vis_frac", "flux_frac", "enu"];
const C6_EARTH = ["az_deg", "el_deg", "dist_km", "ang_radius_deg", "vis_frac", "phase_frac", "enu", "sun_dir_enu", "era_deg"];
const C6_SERIES = ["t_ms", "sun_el", "sun_az", "sun_vis", "flux_horiz_wm2", "flux_normal_wm2", "earth_el", "earth_az", "earth_vis", "earth_phase", "earth_ang_diam_deg"];

const ephemDir = fileURLToPath(new URL("../data/ephem", import.meta.url));

test("adapter loads the real ephemeris and returns the C6 shape", async () => {
  assert.equal(await initPhysics(ephemDir, { fetch: fileFetch }), true);
  assert.ok(physicsCoverage().includes(1969) && physicsCoverage().includes(2040));
  const { site, horizon } = await siteFor({ lat_deg: 0.6741, lon_deg: 23.473, site_id: null });
  // A custom point gets the approximate horizon from the DEM tiles (web/data/dem next to the ephemeris).
  assert.equal(horizon.approximate, true);
  assert.equal(horizon.label, "approximate terrain (coarse)");
  assert.equal(horizon.el_deg.length, 720);
  assert.equal(site.horizon, horizon);
  const t = Date.UTC(1969, 6, 20, 20, 17, 40);
  const s = await stateAt(site, t);
  assert.equal(s.t_ms, t);
  for (const k of C6_SUN) assert.ok(k in s.sun, `sun.${k}`);
  for (const k of C6_EARTH) assert.ok(k in s.earth, `earth.${k}`);
  assert.ok(Array.isArray(s.planets));
  assert.equal(s.r_icrs_to_enu.length, 9);
  // Apollo 11 landed with the Sun ~10.7° up in the east, Earth high in the western sky and gibbous.
  assert.ok(Math.abs(s.sun.el_deg - 10.7) < 0.5, `sun el ${s.sun.el_deg}`);
  assert.ok(s.sun.az_deg > 85 && s.sun.az_deg < 95, `sun az ${s.sun.az_deg}`);
  assert.ok(s.earth.el_deg > 55 && s.earth.az_deg > 250 && s.earth.az_deg < 290);
  assert.ok(s.earth.phase_frac > 0.6 && s.earth.phase_frac < 0.75);

  const ser = await seriesFor(site, t, t + 6 * 3600e3, 600e3);
  for (const k of C6_SERIES) assert.equal(ser[k].length, ser.t_ms.length, k);
  for (const k of ["sun_vis_pct", "earth_vis_pct", "next_sunset_ms", "next_earthset_ms", "mean_flux_horiz_wm2"]) assert.ok(k in ser.summary, k);
});

test("south-pole quick start: the Sun skims the horizon and the terrain switches it on and off", async () => {
  await initPhysics(ephemDir, { fetch: fileFetch });
  const [p] = QUICK_STARTS.find((q) => q.key === "pole").resolve(SITES);
  const horizon = JSON.parse(readFileSync(fileURLToPath(new URL(`../data/horizons/${p.site_id}.json`, import.meta.url)), "utf8"));
  const site = makeSite({ lat_deg: p.lat_deg, lon_deg: p.lon_deg, horizon });
  const ser = await seriesFor(site, parseUtc(p.t_start_utc), parseUtc(p.t_end_utc), 3600e3);
  // Near the pole the Sun's elevation stays within the subsolar latitude (|b| <= 1.6 deg) plus the colatitude.
  const colat = 90 - Math.abs(p.lat_deg);
  assert.ok(Math.max(...ser.sun_el.map(Math.abs)) < 1.6 + colat, `sun el ${Math.min(...ser.sun_el)}..${Math.max(...ser.sun_el)}`);
  let sunsets = 0;
  for (let i = 1; i < ser.sun_vis.length; i++) if (ser.sun_vis[i - 1] > 0 && ser.sun_vis[i] === 0) sunsets++;
  assert.ok(sunsets >= 2, `sunsets ${sunsets}`);
  assert.ok(ser.summary.sun_vis_pct > 50 && ser.summary.sun_vis_pct < 95, `sunlit ${ser.summary.sun_vis_pct}%`);
  // The opening instant: the Sun fully up and above the local horizontal (long shadows), and the Earth clearly up.
  assert.ok(ser.sun_el[0] > 0 && ser.sun_vis[0] > 0.99, `T+0 sun el ${ser.sun_el[0]} vis ${ser.sun_vis[0]}`);
  assert.ok(ser.earth_el[0] > 3 && ser.earth_vis[0] > 0.99, `T+0 earth el ${ser.earth_el[0]} vis ${ser.earth_vis[0]}`);
  // A long window plays in about a minute at the fastest speed (1 day per second), and stays under the 120-day limit.
  assert.ok(ser.t_ms[ser.t_ms.length - 1] - ser.t_ms[0] <= 70 * DAY_MS);
});

test("far side: Earth never rises at Chang'e 4", async () => {
  await initPhysics(ephemDir, { fetch: fileFetch });
  const { site } = await siteFor({ lat_deg: -45.4561, lon_deg: 177.5885, site_id: null });
  const t0 = Date.UTC(2019, 0, 3);
  const ser = await seriesFor(site, t0, t0 + 30 * DAY_MS, 6 * 3600e3);
  assert.equal(Math.max(...ser.earth_vis), 0);
  assert.ok(Math.max(...ser.earth_el) < -20);
});
