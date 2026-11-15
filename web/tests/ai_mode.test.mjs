// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// AI mode (web/js/ai/): the tools on the real ephemeris and terrain files, the agent loop with a scripted fake
// client (no key, no network) including its error paths, the result and map planning, and the key storage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { initPhysics, seriesFor, loadHorizon, customHorizon, physicsCoverage } from "../js/app/physics_adapter.js";
import { makeSite } from "../js/physics/index.js";
import { suggestDates } from "../js/suggest/index.js";
import { createTools, findCandidates, seriesMetrics, checkWindow, TOOL_DEFS, TOOL_NAMES, MAX_EVALUATIONS, distanceKm } from "../js/ai/tools.js";
import { runMission, explainError, echoContent, usageOf, costUsd, requestParams, AgentError, MODEL, MAX_TURNS } from "../js/ai/agent.js";
import { resultSites, planPlaces } from "../js/ai/result.js";
import { readKey, saveKey, forgetKey, looksLikeKey, KEY_NAME, SDK_URL, SDK_VERSION, loadSdk } from "../js/ai/sdk.js";
import { fileFetch, REPO } from "./physics_helpers.mjs";

const WEB = `${REPO}web/`;
const json = async (rel) => JSON.parse(await readFile(`${WEB}${rel}`, "utf8"));
const SITES = (await json("data/sites.json")).sites;
const SPOTS = (await json("data/overlays/overlays.json")).sun_spots.rows;
await initPhysics(`${WEB}data/ephem`, { fetch: fileFetch, demBase: `${WEB}data/dem` });

/** Tools wired to the real physics, catalog horizons and DEM tiles (live Moon Trek replaced by `live`). */
function realTools({ live = null, progress = [] } = {}) {
  return createTools({
    sites: () => SITES,
    spotRows: async () => SPOTS,
    catalogHorizon: (id) => loadHorizon(id, (u) => fileFetch(`${WEB}${u}`), 0),
    liveTerrain: live,
    tilesHorizon: (lat, lon) => customHorizon(lat, lon),
    makeSite,
    series: seriesFor,
    suggest: (spec, opts) => suggestDates(spec, { ...opts, ephemBaseUrl: `${WEB}data/ephem`, fetch: fileFetch }),
    coverage: physicsCoverage,
    onProgress: (t) => progress.push(t),
  });
}

// ---------------------------------------------------------------------------------------------
// Tool definitions

