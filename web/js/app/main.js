// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// App entry: wires the store, the globe, the scenario cards, the physics, the sky views, the Sun | Earth switch and the
// data under it, the event hints, theme, sharing and the About panels. The page is one flow: place and time (globe,
// cards, stories), then the sky from there, then the chosen body's data.

import { store, subscribe, setScenarios, setUi, updateScenario } from "./store.js";
import {
  colorHex, isWrappedSlot, validateScenario, scenarioTimes, physicsKey, encodeHash, decodeHash, hashBody, coverageEnd, makeScenario,
  DAY_MS, HOUR_MS,
} from "./state.js";
import { missionSeries } from "./playback.js";
import { loadCatalog, QUICK_STARTS, catalogSites } from "./catalog.js";
import { initPhysics, physicsError, physicsCoverage, siteFor, stateAt, seriesFor, useLiveTerrain } from "./physics_adapter.js";
import { readyTerrain, ensureTerrain, keepOnly, onTerrainChange } from "./terrain_live.js";
import { initScenarioUI } from "./scenarios_ui.js";
import { renderCompare, rerenderCompare, initBodySwitch, syncBody, holdChartsUntil, setChartCursor } from "./compare.js";
import { initSky, setSkyItems, queueSkyStart, skyShareState, setSkyBody, jumpTo, skyTime } from "./sky_panel.js";
import { pickHint } from "./events.js";
import { suggestBody, suggestWindow } from "./suggest_adapter.js";
import { routeCore } from "../rover/app.js";

const $ = (id) => document.getElementById(id);
const LOOKAHEAD_MS = 30 * DAY_MS;

// ---------------------------------------------------------------------------------------------
// Theme

function initTheme() {
  store.theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const btn = $("btn-theme");
  const label = () => btn.setAttribute("aria-label", store.theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  label();
  btn.addEventListener("click", () => {
    const t = store.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("moonat-theme", t);
    } catch {
      /* storage blocked */
    }
    setUi({ theme: t });
    label();
  });
}

// ---------------------------------------------------------------------------------------------
// Compute (debounced, cached per physics inputs)

const cache = new Map();

/** Custom points are computed again once their real (Moon Trek) terrain arrives. */
const terrainTag = (s) => (!s.site_id && !s.route && readyTerrain(s.lat_deg, s.lon_deg) ? "|trek" : "");

function computeCore(s) {
  const key = physicsKey(s);
  const ckey = key + terrainTag(s);
  if (!cache.has(ckey)) {
    if (cache.size > 80) cache.delete(cache.keys().next().value);
    const p = (async () => {
      // Rover traverse (advanced mode): planned route, the sky along it (web/js/rover/app.js).
      if (s.route) return routeCore(s);
      const { site, horizon, patch } = await siteFor(s);
      const { t0, t1, span } = scenarioTimes(s);
      const state0 = await stateAt(site, t0);
      let series = null;
      let look = null;
      if (span > 0) {
        // The step follows the span (5 min for days to 3 h for decades), with detail around eclipses (playback.js).
        const a = performance.now();
        series = await missionSeries(site, t0, t1, seriesFor);
        performance.measure?.(`moonat:series ${series.t_ms.length}`, { start: a, end: performance.now() });
      } else {
        // Look ahead for the next set or rise, without running past the end of the ephemeris tables.
        const end = coverageEnd(t0, physicsCoverage());
        const t1Look = Math.min(t0 + LOOKAHEAD_MS, end === null ? Infinity : end - HOUR_MS);
        if (t1Look - t0 >= 2 * HOUR_MS) look = await seriesFor(site, t0, t1Look, HOUR_MS);
      }
      return { key, site, horizon, patch, t0, t1, span, state0, series, look, error: null };
    })().catch((error) => {
      if (!error?.code) console.error("[moonat] compute failed", error); // route problems (code) show on the route card
      cache.delete(ckey);
      return { key, error };
    });
    cache.set(ckey, p);
  }
  return cache.get(ckey);
}

let computeSeq = 0;
let lastItems = [];
let computed = false; // the first compute has finished (until then the page keeps its first-paint layout)

