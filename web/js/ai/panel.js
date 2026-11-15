// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// AI mode's panel: a dialog where the user describes a mission, pastes their own Anthropic API key and gets sites
// ranked by Claude with Moonat's physics (web/js/ai/agent.js + tools.js). Loaded by the header's "AI mode" button
// (web/js/app/main.js) on the first press; it loads its own stylesheet (web/css/ai.css). The SDK loads only when a
// run starts (web/js/ai/sdk.js).

import { createTools, latLonText, MAX_EVALUATIONS } from "./tools.js";
import { runMission, explainError, AgentError } from "./agent.js";
import { resultSites, planPlaces } from "./result.js";
import { makeClient, readKey, saveKey, forgetKey } from "./sdk.js";
import { icon } from "../app/icons.js";
import { store, setScenarios, setActive } from "../app/store.js";
import { PALETTE, parseUtc, formatDuration } from "../app/state.js";
import { catalogSites } from "../app/catalog.js";
import { seriesFor, loadHorizon, customHorizon, physicsCoverage } from "../app/physics_adapter.js";
import { flyTo, fitTo } from "../app/globe_api.js";
import { makeSite } from "../physics/index.js";
import { terrainAt } from "../terrain/index.js";
import { suggestDates } from "../suggest/index.js";

/** The map's place limit (one per palette colour, as web/js/app/places.js MAX_PLACES). */
const MAX_PLACES = PALETTE.dark.length;

export const EXAMPLES = [
  { label: "Crewed base, 2030-2040", text: "A crewed base for 10 years from 2030 that needs maximum sunlight and continuous Earth contact." },
  { label: "Ice prospecting rover", text: "A 14-day polar ice prospecting rover in 2028 that must talk to Earth every day." },
  { label: "Far-side radio telescope", text: "A far-side radio telescope shielded from Earth's radio noise." },
];

const LABEL = "AI suggestions; the numbers come from Moonat's validated physics.";

let dlg = null;
let running = null; // AbortController of the current run
let lastSites = [];

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

