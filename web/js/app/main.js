// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// App entry: wires the store, scenario cards, map, physics, Compare and Sky tabs, theme, sharing and the About panel.

import { store, subscribe, setScenarios, setUi } from "./store.js";
import {
  colorHex, isWrappedSlot, validateScenario, scenarioTimes, chooseStep, physicsKey, encodeHash, decodeHash, coverageEnd, makeScenario, DAY_MS,
  HOUR_MS,
} from "./state.js";
import { loadCatalog, QUICK_STARTS, catalogSites } from "./catalog.js";
import { initPhysics, physicsError, physicsCoverage, siteFor, stateAt, seriesFor, useLiveTerrain } from "./physics_adapter.js";
import { readyTerrain, ensureTerrain, keepOnly, onTerrainChange } from "./terrain_live.js";
import { initScenarioUI } from "./scenarios_ui.js";
import { renderCompare, rerenderCompare, initBodySwitch, syncBody, resizeShownCharts } from "./compare.js";
import { initSkyTab, setSkyItems, setSkyVisible, queueSkyStart, skyShareState } from "./sky_tab.js";
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
// Tabs

function initTabs() {
  const buttons = [...document.querySelectorAll('.tabs [role="tab"]')];
  const show = (tab, focus = false) => {
    for (const b of buttons) {
      const on = b.dataset.tab === tab;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    const changed = $("tab-compare").hidden !== (tab !== "compare");
    $("tab-compare").hidden = tab !== "compare";
    $("tab-sky").hidden = tab !== "sky";
    // Charts drawn earlier keep the width they had: fit them, in case the window changed while the tab was hidden.
    if (!renderStaleCompare() && changed && tab === "compare") resizeShownCharts();
    // A new tab opens at its top, not at the scroll depth of the previous one.
    if (changed) scrollToOutputTop();
    setSkyVisible(tab === "sky");
    if (store.tab !== tab) setUi({ tab });
  };
  for (const b of buttons) {
    b.addEventListener("click", () => show(b.dataset.tab));
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = buttons.indexOf(b);
      const j = (i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length;
      show(buttons[j].dataset.tab, true);
    });
  }
  return show;
}

/** Scroll up to the top of the results when the page is scrolled past it (below the sticky top bar). */
function scrollToOutputTop() {
  const bar = document.querySelector(".topbar");
  const top = $("output").getBoundingClientRect().top + window.scrollY - (bar ? bar.offsetHeight : 0) - 12;
  if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top) });
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
      if (span > 0) series = await seriesFor(site, t0, t1, chooseStep(span));
      else {
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

let busyTimer = 0;
/**
 * Show that results are being computed. A compute that takes longer than a moment (a rover route is planned from
 * live terrain in several seconds) also dims the results still on screen, which belong to the previous scenarios,
 * and labels the Sky tab, which has no other progress indicator.
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
  lastItems = valid.map(({ s, index }, i) => ({ ...cores[i], s, index }));
  render();
}

function decorate(it) {
  return { ...it, label: it.s.label || `Scenario ${it.index + 1}`, color: colorHex(it.s.color, store.theme), dash: isWrappedSlot(it.s.color) };
}

let compareStale = null; // items waiting for the Compare tab to be shown
function render() {
  const items = lastItems.map(decorate);
  // Plotly cannot measure a hidden tab, and the Sky tab does not need Plotly: the Compare tab is drawn when shown.
  if ($("tab-compare").hidden) compareStale = items;
  else {
    compareStale = null;
    renderCompare(items, { xaxis: store.xaxis });
  }
  setSkyItems(items.filter((it) => !it.error));
  $("compare-empty").hidden = items.some((it) => !it.error);
}

/** Draw the Compare tab if results arrived while it was hidden. Returns true when it drew. */
function renderStaleCompare() {
  if (!compareStale || $("tab-compare").hidden) return false;
  const items = compareStale;
  compareStale = null;
  renderCompare(items, { xaxis: store.xaxis });
  return true;
}

// ---------------------------------------------------------------------------------------------
// Load order: the first results on screen come first. Large things the first screen does not need (the globe's
// full-resolution textures, Plotly when the page opens on the Sky tab) start once they are drawn.

/** Resolves when the open tab shows its first results (a chart, the instant cards or a sky view), or after maxMs. */
function whenFirstViewDrawn(maxMs = 15000) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const drawn = () => {
      if (!$("tab-compare").hidden) {
        if ($("tab-compare").querySelector(".js-plotly-plot .main-svg")) return true;
        return !!$("cards-sun").firstElementChild && $("charts-sun").hidden; // single instants: no charts
      }
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

/** Fetch Plotly into the HTTP cache at idle priority, so a first switch to the Compare tab is quick. */
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

// Navigation (a quick start, a tab, adding or removing a scenario) makes a new history entry, so Back returns to the
// previous view; edits in place (a field, a label, the Compare axis) replace the current entry.

let hashTimer = 0;
let pushPending = false;
let restoring = false; // applying a link or a Back/Forward step: nothing is written to the history
let booted = false;
let lastIds = "";

/** The hash of the current state; on the Sky tab it holds the moment and the view too. */
function currentHash() {
  return encodeHash({
    scenarios: store.scenarios, tab: store.tab, xaxis: store.xaxis, body: store.body, sky: store.tab === "sky" ? skyShareState() : null,
  });
}

/** Record the state in the URL (debounced, so one quick start makes one entry). push: a new history entry. */
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
 * opens the first-visit story, Apollo 11, on the link's tab if it names one. Scenarios equal to the current ones are
 * kept (their views and the timelapse stay); new ones open at the link's Sky moment and view.
 */
function applyHash() {
  const h = decodeHash(location.hash);
  clearTimeout(hashTimer);
  pushPending = false;
  restoring = true;
  try {
    if (!h || !h.scenarios.length) {
      runQuickStart(QUICK_STARTS[0].key);
      if (h?.tabGiven) showTab(h.tab);
      return;
    }
    applyCompareView(h);
    if (encodeHash({ scenarios: h.scenarios }) !== encodeHash({ scenarios: store.scenarios })) {
      queueSkyStart(h.sky);
      setScenarios(h.scenarios);
    }
    showTab(h.tab);
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
      toast(store.tab === "sky" ? "Link copied: it opens this sky, at this moment and in this view." : "Link copied: it opens this exact comparison.");
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
// Quick starts, About, x-axis toggle

let showTab = () => {};

/** Quick-start chips (in QUICK_STARTS order: the demo video clicks them by position). Any [data-qs] button runs one. */
function initQuickStarts() {
  const box = $("quickstarts");
  box.replaceChildren(
    ...QUICK_STARTS.map((q) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = q.label;
      b.title = q.title;
      b.dataset.qs = q.key;
      return b;
    }),
  );
  // The same stories in the empty states (after "Clear all"), outside #quickstarts so its chips keep their positions.
  for (const list of document.querySelectorAll("[data-qs-list]")) {
    list.replaceChildren(
      ...QUICK_STARTS.map((q) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.textContent = q.label;
        b.title = q.title;
        b.dataset.qs = q.key;
        return b;
      }),
    );
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-qs]");
    if (b) runQuickStart(b.dataset.qs);
  });
}

