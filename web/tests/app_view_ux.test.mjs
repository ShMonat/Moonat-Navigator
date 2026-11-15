// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The sky view as an app (docs/validation/view_ux.md): one stage that fills the window (caption, views, timelapse bar,
// Sun | Earth switch), one camera group (Follow, Driver's view), no Focus mode, and the interface icon set.
// Run: node --test web/tests/app_view_ux.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { icon, ICON_NAMES } from "../js/app/icons.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const HTML = read("../index.html");
const CSS = read("../css/app.css");
const PANEL = read("../js/app/sky_panel.js");
const RIDE = read("../js/rover/sky_ride.js");

test("the stage holds, in order: the caption line, the sky panel (views, timelapse bar), the Sun | Earth switch", () => {
  const stage = HTML.indexOf('id="sky-stage"');
  const order = ['id="qs-caption"', 'id="sky-panel"', 'id="sky-grid"', 'id="sky-controls"', 'id="cam-group"', 'id="body-bar"', 'id="compare-body"']
    .map((s) => HTML.indexOf(s));
  assert.ok(stage > 0, "#sky-stage exists");
  assert.ok(order.every((i) => i > stage), "everything after the stage opens");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "caption, views, controls, camera group, switch, then the data");
  assert.match(CSS, /\.sky-stage\s*\{[^}]*min-height:\s*max\(420px, calc\(100dvh - var\(--stage-top\)\)\)/);
});

test("one camera group: Follow (the switch's body) and Driver's view; no Track button, no Look ahead, no Focus", () => {
  assert.match(HTML, /id="btn-follow"[^>]*aria-pressed="false"/);
  assert.match(HTML, /id="btn-driver"[^>]*aria-pressed="false" hidden/);
  assert.match(HTML, /Driver's view/);
  for (const gone of ['id="btn-track"', "Look ahead", ">Track<"]) assert.ok(!HTML.includes(gone), gone);
  for (const gone of ["sky-focus-btn", "Look ahead", "addRideControls", "enterFocus", "Exit focus"]) assert.ok(!PANEL.includes(gone), gone);
  for (const gone of ["addRideControls", "ride-ahead", "Look ahead"]) assert.ok(!RIDE.includes(gone), gone);
  assert.ok(!/sky-focus|\.track-btn|#sky-panel\.focus/.test(CSS), "no focus-mode or Track styles left");
  // The full screen control stays, as a corner icon, with an exit button for touch screens.
  assert.match(PANEL, /class="sky-act sky-fs-btn" title="Full screen \(Esc to exit\)"/);
  assert.match(PANEL, /Exit full screen/);
});

test("interface icons: one SVG per name, currentColor, 1em, hidden from screen readers", () => {
  for (const name of ["follow", "rover", "sun", "earth", "calendar", "suggest", "warning", "eclipse", "fullscreen", "close"]) {
    assert.ok(ICON_NAMES.includes(name), name);
  }
  for (const name of ICON_NAMES) {
    const s = icon(name);
    assert.match(s, /^<svg [^>]*viewBox="0 0 24 24"/, name);
    assert.match(s, /width="1em" height="1em"/, name);
    assert.match(s, /aria-hidden="true"/, name);
    assert.match(s, /stroke="currentColor"/, name);
    assert.ok(!/#[0-9a-f]{3,6}\b/i.test(s), `${name}: no fixed colours`);
  }
  assert.equal(icon("nope"), "");
  assert.match(icon("sun", "x"), /class="ico-svg x"/);
});

/** Emoji and emoji-capable pictographs (phones draw them as colour emoji); ✕ (U+2715) is a plain close mark. */
const EMOJI = /[\u{2194}-\u{2199}\u{21A9}\u{21AA}\u{231A}\u{231B}\u{2328}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2600}-\u{2714}\u{2716}-\u{27BF}\u{2B05}-\u{2B07}\u{2B1B}\u{2B1C}\u{2B50}\u{2B55}\u{1F000}-\u{1FAFF}\u{FE0F}]/u;

test("no emoji in the page or the app code (comments aside)", () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|css)$/.test(e.name)) files.push(p);
    }
  };
  const web = fileURLToPath(new URL("..", import.meta.url));
  for (const d of ["js", "css"]) walk(join(web, d));
  const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const hits = [];
  for (const f of [...files, join(web, "index.html")]) {
    strip(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
      if (EMOJI.test(line)) hits.push(`${f.slice(web.length)}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(hits, []);
});
