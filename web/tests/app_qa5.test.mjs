// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// QA round 5 (docs/validation/qa5.md): the Layers panel shows a name and one short line per row, with the long notes
// and the sources behind an "i"; the panel keeps its head inside the map; a date-picker note keeps its long
// explanation behind an "i".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SHORT, tipText } from "../js/app/map_layers.js";
import { LAYERS, BASE_MAPS, GRID_LAYER, CONTOUR_LAYER } from "../js/globe/layers.js";
import { DAYLIGHT_LAYER } from "../js/globe/daylight.js";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(WEB, p), "utf8");

const OVERLAYS = [DAYLIGHT_LAYER, GRID_LAYER, CONTOUR_LAYER, ...LAYERS];

test("Layers panel: each row shows a short line (colour keys or SHORT), at most 45 characters", () => {
  for (const l of OVERLAYS) {
    const lines = l.swatches.length ? l.swatches.map(([, t]) => t) : [SHORT[l.id]];
    for (const t of lines) {
      assert.ok(typeof t === "string" && t.length > 0, `${l.id}: a short line`);
      assert.ok(t.length <= 45, `${l.id}: "${t}" is short`);
    }
  }
  for (const b of BASE_MAPS) {
    assert.ok(SHORT[b.id], `${b.id}: a short line`);
    assert.ok(SHORT[b.id].length <= 45, `${b.id}: short`);
  }
});

test("Layers panel: the long note and the source move into the i helper, with the science caveats kept", () => {
  for (const item of [...OVERLAYS, ...BASE_MAPS]) {
    const tip = tipText(item);
    assert.ok(tip.startsWith(item.note), `${item.id}: the tip starts with the note`);
    if (item.source) assert.match(tip, new RegExp(`Source: ${item.source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.$`));
  }
  assert.match(tipText(DAYLIGHT_LAYER), /smooth Moon/);
  assert.match(tipText(LAYERS.find((l) => l.id === "sun")), /No ground is lit all the time/);
  // The panel no longer prints the notes and sources as text rows.
  const src = read("js/app/map_layers.js");
  assert.doesNotMatch(src, /el\("span", "glayer-note", layer\.note\)/);
  assert.doesNotMatch(src, /el\("span", "glayer-src"/);
  assert.match(src, /infoTip\(tipText\(/);
});

test("Layers panel: it fits inside the map (the head was clipped on a short map); a click in a popover keeps the box", () => {
  const src = read("js/app/map_layers.js");
  assert.match(src, /function fit\(\)/);
  assert.match(src, /panel\.style\.maxHeight = /);
  assert.match(src, /if \(e\.target\.closest\?\.\("\.info-pop"\)\) e\.preventDefault\(\);/);
});

test("empty state: a card that holds a place (a too-long trip leg) gets 'Almost there', not 'Pick a place'", () => {
  const src = read("js/app/main.js");
  assert.match(src, /pending: \["Almost there: check the place and time"/);
  assert.match(src, /emptyText\(store\.scenarios\.some\(\(s\) => s\.site_id \|\| s\.route \|\| s\.lat_deg !== null \|\| s\.lon_deg !== null\)\)/);
  // The page's own markup keeps the "no place yet" words, which EMPTY_TEXT.none repeats.
  const html = read("index.html");
  assert.match(html, /<h2>Pick a place on the Moon and a time<\/h2>/);
  assert.match(src, /none: \["Pick a place on the Moon and a time", "Search the Moon, click the globe, or start a story:"\]/);
  assert.match(html, /<p>Search the Moon, click the globe, or start a story:<\/p>/);
});

test("date picker: a note (Earth always in view, no contact) keeps its long detail behind an i", () => {
  const src = read("js/app/time_picker.js");
  assert.match(src, /import \{ infoTip \} from "\.\/info_tip\.js";/);
  assert.match(src, /infoTip\(g\.detail/);
  assert.doesNotMatch(src, /class: "si-detail", text: g\.detail/);
});
