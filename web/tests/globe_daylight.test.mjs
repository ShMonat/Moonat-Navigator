// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The globe's day and night (web/js/globe/daylight.js): the shading model and its shader code, the moment shown and
// its caption, the switch in the store and the share link ("ml=noday" when off, web/js/globe/layers.js and
// web/js/app/state.js), and the wiring in the globe and the page.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  TERMINATOR_HALF_DEG, NIGHT_RGB, LAYER_NIGHT_SHARE, DAYLIGHT_UNIFORMS_GLSL, DAYLIGHT_FUNCS_GLSL, DAYLIGHT_LAYER, DAYLIGHT_NOTE,
  smoothstep, daylightAt, pickMoment, daylightCaption, diskCover,
} from "../js/globe/daylight.js";
import { occultedFluxFraction } from "../js/physics/eclipse.js";
import { NO_DAYLIGHT, formatMapLink, parseDaylight } from "../js/globe/layers.js";
import { encodeHash, decodeHash } from "../js/app/state.js";
import { store, setUi, subscribe } from "../js/app/store.js";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(resolve(WEB, rel), "utf8");
const D = Math.PI / 180;

test("shading model: day where the Sun is up, night where it is down, a soft edge 1° wide", () => {
  const sun = [1, 0, 0]; // sub-solar point at 0° N, 0° E
  assert.equal(daylightAt(0, 0, sun).lit, 1);
  assert.equal(daylightAt(0, 180, sun).lit, 0);
  assert.ok(Math.abs(daylightAt(0, 0, sun).sun_el_deg - 90) < 1e-9);
  // On the terminator (90° from the sub-solar point) the Sun's centre is on the horizon: half lit.
  const edge = daylightAt(0, 90, sun);
  assert.ok(Math.abs(edge.sun_el_deg) < 1e-9);
  assert.ok(Math.abs(edge.lit - 0.5) < 1e-12);
  assert.equal(daylightAt(0, 90 - TERMINATOR_HALF_DEG, sun).lit, 1);
  assert.equal(daylightAt(0, 90 + TERMINATOR_HALF_DEG, sun).lit, 0);
  assert.ok(daylightAt(0, 89.8, sun).lit > 0.5 && daylightAt(0, 89.8, sun).lit < 1);
  // The edge is wider than the Sun's disk (0.53°) but stays narrow (about 1°).
  assert.ok(2 * TERMINATOR_HALF_DEG >= 0.53 && 2 * TERMINATOR_HALF_DEG <= 1.2);
  // A pole sees the Sun at the sub-solar latitude: 1.5° up when the sub-solar point is at 1.5° S, seen from the south.
  const s = [Math.cos(-1.5 * D), 0, Math.sin(-1.5 * D)];
  assert.ok(Math.abs(daylightAt(-90, 0, s).sun_el_deg - 1.5) < 1e-9);
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
});

test("night is dimmed to 25-35 % with a slight cool tint; the layer colours dim less", () => {
  const mean = NIGHT_RGB.reduce((a, b) => a + b, 0) / 3;
  assert.ok(mean >= 0.25 && mean <= 0.35, `mean ${mean}`);
  assert.ok(NIGHT_RGB[2] > NIGHT_RGB[1] && NIGHT_RGB[1] >= NIGHT_RGB[0], "blue above green above red");
  assert.ok(NIGHT_RGB[2] / NIGHT_RGB[0] < 1.5, "only a slight tint");
  assert.ok(LAYER_NIGHT_SHARE > 0 && LAYER_NIGHT_SHARE < 1);
});