test("tool definitions: strict JSON schemas, closed objects, every field required, no numeric bounds", () => {
  assert.deepEqual(TOOL_NAMES, ["set_requirements", "find_candidate_sites", "evaluate_site", "suggest_dates", "final_recommendation"]);
  const walk = (s, path) => {
    if (s.type === "object") {
      assert.equal(s.additionalProperties, false, path);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), path);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`);
    }
    if (s.type === "array") walk(s.items, `${path}[]`);
    for (const bad of ["minimum", "maximum", "minLength", "maxLength", "multipleOf"]) assert.ok(!(bad in s), `${path}: ${bad}`);
  };
  for (const t of TOOL_DEFS) {
    assert.equal(t.strict, true, t.name);
    assert.ok(t.description.length > 60, t.name);
    walk(t.input_schema, t.name);
  }
});

// ---------------------------------------------------------------------------------------------
// find_candidate_sites

test("find_candidate_sites: south pole spots (most lit first, 2 km apart, named after a nearby site) and catalog sites", () => {
  const r = findCandidates({ region: "south_pole", min_sunlit_pct: 80, kinds: [], max_results: 40 }, SITES, SPOTS);
  const spots = r.sites.filter((s) => s.kind === "sunlit_spot");
  assert.ok(spots.length >= 5, String(spots.length));
  assert.equal(spots[0].pgda_lit_time_pct, 88.4); // the connecting ridge spot, the best in the south
  for (let i = 1; i < spots.length; i++) assert.ok(spots[i - 1].pgda_lit_time_pct >= spots[i].pgda_lit_time_pct);
  for (const a of spots) for (const b of spots) if (a !== b) assert.ok(distanceKm(a.lat_deg, a.lon_deg, b.lat_deg, b.lon_deg) >= 2);
  assert.ok(spots.every((s) => s.lat_deg <= -80 && s.pgda_lit_time_pct >= 80));
  assert.ok(spots.some((s) => /km from /.test(s.name)), "spots carry the nearest catalog name");
  const home = r.sites.find((s) => s.site_id === "starhab");
  assert.ok(home && /98\.3 %/.test(home.known));
  assert.ok(r.sites.some((s) => s.site_id === "art_malapert"));
  assert.ok(!r.sites.some((s) => s.site_id === "apollo11"), "Apollo 11 is not polar");
  // Kinds and far side
  const far = findCandidates({ region: "far_side", min_sunlit_pct: 0, kinds: ["mission"], max_results: 10 }, SITES, SPOTS);
  assert.ok(far.sites.length >= 2 && far.sites.every((s) => s.kind === "mission" && Math.abs(s.lon_deg) > 90), JSON.stringify(far.sites.map((s) => s.name)));
  assert.ok(far.sites.some((s) => s.site_id === "change4"));
  // max_results keeps a mix of spots and catalog sites
  const few = findCandidates({ region: "south_pole", min_sunlit_pct: 0, kinds: [], max_results: 9 }, SITES, SPOTS);
  assert.equal(few.sites.length, 9);
  assert.ok(few.sites.filter((s) => s.kind !== "sunlit_spot").length >= 3);
});

// ---------------------------------------------------------------------------------------------
// evaluate_site on the real ephemeris and LOLA horizons

test("evaluate_site at StarHab over 2030: the app's own series and numbers (catalog LOLA horizon, eye 2 m)", async () => {
  const progress = [];
  const tools = realTools({ progress });
  const r = await tools.run("evaluate_site", { name: "StarHab", site_id: "starhab", lat_deg: 0, lon_deg: 0, start_utc: "2030-01-01T00:00:00Z", end_utc: "2031-01-01T00:00:00Z" });
  assert.equal(r.evaluation_id, "E1");
  assert.equal(r.site_id, "starhab");
  assert.equal(r.lat_deg, -85.96775); // the catalog's coordinates, not the model's zeros
  assert.equal(r.eye_height_m, 2);
  assert.equal(r.terrain_quality, "real");
  assert.match(r.sampling, /every 1 h, 8761 samples/);
  // Same numbers as a direct C6 series with the same horizon and step (the app's chooseStep: 1 h for a year).
  const hz = JSON.parse(await readFile(`${WEB}data/horizons/starhab.json`, "utf8"));
  const se = await seriesFor(makeSite({ lat_deg: hz.lat_deg, lon_deg: hz.lon_deg, observer_height_m: 2, horizon: hz }), Date.UTC(2030, 0, 1), Date.UTC(2031, 0, 1), 3600e3);
  const m = seriesMetrics(se);
  for (const k of ["sun_visible_pct", "earth_visible_pct", "longest_night_days", "longest_blackout_days", "eclipse_count"]) assert.equal(r[k], m[k], k);
  // Close to the StarHab study's 2 m numbers over 2030-2040 (76.7 % Sun, 67.4 % Earth): one year differs a little.
  assert.ok(Math.abs(r.sun_visible_pct - 76.7) < 3, String(r.sun_visible_pct));
  assert.ok(Math.abs(r.earth_visible_pct - 67.4) < 3, String(r.earth_visible_pct));
  assert.ok(r.longest_night_days > 1 && r.longest_night_days < 20);
  assert.ok(r.mean_flux_sun_facing_wm2 > 800 && r.mean_flux_sun_facing_wm2 < 1361 * 1.04);
  assert.ok(tools.evaluations.get("E1") === r);
  assert.ok(progress.some((t) => /^StarHab: Sun \d+ %, Earth \d+ %/.test(t)), progress.join(" | "));
});

test("evaluate_site: a custom point without Moon Trek uses the coarse tiles; windows are clipped to the ephemeris", async () => {
  const tools = realTools({ live: async () => { throw new Error("offline"); } });
  const r = await tools.run("evaluate_site", { name: "Ridge point", site_id: "", lat_deg: -89.45, lon_deg: -137.3, start_utc: "2040-06-01T00:00:00Z", end_utc: "2045-01-01T00:00:00Z" });
  assert.equal(r.terrain_quality, "approximate");
  assert.match(r.terrain, /coarse LOLA tiles/);
  assert.equal(r.end_utc, "2040-12-31T23:00:00Z");
  assert.match(r.window_note, /ephemeris ends/);
  const bad = await tools.run("evaluate_site", { name: "x", site_id: "", lat_deg: 10, lon_deg: 10, start_utc: "1990-01-01T00:00:00Z", end_utc: "1991-01-01T00:00:00Z" });
  assert.match(bad.error, /covers 1966–1976 and 2013–2040/);
  const lat = await tools.run("evaluate_site", { name: "x", site_id: "", lat_deg: 95, lon_deg: 10, start_utc: "2030-01-01T00:00:00Z", end_utc: "2030-02-01T00:00:00Z" });
  assert.match(lat.error, /not a latitude/);
  assert.deepEqual(checkWindow("2030-01-01", "2029-01-01", [2030]).error, "end_utc must be after start_utc.");
});

test("evaluate_site: a far-side site never sees the Earth; at most 8 evaluations per run", async () => {
  const tools = realTools();
  const r = await tools.run("evaluate_site", { name: "Chang'e 4", site_id: "change4", lat_deg: 0, lon_deg: 0, start_utc: "2030-01-01T00:00:00Z", end_utc: "2030-03-01T00:00:00Z" });
  assert.equal(r.earth_visible_pct, 0);
  assert.equal(r.earth_in_view_time_pct, 0);
  assert.ok(r.longest_blackout_days > 58);
  for (let i = 1; i < MAX_EVALUATIONS; i++) {
    const ok = await tools.run("evaluate_site", { name: `A${i}`, site_id: "apollo11", lat_deg: 0, lon_deg: 0, start_utc: "2030-01-01T00:00:00Z", end_utc: "2030-01-03T00:00:00Z" });
    assert.ok(!ok.error, ok.error);
  }
  const over = await tools.run("evaluate_site", { name: "one more", site_id: "apollo11", lat_deg: 0, lon_deg: 0, start_utc: "2030-01-01T00:00:00Z", end_utc: "2030-01-03T00:00:00Z" });
  assert.match(over.error, /at most 8 site evaluations/);
});

test("suggest_dates: the engine's best windows at a catalog site", async () => {
  const tools = realTools();
  const r = await tools.run("suggest_dates", { name: "Shackleton rim", site_id: "shackleton_rim", lat_deg: 0, lon_deg: 0, from_utc: "2028-01-01T00:00:00Z", to_utc: "2029-01-01T00:00:00Z", window_days: 14, kinds: ["sun", "both"] });
  assert.ok(!r.error, r.error);
  assert.ok(r.windows.length >= 2);
  assert.deepEqual([...new Set(r.windows.map((w) => w.kind))], ["sun", "both"]);
  const best = r.windows[0];
  assert.equal(best.rank, 1);
  assert.ok(Date.parse(best.end_utc) - Date.parse(best.start_utc) > 13.9 * 86400e3);
  assert.ok(best.score_pct > 50 && best.score_pct <= 100, String(best.score_pct));
});

// ---------------------------------------------------------------------------------------------
// The agent loop with a scripted fake client

const msg = (content, stop_reason = "tool_use", usage = { input_tokens: 1000, output_tokens: 200 }) => ({ content, stop_reason, usage });
const use = (id, name, input) => ({ type: "tool_use", id, name, input });

function fakeClient(script) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(structuredClone(params));
          const next = script.shift();
          if (!next) throw new Error("script ended");
          if (next instanceof Error) throw next;
          return typeof next === "function" ? next(params) : next;
        },
      },
    },
  };
}

const FINAL = {
  summary: "Malapert wins.", assumptions: ["Fixed site."],
  sites: [{ name: "StarHab", site_id: "starhab", lat_deg: -85.96775, lon_deg: -2.28748, start_utc: "2030-01-01T00:00:00Z", end_utc: "2030-02-01T00:00:00Z", evaluation_id: "E1", why: "Most Earth.", metrics: { sun_pct: 1, earth_pct: 2, longest_night_days: 3, longest_blackout_days: 4 } }],
};

test("agent loop: requirements, tools, final recommendation; request settings; usage and cost", async () => {
  const client = fakeClient([
    msg([{ type: "thinking", thinking: "", signature: "x" }, use("t1", "set_requirements", { mission_summary: "A base", region: "south_pole", start_utc: "2030-01-01T00:00:00Z", end_utc: "2030-02-01T00:00:00Z", min_sun_pct: 70, min_earth_pct: 90, max_night_days: 10, max_blackout_days: 1, earth_must_be_hidden: false, mobility: "fixed", assumptions: ["10 m mast"] })]),
    msg([use("t2", "find_candidate_sites", { region: "south_pole", min_sunlit_pct: 80, kinds: [], max_results: 5 }), use("t3", "evaluate_site", { name: "StarHab", site_id: "starhab", lat_deg: -85.96775, lon_deg: -2.28748, start_utc: "2030-01-01T00:00:00Z", end_utc: "2030-02-01T00:00:00Z" })], "tool_use", { input_tokens: 100, output_tokens: 300, cache_read_input_tokens: 2000, cache_creation_input_tokens: 500 }),
    msg([{ type: "text", text: "Done." }, use("t4", "final_recommendation", FINAL)]),
  ]);
  const events = [];
  const out = await runMission({ client, tools: realTools(), mission: "A crewed base", onEvent: (e) => events.push(e) });
  assert.equal(out.turns, 3);
  assert.equal(out.final.summary, "Malapert wins.");
  assert.ok(out.evaluations.get("E1"));
  // Request settings: model, adaptive thinking, effort medium, the refusal fallback, strict tools, caching.
  const p = client.calls[0];
  assert.equal(p.model, "claude-opus-5-5");
  assert.equal(MODEL, "claude-opus-5-5");
  assert.deepEqual(p.thinking, { type: "adaptive" });
  assert.deepEqual(p.output_config, { effort: "medium" });
  assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(p.fallbacks, "default");
  assert.ok(!("temperature" in p) && !("tool_choice" in p));
  assert.deepEqual(p.cache_control, { type: "ephemeral" });
  assert.equal(p.messages[0].content, "Mission: A crewed base");
  // The second request echoes the first turn and answers its tool call; the third answers both calls in one message.
  assert.equal(client.calls[1].messages.length, 3);
  assert.equal(client.calls[1].messages[2].content[0].tool_use_id, "t1");
  const third = client.calls[2].messages.at(-1).content;
  assert.deepEqual(third.map((r) => r.tool_use_id), ["t2", "t3"]);
  assert.ok(third.every((r) => !r.is_error));
  assert.equal(JSON.parse(third[1].content).evaluation_id, "E1");
  // Events
  assert.equal(events.filter((e) => e.type === "requirements").length, 1);
  assert.deepEqual(events.filter((e) => e.type === "result").map((e) => e.name), ["find_candidate_sites", "evaluate_site"]);
  assert.deepEqual(out.usage, { input: 1100 + 1000, output: 700, cacheWrite: 500, cacheRead: 2000 });
  assert.ok(Math.abs(out.cost - (2100 * 4 + 700 * 20 + 500 * 5 + 2000 * 0.2) / 1e6) < 1e-12);
});

test("agent loop error paths: refusal, max_tokens, no answer, too many steps, tool errors", async () => {
  const req = use("r", "set_requirements", {});
  await assert.rejects(runMission({ client: fakeClient([{ content: [], stop_reason: "refusal", stop_details: { category: "cyber" }, usage: {} }]), tools: realTools(), mission: "x" }),
    (e) => e instanceof AgentError && e.kind === "refusal" && /declined/.test(e.message) && /cyber/.test(e.message));
  await assert.rejects(runMission({ client: fakeClient([msg([req], "max_tokens")]), tools: realTools(), mission: "x" }),
    (e) => e.kind === "max_tokens");
  const notes = [];
  await assert.rejects(runMission({ client: fakeClient([msg([{ type: "text", text: "I cannot." }], "end_turn")]), tools: realTools(), mission: "x", onEvent: (e) => e.type === "note" && notes.push(e.text) }),
    (e) => e.kind === "no_answer");
  assert.deepEqual(notes, ["I cannot."]);
  // A model that never stops calling tools: the loop ends after MAX_TURNS turns, and tool calls past 12 come back as errors.
  const loop = fakeClient(Array.from({ length: MAX_TURNS + 2 }, (_, i) => msg([use(`f${i}`, "find_candidate_sites", { region: "north_pole", min_sunlit_pct: 0, kinds: ["poi"], max_results: 1 })])));
  await assert.rejects(runMission({ client: loop, tools: realTools(), mission: "x" }), (e) => e.kind === "too_many_steps");
  assert.equal(loop.calls.length, MAX_TURNS);
  const last = loop.calls.at(-1).messages.at(-1).content[0];
  assert.equal(last.is_error, true);
  assert.match(last.content, /at most 12 tool calls/);
  // A tool that throws is an error result, not a crash.
  const tools = realTools();
  const broken = { ...tools, run: async () => { throw new Error("boom"); } };
  const c = fakeClient([msg([use("b", "find_candidate_sites", {})]), msg([use("z", "final_recommendation", FINAL)])]);
  await runMission({ client: c, tools: broken, mission: "x" });
  assert.match(c.calls[1].messages.at(-1).content[0].content, /The tool failed: boom/);
});

test("agent loop: HTTP errors (401, 429, network) reject, and explainError words them plainly", async () => {
  const http = (status, name) => Object.assign(new Error(`${status}`), { status, name });
  for (const [err, kind, re] of [
    [http(401, "AuthenticationError"), "bad_key", /did not accept this API key \(401\)/],
    [http(429, "RateLimitError"), "rate_limit", /rate limit/],
    [Object.assign(new Error("Connection error."), { name: "APIConnectionError" }), "network", /Could not reach api\.anthropic\.com/],
    [http(529, "InternalServerError"), "server", /busy or failing \(529\)/],
    [http(400, "BadRequestError"), "bad_request", /invalid \(400\)/],
  ]) {
    const e = await runMission({ client: fakeClient([err]), tools: realTools(), mission: "x" }).catch((x) => x);
    assert.equal(e, err);
    const x = explainError(e);
    assert.equal(x.kind, kind);
    assert.match(x.message, re);
  }
  // With the SDK's classes, instanceof decides.
  class AuthenticationError extends Error {}
  assert.equal(explainError(new AuthenticationError("x"), { AuthenticationError }).kind, "bad_key");
  assert.equal(explainError(Object.assign(new Error("a"), { name: "AbortError" })).kind, "stopped");
  assert.equal(explainError(new AgentError("refusal", "no")).message, "no");
});

test("agent loop: stop button (AbortSignal) ends the run between tools", async () => {
  const ctl = new AbortController();
  const client = fakeClient([msg([use("a", "find_candidate_sites", { region: "south_pole", min_sunlit_pct: 0, kinds: [], max_results: 3 })])]);
  const tools = realTools();
  const t = { ...tools, run: async (n, i) => { ctl.abort(); return tools.run(n, i); } };
  await assert.rejects(runMission({ client, tools: t, mission: "x", signal: ctl.signal }), (e) => e.name === "AbortError");
});

test("fallback turns are echoed without the declined attempt's thinking and tool use; usage sums every attempt", () => {
  const content = [{ type: "thinking", thinking: "" }, { type: "tool_use", id: "a" }, { type: "text", text: "partial" }, { type: "fallback", from: { model: "a" }, to: { model: "b" } }, { type: "tool_use", id: "b" }];
  assert.deepEqual(echoContent(content).map((b) => b.type), ["text", "fallback", "tool_use"]);
  assert.equal(echoContent(content.slice(0, 2)).length, 2);
  const u = usageOf({ usage: { input_tokens: 5, iterations: [{ type: "message", input_tokens: 10, output_tokens: 1 }, { type: "fallback_message", input_tokens: 20, output_tokens: 2 }] } });
  assert.deepEqual(u, { input: 30, output: 3, cacheWrite: 0, cacheRead: 0 });
  assert.equal(costUsd({ input: 1e6, output: 0, cacheWrite: 0, cacheRead: 0 }), 4);
  assert.equal(requestParams([]).max_tokens, 16000);
});

// ---------------------------------------------------------------------------------------------
// Result cards and the map

test("result sites take the tool's numbers by evaluation id (or place), else the model's are marked unchecked", () => {
  const ev = { evaluation_id: "E1", name: "StarHab", site_id: "starhab", lat_deg: -85.96775, lon_deg: -2.28748, start_utc: "2030-01-01T00:00:00Z", end_utc: "2030-02-01T00:00:00Z", sun_visible_pct: 80 };
  const evals = new Map([["E1", ev]]);
  const [a] = resultSites(FINAL, evals);
  assert.equal(a.source, "tool");
  assert.equal(a.evaluation.sun_visible_pct, 80);
  const [b] = resultSites({ sites: [{ ...FINAL.sites[0], evaluation_id: "" }] }, evals);
  assert.equal(b.source, "tool");
  const [c] = resultSites({ sites: [{ ...FINAL.sites[0], evaluation_id: "E9", lat_deg: 10, lon_deg: 10 }] }, evals);
  assert.equal(c.source, "model");
  assert.equal(c.model_metrics.sun_pct, 1);
});

test("adding sites to the map: fills the empty card, skips duplicates, keeps within the 6-place limit", () => {
  const site = (i) => ({ name: `S${i}`, site_id: "", lat_deg: -85 - i / 10, lon_deg: i, start_utc: "2030-01-01T00:00:00Z", end_utc: "2031-01-01T00:00:00Z" });
  const empty = [{ id: "a", label: "", lat_deg: null, lon_deg: null, t_start_utc: "2026-01-01T00:00:00Z", t_end_utc: null, color: 0 }];
  const p = planPlaces(empty, [site(1), site(2)]);
  assert.equal(p.added, 2);
  assert.equal(p.scenarios.length, 2);
  assert.equal(p.scenarios[0].id, "a"); // the empty card is reused
  assert.equal(p.scenarios[0].label, "S1");
  assert.equal(p.scenarios[0].t_src, "user");
  assert.equal(p.focus, 0);
  const again = planPlaces(p.scenarios, [site(2)]);
  assert.equal(again.added, 0);
  assert.equal(again.focus, 1);
  const five = Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, lat_deg: i, lon_deg: i, t_start_utc: "2030-01-01T00:00:00Z" }));
  const full = planPlaces(five, [site(1), site(2), site(3)]);
  assert.equal(full.added, 1);
  assert.equal(full.skipped, 2);
  assert.equal(full.scenarios.length, 6);
});

// ---------------------------------------------------------------------------------------------
// The key and the SDK

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test("the API key: session by default, local only when remembered, one place at a time, forget clears both", () => {
  const stores = { session: memStore(), local: memStore() };
  assert.deepEqual(readKey(stores), { key: "", remembered: false });
  saveKey(" sk-ant-abc ", false, stores);
  assert.equal(stores.session.m.get(KEY_NAME), "sk-ant-abc");
  assert.equal(stores.local.m.size, 0);
  assert.deepEqual(readKey(stores), { key: "sk-ant-abc", remembered: false });
  saveKey("sk-ant-abc", true, stores);
  assert.equal(stores.local.m.get(KEY_NAME), "sk-ant-abc");
  assert.equal(stores.session.m.size, 0);
  assert.deepEqual(readKey(stores), { key: "sk-ant-abc", remembered: true });
  forgetKey(stores);
  assert.equal(stores.local.m.size + stores.session.m.size, 0);
  // Blocked storage (private mode) never throws.
  const blocked = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };
  saveKey("sk-ant-x", true, { session: blocked, local: blocked });
  assert.deepEqual(readKey({ session: blocked, local: blocked }), { key: "", remembered: false });
  assert.ok(looksLikeKey("sk-ant-api03-" + "a".repeat(40)));
  assert.ok(!looksLikeKey("hello"));
});

test("the SDK: an exact pinned version from jsDelivr, loaded once, only by AI mode", async () => {
  assert.match(SDK_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(SDK_URL, `https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@${SDK_VERSION}/+esm`);
  let n = 0;
  const fake = async () => { n++; return { default: class { constructor(o) { this.o = o; } } }; };
  await loadSdk(fake);
  await loadSdk(fake);
  assert.equal(n, 1);
  const refs = readFileSync(`${REPO}docs/REFERENCES.md`, "utf8");
  assert.ok(refs.includes(`@anthropic-ai/sdk`) && refs.includes(SDK_VERSION), "docs/REFERENCES.md lists the SDK and its version");
  // The main page loads AI mode only on demand: no static import of web/js/ai from the app.
  const main = readFileSync(`${WEB}js/app/main.js`, "utf8");
  assert.ok(!/^import [^;]*["']\.\.\/ai\//m.test(main));
  assert.match(main, /import\("\.\.\/ai\/panel\.js"\)/);
  const html = readFileSync(`${WEB}index.html`, "utf8");
  assert.match(html, /id="btn-ai"/);
  // The key never goes into a link: the share link code does not know about it.
  assert.ok(!readFileSync(`${WEB}js/app/state.js`, "utf8").includes("anthropic"));
});
