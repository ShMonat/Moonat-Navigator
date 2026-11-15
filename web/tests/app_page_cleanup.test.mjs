// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The thinner page: the Sun | Earth | Both switch in the state and share links, the grouping of the data charts per
// switch value, the colour rule of the chart lines, and the shared "i" info-icon helper.
// Run: node --test web/tests/app_page_cleanup.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeHash, decodeHash, hashBody, makeScenario } from "../js/app/state.js";
import { CHARTS, chartsFor, normBody, lineStyle, styleKey, BODY_LINE, BODIES } from "../js/app/chart_plan.js";
import { infoTip, setTipOpen, setInfoText } from "../js/app/info_tip.js";

const SC = [makeScenario({ label: "A", lat_deg: -89.5, lon_deg: 0, t_start_utc: "2026-01-01T00:00:00Z", t_end_utc: "2026-01-03T00:00:00Z", site_id: null }, [])];

test("Both in share links: b=both round-trips; sun stays the default and is not written", () => {
  for (const body of ["sun", "earth", "both"]) {
    const h = encodeHash({ scenarios: SC, body });
    assert.equal(h.includes("b=both"), body === "both", body);
    assert.equal(h.includes("b="), body !== "sun", body);
    const d = decodeHash(h);
    assert.equal(d.body, body);
    assert.equal(hashBody(d), body);
  }
  assert.equal(decodeHash("#b=nonsense&x=utc").body, "sun", "an unknown value falls back to the Sun");
  // Old tab links keep their meaning.
  assert.equal(hashBody(decodeHash("#tab=sky&look=sun")), "sun");
  assert.equal(hashBody(decodeHash("#tab=sky")), "earth");
  assert.deepEqual([...BODIES], ["sun", "earth", "both"]);
  assert.equal(normBody("both"), "both");
  assert.equal(normBody(undefined), "sun");
});