let busyTimer = 0;
/**
 * Show that results are being computed. A compute that takes longer than a moment (a rover route is planned from
 * live terrain in several seconds) also dims the results still on screen, which belong to the previous scenarios,
 * and labels the sky, which has no other progress indicator.
 */
function setBusy(on, text = "Computing…") {
  $("busy").hidden = !on;
  clearTimeout(busyTimer);
  const els = [$("compare-body"), $("sky-grid")];
  if (!on) {
    for (const e of els) delete e.dataset.busy;
    return;
  }
  busyTimer = setTimeout(() => {
    for (const e of els) e.dataset.busy = text;
  }, 400);
}

async function recompute() {
  const seq = ++computeSeq;
  const valid = store.scenarios
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => validateScenario(s, physicsCoverage()).ok);
  setBusy(true, valid.some(({ s }) => s.route) ? "Planning the rover route…" : "Computing…");
  // Stop fetching real terrain for points no scenario shows any more (rapid map clicks, edited coordinates).
  keepOnly(valid.filter(({ s }) => !s.site_id).map(({ s }) => [s.lat_deg, s.lon_deg]));
  const cores = await Promise.all(valid.map(({ s }) => computeCore(s)));
  if (seq !== computeSeq) return; // a newer request superseded this one
  setBusy(false);
  computed = true;
  lastItems = valid.map(({ s, index }, i) => ({ ...cores[i], s, index }));
  render();
  if (pendingJump) {
    // A window opened around an event (a suggested eclipse, "Show me"): the sky shows the event's maximum.
    const it = lastItems.find((x) => x.s.id === pendingJump.id && !x.error);
    if (it) jumpTo(pendingJump.atMs - it.t0);
    pendingJump = null;
  }
}

let pendingJump = null; // { id, atMs }: the moment to show once the scenario's new window is computed

/** Give a scenario new times; atMs (epoch ms, optional): the moment the sky then shows. */
function openWindow(id, t_start_utc, t_end_utc, atMs = null) {
  pendingJump = Number.isFinite(atMs) ? { id, atMs } : null;
  updateScenario(id, { t_start_utc, t_end_utc }, "structure");
}

function decorate(it) {
  return { ...it, label: it.s.label || `Scenario ${it.index + 1}`, color: colorHex(it.s.color, store.theme), dash: isWrappedSlot(it.s.color) };
}

function render() {
  const items = lastItems.map(decorate);
  const ok = items.filter((it) => !it.error);
  const any = ok.length > 0;
  // Nothing to show (no complete scenario): one empty state with the stories instead of the sky and the data.
  $("out-empty").hidden = any || !computed;
  $("sky-panel").hidden = !any && computed;
  $("body-bar").hidden = !any;
  renderCompare(items, { xaxis: store.xaxis });
  setSkyItems(ok);
  syncHint();
}

// ---------------------------------------------------------------------------------------------
// Event hint: one subtle line under the timelapse when the scenarios hold something special (an eclipse, an
// Earthrise) that the sky is not showing yet, with "Show me" (web/js/app/events.js).

let hint = null;

function syncHint() {
  const items = lastItems.filter((it) => !it.error).map(decorate);
  hint = pickHint(items, skyTime().offsetMs);
  const box = $("event-hint");
  box.hidden = !hint;
  if (!hint) return;
  const text = box.querySelector(".hint-text");
  if (text && text.textContent === hint.text) return;
  box.innerHTML = '<span class="hint-text"></span> <button type="button" class="link-btn hint-go">Show me</button>';
  box.querySelector(".hint-text").textContent = hint.text;
}

function initHint() {
  $("event-hint").addEventListener("click", (e) => {
    if (!e.target.closest(".hint-go") || !hint) return;
    const h = hint;
    chooseBody(h.body);
    if (h.kind === "eclipse-window") {
      // A single instant with an eclipse ahead: open the eclipse's window at its maximum (the views are rebuilt).
      openWindow(h.item.s.id, h.t_start_utc, h.t_end_utc, h.atMs);
    } else jumpTo(h.offsetMs);
  });
}

/** Turn the Sun | Earth switch (and with it every sky view) to a body. */
function chooseBody(body) {
  if (body !== "sun" && body !== "earth") return;
  setSkyBody(body);
  if (store.body !== body) setUi({ body });
}