const $ = (sel) => dlg.querySelector(sel);
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x)} %` : "n/a");
const d1 = (x) => (Number.isFinite(x) ? `${x < 10 ? x.toFixed(1) : Math.round(x)} d` : "n/a");
const dateText = (iso) => {
  const ms = parseUtc(String(iso || ""));
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const grouped = (n) => Math.round(n).toLocaleString("en-US").replace(/,/g, " ");

function loadStyles() {
  if (document.querySelector('link[data-ai-css]')) return;
  document.head.append(el("link", { rel: "stylesheet", href: new URL("../../css/ai.css", import.meta.url).href, "data-ai-css": "" }));
}

// ---------------------------------------------------------------------------------------------
// Building the dialog

function build() {
  loadStyles();
  const key = readKey();
  dlg = el("dialog", { id: "ai-dialog", class: "about ai-panel", "aria-labelledby": "ai-title" });
  dlg.innerHTML = `
    <form method="dialog" class="about-close"><button class="icon-btn" aria-label="Close">${icon("close")}</button></form>
    <h2 id="ai-title"><span class="ai-title-ico">${icon("ai")}</span>AI mode: where should your mission go?</h2>
    <p class="ai-label">${LABEL}</p>
    <p class="lead">Describe a mission in your own words. Claude runs Moonat's own Sun, Earth and terrain calculations on up
      to ${MAX_EVALUATIONS} candidate sites and ranks them.</p>
    <label class="ai-h" for="ai-mission">Your mission</label>
    <textarea id="ai-mission" rows="3" placeholder="e.g. A solar-powered lander at the south pole for one lunar day in 2027, with direct radio contact to Earth"></textarea>
    <div class="chips ai-examples" role="group" aria-label="Example missions"></div>
    <div class="ai-keybox">
      <label class="ai-h" for="ai-key">Your Anthropic API key</label>
      <div class="ai-keyline">
        <input id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-...">
        <button type="button" class="ghost" id="ai-forget">Forget key</button>
      </div>
      <label class="ai-check"><input type="checkbox" id="ai-remember"> Remember on this device</label>
      <p class="ai-note">About $0.10–0.30 a mission. The key stays in this browser, goes only to api.anthropic.com and is
        never put in a link. <a href="https://console.anthropic.com/" target="_blank" rel="noopener">Get a key in the Anthropic Console</a>.</p>
    </div>
    <div class="ai-actions">
      <button type="button" class="ai-go" id="ai-go">${icon("ai")}<span>Suggest sites</span></button>
      <button type="button" class="ghost" id="ai-stop" hidden>Stop</button>
      <span class="ai-usage" id="ai-usage" aria-live="polite"></span>
    </div>
    <p class="banner ai-error" id="ai-error" role="alert" hidden></p>
    <section class="ai-req" id="ai-req" hidden></section>
    <ol class="ai-log" id="ai-log" aria-live="polite"></ol>
    <section class="ai-result" id="ai-result" hidden></section>`;
  document.body.append(dlg);

  const ex = $(".ai-examples");
  for (const e of EXAMPLES) {
    const b = el("button", { type: "button", class: "chip", text: e.label, title: e.text });
    b.addEventListener("click", () => {
      $("#ai-mission").value = e.text;
      $("#ai-mission").focus();
    });
    ex.append(b);
  }
  const keyIn = $("#ai-key");
  const remember = $("#ai-remember");
  keyIn.value = key.key;
  remember.checked = key.remembered;
  remember.addEventListener("change", () => keyIn.value.trim() && saveKey(keyIn.value, remember.checked));
  keyIn.addEventListener("change", () => saveKey(keyIn.value, remember.checked));
  $("#ai-forget").addEventListener("click", () => {
    forgetKey();
    keyIn.value = "";
    remember.checked = false;
    keyIn.focus();
  });
  $("#ai-go").addEventListener("click", start);
  $("#ai-stop").addEventListener("click", () => running?.abort());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
}

/** Open the AI mode panel (built on the first call). */
export function openAiPanel() {
  if (!dlg) build();
  for (const d of document.querySelectorAll("dialog[open]")) if (d !== dlg) d.close();
  if (!dlg.open) {
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute("open", "");
  }
  // With a mouse, start typing at once; on a touch screen do not pop the keyboard up over the panel.
  if (!$("#ai-mission").value && globalThis.matchMedia?.("(pointer: fine)").matches) $("#ai-mission").focus();
}

// ---------------------------------------------------------------------------------------------
// A run

function showError(msg) {
  const e = $("#ai-error");
  e.textContent = msg;
  e.hidden = !msg;
}

function setBusy(on) {
  $("#ai-go").disabled = on;
  $("#ai-stop").hidden = !on;
  $("#ai-mission").readOnly = on;
  dlg.classList.toggle("busy", on);
}

let current = null; // the log line in progress
function logLine(text, cls = "") {
  current?.classList.remove("active");
  const li = el("li", { class: `ai-step ${cls} active` }, el("span", { class: "ai-step-txt", text }), el("span", { class: "ai-step-sub" }));
  $("#ai-log").append(li);
  current = li;
  li.scrollIntoView?.({ block: "nearest" });
  return li;
}
const subLine = (text) => current && (current.querySelector(".ai-step-sub").textContent = text);
const doneLine = (text, cls = "done") => {
  if (!current) return;
  current.classList.remove("active");
  current.classList.add(cls);
  if (text) current.querySelector(".ai-step-txt").textContent = text;
  current.querySelector(".ai-step-sub").textContent = "";
};

function showRequirements(r) {
  const box = $("#ai-req");
  const rows = [
    ["Mission", r.mission_summary],
    ["Region", String(r.region || "").replace("_", " ")],
    ["Dates", `${dateText(r.start_utc)} to ${dateText(r.end_utc)}`],
    ["Sunlight", r.min_sun_pct > 0 ? `at least ${Math.round(r.min_sun_pct)} % of the Sun's light on average` : "not required"],
    ["Earth contact", r.earth_must_be_hidden ? "the Earth must stay hidden" : r.min_earth_pct > 0 ? `at least ${Math.round(r.min_earth_pct)} % of the Earth's disk in view on average` : "not required"],
    ["Longest night", r.max_night_days > 0 ? `at most ${r.max_night_days} days` : "no limit"],
    ["Longest Earth blackout", r.max_blackout_days > 0 ? `at most ${r.max_blackout_days} days` : r.earth_must_be_hidden ? "n/a" : "no limit"],
    ["Mobility", r.mobility],
  ];
  box.replaceChildren(
    el("h3", { text: "Requirements (Claude's reading of your mission)" }),
    el("dl", { class: "ai-req-list" }, ...rows.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v || "n/a" })])),
  );
  if (Array.isArray(r.assumptions) && r.assumptions.length) {
    box.append(el("p", { class: "ai-sub", text: "Assumptions" }), el("ul", { class: "ai-assume" }, ...r.assumptions.map((a) => el("li", { text: a }))));
  }
  box.hidden = false;
}

