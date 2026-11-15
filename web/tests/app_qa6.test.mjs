// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// QA round 6 (docs/validation/qa6.md): Play is held while a rover route is planned (the sky on screen is the previous
// story's); the calendar opens inside the window when it fits on neither side of its field; shorter panel texts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { popSpot } from "../js/app/time_picker.js";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(WEB, p), "utf8");

test("rover route planning: Play, the slider and the speed are held until the route arrives", () => {
  const sky = read("js/app/sky_panel.js");
  assert.match(sky, /export function holdPlayback\(text\)/);
  // A hold stops playback, disables the controls and writes its words in the timelapse clock.
  assert.match(sky, /if \(holdText\) stop\(\);/);
  assert.match(sky, /const can = maxSpan > 0 && !holdText;/);
  for (const id of ["sky-slider", "btn-play", "sky-speed"]) assert.match(sky, new RegExp(`\\$\\("${id}"\\)\\.disabled = !can;`));
  assert.match(sky, /const html = holdText \? esc\(holdText\)/);
  assert.match(sky, /function play\(\) \{\n {2}if \(maxSpan <= 0 \|\| holdText\) return;/);
  // setSkyItems uses the same rule, so new results open playable (at T+0, a new set) once the hold ends.
  assert.doesNotMatch(sky, /\$\("btn-play"\)\.disabled = !hasMission;/);

  const main = read("js/app/main.js");
  // Held only while a trip's route is not computed yet; released when the results of the latest request arrive.
  assert.match(main, /const planning = valid\.some\(\(\{ s \}\) => isTrip\(s\) && !cache\.get\(physicsKey\(s\)\)\?\.done\);/);
  assert.match(main, /holdPlayback\(planning \? PLANNING_TEXT : null\);/);
  assert.match(main, /if \(seq !== computeSeq\) return;[^\n]*\n {2}setBusy\(false\);\n {2}holdPlayback\(null\);/);
  assert.match(main, /p\.then\(\(\) => \(p\.done = true\)\);/);
});

test("calendar: below when it fits, else above, else inside the window (Now / Clear / Done never scroll away)", () => {
  // 1366 x 768, a field in the middle of the window: 434 px of picker, 346 px below the field, 376 px above it.
  assert.equal(popSpot(434, 346, 376), "inside");
  assert.equal(popSpot(434, 500, 100), "below");
  assert.equal(popSpot(434, 100, 600), "above");
  assert.equal(popSpot(434, 439, 600), "above", "6 px of gap are kept between the field and the picker");
  assert.equal(popSpot(434, 440, 600), "below");
  const src = read("js/app/time_picker.js");
  assert.match(src, /top = Math\.max\(8, vh - 8 - h\);\n {6}root\.style\.maxHeight = `\$\{vh - 16\}px`;/);
  // The full height is measured also while a max-height makes the picker scroll (a later scroll or resize).
  assert.match(src, /return root\.scrollHeight \+ \(root\.offsetHeight - root\.clientHeight\);/);
});

test("share link: a camera (v=) opened over the scenarios already shown turns the first view", () => {
  const main = read("js/app/main.js");
  // A new set of scenarios gets the camera through queueSkyStart; the same set keeps its views, so it is turned here.
  assert.match(main, /queueSkyStart\(\{ offsetMs: h\.sky\.offsetMs \|\| 0, view: h\.sky\.view \}\);\n {6}setScenarios\(h\.scenarios\);\n {4}\} else if \(h\.sky\.view\) setSkyCamera\(h\.sky\.view\);/);
  const sky = read("js/app/sky_panel.js");
  assert.match(sky, /export function setSkyCamera\(cam\) \{/);
  // A view not built yet (off screen on a phone) takes it when it is built; the share state reports it meanwhile.
  assert.match(sky, /if \(!first\?\.view\) \{\n {4}pendingCamera = cam;/);
  // A turned view counts as touched, so the next written link keeps its camera.
  assert.match(sky, /first\.view\.lookAt\(Number\(cam\.az_deg\) \|\| 0, Number\(cam\.el_deg\) \|\| 0\);[\s\S]{0,120}first\.camTouched = true;/);
});

test("shorter texts: the empty state and the AI panel say what the controls do not already show", () => {
  const html = read("index.html");
  assert.match(html, /<p>Search the Moon, click the globe, or start a story:<\/p>/);
  const ai = read("js/ai/panel.js");
  assert.doesNotMatch(ai, /this tab only, unless you tick Remember/);
  assert.doesNotMatch(ai, /It never makes up the numbers/);
  // The cost, where the key goes and the link to get one stay visible; the AI label keeps "validated physics".
  assert.match(ai, /About \$0\.10–0\.30 a mission\. The key stays in this browser, goes only to api\.anthropic\.com and is\s+never put in a link\./);
  assert.match(ai, /Get a key in the Anthropic Console/);
});