// ---------------------------------------------------------------------------------------------
// Load order: the first results on screen come first. Large things the first screen does not need (the globe's
// full-resolution textures, Plotly for the charts under the sky) start once the first sky view is drawn.

/** Resolves when the first sky view shows its first frame (or the page has nothing to show), or after maxMs. */
function whenFirstViewDrawn(maxMs = 15000) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const drawn = () => {
      const v = $("sky-grid").querySelector(".sky-view");
      return !!v && !!v.querySelector("canvas") && !v.querySelector(".sky-loading");
    };
    const poll = () => {
      if (drawn() || (lastItems.length === 0 && booted && performance.now() - t0 > 3000) || performance.now() - t0 > maxMs) resolve();
      else setTimeout(poll, 150);
    };
    poll();
  });
}

/** Resolves when one of the elements comes within 150 px of the window. */
function whenNear(els) {
  return new Promise((resolve) => {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      resolve();
    }, { rootMargin: "150px" });
    for (const el of els) io.observe(el);
  });
}

/** Fetch Plotly into the HTTP cache at idle priority, so the first chart draw is quick. */
function prefetchPlotly() {
  const url = document.documentElement.dataset.plotly;
  if (!url || window.Plotly || document.querySelector(`link[href="${url}"]`)) return;
  const l = document.createElement("link");
  l.rel = "prefetch";
  l.as = "script";
  l.href = url;
  document.head.append(l);
}

let timer = 0;
function scheduleRecompute(delay = 250) {
  clearTimeout(timer);
  timer = setTimeout(recompute, delay);
}

// ---------------------------------------------------------------------------------------------
// URL hash (shareable views)

// Navigation (a story, adding or removing a scenario) makes a new history entry, so Back returns to the previous view;
// edits in place (a field, a label, the time axis, the Sun | Earth switch) replace the current entry.

let hashTimer = 0;
let pushPending = false;
let restoring = false; // applying a link or a Back/Forward step: nothing is written to the history
let booted = false;
let lastIds = "";

/** The hash of the current state, with the sky's moment and camera. */
function currentHash() {
  return encodeHash({ scenarios: store.scenarios, xaxis: store.xaxis, body: store.body, sky: skyShareState() });
}

/** Record the state in the URL (debounced, so one story makes one entry). push: a new history entry. */
function writeHash(push = false) {
  if (restoring) return;
  pushPending ||= push && booted;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(flushHash, 300);
}

function flushHash() {
  clearTimeout(hashTimer);
  const push = pushPending;
  pushPending = false;
  const h = currentHash();
  if (h === location.hash) return;
  if (push) history.pushState(null, "", h);
  else history.replaceState(null, "", h);
}

/**
 * Apply the URL hash: a shared link at start, or a Back/Forward step. A link without scenarios (no hash, "#tab=sky")
 * opens the first-visit story, Apollo 11. Scenarios equal to the current ones are kept (their views and the timelapse
 * stay); new ones open at the link's moment and camera.
 */
function applyHash() {
  const h = decodeHash(location.hash);
  clearTimeout(hashTimer);
  pushPending = false;
  restoring = true;
  try {
    if (!h || !h.scenarios.length) {
      runQuickStart(QUICK_STARTS[0].key);
      return;
    }
    const same = encodeHash({ scenarios: h.scenarios }) === encodeHash({ scenarios: store.scenarios });
    applyView({ xaxis: h.xaxis, body: hashBody(h) }, { aim: same });
    if (!same) {
      queueSkyStart({ offsetMs: h.sky.offsetMs || 0, view: h.sky.view });
      setScenarios(h.scenarios);
    }
  } finally {
    restoring = false;
  }
}

function initHistory() {
  const onNav = () => {
    if (location.hash !== currentHash()) applyHash();
  };
  window.addEventListener("popstate", onNav);
  window.addEventListener("hashchange", onNav); // a hash typed or pasted into the address bar
}

function initShare() {
  $("btn-share").addEventListener("click", async () => {
    flushHash();
    try {
      await navigator.clipboard.writeText(location.href);
      toast("Link copied: it opens these places and times, at this moment and in this view.");
    } catch {
      toast("Copy the address bar to share this view.");
    }
  });
}

