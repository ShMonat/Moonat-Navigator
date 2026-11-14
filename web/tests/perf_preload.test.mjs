// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The load-order hints in web/index.html: the modulepreload list must equal the app's static module graph (a missing
// entry makes the browser fetch that module import by import; a stale one is a wasted request or a 404), and the
// opening view's preloads must name files that exist and that the code really requests.
// If this fails after you add or remove a module: update the <link rel="modulepreload"> lines in web/index.html
// (or SKY_MODULES in its inline script for web/js/sky/) as the message says.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname, relative } from "node:path";
import { QUICK_STARTS } from "../js/app/catalog.js";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(resolve(WEB, rel), "utf8");
const HTML = read("index.html");

/** Static relative imports reachable from an entry (paths relative to web/), plus the bare specifiers met. */
function graph(entry) {
  const seen = new Set();
  const bare = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const re = /(?:^|[;\s])(?:import|export)\s+(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(src))) {
      if (m[1].startsWith(".")) walk(resolve(dirname(file), m[1]));
      else bare.add(m[1]);
    }
  };
  walk(resolve(WEB, entry));
  return { files: [...seen].map((f) => relative(WEB, f).replace(/\\/g, "/")), bare: [...bare] };
}

const arrayIn = (name) => {
  const m = new RegExp(`var ${name} = (\\[[^\\]]*\\])`).exec(HTML);
  assert.ok(m, `${name} not found in index.html`);
  return JSON.parse(m[1]);
};

test("the modulepreload list in index.html is exactly the static module graph of js/app/main.js", () => {
  const listed = [...HTML.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
  const { files } = graph("js/app/main.js");
  const missing = files.filter((f) => !listed.includes(f));
  const stale = listed.filter((f) => !files.includes(f));
  assert.deepEqual(missing, [], `add to web/index.html: ${missing.map((f) => `<link rel="modulepreload" href="${f}">`).join(" ")}`);
  assert.deepEqual(stale, [], `remove from web/index.html (no longer imported by js/app/main.js): ${stale.join(", ")}`);
  assert.equal(new Set(listed).size, listed.length, "duplicate modulepreload entries");
});

test("the sky view module preloads are the sky view's graph plus three.js from the import map", () => {
  const sky = arrayIn("SKY_MODULES");
  const { files, bare } = graph("js/sky/index.js");
  const importMap = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(HTML)[1]).imports;
  const expected = [...bare.map((b) => importMap[b]), ...files];
  assert.ok(bare.every((b) => importMap[b]), `bare imports without an import-map entry: ${bare}`);
  assert.deepEqual([...sky].sort(), [...expected].sort());
});

test("the opening view's data preloads exist, and the first-visit ones are the Apollo 11 quick start's", () => {
  for (const u of [...arrayIn("SKY_DATA"), ...arrayIn("SKY_IMAGES"), ...arrayIn("FIRST_VISIT"), "data/sites.json", "data/ephem/manifest.json"]) {
    assert.ok(existsSync(resolve(WEB, u)), u);
  }
  const [a11] = QUICK_STARTS[0].resolve([]);
  const year = a11.t_start_utc.slice(0, 4);
  assert.equal(QUICK_STARTS[0].key, "apollo11"); // the first visit opens the Apollo 11 story
  assert.deepEqual(arrayIn("FIRST_VISIT"), [
    `data/ephem/${year}.bin`, `data/horizons/${a11.site_id}.json`, `data/terrain/${a11.site_id}.bin`,
  ]);
  // The URLs the sky view requests by default (web/js/sky/index.js) and the night map the sky panel passes.
  const skySrc = read("js/sky/index.js");
  for (const u of arrayIn("SKY_DATA")) assert.ok(skySrc.includes(`'${u}'`), u);
  assert.ok(skySrc.includes("'assets/earth_daymap.jpg'"));
  assert.ok(read("js/app/sky_panel.js").includes('"assets/earth_night.jpg"'));
});

test("the years the inline script preloads for a shared link are the ephemeris years", () => {
  const years = JSON.parse(read("data/ephem/manifest.json")).years;
  const m = /var covered = function \(y\) \{ return \(y >= (\d+) && y <= (\d+)\) \|\| \(y >= (\d+) && y <= (\d+)\); \}/.exec(HTML);
  assert.ok(m);
  const [a, b, c, d] = m.slice(1).map(Number);
  const covered = (y) => (y >= a && y <= b) || (y >= c && y <= d);
  for (let y = 1950; y <= 2060; y++) assert.equal(covered(y), years.includes(y), String(y));
});

test("the Plotly URL preloaded in index.html is the one compare.js loads", () => {
  const inHtml = /var PLOTLY = "([^"]+)"/.exec(HTML)[1];
  const inJs = /const PLOTLY_URL = "([^"]+)"/.exec(read("js/app/compare.js"))[1];
  assert.equal(inHtml, inJs);
});