function toolStartText(name, input) {
  if (name === "find_candidate_sites") {
    const where = String(input.region || "anywhere").replace("_", " ");
    return `Finding candidate sites: ${where}${input.min_sunlit_pct > 0 ? `, sunlit spots lit at least ${Math.round(input.min_sunlit_pct)} % of the time` : ""}`;
  }
  if (name === "evaluate_site") return `Evaluating ${input.name || latLonText(input.lat_deg, input.lon_deg)} (${dateText(input.start_utc)} to ${dateText(input.end_utc)})`;
  if (name === "suggest_dates") return `Searching the best dates at ${input.name || latLonText(input.lat_deg, input.lon_deg)}`;
  return `Running ${name}`;
}

function toolDoneText(name, input, r) {
  if (r?.error) return null;
  if (name === "find_candidate_sites") return `Found ${r.count} candidate sites (${String(r.region).replace("_", " ")})`;
  if (name === "evaluate_site") {
    const terr = r.terrain_quality === "real" ? "" : r.terrain_quality === "approximate" ? " (approximate terrain)" : " (no terrain)";
    return `${r.name}: Sun ${pct(r.sun_visible_pct)}, Earth ${pct(r.earth_visible_pct)}, longest night ${d1(r.longest_night_days)}${terr}`;
  }
  if (name === "suggest_dates") {
    const best = (r.windows || []).find((w) => !w.note) || r.windows?.[0];
    return best ? `${r.name}: ${best.title}` : `${r.name}: no windows found`;
  }
  return null;
}

function showUsage(u, cost) {
  const tokIn = u.input + u.cacheWrite + u.cacheRead;
  $("#ai-usage").textContent = `${grouped(tokIn)} tokens in${u.cacheRead ? ` (${grouped(u.cacheRead)} cached)` : ""}, ${grouped(u.output)} out: about $${cost.toFixed(2)}`;
}

/** The dependencies of the tools in the page: the app's own catalog, horizons, terrain, physics and date engine. */
function pageTools() {
  const R = 3e-4; // web/js/app/terrain_live.js rounds points the same way, so its later request hits the same cache
  const round = (x) => Math.round(x / R) * R;
  let spots = null;
  const paint = () => new Promise((r) => setTimeout(r, 30)); // let the log paint before the main-thread physics
  return createTools({
    sites: () => catalogSites(),
    spotRows: () => (spots ??= fetch("data/overlays/overlays.json").then((r) => (r.ok ? r.json() : null)).then((j) => j?.sun_spots?.rows || []).catch(() => [])),
    catalogHorizon: (id) => loadHorizon(id),
    liveTerrain: (lat, lon) => terrainAt(round(lat), round(lon)),
    tilesHorizon: (lat, lon) => customHorizon(lat, lon),
    makeSite,
    series: async (site, t0, t1, step) => {
      await paint();
      return seriesFor(site, t0, t1, step);
    },
    suggest: (spec, opts) => suggestDates(spec, opts),
    coverage: () => physicsCoverage(),
    onProgress: (t) => subLine(t),
  });
}

