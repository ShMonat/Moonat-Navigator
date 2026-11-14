// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// loadHorizon: a 404 means "no profile", a transient server error is retried once and never cached as missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHorizon } from "../js/app/physics_adapter.js";

const profile = { az_step_deg: 0.25, el_deg: new Array(1440).fill(0), dist_km: new Array(1440).fill(1) };
const ok = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(profile) });
const status = (s) => () => Promise.resolve({ ok: false, status: s, json: () => Promise.reject(new Error("no body")) });

test("a transient 503 is retried and the profile is returned", async () => {
  const calls = [];
  const seq = [status(503), ok];
  const h = await loadHorizon("retry_site_a", (u) => (calls.push(u), seq[calls.length - 1]()), 1);
  assert.equal(calls.length, 2);
  assert.ok(h && h.el_deg.length === 1440);
});

test("a 404 returns null without a retry", async () => {
  let n = 0;
  const h = await loadHorizon("retry_site_b", () => (n++, status(404)()), 1);
  assert.equal(h, null);
  assert.equal(n, 1);
});

test("two failures return null, and a later call fetches again", async () => {
  let n = 0;
  const h1 = await loadHorizon("retry_site_c", () => (n++, status(503)()), 1);
  assert.equal(h1, null);
  assert.equal(n, 2);
  const h2 = await loadHorizon("retry_site_c", () => (n++, ok()), 1);
  assert.ok(h2 && Array.isArray(h2.el_deg));
  assert.equal(n, 3);
});

test("a network error is retried", async () => {
  let n = 0;
  const h = await loadHorizon("retry_site_d", () => (++n === 1 ? Promise.reject(new TypeError("offline")) : ok()), 1);
  assert.equal(n, 2);
  assert.ok(h);
});