let toastTimer = 0;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------------------------------------------------------------------------------------------
// Stories (quick starts), About, x-axis toggle

/** Story chips (in QUICK_STARTS order: the demo video clicks them by position). Any [data-qs] button runs one. */
function initQuickStarts() {
  const chip = (q) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = q.label;
    b.title = q.title;
    b.dataset.qs = q.key;
    return b;
  };
  $("quickstarts").replaceChildren(...QUICK_STARTS.map(chip));
  // The same stories in the empty state (after "Clear all"), outside #quickstarts so its chips keep their positions.
  for (const list of document.querySelectorAll("[data-qs-list]")) list.replaceChildren(...QUICK_STARTS.map(chip));
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-qs]");
    if (!b) return;
    runQuickStart(b.dataset.qs);
    revealSky();
  });
}

/**
 * Load a story: its scenarios, its Sun | Earth choice (the views are built aimed at it), its time axis and its
 * opening moment.
 */
function runQuickStart(key) {
  const q = QUICK_STARTS.find((x) => x.key === key);
  if (!q) return;
  applyView({ xaxis: q.xaxis || "met", body: q.body || "sun" }, { aim: false });
  queueSkyStart({ offsetMs: q.offsetMs || 0, view: null });
  setScenarios(q.resolve(catalogSites()));
}

/**
 * On a one-column page (phones, tablets) the sky is under the inputs: after a story is chosen, scroll down to it
 * (its caption) unless it is already on screen.
 */
function revealSky() {
  const head = document.querySelector(".out-head");
  if (!head || window.matchMedia("(min-width: 1100px)").matches) return;
  const r = head.getBoundingClientRect();
  if (r.top > 60 && r.top < window.innerHeight * 0.5) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  head.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
}

/** Set the charts' time axis and the Sun | Earth choice without a separate redraw (a recompute follows). */
function applyView({ xaxis, body }, { aim = true } = {}) {
  store.xaxis = xaxis;
  store.body = body;
  setSkyBody(body, { aim });
  syncBody();
  syncXAxis();
}

let qsSigs = null;
/** The scenario signature (the hash rows) of each story, against the loaded catalog. */
function quickStartSigs() {
  if (!qsSigs) {
    qsSigs = QUICK_STARTS.map((q) => {
      const list = [];
      for (const p of q.resolve(catalogSites())) list.push(makeScenario(p, list));
      return [q, encodeHash({ scenarios: list })];
    });
  }
  return qsSigs;
}

/**
 * While the scenarios are exactly a story's (however they were loaded: chip, shared link, Back), its chip is marked and
 * its "what to look for" caption shows. Any edit hides them.
 */
function syncQuickStartUi() {
  const sig = encodeHash({ scenarios: store.scenarios });
  const q = quickStartSigs().find(([, s]) => s === sig)?.[0] || null;
  for (const c of $("quickstarts").children) {
    const on = !!q && c.dataset.qs === q.key;
    c.classList.toggle("active", on);
    c.setAttribute("aria-pressed", String(on));
  }
  const cap = $("qs-caption");
  cap.hidden = !q?.caption;
  if (q?.caption) cap.querySelector(".qs-cap-text").textContent = q.caption;
}

/** The introduction line: hidden for good with its ✕ (remembered in localStorage; <head> applies it before paint). */
function initIntro() {
  const close = $("intro-close");
  if (!close) return;
  close.addEventListener("click", () => {
    document.documentElement.dataset.intro = "off";
    try {
      localStorage.setItem("moonat-intro", "off");
    } catch {
      /* storage blocked: hidden for this visit only */
    }
  });
}

/** The About panel and the "Validated" panel: modal dialogs, closed by ✕, Esc or a click on the backdrop. */
function initAbout() {
  for (const [id, btn, attr] of [["about", "btn-about", "data-open-about"], ["validated", "btn-validated", "data-open-validated"]]) {
    const dlg = $(id);
    if (!dlg) continue;
    const open = () => {
      for (const d of document.querySelectorAll("dialog[open]")) if (d !== dlg) d.close();
      if (dlg.showModal) dlg.showModal();
      else dlg.setAttribute("open", "");
    };
    $(btn)?.addEventListener("click", open);
    for (const b of document.querySelectorAll(`[${attr}]`)) b.addEventListener("click", open);
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
  }
}