async function start() {
  showError("");
  const mission = $("#ai-mission").value.trim();
  const key = $("#ai-key").value.trim();
  if (!mission) return showError("Describe your mission first, or pick one of the examples.");
  if (!key) return showError("Paste your Anthropic API key first. You can get one in the Anthropic Console.");
  if (!/^sk-ant-/.test(key)) return showError("That does not look like an Anthropic API key: they start with sk-ant-.");
  saveKey(key, $("#ai-remember").checked);

  $("#ai-log").replaceChildren();
  $("#ai-req").hidden = true;
  $("#ai-result").hidden = true;
  $("#ai-usage").textContent = "";
  current = null;
  running = new AbortController();
  const signal = running.signal;
  setBusy(true);
  let sdk = null;
  try {
    logLine("Loading the Claude client");
    const made = await makeClient(key).catch(() => {
      throw new AgentError("network", "Could not load the Claude client from cdn.jsdelivr.net. Check your internet connection and try again.");
    });
    sdk = made.sdk;
    doneLine("Claude client ready");
    const tools = pageTools();
    const out = await runMission({
      client: made.client,
      tools,
      mission,
      signal,
      onEvent: (e) => {
        if (e.type === "turn") logLine(e.n === 1 ? "Claude is reading your mission" : "Claude is weighing the results", "think");
        else if (e.type === "requirements") {
          doneLine("Requirements set");
          showRequirements(e.input);
        } else if (e.type === "tool") {
          if (current?.classList.contains("think")) doneLine();
          logLine(toolStartText(e.name, e.input), "tool");
        } else if (e.type === "result") {
          const t = toolDoneText(e.name, e.input, e.result);
          if (e.result?.error) doneLine(`${toolStartText(e.name, e.input)}: ${e.result.error}`, "warn");
          else doneLine(t);
        } else if (e.type === "usage") showUsage(e.usage, e.cost);
        else if (e.type === "note") logLine(e.text, "note");
      },
    });
    doneLine("Done");
    current?.classList.remove("think");
    showResult(out);
  } catch (err) {
    const x = explainError(err, sdk);
    if (current) doneLine(x.kind === "stopped" ? "Stopped" : null, x.kind === "stopped" ? "done" : "warn");
    if (x.kind !== "stopped") showError(x.message);
  } finally {
    running = null;
    setBusy(false);
  }
}

// ---------------------------------------------------------------------------------------------
// The result

function metricRows(s) {
  const e = s.evaluation;
  if (!e) {
    const m = s.model_metrics || {};
    return el("p", { class: "ai-unchecked" }, el("span", { html: icon("warning") }),
      ` Not evaluated by Moonat in this run. Claude's figures: Sun ${pct(m.sun_pct)}, Earth ${pct(m.earth_pct)}, longest night ${d1(m.longest_night_days)}.`);
  }
  const big = (ico, val, sub, cls = "") => el("div", { class: `ai-m ${cls}` }, el("span", { class: "ai-m-ico", html: icon(ico) }), el("strong", { text: val }), el("span", { class: "ai-m-sub", text: sub }));
  const hidden = e.earth_in_view_time_pct === 0;
  return el("div", { class: "ai-metrics" },
    big("sun", pct(e.sun_visible_pct), "of the Sun's light", "sun"),
    big("earth", pct(e.earth_visible_pct), hidden ? "Earth never in view" : "of the Earth's disk", "earth"),
    big("clock", d1(e.longest_night_days), "longest night"),
    big("earthrise", hidden ? "always" : d1(e.longest_blackout_days), "longest Earth blackout"),
  );
}

