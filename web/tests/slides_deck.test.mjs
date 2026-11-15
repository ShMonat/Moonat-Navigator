// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The 7-slide presentation (web/slides/index.html): seven slides, a link to its PDF, and every image it uses exists.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SLIDES = join(dirname(fileURLToPath(import.meta.url)), "..", "slides");
const html = readFileSync(join(SLIDES, "index.html"), "utf8");

test("the deck has exactly 7 slides", () => {
  const n = (html.match(/<section class="slide[\s"]/g) || []).length;
  assert.equal(n, 7);
});

test("the deck links to its PDF, and the PDF is there", () => {
  assert.match(html, /href="moonat_slides\.pdf"/);
  assert.ok(existsSync(join(SLIDES, "moonat_slides.pdf")), "web/slides/moonat_slides.pdf");
});

test("every image the deck uses exists", () => {
  const srcs = [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.length >= 6, `found ${srcs.length} images`);
  for (const s of srcs) assert.ok(existsSync(join(SLIDES, s)), s);
});

test("the team names and LinkedIn links come from one constant", () => {
  assert.equal((html.match(/const TEAM = \[/g) || []).length, 1);
  assert.ok((html.match(/data-team/g) || []).length >= 1);
  for (const [name, url] of [
    ["Shay Monat", "https://www.linkedin.com/in/shay-monat/"],
    ["Shahar Caspi Monat", "https://www.linkedin.com/in/shahar-caspi/"],
  ]) {
    assert.equal(html.split(`["${name}", "${url}"]`).length - 1, 1, name);
  }
  assert.match(html, /target="_blank" rel="noopener"/);
});

test("AI mode is presented as live, not planned", () => {
  assert.match(html, /AI mode/);
  assert.doesNotMatch(html, /AI mode \(planned\)/);
});