test("the shader code: one uniform for the Sun direction, an on/off switch, and the globe uses them", () => {
  for (const u of ["uniform vec3 uSunDir", "uniform float uDayOn", "uniform vec3 cNight"]) assert.ok(DAYLIGHT_UNIFORMS_GLSL.includes(u), u);
  assert.match(DAYLIGHT_FUNCS_GLSL, /float daylight\(vec3 u\)/);
  assert.match(DAYLIGHT_FUNCS_GLSL, /fwidth\(h\)/); // at least one screen pixel wide: no aliasing
  const half = Number(/max\(([\d.]+), fwidth/.exec(DAYLIGHT_FUNCS_GLSL)[1]);
  assert.ok(Math.abs(half - TERMINATOR_HALF_DEG * D) < 1e-8);
  const globe = read("js/globe/globe.js");
  assert.match(globe, /\$\{DAYLIGHT_UNIFORMS_GLSL\}/);
  assert.match(globe, /\$\{DAYLIGHT_FUNCS_GLSL\}/);
  assert.match(globe, /float lit = daylight\(u\);/);
  assert.match(globe, /dayShade\(lit\)/);
  for (const k of ["uSunDir", "uDayOn", "cNight"]) assert.match(globe, new RegExp(`${k}: \\{ value:`), k);
  assert.match(globe, /setSunDir,/);
  // A new Sun direction redraws the sphere only, not the HTML overlay.
  assert.match(globe, /requestRender\(false\)/);
});

test("the moment: the selected scenario's sky view, else the first view, else a start time, else now", () => {
  const sky = [
    { id: "a", label: "Apollo 11", t_ms: 1000 },
    { id: "b", label: "Shackleton", t_ms: 2000 },
  ];
  assert.deepEqual(pickMoment(sky, [], "b", 9), { t_ms: 2000, label: "Shackleton", now: false });
  assert.deepEqual(pickMoment(sky, [], "zz", 9), { t_ms: 1000, label: "Apollo 11", now: false });
  assert.deepEqual(pickMoment(sky, [], null, 9), { t_ms: 1000, label: "Apollo 11", now: false });
  const starts = [{ id: "a", label: "A", t_ms: NaN }, { id: "b", label: "B", t_ms: 5000 }];
  assert.deepEqual(pickMoment([], starts, "a", 9), { t_ms: 5000, label: "B", now: false });
  assert.deepEqual(pickMoment([], starts, "b", 9), { t_ms: 5000, label: "B", now: false });
  assert.deepEqual(pickMoment([], [], null, 9), { t_ms: 9, label: "", now: true });
});

test("the caption names the moment in UTC and the scenario; the note says what the shading leaves out", () => {
  const t = Date.UTC(1969, 6, 20, 20, 17, 40);
  assert.equal(daylightCaption({ t_ms: t, label: "Apollo 11", now: false }), "Daylight at 20 Jul 1969, 20:17 UTC (Apollo 11)");
  assert.equal(daylightCaption({ t_ms: t, label: "", now: false }), "Daylight at 20 Jul 1969, 20:17 UTC");
  assert.equal(daylightCaption({ t_ms: Date.UTC(2026, 10, 15, 9, 5), label: "", now: true }), "Daylight now, 15 Nov 2026, 09:05 UTC");
  assert.match(DAYLIGHT_NOTE, /smooth Moon/);
  assert.match(DAYLIGHT_NOTE, /terrain shadows are shown in the sky view and in the permanent shadow layer/);
  assert.equal(DAYLIGHT_LAYER.label, "Daylight at the selected time");
});

test("the switch: on by default, a 'ui' change in the store; the share link writes only 'off'", () => {
  assert.equal(store.daylight, true);
  const seen = [];
  const off = subscribe((kind, detail) => seen.push([kind, detail]));
  setUi({ daylight: false });
  off();
  assert.deepEqual(seen, [["ui", { daylight: false }]]);
  setUi({ daylight: true });

  assert.equal(NO_DAYLIGHT, "noday");
  assert.equal(formatMapLink([], true), "");
  assert.equal(formatMapLink([], false), "noday");
  assert.equal(formatMapLink(["sun", "psr"], false), "psr.sun.noday");
  assert.equal(parseDaylight(null), true);
  assert.equal(parseDaylight("psr.sun"), true);
  assert.equal(parseDaylight("psr.noday"), false);

  const scenarios = [{ label: "A", lat_deg: 0.674, lon_deg: 23.473, t_start_utc: "1969-07-20T20:17:40Z", t_end_utc: null, site_id: null, color: 0 }];
  const on = encodeHash({ scenarios, layers: ["psr"] });
  assert.match(on, /(^#|&)ml=psr(&|$)/);
  assert.equal(decodeHash(on).daylight, true);
  const dark = encodeHash({ scenarios, layers: ["psr"], daylight: false });
  assert.match(dark, /(^#|&)ml=psr\.noday(&|$)/);
  assert.deepEqual(decodeHash(dark).layers, ["psr"]); // the word is not a layer
  assert.equal(decodeHash(dark).daylight, false);
  assert.equal(decodeHash(encodeHash({ scenarios })).daylight, true);
  assert.equal(decodeHash("#ml=noday").daylight, false);

  // The page writes the switch into the link and reads it back.
  const main = read("js/app/main.js");
  assert.match(main, /daylight: store\.daylight/);
  assert.match(main, /h\?\.daylight \?\? true/);
});

test("the page: the map wires the day/night link; the Layers panel has the switch; the sky panel reports its time", () => {
  assert.match(read("js/app/map.js"), /initDaylight\(globe\)/);
  const layers = read("js/app/map_layers.js");
  assert.match(layers, /DAYLIGHT_LAYER/);
  assert.match(layers, /setUi\(\{ daylight: box\.checked \}\)/);
  const sky = read("js/app/sky_panel.js");
  assert.match(sky, /export function onSkyTime/);
  assert.match(sky, /export function skyMoments/);
  assert.match(sky, /for \(const cb of timeListeners\) cb\(\);/);
  const link = read("js/app/daylight_link.js");
  assert.match(link, /requestAnimationFrame\(update\)/); // at most once per frame
  assert.match(link, /if \(key === lastKey\) return;/); // only when the moment changes
  assert.match(link, /subsolarAt\(/); // the same physics as the sky view
});

test("the Earth's shadow: covered share of a uniform disk, as the physics' lens area", () => {
  const rs = 0.00465; // the Sun's angular radius from the Moon (rad)
  assert.equal(diskCover(0.1, rs, 0.0166), 0); // far apart
  assert.equal(diskCover(0.001, rs, 0.0166), 1); // the Earth (bigger) covers the Sun
  assert.ok(Math.abs(diskCover(0.0005, rs, 0.002) - (0.002 / rs) ** 2) < 1e-12); // a small disk inside
  for (const re of [0.0166, 0.0172, 0.003]) {
    for (const k of [0.1, 0.4, 0.7, 0.95]) {
      const d = Math.abs(re - rs) + k * 2 * Math.min(re, rs);
      const ref = occultedFluxFraction(d / rs, re / rs, 0);
      assert.ok(Math.abs(diskCover(d, rs, re) - ref) < 1e-5, `re ${re}, d ${d}: ${diskCover(d, rs, re)} vs ${ref}`);
    }
  }
  assert.match(DAYLIGHT_FUNCS_GLSL, /float earthShadow\(vec3 u\)/);
  assert.match(read("js/globe/globe.js"), /lit \*= 1\.0 - earthShadow\(u\);/);
});
