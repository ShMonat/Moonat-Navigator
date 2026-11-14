// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Tests for the plain-language wording of the sky view and the Sky tab (web/js/sky/words.js).

import test from "node:test";
import assert from "node:assert/strict";
import { compass16, compassPair, degText, hiddenReason, hiddenPhrase, bodyLine, earthNeverRises } from "../js/sky/words.js";

test("compass16 and compassPair: same name for two bodies 0.3° apart across a sector boundary", () => {
  assert.equal(compass16(0), "N");
  assert.equal(compass16(272.2), "W");
  assert.equal(compass16(258.6), "WSW");
  assert.equal(compass16(258.9), "W");
  assert.deepEqual(compassPair(258.9, 258.6), ["W", "W"]); // QA2 Q32: eclipse, Sun 258.9°, Earth 258.6°
  assert.deepEqual(compassPair(359.8, 0.3), ["N", "N"]);
  assert.deepEqual(compassPair(88.8, 272.2), ["E", "W"]);
});

test("degText: true minus sign, optional plus, no −0.0°", () => {
  assert.equal(degText(-48.597), "−48.6°");
  assert.equal(degText(3.04, { plus: true }), "+3.0°");
  assert.equal(degText(-0.04), "0.0°");
  assert.equal(degText(NaN), "–");
});

test("hiddenReason: below the horizon only when the whole disk is below the horizontal plane", () => {
  // QA2 Q16: 7.4° N 170.0° W, 1969-07-20 20:17:40 UTC: Sun +3.0°, behind a ridge.
  assert.equal(hiddenReason({ el_deg: 3.0, ang_radius_deg: 0.26, vis_frac: 0 }), "terrain");
  // Centre below the plane, upper limb above it: still the terrain that hides it.
  assert.equal(hiddenReason({ el_deg: -0.1, ang_radius_deg: 0.26, vis_frac: 0 }), "terrain");
  assert.equal(hiddenReason({ el_deg: -0.7, ang_radius_deg: 0.26, vis_frac: 0 }), "below");
  // Below the horizontal plane but above a lower skyline (seen from a peak): visible, no wording.
  assert.equal(hiddenReason({ el_deg: -0.7, ang_radius_deg: 0.26, vis_frac: 1 }), null);
  assert.equal(hiddenReason({ el_deg: 1, ang_radius_deg: 0.26, vis_frac: 0.4 }), null);
  assert.equal(hiddenPhrase({ el_deg: 3.0, ang_radius_deg: 0.26, vis_frac: 0 }, 5.2), "hidden behind terrain (skyline +5.2°)");
  assert.equal(hiddenPhrase({ el_deg: -48.6, ang_radius_deg: 0.95, vis_frac: 0 }, 0.3), "below the horizon");
});

test("bodyLine: the card footer wording", () => {
  assert.equal(bodyLine("Sun", { el_deg: 10.7, az_deg: 88.8, ang_radius_deg: 0.26, vis_frac: 1 }, "E"), "Sun: height 10.7°, E (89°)");
  assert.equal(bodyLine("Sun", { el_deg: 0.2, az_deg: 90, ang_radius_deg: 0.26, vis_frac: 0.4 }, "E"), "Sun: height 0.2°, E (90°) · 40% visible");
  assert.equal(bodyLine("Sun", { el_deg: 3.0, az_deg: 271, ang_radius_deg: 0.26, vis_frac: 0 }, "W", 5.2), "Sun hidden behind terrain: height +3.0°, W (271°), skyline +5.2°");
  assert.equal(bodyLine("Sun", { el_deg: -5, az_deg: 265, ang_radius_deg: 0.26, vis_frac: 0 }, "W", 0.5), "Sun below the horizon: height −5.0°, W (265°)");
  // Chang'e 4 site, 2026-11-14 12:00 UTC (Horizons: az 180.732°, el −48.597°).
  assert.equal(
    bodyLine("Earth", { el_deg: -48.597, az_deg: 180.732, ang_radius_deg: 0.95, vis_frac: 0 }, "S", 1.0, { neverRises: true }),
    "Earth below your feet: height −48.6°, S (181°) · it never rises here",
  );
});

test("earthNeverRises: far side yes, near side and the libration zone no", () => {
  assert.equal(earthNeverRises(-45.4561, 177.5885), true); // Chang'e 4
  assert.equal(earthNeverRises(7.4, -170.0), true); // QA2 far-side custom point
  assert.equal(earthNeverRises(0.6741, 23.473), false); // Apollo 11
  assert.equal(earthNeverRises(-89.5, 0), false); // south pole: Earth skims the horizon
  assert.equal(earthNeverRises(0, 98), false); // libration zone: Earth rises at times
  assert.equal(earthNeverRises(0, 106), true);
  assert.equal(earthNeverRises(NaN, 0), false);
});
