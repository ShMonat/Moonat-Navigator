// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The globe's map layers: the layer list and its link format (web/js/globe/layers.js), the toggling state in the store
// and the share link (store.mapLayers, "ml" in web/js/app/state.js), and the shipped overlay data
// (web/data/overlays/, built by scripts/data/build_map_layers.py from NASA PGDA maps).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  LAYERS, LAYER_IDS, LIT_THRESHOLDS, LAYER_LIMIT_LAT, POLE_VIEW, normalizeLayers, formatLayers, parseLayers, setLayer,
  poleFor, capSamples,
} from "../js/globe/layers.js";
import { encodeHash, decodeHash } from "../js/app/state.js";
import { store, setUi, subscribe } from "../js/app/store.js";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const DIR = resolve(WEB, "data/overlays");
const manifest = JSON.parse(readFileSync(resolve(DIR, "overlays.json"), "utf8"));
const AI_NOTE = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.";

test("layer lists: known ids only, no repeats, panel order; toggling one layer keeps the other", () => {
  assert.deepEqual(LAYER_IDS, ["psr", "sun"]);
  assert.deepEqual(normalizeLayers(["sun", "psr", "sun", "lava"]), ["psr", "sun"]);
  assert.deepEqual(normalizeLayers(null), []);
  let on = [];
  on = setLayer(on, "sun", true);
  assert.deepEqual(on, ["sun"]);
  on = setLayer(on, "psr", true);
  assert.deepEqual(on, ["psr", "sun"]);
  on = setLayer(on, "sun", false);
  assert.deepEqual(on, ["psr"]);
  assert.deepEqual(setLayer(on, "psr", true), ["psr"]); // already on
  assert.deepEqual(setLayer(on, "psr", false), []);
});

test("link format: dot-separated, unknown words dropped, commas accepted", () => {
  assert.equal(formatLayers(["sun", "psr"]), "psr.sun");
  assert.equal(formatLayers([]), "");
  assert.deepEqual(parseLayers("psr.sun"), ["psr", "sun"]);
  assert.deepEqual(parseLayers("sun,psr"), ["psr", "sun"]);
  assert.deepEqual(parseLayers("x.sun"), ["sun"]);
  assert.deepEqual(parseLayers(null), []);
});