test("chart grouping: Both merges the shared quantities into one chart each, body-specific charts stay alone", () => {
  assert.deepEqual(chartsFor("sun").map((c) => c.id), ["sun-el", "sun-vis", "sun-flux"]);
  assert.deepEqual(chartsFor("earth").map((c) => c.id), ["earth-el", "earth-vis", "earth-phase"]);
  const both = chartsFor("both");
  assert.deepEqual(both.map((c) => c.title), ["Elevation", "Visible disk", "Sunlight power", "Earth phase"]);
  assert.deepEqual(both.map((c) => c.bodies), [["sun", "earth"], ["sun", "earth"], ["sun"], ["earth"]]);
  assert.ok(both.find((c) => c.id === "both-flux").toggle, "the panel orientation buttons stay on Sunlight power");
  // Every chart has a helper sentence (shown behind its "i") and a unique id across the sections.
  const all = Object.values(CHARTS).flat();
  assert.equal(new Set(all.map((c) => c.id)).size, all.length);
  for (const c of all) assert.ok(c.help.length > 20, c.id);
});

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Hue in degrees of a #rrggbb colour. */
function hue(h) {
  const [r, g, b] = hex(h).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const x = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (x * 60 + 360) % 360;
}
/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a, b) {
  const lum = (h) => {
    const [r, g, bl] = hex(h).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test("colour rule: one scenario, the Sun red and the Earth blue; several, the scenario colour and the body's line style", () => {
  for (const theme of ["dark", "light"]) {
    assert.deepEqual(lineStyle({ body: "sun", theme, color: "#123456" }), { color: BODY_LINE[theme].sun, dash: "solid" });
    assert.deepEqual(lineStyle({ body: "earth", theme, mode: "both", color: "#123456" }), { color: BODY_LINE[theme].earth, dash: "solid" });
  }
  // Several scenarios: the scenario's own colour; in the Both section the Sun solid and the Earth dashed.
  assert.deepEqual(lineStyle({ body: "sun", mode: "both", multi: true, color: "#356ac9" }), { color: "#356ac9", dash: "solid" });
  assert.deepEqual(lineStyle({ body: "earth", mode: "both", multi: true, color: "#356ac9" }), { color: "#356ac9", dash: "dash" });
  // A repeated colour slot keeps a distinct style, never the Earth's plain dash or the terrain's dots.
  const wrapped = ["sun", "earth"].map((body) => lineStyle({ body, mode: "both", multi: true, color: "#356ac9", wrapped: true }).dash);
  assert.ok(wrapped.every((d) => !["solid", "dash", "dot"].includes(d)) && wrapped[0] !== wrapped[1], wrapped.join());
  assert.equal(lineStyle({ body: "earth", multi: true, color: "#356ac9" }).dash, "solid", "Sun and Earth sections keep solid lines");
  // The legend says which style is which body, only where it is needed.
  assert.deepEqual(styleKey({ bodies: ["sun", "earth"], mode: "both", multi: true }).map((k) => k.name), ["Solid: Sun", "Dashed: Earth"]);
  assert.deepEqual(styleKey({ bodies: ["earth"], mode: "both", multi: true }).map((k) => k.name), ["Dashed: Earth"]);
  assert.deepEqual(styleKey({ bodies: ["sun", "earth"], mode: "both", multi: false }), []);
  assert.deepEqual(styleKey({ bodies: ["sun"], mode: "single", multi: true }), []);
  // The red is a red (not the orange of the eclipse text, #ffb27a, or the amber warnings) and reads on both themes.
  const surface = { dark: "#12151c", light: "#ffffff" };
  const warn = { dark: "#f5c26b", light: "#9a6400" };
  for (const theme of ["dark", "light"]) {
    const h = hue(BODY_LINE[theme].sun);
    assert.ok(h < 10 || h > 350, `${theme} Sun red hue ${h.toFixed(0)}°`);
    assert.ok(Math.abs(h - hue("#ffb27a")) > 15 && Math.abs(h - hue(warn[theme])) > 20, `${theme}: clear of eclipse and warning hues`);
    assert.ok(contrast(BODY_LINE[theme].sun, surface[theme]) >= 3, `${theme}: Sun line contrast`);
    assert.ok(contrast(BODY_LINE[theme].earth, surface[theme]) >= 3, `${theme}: Earth line contrast`);
  }
});

/** A tiny stand-in for the DOM pieces the info tip touches. */
function fakeTip() {
  const attrs = {};
  const btn = { setAttribute: (k, v) => (attrs[k] = v) };
  const cls = new Set();
  const wrap = {
    classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
    querySelector: (sel) => (sel === ".info-btn" ? btn : null),
  };
  return { wrap, attrs, cls };
}

test("info icon helper: an accessible button with its popover, escaped text, and open/close state", () => {
  const html = infoTip('Height above the "flat" <horizon>', { id: "help-x", label: "About the Elevation chart" });
  assert.match(html, /<button type="button" class="info-btn" aria-label="About the Elevation chart" aria-expanded="false" aria-controls="help-x" aria-describedby="help-x">/);
  assert.match(html, /<span class="info-pop" id="help-x" role="tooltip">Height above the &quot;flat&quot; &lt;horizon&gt;<\/span>/);
  assert.match(html, /<svg [^>]*aria-hidden="true"/, "the icon comes from icons.js");
  assert.match(infoTip("x", { end: true }), /class="info-tip end"/);
  const a = infoTip("a").match(/id="(info-\d+)"/)[1];
  const b = infoTip("b").match(/id="(info-\d+)"/)[1];
  assert.notEqual(a, b, "each tip gets its own id");
  const { wrap, attrs, cls } = fakeTip();
  setTipOpen(wrap, true);
  assert.ok(cls.has("open"));
  assert.equal(attrs["aria-expanded"], "true");
  setTipOpen(wrap, false);
  assert.ok(!cls.has("open"));
  assert.equal(attrs["aria-expanded"], "false");
  const el = { textContent: "old" };
  setInfoText("help-x", "new", { getElementById: (id) => (id === "help-x" ? el : null) });
  assert.equal(el.textContent, "new");
  setInfoText("missing", "x", { getElementById: () => null }); // no throw
});
