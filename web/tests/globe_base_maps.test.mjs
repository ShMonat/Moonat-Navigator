// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The globe's base map (Imagery / Elevation / Plain), grid lines and contour lines: the style helpers and the "ml"
// link format (web/js/globe/layers.js), old and new links through the share hash (web/js/app/state.js), the panel
// state in the store (store.mapStyle), and the shipped LOLA data (web/data/basemaps/, scripts/data/build_base_maps.py).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  BASE_MAPS, BASE_IDS, DEFAULT_STYLE, ELEV_RAMP, CONTOURS, CONTOUR_LAYER, GRID_LAYER, normalizeBase, normalizeStyle,
  parseStyle, formatMapLink, parseLayers, parseDaylight, intervalText,
} from "../js/globe/layers.js";
import { encodeHash, decodeHash } from "../js/app/state.js";
import { store, setUi, subscribe } from "../js/app/store.js";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const DIR = resolve(WEB, "data/basemaps");
const manifest = JSON.parse(readFileSync(resolve(DIR, "basemaps.json"), "utf8"));
const AI_NOTE = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.";
const scenarios = [{ label: "A", lat_deg: -89.45, lon_deg: -137.2, t_start_utc: "2027-01-01T00:00:00Z", t_end_utc: null, site_id: null, color: 0 }];

test("base maps: Imagery first (the default), then Elevation and Plain; unknown ids fall back to Imagery", () => {
  assert.deepEqual(BASE_IDS, ["imagery", "elevation", "plain"]);
  assert.deepEqual(BASE_MAPS.map((b) => b.label), ["Imagery", "Elevation", "Plain"]);
  assert.equal(normalizeBase("plain"), "plain");
  assert.equal(normalizeBase("satellite"), "imagery");
  assert.equal(normalizeBase(undefined), "imagery");
  assert.deepEqual(DEFAULT_STYLE, { base: "imagery", grid: true, contours: false });
});

test("style: grid on and contours off unless said otherwise", () => {
  assert.deepEqual(normalizeStyle(null), DEFAULT_STYLE);
  assert.deepEqual(normalizeStyle({}), DEFAULT_STYLE);
  assert.deepEqual(normalizeStyle({ base: "elevation" }), { base: "elevation", grid: true, contours: false });
  assert.deepEqual(normalizeStyle({ grid: false, contours: 1, base: "x" }), { base: "imagery", grid: false, contours: true });
});

test("ml link: the default style writes nothing; each change adds one short word", () => {
  assert.equal(formatMapLink([], true), "");
  assert.equal(formatMapLink([], true, DEFAULT_STYLE), "");
  assert.equal(formatMapLink([], true, { base: "elevation" }), "elev");
  assert.equal(formatMapLink([], true, { base: "plain" }), "plain");
  assert.equal(formatMapLink([], true, { grid: false }), "nogrid");
  assert.equal(formatMapLink([], true, { contours: true }), "ct");
  assert.equal(formatMapLink(["sun", "psr"], false, { base: "elevation", grid: false, contours: true }), "psr.sun.ct.elev.noday.nogrid");
});

test("ml link: new values round-trip, and the old words still read the same", () => {
  for (const base of BASE_IDS) {
    for (const grid of [true, false]) {
      for (const contours of [true, false]) {
        const s = { base, grid, contours };
        const ml = formatMapLink(["psr"], false, s);
        assert.deepEqual(parseStyle(ml), s, ml);
        assert.deepEqual(parseLayers(ml), ["psr"], ml);
        assert.equal(parseDaylight(ml), false, ml);
      }
    }
  }
  // Links from before the base maps: the default style.
  for (const old of [null, "", "psr", "psr.sun", "sun.noday", "psr,sun"]) assert.deepEqual(parseStyle(old), DEFAULT_STYLE, String(old));
  // Unknown words are ignored.
  assert.deepEqual(parseStyle("terrain.foo"), DEFAULT_STYLE);
});

