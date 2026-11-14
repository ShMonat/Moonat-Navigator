// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// App entry: wires the store, scenario cards, map, physics, Compare and Sky tabs, theme, sharing and the About panel.

import { store, subscribe, setScenarios, setUi } from "./store.js";
import {
  colorHex, isWrappedSlot, validateScenario, scenarioTimes, chooseStep, physicsKey, encodeHash, decodeHash, coverageEnd, DAY_MS, HOUR_MS,
} from "./state.js";
import { loadCatalog, QUICK_STARTS, catalogSites } from "./catalog.js";
import { initPhysics, physicsError, physicsCoverage, siteFor, stateAt, seriesFor, useLiveTerrain } from "./physics_adapter.js";
import { readyTerrain, ensureTerrain, keepOnly, onTerrainChange } from "./terrain_live.js";
import { initScenarioUI } from "./scenarios_ui.js";
import { renderCompare, rerenderCompare, initBodySwitch, syncBody } from "./compare.js";
import { initSkyTab, setSkyItems, setSkyVisible } from "./sky_tab.js";

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
const terrainTag = (s) => (!s.site_id && readyTerrain(s.lat_deg, s.lon_deg) ? "|trek" : "");

function computeCore(s) {
  const key = physicsKey(s);
  const ckey = key + terrainTag(s);
  if (!cache.has(ckey)) {
    if (cache.size > 80) cache.delete(cache.keys().next().value);
    const p = (async () => {
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
      console.error("[moonat] compute failed", error);
      cache.delete(ckey);
      return { key, error };
    });
    cache.set(ckey, p);
  }
  return cache.get(ckey);
}

let computeSeq = 0;
let lastItems = [];

async function recompute() {
  const seq = ++computeSeq;
  const valid = store.scenarios
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => validateScenario(s, physicsCoverage()).ok);
  $("busy").hidden = false;
  // Stop fetching real terrain for points no scenario shows any more (rapid map clicks, edited coordinates).
  keepOnly(valid.filter(({ s }) => !s.site_id).map(({ s }) => [s.lat_deg, s.lon_deg]));
  const cores = await Promise.all(valid.map(({ s }) => computeCore(s)));
  if (seq !== computeSeq) return; // a newer request superseded this one
  $("busy").hidden = true;
  lastItems = valid.map(({ s, index }, i) => ({ ...cores[i], s, index }));
  render();
}

function decorate(it) {
  return { ...it, label: it.s.label || `Scenario ${it.index + 1}`, color: colorHex(it.s.color, store.theme), dash: isWrappedSlot(it.s.color) };
}

function render() {
  const items = lastItems.map(decorate);
  renderCompare(items, { xaxis: store.xaxis });
  setSkyItems(items.filter((it) => !it.error));
  $("compare-empty").hidden = items.some((it) => !it.error);
}

let timer = 0;
function scheduleRecompute(delay = 250) {
  clearTimeout(timer);
  timer = setTimeout(recompute, delay);
}

// ---------------------------------------------------------------------------------------------
// URL hash (shareable views)

let hashTimer = 0;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const h = encodeHash({ scenarios: store.scenarios, tab: store.tab, xaxis: store.xaxis, body: store.body });
    if (h !== location.hash) history.replaceState(null, "", h);
  }, 300);
}

function initShare() {
  $("btn-share").addEventListener("click", async () => {
    clearTimeout(hashTimer);
    history.replaceState(null, "", encodeHash({ scenarios: store.scenarios, tab: store.tab, xaxis: store.xaxis, body: store.body }));
    try {
      await navigator.clipboard.writeText(location.href);
      toast("Link copied: it opens this exact comparison.");
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

function initQuickStarts() {
  const box = $("quickstarts");
  box.replaceChildren(
    ...QUICK_STARTS.map((q) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = q.label;
      b.title = q.title;
      b.addEventListener("click", () => {
        setScenarios(q.resolve(catalogSites()));
        for (const c of box.children) c.classList.toggle("active", c === b);
      });
      return b;
    }),
  );
}

function initAbout() {
  const dlg = $("about");
  const open = () => (dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", ""));
  $("btn-about").addEventListener("click", open);
  for (const b of document.querySelectorAll("[data-open-about]")) b.addEventListener("click", open);
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
}

function initXAxisToggle() {
  const seg = $("xaxis-toggle");
  const sync = () => {
    for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.x === store.xaxis));
  };
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setUi({ xaxis: b.dataset.x });
    sync();
  });
  sync();
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
  const showTab = initTabs();
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
      writeHash();
    } else if (kind === "label") {
      render();
      writeHash();
    } else if (kind === "ui") {
      if ("theme" in detail) render();
      if ("xaxis" in detail) rerenderCompare({ xaxis: store.xaxis });
      writeHash();
    }
  });

  // The globe map loads three.js and its images; the rest of the app works without it.
  import("./map.js")
    .then((m) => m.initMap())
    .catch((err) => {
      console.error("[moonat] map failed", err);
      $("map").textContent = "The map could not load. You can still type coordinates or pick a mission.";
      $("map-hint").hidden = true;
    });

  const fromHash = decodeHash(location.hash);
  if (fromHash && fromHash.scenarios.length) {
    store.xaxis = fromHash.xaxis;
    store.body = fromHash.body;
    syncBody();
    for (const b of $("xaxis-toggle").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.x === store.xaxis));
    setScenarios(fromHash.scenarios);
    showTab(fromHash.tab);
  } else {
    // First visit: open on Apollo 11 so there is something to explore immediately.
    setScenarios(QUICK_STARTS[0].resolve(catalogSites()));
    $("quickstarts").firstElementChild?.classList.add("active");
  }

  window.addEventListener("hashchange", () => {
    const h = decodeHash(location.hash);
    const cur = encodeHash({ scenarios: store.scenarios, tab: store.tab, xaxis: store.xaxis, body: store.body });
    if (h && location.hash !== cur) {
      store.xaxis = h.xaxis;
      store.body = h.body;
      syncBody();
      setScenarios(h.scenarios);
      showTab(h.tab);
    }
  });
}

boot().catch((err) => {
  console.error(err);
  document.getElementById("output").insertAdjacentHTML("afterbegin", `<p class="scen-msg">Something went wrong while starting the app: ${String(err.message || err)}</p>`);
});
