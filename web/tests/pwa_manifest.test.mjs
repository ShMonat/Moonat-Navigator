// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Installable app: web/manifest.webmanifest fields, its icon files (real PNGs of the stated size) and the page's head tags.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(WEB, "manifest.webmanifest"), "utf8"));
const head = readFileSync(join(WEB, "index.html"), "utf8").split("</head>")[0];

/** Width and height of a PNG file, from its IHDR chunk. */
function pngSize(path) {
  const b = readFileSync(path);
  assert.equal(b.toString("latin1", 1, 4), "PNG", `${path} is a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test("manifest names, start URL, scope and display", () => {
  assert.equal(manifest.name, "Moonat: Lunar Landing Site Navigator");
  assert.equal(manifest.short_name, "Moonat");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.background_color, "#090b10");
  assert.equal(manifest.theme_color, "#090b10");
});

test("manifest has 192 and 512 icons, plain and maskable, and every file exists at its stated size", () => {
  for (const purpose of ["any", "maskable"]) {
    for (const s of ["192x192", "512x512"]) {
      assert.ok(manifest.icons.some((i) => i.sizes === s && i.purpose === purpose && i.type === "image/png"), `${purpose} ${s}`);
    }
  }
  for (const icon of manifest.icons) {
    const path = join(WEB, icon.src);
    assert.ok(existsSync(path), icon.src);
    assert.deepEqual(pngSize(path), icon.sizes.split("x").map(Number), icon.src);
  }
});

test("the page head links the manifest, the theme colour and the iOS home-screen tags", () => {
  assert.match(head, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(head, /<meta name="theme-color" content="#090b10">/);
  assert.match(head, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(head, /<meta name="apple-mobile-web-app-title" content="Moonat">/);
  const apple = head.match(/<link rel="apple-touch-icon"[^>]*href="([^"]+)"/);
  assert.ok(apple, "apple-touch-icon link");
  assert.deepEqual(pngSize(join(WEB, apple[1])), [180, 180]);
});

test("no service worker is registered (offline caching is a follow-up)", () => {
  assert.ok(!existsSync(join(WEB, "sw.js")));
  assert.doesNotMatch(readFileSync(join(WEB, "index.html"), "utf8"), /serviceWorker\.register/);
});
