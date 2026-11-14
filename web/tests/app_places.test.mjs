// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// "Search the Moon" (web/js/app/place_search.js): typed coordinates, the grouped result list, the home base entry.
// Run: node --test web/tests/app_places.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseLatLon, fmtSigned, fmtHemi, placeResults, siteSubtitle, areaOf } from "../js/app/place_search.js";
import { HOME_SITE_ID, searchSites } from "../js/app/catalog.js";

const SITES = JSON.parse(readFileSync(fileURLToPath(new URL("../data/sites.json", import.meta.url)), "utf8")).sites;

test("parseLatLon: signed pairs, hemisphere letters before or after, degree signs, longitude first with letters", () => {
  assert.deepEqual(parseLatLon("-89.5, 130"), { lat: -89.5, lon: 130 });
  assert.deepEqual(parseLatLon("-89.5 130"), { lat: -89.5, lon: 130 });
  assert.deepEqual(parseLatLon("89.5S 130E"), { lat: -89.5, lon: 130 });
  assert.deepEqual(parseLatLon("89.5° S, 130° E"), { lat: -89.5, lon: 130 });
  assert.deepEqual(parseLatLon("89.5s 130w"), { lat: -89.5, lon: -130 });
  assert.deepEqual(parseLatLon("S89.5 E130"), { lat: -89.5, lon: 130 });
  assert.deepEqual(parseLatLon("130E 89.5S"), { lat: -89.5, lon: 130 });
  assert.deepEqual(parseLatLon("0.674 N 23.473 E"), { lat: 0.674, lon: 23.473 });
  assert.deepEqual(parseLatLon("−45.44, 177.6"), { lat: -45.44, lon: 177.6 }); // a typographic minus
  assert.deepEqual(parseLatLon("10; 200"), { lat: 10, lon: -160 }); // 200 E = 160 W
  assert.deepEqual(parseLatLon("-90 0"), { lat: -90, lon: 0 });
});

test("parseLatLon: not coordinates", () => {
  for (const q of ["", "apollo 11", "Apollo 11 12", "91 10", "10 400", "10N 20N", "10E 20E", "10", "N S", "1, 2, 3", "1.5.3"]) {
    assert.equal(parseLatLon(q), null, q);
  }
});

test("coordinate formats: signed with a true minus, and with hemispheres", () => {
  assert.equal(fmtSigned(-89.5, 130), "−89.50°, 130.00°");
  assert.equal(fmtHemi(-89.5, -130), "89.50° S, 130.00° W");
  assert.equal(fmtHemi(0.674, 23.473, 3), "0.674° N, 23.473° E");
});

test("the empty search lists Home first, then missions, Artemis III regions and places of interest", () => {
  const r = placeResults("", SITES);
  assert.equal(r.coords, null);
  assert.equal(r.home?.id, HOME_SITE_ID);
  assert.deepEqual(r.groups.map((g) => g.kind), ["mission", "candidate", "poi"]);
  const listed = r.groups.flatMap((g) => g.sites).length + 1;
  assert.equal(listed, SITES.length, "every catalog place is listed once");
  assert.ok(r.groups.every((g) => g.sites.every((s) => s.kind === g.kind && s.kind !== "home")));
  assert.equal(r.groups[0].label, "Missions");
  assert.equal(r.groups[1].label, "Artemis III candidate regions");
});

test("typing filters (searchSites); 'home' and 'starhab' find the home base; coordinates offer Go to", () => {
  const apollo = placeResults("apollo", SITES);
  assert.equal(apollo.home, null);
  assert.deepEqual(apollo.groups.map((g) => g.kind), ["mission"]);
  assert.deepEqual(apollo.groups[0].sites.slice(0, 6).map((s) => s.id), ["apollo11", "apollo12", "apollo14", "apollo15", "apollo16", "apollo17"]);
  assert.equal(placeResults("home", SITES).home?.id, HOME_SITE_ID);
  assert.equal(placeResults("starhab", SITES).home?.id, HOME_SITE_ID);
  const armstrong = placeResults("armstrong", SITES).groups.flatMap((g) => g.sites).map((s) => s.id);
  assert.deepEqual(armstrong, ["apollo11"]);
  const c = placeResults("89.5S 130E", SITES);
  assert.deepEqual(c.coords, { lat: -89.5, lon: 130 });
  assert.equal(c.groups.length, 0);
  // The search is still searchSites for the catalog part.
  assert.deepEqual(placeResults("malapert", SITES).groups.flatMap((g) => g.sites).map((s) => s.id).sort(),
    searchSites("malapert", SITES).map((s) => s.id).sort());
});

test("the home base is StarHab, kind home, on the Shackleton rim reference point until its site is set", () => {
  const home = SITES.find((s) => s.id === HOME_SITE_ID);
  const rim = SITES.find((s) => s.id === "shackleton_rim");
  assert.equal(home.kind, "home");
  assert.match(home.name, /StarHab/);
  // PLACEHOLDER[starhab-coords]: same point as shackleton_rim (scripts/catalog/build_sites.py STARHAB_LAT_LON).
  assert.equal(home.lat_deg, rim.lat_deg);
  assert.equal(home.lon_deg, rim.lon_deg);
  assert.match(home.notes, /PLACEHOLDER\[starhab-coords\]/);
  // Its terrain files exist (built like any catalog site), so the home's sky has the real LOLA horizon.
  const h = JSON.parse(readFileSync(fileURLToPath(new URL(`../data/horizons/${HOME_SITE_ID}.json`, import.meta.url)), "utf8"));
  assert.equal(h.el_deg.length, 1440);
  assert.equal(h.lat_deg, home.lat_deg);
  assert.equal(h.lon_deg, home.lon_deg);
});

test("subtitles: agency, year and crew for missions; region for candidates; where the home base is", () => {
  const a11 = SITES.find((s) => s.id === "apollo11");
  assert.equal(siteSubtitle(a11), "NASA · 1969 · Neil Armstrong & Buzz Aldrin");
  const cand = SITES.find((s) => s.kind === "candidate");
  assert.match(siteSubtitle(cand), /^Artemis III region · south pole · approximate point$/);
  assert.equal(siteSubtitle(SITES.find((s) => s.id === HOME_SITE_ID)), "Lunar base concept (IAC 2021) · south pole");
  assert.equal(areaOf(0, 23), "near side");
  assert.equal(areaOf(-45, 177.6), "far side");
  assert.equal(areaOf(-45, -95), "far side");
  assert.equal(areaOf(85, 0), "north pole");
});
