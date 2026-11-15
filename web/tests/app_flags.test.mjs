// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Mission flags (web/js/app/flags.js, catalog field C2 "nation") and the "Potential Artemis sites" wording.
// Run: node --test web/tests/app_flags.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { NATIONS, FLAG_DIR, siteFlag } from "../js/app/flags.js";
import { placeResults } from "../js/app/place_search.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const SITES = JSON.parse(readFileSync(here("../data/sites.json"), "utf8")).sites;

// The nation that flew each mission in the catalog.
const EXPECTED = {
  apollo11: "US", apollo12: "US", apollo14: "US", apollo15: "US", apollo16: "US", apollo17: "US",
  surveyor1: "US", surveyor3: "US", surveyor5: "US", surveyor6: "US", surveyor7: "US",
  im1: "US", im2: "US", blueghost1: "US",
  luna9: "SU", luna13: "SU", luna16: "SU", luna17: "SU", luna20: "SU", luna21: "SU", luna24: "SU",
  change3: "CN", change4: "CN", change5: "CN", change6: "CN",
  chandrayaan3: "IN", slim: "JP", beresheet: "IL",
};

// SHA-256 of the files as published by their sources (docs/REFERENCES.md): the vendored copies must be byte-identical.
// flag-icons 7.6.0 flags/4x3/<code>.svg (MIT); Wikimedia Commons "Flag of the Soviet Union.svg" (public domain).
const SOURCE_SHA256 = {
  "us.svg": "e7be4240cf57987926673708f09233be1ab6bdf35acc7b86bd32a263f197a2a7",
  "cn.svg": "981da9bdf82d48e31691f20578cefcb26cf7d0bd95e4ebd5c0df00bdfe988c1a",
  "in.svg": "91185efa1a9b52cdc0e470712518efeefc4e4d6a6555bae9de997ba71885bb98",
  "jp.svg": "bfea80baf9989383dc4bf7ca594ed95be0df0ff125bfc88d0bfa878eb0198022",
  "il.svg": "04a099ac4370b5e856f5f8d44ce0822ec47a6d3bc395a7d048d3a46d69274d68",
  "su.svg": "f6741b67fcf8934c47f2482a54440ab406ae82763c9c7676b9972f476232127f",
};

test("every mission names the nation that flew it, and that nation has a flag", () => {
  const missions = SITES.filter((s) => s.kind === "mission");
  assert.deepEqual(missions.map((s) => s.id).sort(), Object.keys(EXPECTED).sort(), "the table covers every mission");
  for (const s of missions) {
    assert.equal(s.nation, EXPECTED[s.id], s.id);
    const f = siteFlag(s);
    assert.ok(f, s.id);
    assert.equal(f.src, FLAG_DIR + NATIONS[s.nation].file);
  }
  assert.equal(siteFlag(SITES.find((s) => s.id === "luna9")).title, "Flag of the Soviet Union");
  assert.equal(siteFlag(SITES.find((s) => s.id === "beresheet")).title, "Flag of Israel");
});

test("only missions have a flag", () => {
  for (const s of SITES.filter((x) => x.kind !== "mission")) assert.equal(siteFlag(s), null, s.id);
  assert.equal(siteFlag({ kind: "mission", nation: "XX" }), null);
  assert.equal(siteFlag(null), null);
});

test("the flag files are the unaltered source files, one per nation, and nothing else is vendored", () => {
  const dir = here(`../${FLAG_DIR}`);
  const svgs = readdirSync(dir).filter((n) => n.endsWith(".svg")).sort();
  assert.deepEqual(svgs, Object.values(NATIONS).map((n) => n.file).sort());
  for (const name of svgs) {
    const sha = createHash("sha256").update(readFileSync(`${dir}${name}`)).digest("hex");
    assert.equal(sha, SOURCE_SHA256[name], name);
  }
  // flag-icons is MIT: its licence travels with the copies.
  assert.match(readFileSync(`${dir}LICENSE-flag-icons.txt`, "utf8"), /MIT License[\s\S]*Panayiotis Lipiridis/);
});

test("the flag's aspect ratio is the one drawn in its file (the app sizes flags by it)", () => {
  for (const n of Object.values(NATIONS)) {
    const svg = readFileSync(here(`../${FLAG_DIR}${n.file}`), "utf8");
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    const wh = /<svg[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/.exec(svg);
    const [w, h] = (vb || wh).slice(1).map(Number);
    assert.ok(Math.abs(w / h - n.aspect) < 1e-9, n.file);
  }
});

test("the candidate regions are 'Potential Artemis sites', and searching 'artemis' lists them all", () => {
  const r = placeResults("artemis", SITES);
  assert.deepEqual(r.groups.map((g) => g.label), ["Potential Artemis sites"]);
  assert.equal(r.groups[0].sites.length, SITES.filter((s) => s.kind === "candidate").length);
  assert.equal(placeResults("potential", SITES).groups[0]?.label, "Potential Artemis sites");
});

test("no 'Artemis III' left in the page or the app code", () => {
  const files = [here("../index.html")];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${d}${e.name}/`);
      else if (/\.(js|css)$/.test(e.name)) files.push(`${d}${e.name}`);
    }
  };
  walk(here("../js/"));
  walk(here("../css/"));
  for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8"), /Artemis\s+(III|3)\b/, f);
});