test("share hash: the style rides in 'ml'; old hashes open with the default style", () => {
  const h = encodeHash({ scenarios, layers: ["psr"], daylight: true, style: { base: "plain", grid: false, contours: true } });
  assert.match(h, /(^#|&)ml=psr\.ct\.plain\.nogrid(&|$)/);
  const d = decodeHash(h);
  assert.deepEqual(d.style, { base: "plain", grid: false, contours: true });
  assert.deepEqual(d.layers, ["psr"]);
  assert.equal(d.daylight, true);
  const plainHash = encodeHash({ scenarios });
  assert.doesNotMatch(plainHash, /ml=/);
  assert.deepEqual(decodeHash(plainHash).style, DEFAULT_STYLE);
  const old = decodeHash("#ml=psr.sun.noday");
  assert.deepEqual(old.style, DEFAULT_STYLE);
  assert.deepEqual(old.layers, ["psr", "sun"]);
  assert.equal(old.daylight, false);
  assert.deepEqual(decodeHash("#ml=elev").style, { base: "elevation", grid: true, contours: false });
});

test("panel state: store.mapStyle starts at the default; each choice is one 'ui' change the page writes to the link", () => {
  assert.deepEqual(store.mapStyle, DEFAULT_STYLE);
  const seen = [];
  const off = subscribe((kind, detail) => seen.push([kind, detail]));
  setUi({ mapStyle: normalizeStyle({ ...store.mapStyle, base: "elevation" }) });
  setUi({ mapStyle: normalizeStyle({ ...store.mapStyle, contours: true }) });
  setUi({ mapStyle: normalizeStyle({ ...store.mapStyle, grid: false }) });
  assert.deepEqual(store.mapStyle, { base: "elevation", grid: false, contours: true });
  off();
  assert.equal(seen.length, 3);
  assert.ok(seen.every(([k, d]) => k === "ui" && "mapStyle" in d));
  const main = readFileSync(resolve(WEB, "js/app/main.js"), "utf8");
  assert.match(main, /style: store\.mapStyle/);
  const panel = readFileSync(resolve(WEB, "js/app/map_layers.js"), "utf8");
  assert.match(panel, /"mapStyle" in detail/);
  setUi({ mapStyle: normalizeStyle(null) });
});

test("panel wording: the contour row and legend name the intervals; the grid row is on by default", () => {
  assert.equal(intervalText(1000), "1 km");
  assert.equal(intervalText(250), "250 m");
  assert.match(CONTOUR_LAYER.note, /every 1 km \(bold every 5 km\); poleward of 80°, every 250 m \(bold every 1 km\)/);
  assert.match(CONTOUR_LAYER.swatches[0][1], /1 km; 250 m poleward of 80°/);
  assert.equal(GRID_LAYER.label, "Grid lines");
});

test("basemaps.json: AI note, LOLA source, ramp and contour intervals as the page states them", () => {
  assert.equal(manifest._generated_by, AI_NOTE);
  assert.match(manifest.source.name, /LOLA/);
  assert.deepEqual(manifest.elevation.ramp.range_km, ELEV_RAMP.rangeKm);
  assert.deepEqual(manifest.elevation.ramp.stops.map((s) => s.hex), ELEV_RAMP.stops);
  assert.equal(manifest.elevation.ramp.reference_radius_km, 1737.4);
  assert.equal(manifest.contours.global.interval_m, CONTOURS.global.intervalM);
  assert.equal(manifest.contours.global.index_every, CONTOURS.global.indexEvery);
  for (const c of manifest.contours.caps) {
    assert.equal(c.interval_m, CONTOURS.caps.intervalM);
    assert.equal(c.index_every, CONTOURS.caps.indexEvery);
    assert.ok(c.psi_max_deg >= 90 - CONTOURS.switchLatDeg, "the cap images reach the switch latitude");
  }
  assert.equal(manifest.contours.switch_lat_deg, CONTOURS.switchLatDeg);
  assert.deepEqual(manifest.contours.caps.map((c) => c.pole).sort(), [-1, 1]);
});

test("basemaps files: present, sizes as listed, about 3 MB in all, each base map under 1.5 MB", () => {
  let total = 0;
  for (const [name, bytes] of Object.entries(manifest.bytes)) {
    assert.equal(statSync(resolve(DIR, name)).size, bytes, name);
    total += bytes;
  }
  assert.ok(total < 4e6, `total ${total}`);
  for (const kind of ["elevation", "plain"]) {
    const files = [manifest[kind].global.url, ...manifest[kind].caps.map((c) => c.url)];
    const sum = files.reduce((a, f) => a + manifest.bytes[f], 0);
    assert.ok(sum < 1.5e6, `${kind}: ${sum}`);
  }
});