function card(s) {
  const e = s.evaluation;
  const when = s.start_utc ? `${dateText(s.start_utc)} to ${dateText(s.end_utc)}${s.end_utc ? ` (${formatDuration(parseUtc(s.end_utc) - parseUtc(s.start_utc))})` : ""}` : "";
  const show = el("button", { type: "button", class: "ghost ai-show", html: `${icon("pin")}<span>Show on map</span>` });
  show.addEventListener("click", () => addToMap([s]));
  const li = el("li", { class: "ai-card" },
    el("div", { class: "ai-card-head" },
      el("span", { class: "ai-rank", text: String(s.rank) }),
      el("div", { class: "ai-card-title" }, el("h4", { text: s.name }), el("p", { class: "ai-where", text: `${latLonText(s.lat_deg, s.lon_deg)}${when ? ` · ${when}` : ""}` })),
      show),
    metricRows(s),
  );
  if (e) {
    const extra = [
      `Sunlight ${pct(e.sunlit_time_pct)} of the time`,
      e.earth_in_view_time_pct > 0 ? `Earth in view ${pct(e.earth_in_view_time_pct)} of the time` : null,
      `Sun-facing panel ${grouped(e.mean_flux_sun_facing_wm2)} W/m² on average`,
      `${e.eclipse_count} eclipse${e.eclipse_count === 1 ? "" : "s"} of the Sun by the Earth`,
    ].filter(Boolean).join(" · ");
    li.append(el("p", { class: "ai-extra", text: extra }));
    li.append(el("p", { class: "ai-terrain", text: `Terrain: ${e.terrain}. Eye 2 m above the ground; masts not modelled.` }));
  }
  if (s.why) li.append(el("p", { class: "ai-why" }, el("strong", { text: "Why: " }), s.why));
  return li;
}

function showResult(out) {
  const box = $("#ai-result");
  const sites = resultSites(out.final, out.evaluations);
  lastSites = sites;
  const addAll = el("button", { type: "button", class: "ai-go ai-addall", html: `${icon("plus")}<span>Add all to the map</span>` });
  addAll.addEventListener("click", () => addToMap(lastSites));
  box.replaceChildren(
    el("div", { class: "ai-result-head" }, el("h3", { text: "Recommended sites" }), sites.length ? addAll : null),
    el("p", { class: "ai-label", text: LABEL }),
    el("p", { class: "ai-summary", text: out.final.summary || "" }),
  );
  if (Array.isArray(out.final.assumptions) && out.final.assumptions.length) {
    box.append(el("p", { class: "ai-sub", text: "Assumptions" }), el("ul", { class: "ai-assume" }, ...out.final.assumptions.map((a) => el("li", { text: a }))));
  }
  box.append(el("ol", { class: "ai-cards" }, ...sites.map(card)));
  box.hidden = false;
  box.scrollIntoView?.({ block: "start", behavior: "smooth" });
}

let toastTimer = 0;
function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.replaceChildren(el("span", { text: msg }));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3600);
}

/** Add sites as places on the map (scenarios with the suggested times), select the first, and show it. */
export function addToMap(sites) {
  if (!sites.length) return;
  // Only real catalog ids become a place's site (its precomputed terrain); any other id is a custom point.
  const ids = new Set(catalogSites().map((x) => x.id));
  const clean = sites.map((s) => ({ ...s, site_id: ids.has(s.site_id) ? s.site_id : "" }));
  const plan = planPlaces(store.scenarios, clean, MAX_PLACES);
  setScenarios(plan.scenarios);
  const focus = store.scenarios[plan.focus];
  if (focus) setActive(focus.id);
  if (sites.length === 1) flyTo(sites[0].lat_deg, sites[0].lon_deg, 10);
  else fitTo(sites.map((s) => ({ lat_deg: s.lat_deg, lon_deg: s.lon_deg })), { maxZoom: 10 });
  dlg?.close();
  document.getElementById("map")?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  const n = plan.added;
  const full = plan.skipped ? ` ${plan.skipped} did not fit: the map holds ${MAX_PLACES} places (remove one by clicking its pin).` : "";
  toast(n ? `Added ${n} place${n === 1 ? "" : "s"} from AI mode, with the suggested dates.${full}` : plan.skipped ? `The map is full (${MAX_PLACES} places).${full}` : "Already on the map: selected it.");
}