function syncXAxis() {
  for (const b of $("xaxis-toggle").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.x === store.xaxis));
}

function initXAxisToggle() {
  $("xaxis-toggle").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setUi({ xaxis: b.dataset.x });
    syncXAxis();
  });
  syncXAxis();
}

/**
 * A suggested date was chosen in a scenario card (C11): set its window (an eclipse or an Earthrise: a short window
 * around it, the sky at its maximum) and turn the switch to the body it is about.
 */
function onSuggest(s, sug) {
  const w = suggestWindow(sug);
  if (!w) return;
  const body = suggestBody(sug.kind);
  if (body) chooseBody(body);
  openWindow(s.id, w.t_start_utc, w.t_end_utc, w.at_utc ? Date.parse(w.at_utc) : null);
  revealSky();
}

function showPhysicsError() {
  const err = physicsError();
  if (!err) return;
  $("output").insertAdjacentHTML("afterbegin", `<p class="banner" role="alert">The ephemeris tables could not load, so positions cannot be computed.
    Please check your connection and reload the page. <span class="muted">(${String(err.message || err).replace(/</g, "&lt;")})</span></p>`);
}

// ---------------------------------------------------------------------------------------------
// Boot

async function boot() {
  initTheme();
  initIntro();
  initAbout();
  initShare();
  initXAxisToggle();
  initBodySwitch((body) => setSkyBody(body));
  initSky({
    onTime: (offsetMs) => {
      setChartCursor(offsetMs);
      if (hint || lastItems.length) syncHint();
    },
  });
  initHint();
  // The charts (and the 1 MB Plotly download) wait for the first sky view, which is the first thing on screen, unless
  // the visitor scrolls down to them first (on a phone the sky is below the fold).
  const firstView = whenFirstViewDrawn();
  holdChartsUntil(Promise.race([firstView, whenNear([$("charts-sun"), $("charts-earth")]), new Promise((r) => setTimeout(r, 8000))]));

  await Promise.all([loadCatalog(), initPhysics("data/ephem")]);
  showPhysicsError();
  // Custom points: show the coarse tiles horizon at once, then recompute when the real terrain arrives.
  useLiveTerrain({ ready: readyTerrain, ensure: ensureTerrain });
  onTerrainChange(() => scheduleRecompute(0));
  initQuickStarts();
  initScenarioUI({ onSuggest });

  subscribe((kind, detail) => {
    if (kind === "structure" || kind === "field") {
      scheduleRecompute(kind === "structure" ? 0 : 300);
      syncQuickStartUi();
      // A new set of scenario ids (story, add, duplicate, remove, clear) is navigation; a rebuilt card is not.
      const ids = store.scenarios.map((s) => s.id).join(",");
      const nav = kind === "structure" && ids !== lastIds;
      lastIds = ids;
      writeHash(nav);
    } else if (kind === "label") {
      render();
      syncQuickStartUi();
      writeHash();
    } else if (kind === "ui") {
      if ("theme" in detail) render();
      if ("xaxis" in detail) rerenderCompare({ xaxis: store.xaxis });
      writeHash();
    }
  });

  // A shared link opens exactly what it encodes; a first visit (no hash) opens Apollo 11.
  applyHash();
  booted = true;
  writeHash(); // the full link of what is shown (replaces the address, e.g. "#tab=sky" or none)
  initHistory();

  // The globe loads three.js and its images (the sky needs three.js too); its full-resolution textures (4 MB) wait for
  // the first sky view.
  import("./map.js")
    .then((m) => m.initMap({ hiResAfter: firstView }))
    .catch((err) => {
      console.error("[moonat] map failed", err);
      $("map").textContent = "The map could not load. You can still type coordinates or pick a mission.";
      $("map-hint").hidden = true;
    });
  firstView.then(() => setTimeout(prefetchPlotly, 600));
}

boot().catch((err) => {
  console.error(err);
  document.getElementById("output").insertAdjacentHTML("afterbegin", `<p class="scen-msg">Something went wrong while starting the app: ${String(err.message || err)}</p>`);
});