test("the share link keeps the layers; a link without them has none", () => {
  const scenarios = [{ label: "A", lat_deg: -89.45, lon_deg: -137.2, t_start_utc: "2027-01-01T00:00:00Z", t_end_utc: null, site_id: null, color: 0 }];
  const h = encodeHash({ scenarios, layers: ["sun", "psr"] });
  assert.match(h, /(^#|&)ml=psr\.sun(&|$)/);
  assert.deepEqual(decodeHash(h).layers, ["psr", "sun"]);
  const plain = encodeHash({ scenarios });
  assert.doesNotMatch(plain, /ml=/);
  assert.deepEqual(decodeHash(plain).layers, []);
  // A link with only the layers is still a Moonat link (it opens the first-visit story with the layers on).
  assert.deepEqual(decodeHash("#ml=psr").layers, ["psr"]);
  assert.equal(decodeHash(plain).scenarios.length, 1);
});

test("toggling a layer is a 'ui' change in the store, which the page writes to the link", () => {
  const seen = [];
  const off = subscribe((kind, detail) => seen.push([kind, detail]));
  assert.deepEqual(store.mapLayers, []); // off by default
  setUi({ mapLayers: setLayer(store.mapLayers, "psr", true) });
  setUi({ mapLayers: setLayer(store.mapLayers, "sun", true) });
  assert.deepEqual(store.mapLayers, ["psr", "sun"]);
  setUi({ mapLayers: setLayer(store.mapLayers, "psr", false) });
  assert.deepEqual(store.mapLayers, ["sun"]);
  off();
  assert.equal(seen.length, 3);
  assert.ok(seen.every(([k, d]) => k === "ui" && "mapLayers" in d));
  const main = readFileSync(resolve(WEB, "js/app/main.js"), "utf8");
  assert.match(main, /encodeHash\(\{[^}]*layers: store\.mapLayers/);
  setUi({ mapLayers: [] });
});

test("a layer turned on away from the poles goes to the nearer pole (south unless the view is well north)", () => {
  assert.equal(poleFor([1, 0, 0]), "south"); // near side, on the equator
  assert.equal(poleFor([0.9, 0, 0.1]), "south");
  assert.equal(poleFor([0.8, 0, 0.6]), "north");
  assert.equal(poleFor([0.8, 0, -0.6]), "south");
  assert.equal(POLE_VIEW.south.lat, -90);
  assert.equal(POLE_VIEW.north.lat, 90);
  const pts = capSamples("north");
  assert.equal(pts.length, 17);
  assert.ok(pts.every((p) => p.lat >= LAYER_LIMIT_LAT));
  assert.ok(capSamples("south").every((p) => p.lat <= -LAYER_LIMIT_LAT));
});

test("overlays.json: NASA source, AI note, the thresholds and layers the page uses", () => {
  assert.equal(manifest._generated_by, AI_NOTE);
  assert.equal(manifest.source.page, "https://pgda.gsfc.nasa.gov/products/69");
  assert.match(manifest.source.method, /Mazarico/);
  assert.deepEqual(manifest.layers.map((l) => l.id), LAYER_IDS);
  const sun = manifest.layers.find((l) => l.id === "sun");
  assert.deepEqual(sun.thresholds, LIT_THRESHOLDS);
  assert.deepEqual(LIT_THRESHOLDS, [0.7, 0.8]);
  assert.equal(sun.label, LAYERS.find((l) => l.id === "sun").label);
  assert.match(sun.note, /No point on the Moon is lit all the time/);
  // Honest wording: no "eternal light" label, and the note says that no ground is lit all the time.
  for (const l of LAYERS) assert.doesNotMatch(l.label, /eternal|always/i);
  assert.match(LAYERS.find((l) => l.id === "sun").note, /No ground is lit all the time/);
});

test("overlay images: pole-centred 2-bit palette PNGs, sizes as listed, a few hundred kB in all", () => {
  let total = 0;
  const ids = manifest.tiers.map((t) => t.id);
  assert.deepEqual(ids, ["north", "south", "south_inner"]);
  for (const t of manifest.tiers) {
    const buf = readFileSync(resolve(DIR, t.url));
    total += buf.length;
    assert.equal(manifest.bytes[t.url], statSync(resolve(DIR, t.url)).size);
    assert.equal(buf.toString("latin1", 1, 4), "PNG");
    assert.equal(buf.readUInt32BE(16), t.size); // IHDR width
    assert.equal(buf.readUInt32BE(20), t.size); // IHDR height
    assert.equal(buf[24], 2); // bit depth
    assert.equal(buf[25], 3); // palette colour type
    assert.ok(buf.includes(Buffer.from(AI_NOTE, "latin1")), `${t.url} carries the AI note`);
    // The coverage circle: half the image width in the stereographic plane, rho = 2 R tan(psi / 2).
    const halfM = (t.size / 2) * t.m_per_px;
    const psi = 2 * Math.atan(halfM / (2 * 1737400)) * (180 / Math.PI);
    assert.ok(Math.abs(psi - t.psi_max_deg) < 1e-4, t.id);
  }
  assert.ok(total < 400_000, `${total} bytes`);
  const outer = manifest.tiers.filter((t) => t.id !== "south_inner");
  for (const t of outer) assert.ok(90 - t.psi_max_deg <= LAYER_LIMIT_LAT + 0.2, `${t.id} reaches about 80°`);
  assert.equal(manifest.tiers.find((t) => t.id === "south_inner").m_per_px, 60); // NASA's full resolution near the pole
});

test("sunlit spots: poleward of 80°, each lit at least 70 % of the time", () => {
  const { fields, rows } = manifest.sun_spots;
  assert.deepEqual(fields, ["lat_deg", "lon_deg", "area_km2", "max_lit_pct"]);
  assert.ok(rows.length > 20);
  for (const [lat, lon, area, lit] of rows) {
    assert.ok(Math.abs(lat) >= LAYER_LIMIT_LAT - 0.2 && Math.abs(lon) <= 180);
    assert.ok(area > 0 && area < 5);
    assert.ok(lit >= 70 && lit < 100, String(lit));
  }
});