/**
 * Load a quick start: its scenarios, its Compare axis and section, its Sky-tab moment, and its tab when it names one
 * (otherwise the current tab stays).
 */
function runQuickStart(key) {
  const q = QUICK_STARTS.find((x) => x.key === key);
  if (!q) return;
  applyCompareView({ xaxis: q.xaxis || "met", body: q.body || "sun" });
  queueSkyStart({ offsetMs: q.offsetMs || 0, look: q.look || null, view: null });
  setScenarios(q.resolve(catalogSites()));
  if (q.tab) showTab(q.tab);
}

/** Set the Compare tab's time axis and Sun/Earth section without a separate redraw (a recompute follows). */
function applyCompareView({ xaxis, body }) {
  store.xaxis = xaxis;
  store.body = body;
  syncBody();
  syncXAxis();
}

let qsSigs = null;
/** The scenario signature (the hash rows) of each quick start, against the loaded catalog. */
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
 * While the scenarios are exactly a quick start's (however they were loaded: chip, story link, shared link, Back), its
 * chip is marked and its "what to look for" caption shows. Any edit hides them.
 */
function syncQuickStartUi() {
  const sig = encodeHash({ scenarios: store.scenarios });
  const q = quickStartSigs().find(([, s]) => s === sig)?.[0] || null;
  for (const c of $("quickstarts").children) c.classList.toggle("active", !!q && c.dataset.qs === q.key);
  // The caption describes the story's own tab (the sky, or the charts), so it shows there only.
  const show = !!q?.caption && (!q.tab || q.tab === store.tab);
  const cap = $("qs-caption");
  cap.hidden = !show;
  if (show) cap.querySelector(".qs-cap-text").textContent = q.caption;
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
  showTab = initTabs();
  initIntro();
  initAbout();
  initShare();
  initXAxisToggle();
  initBodySwitch();
  initSkyTab();

  await Promise.all([loadCatalog(), initPhysics("data/ephem")]);
  showPhysicsError();
  // Custom points: show the coarse tiles horizon at once, then recompute when the real terrain arrives.
  useLiveTerrain({ ready: readyTerrain, ensure: ensureTerrain });
  onTerrainChange(() => scheduleRecompute(0));
  initQuickStarts();
  initScenarioUI();

  subscribe((kind, detail) => {
    if (kind === "structure" || kind === "field") {
      scheduleRecompute(kind === "structure" ? 0 : 300);
      syncQuickStartUi();
      // A new set of scenario ids (quick start, add, duplicate, remove, clear) is navigation; a rebuilt card is not.
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
      if ("xaxis" in detail && !compareStale) rerenderCompare({ xaxis: store.xaxis });
      if ("tab" in detail) syncQuickStartUi();
      writeHash("tab" in detail);
    }
  });

  // A shared link opens exactly what it encodes; a first visit (no hash) opens Apollo 11 on the Sky tab.
  applyHash();
  booted = true;
  writeHash(); // the full link of what is shown (replaces the address, e.g. "#tab=sky" or none)
  initHistory();

  // The globe map loads three.js and its images; the rest of the app works without it. On the Sky tab it starts at
  // once (the sky needs three.js too); on the Compare tab after the first chart, so it does not slow Plotly down.
  // Its full-resolution textures (4 MB) wait for the first results in both cases.
  const firstView = whenFirstViewDrawn();
  (store.tab === "sky" ? Promise.resolve() : firstView)
    .then(() => import("./map.js"))
    .then((m) => m.initMap({ hiResAfter: firstView }))
    .catch((err) => {
      console.error("[moonat] map failed", err);
      $("map").textContent = "The map could not load. You can still type coordinates or pick a mission.";
      $("map-hint").hidden = true;
    });
  firstView.then(() => setTimeout(prefetchPlotly, 1500));
}

boot().catch((err) => {
  console.error(err);
  document.getElementById("output").insertAdjacentHTML("afterbegin", `<p class="scen-msg">Something went wrong while starting the app: ${String(err.message || err)}</p>`);
});
