// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The map's interaction rules (Shay's feedback, 2026-11-15): the zoom limits (geo.js), the snap onto sunlit-spot
// markers (geo.js snapTarget), the name of a place picked on a spot, the "Stories" group of the search list
// (place_search.js storyResults), the legend's sun icon (icons.js) and the page's map key (index.html).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MIN_ZOOM, MAX_ZOOM, FIT_MAX_ZOOM, viewSpanKm, snapTarget, SNAP_PX, R_MOON_KM, latLonToVec, vecToLatLon, projectPx } from "../js/globe/geo.js";
import { spotLabel, isSpotLabel, storyResults, STORY_META } from "../js/app/place_search.js";
import { QUICK_STARTS } from "../js/app/catalog.js";
import { sunSpotIcon, ICON_NAMES } from "../js/app/icons.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const HTML = read("../index.html");

test("zoom limits: in to about 1.5 km across, out unchanged, automatic fits capped at about 60 km", () => {
  assert.equal(MIN_ZOOM, 0.9);
  assert.equal(FIT_MAX_ZOOM, 60);
  const km = viewSpanKm(MAX_ZOOM);
  assert.ok(km >= 1 && km <= 2, `${km} km`);
  assert.ok(Math.abs(viewSpanKm(60) - 61.4) < 0.1); // the old limit
  assert.ok(Math.abs(viewSpanKm(1) - 2 * 1.06 * R_MOON_KM) < 1e-9);
});

test("deep zoom: projection stays exact to a fraction of a pixel near the south pole and at Apollo 11", () => {
  for (const [lat, lon] of [[-89.9, 45], [-89.4395, -137.1934], [0.67416, 23.47314]]) {
    const dir = latLonToVec(lat, lon);
    const up = Math.abs(lat) > 75 ? null : [0, 0, 1];
    // A view straight down on the place, north up (or toward 0 E near the pole), at the deepest zoom.
    const u0 = up ?? [-Math.cos(lon * Math.PI / 180), -Math.sin(lon * Math.PI / 180), 0];
    const d = dir;
    const k = u0[0] * d[0] + u0[1] * d[1] + u0[2] * d[2];
    const u = [u0[0] - k * d[0], u0[1] - k * d[1], u0[2] - k * d[2]];
    const n = Math.hypot(...u);
    const view = { dir: d, up: u.map((x) => x / n), zoom: MAX_ZOOM };
    const W = 800, H = 600;
    // A point 100 m east of the place lands about 100 m / (span / H) px from the centre, and back.
    const pxPerKm = H / viewSpanKm(MAX_ZOOM);
    const east = latLonToVec(lat, lon + (0.1 / R_MOON_KM) / Math.cos(lat * Math.PI / 180) * 180 / Math.PI);
    const pc = projectPx(view, dir, W, H);
    const pe = projectPx(view, east, W, H);
    assert.ok(Math.abs(pc.x - W / 2) < 1e-6 && Math.abs(pc.y - H / 2) < 1e-6);
    const dist = Math.hypot(pe.x - pc.x, pe.y - pc.y);
    assert.ok(Math.abs(dist - 0.1 * pxPerKm) < 0.05 * pxPerKm * 0.1 + 0.5, `${dist} px vs ${0.1 * pxPerKm}`);
    const back = vecToLatLon(dir);
    assert.ok(Math.abs(back.lat - lat) < 1e-9);
  }
});

test("snapTarget: within 12 px of a sun symbol it snaps, beyond it does not; the nearest wins; the limb never snaps", () => {
  assert.equal(SNAP_PX, 12);
  const a = { x: 100, y: 100, rPx: 0.5, depth: 0.9, id: "a" };
  const b = { x: 120, y: 100, rPx: 0.5, depth: 0.9, id: "b" };
  assert.equal(snapTarget([a, b], 108, 100)?.id, "a");
  assert.equal(snapTarget([a, b], 113, 100)?.id, "b");
  assert.equal(snapTarget([a], 111.9, 100)?.id, "a");
  assert.equal(snapTarget([a], 112.1, 100), null);
  assert.equal(snapTarget([{ ...a, depth: 0.01 }], 100, 100), null);
  // A ring of 30 px (deeper zoom) reaches its edge + 4 px; a huge one at most 40 px.
  assert.equal(snapTarget([{ ...a, rPx: 30 }], 133, 100)?.id, "a");
  assert.equal(snapTarget([{ ...a, rPx: 300 }], 141, 100), null);
  assert.equal(snapTarget([], 0, 0), null);
});

test("a place picked on a sunlit spot is named after its share of sunlight, and that name is automatic", () => {
  assert.equal(spotLabel(88.2), "Sunlit spot, lit 88 %");
  assert.equal(spotLabel(89.6), "Sunlit spot, lit 90 %");
  assert.ok(isSpotLabel(spotLabel(83.6)));
  assert.ok(!isSpotLabel("My ridge"));
  assert.ok(!isSpotLabel("Point 89.4° S, 137.2° W"));
});

test("Stories group: every quick start, in order, with its key, an icon and a one-line subtitle", () => {
  const all = storyResults("", QUICK_STARTS);
  assert.deepEqual(all.map((s) => s.key), QUICK_STARTS.map((q) => q.key));
  for (const s of all) {
    assert.ok(STORY_META[s.key], s.key);
    assert.ok(ICON_NAMES.includes(s.icon), `${s.key}: ${s.icon}`);
    assert.ok(s.sub.length > 10 && s.sub.length <= 64 && !s.sub.includes("\n"), s.sub);
    assert.equal(s.label, QUICK_STARTS.find((q) => q.key === s.key).label);
  }
});

test("Stories group: typing filters by name (case, accents and apostrophes ignored); coordinates show none", () => {
  assert.deepEqual(storyResults("apollo", QUICK_STARTS).map((s) => s.key), ["apollo11", "apollo-all"]);
  assert.deepEqual(storyResults("ECLIPSE", QUICK_STARTS).map((s) => s.key), ["eclipse"]);
  assert.deepEqual(storyResults("change 4", QUICK_STARTS).map((s) => s.key), ["farside"]);
  assert.deepEqual(storyResults("rover", QUICK_STARTS).map((s) => s.key), ["rover"]);
  assert.deepEqual(storyResults("zzz", QUICK_STARTS), []);
  assert.deepEqual(storyResults("89.5S 130E", QUICK_STARTS), []);
});

test("the legend's sun icon is the globe's sun marker (disc of 3 px, eight rays 4.5 to 8.2 px) in the class colour", () => {
  const svg = sunSpotIcon("#ffe14d");
  assert.match(svg, /<circle r="3" stroke="none"\/>/);
  assert.equal((svg.match(/M/g) || []).length, 16); // eight rays, drawn twice (the dark edge, then the colour)
  assert.match(svg, /fill="#ffe14d"/);
  assert.match(svg, /aria-hidden="true"/);
});

test("the map key ends with an 'i' button whose popover holds the how-to hint; no hint paragraph under the map", () => {
  const legend = /<ul class="map-legend"[\s\S]*?<\/ul>/.exec(HTML)[0];
  assert.match(legend, /<button type="button" class="map-info" id="map-info" aria-label="How to use the map"/);
  assert.match(legend, /id="map-hint-pop" role="tooltip" hidden>/);
  assert.match(legend, /Drag to turn, scroll to zoom\./);
  assert.doesNotMatch(HTML, /<p class="map-hint"/);
});
