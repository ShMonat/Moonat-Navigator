// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The sky panel: one sky view per scenario in a grid, the timelapse bar under it (a shared time slider: time since each
// scenario's start, so missions are synchronised; play/pause with a speed selector), and the body every view is aimed
// at (the page's "☀ Sun | 🌍 Earth" switch, main.js). Each view's card has Focus, Full screen and a "⋯" menu of the
// rarely used view options (Close-up, Constellations, Exposure). Views are created lazily, when they scroll into view.

import { formatDuration, formatUtc } from "./state.js";
import { horizonElAt } from "./derive.js";
import { bodyLine, compassPair, earthNeverRises } from "../sky/words.js";
import { stateAt } from "./physics_adapter.js";
import { makeSkyView, terrainPatchUrl, skyPatch } from "./sky_adapter.js";
import { terrainStatusText } from "./terrain_live.js";
import { bindPinchZoom, bindAxisLock } from "./gestures.js";
import { rideAt, ridePatch, rideNote, frameTurnDeg } from "../rover/sky_ride.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const cards = new Map(); // key (scenario id + physics key) -> card record
let items = [];
let offsetMs = 0;
let maxSpan = 0;
let playing = false;
let lastFrame = 0;
let rafId = 0;
let observer = null;
let inViewObserver = null;
const watch = (rec) => {
  observer.observe(rec.viewEl);
  inViewObserver.observe(rec.viewEl);
};
const unwatch = (rec) => {
  observer.unobserve(rec.viewEl);
  inViewObserver.unobserve(rec.viewEl);
};
let pending = false;
let busy = false;
let aimBody = "earth"; // "earth" | "sun": the body every view is aimed at (the page's Sun | Earth switch)
let speedTouched = false; // the user picked a playback speed; until then it follows the longest scenario
let onTimeChange = () => {};

let pendingStart = null; // { offsetMs, view } for the next completely new set of scenarios
let pendingCamera = null; // { az_deg, el_deg, fov_deg } for the first view of that set, applied when it is built

/**
 * View options shared by every view (the "⋯" menu of each card; C8 setOption names); views created later get them
 * too. The HUD is minimal by default: the card footer under each view carries the full readout.
 */
const viewOpts = { closeUp: true, constellations: true, exposure: "eye", hudLevel: "minimal" };

/**
 * Open the next completely new set of scenarios (the one main.js is about to load) at a given moment and view:
 * offsetMs = time since the scenarios' start (ms); view = the camera of the first view ({ az_deg, el_deg, fov_deg },
 * deg, local horizon frame). Null fields keep the defaults (T+0, the views aimed at the selected body).
 */
export function queueSkyStart(start = null) {
  pendingStart = start;
}

/**
 * The sky's shareable state: { offsetMs, view }. `view` is the first view's camera, only when the user has turned or
 * zoomed it (otherwise the framing of the selected body, which adapts to the window, is kept). A queued start that
 * has not been applied yet is returned as it is.
 */
export function skyShareState() {
  if (pendingStart) return { offsetMs: pendingStart.offsetMs || 0, view: pendingStart.view || null };
  const first = items.length ? cards.get(`${items[0].s.id}|${items[0].key}`) : null;
  const view = first?.view && first.camTouched && first.view.getView ? first.view.getView() : pendingCamera;
  return { offsetMs: maxSpan > 0 ? offsetMs : 0, view: view || null };
}

/** Time since the scenarios' start shown now (ms), and the longest span (ms; 0 for single instants). */
export function skyTime() {
  return { offsetMs: maxSpan > 0 ? offsetMs : 0, maxSpan };
}

/** Playback speeds offered (ms of scenario time per real second), as in the #sky-speed options. */
const SPEEDS = [600000, 3600000, 21600000, 86400000];
/** A timelapse should last at most about this long (s) at the automatic speed. */
const TARGET_PLAY_S = 90;

/** opts.onTime(offsetMs): called whenever the time shown changes (slider, playback, a new set, jumpTo). */
export function initSky({ onTime } = {}) {
  if (onTime) onTimeChange = onTime;
  observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const rec = [...cards.values()].find((r) => r.viewEl === en.target);
      if (!rec) continue;
      rec.onScreen = en.isIntersecting;
      if (en.isIntersecting && !rec.view && !rec.creating) createView(rec);
    }
    recycleViews();
  }, { rootMargin: "300px" });
  // Second observer, without margin: only views actually on screen are redrawn while the time changes.
  inViewObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const rec = [...cards.values()].find((r) => r.viewEl === en.target);
      if (!rec) continue;
      rec.inView = en.isIntersecting;
      if (rec.inView && rec.view) updateCard(rec);
    }
  });

  $("sky-slider").addEventListener("input", (e) => {
    offsetMs = (Number(e.target.value) / 1000) * maxSpan;
    stop();
    refresh();
  });
  $("btn-play").addEventListener("click", () => (playing ? stop() : play()));
  $("sky-speed").addEventListener("change", () => (speedTouched = true));
  initFocusKeys();
  initOptionMenus();
}

/**
 * Aim every view at a body ("sun" | "earth"), now and for views created later. aim = false only records the body
 * (a story or a link about to load new views, which aim themselves when they are built).
 */
export function setSkyBody(body, { aim = true } = {}) {
  aimBody = body === "sun" ? "sun" : "earth";
  if (aim) for (const rec of cards.values()) lookOne(rec, aimBody);
}

/** Show the moment `ms` after the scenarios' start (e.g. "show me" an eclipse), paused. */
export function jumpTo(ms) {
  if (!(maxSpan > 0)) return;
  offsetMs = Math.max(0, Math.min(maxSpan, ms));
  stop();
  refresh();
}

/**
 * Update the list of scenarios to show. items: [{ s, label, color, t0, span, site, horizon }] for valid scenarios.
 * Cards whose scenario and physics inputs are unchanged keep their view.
 */
export function setSkyItems(newItems) {
  items = newItems;
  const grid = $("sky-grid");
  $("sky-controls").hidden = items.length === 0;

  const keep = new Set();
  const order = [];
  // A completely new set of scenarios (a story, a shared link, a new place) starts at T+0 aimed at the selected body,
  // or at the moment and camera queued for it (queueSkyStart).
  if (items.length && !items.some((it) => cards.has(`${it.s.id}|${it.key}`))) {
    const start = pendingStart || {};
    pendingStart = null;
    offsetMs = Math.max(0, Number(start.offsetMs) || 0);
    pendingCamera = start.view || null;
    speedTouched = false;
    stop();
  }
  for (const it of items) {
    const key = `${it.s.id}|${it.key}`;
    keep.add(key);
    let rec = cards.get(key);
    if (!rec) {
      rec = buildCard(it, key);
      cards.set(key, rec);
      watch(rec);
    }
    const terrainChanged = rec.it.horizon !== it.horizon || rec.it.patch !== it.patch;
    rec.it = it;
    if (terrainChanged) {
      // Real terrain arrived for a custom point (or went away): new skyline and 3D ground, same camera.
      rec.lastT = null;
      if (rec.view) swapTerrain(rec);
    }
    if (!it.s.site_id) rec.lastT = null; // the footer shows the live terrain status, which can change on its own
    rec.root.style.setProperty("--c", it.color);
    rec.root.querySelector(".mcard-title").textContent = it.label;
    order.push(rec.root);
  }
  for (const [key, rec] of cards) {
    if (keep.has(key)) continue;
    if (rec === focusRec) exitFocus();
    unwatch(rec);
    if (rec.view) rec.view.dispose();
    rec.root.remove();
    cards.delete(key);
  }
  grid.replaceChildren(...order);
  grid.dataset.n = String(Math.min(order.length, 7));

  maxSpan = Math.max(0, ...items.map((it) => it.span || 0));
  offsetMs = Math.min(offsetMs, maxSpan);
  const hasMission = maxSpan > 0;
  $("sky-controls").classList.toggle("instant", !hasMission);
  $("sky-slider").disabled = !hasMission;
  $("btn-play").disabled = !hasMission;
  $("sky-speed").disabled = !hasMission;
  if (!hasMission) stop();
  if (hasMission && !speedTouched) $("sky-speed").value = String(autoSpeed(maxSpan));
  refresh();
}

/** Slowest offered speed that plays the longest scenario in TARGET_PLAY_S seconds or less. */
function autoSpeed(spanMs) {
  return SPEEDS.find((v) => spanMs / v <= TARGET_PLAY_S) ?? SPEEDS[SPEEDS.length - 1];
}

const LOADING_HTML = '<div class="sky-loading">Loading sky…</div><div class="sky-hint" hidden>Ctrl + scroll to zoom</div>';

const OPTION_ITEMS = [
  { key: "closeUp", text: "Close-up (6× zoom)", tip: "The round inset that magnifies the Earth (and the Sun while hills or the Earth cover part of it)" },
  { key: "constellations", text: "Constellations", tip: "Constellation lines and the names of well-known ones" },
  { key: "exposure", text: "Camera exposure", tip: "Exposed for the sunlit ground, as in the Apollo photographs: the stars vanish while the Sun is up. Off: the eye, with the stars dimmed but visible." },
  { key: "hudLevel", text: "Numbers in the view", tip: "The full readout in the corner of the view (heights, directions, phase). Off: the time only; the numbers are under the view." },
];
function optionOn(key) {
  if (key === "exposure") return viewOpts.exposure === "camera";
  if (key === "hudLevel") return viewOpts.hudLevel === "full";
  return !!viewOpts[key];
}

function buildCard(it, key) {
  const root = document.createElement("article");
  root.className = "sky-card";
  const menuItems = OPTION_ITEMS.map((o) => `<button type="button" class="sky-opt" role="menuitemcheckbox" data-opt="${o.key}"
      aria-checked="${optionOn(o.key)}" title="${esc(o.tip)}"><span class="sky-opt-box" aria-hidden="true"></span>${esc(o.text)}</button>`).join("");
  root.innerHTML = `
    <div class="sky-card-head"><span class="swatch" aria-hidden="true"></span><span class="mcard-title"></span><span class="sky-card-time"></span>
      <span class="sky-card-acts">
        <button type="button" class="sky-act sky-focus-btn" title="Focus: fill the window with this view (Esc to exit)"><span aria-hidden="true">⤢</span><span class="sky-act-txt"> Focus</span></button>
        <button type="button" class="sky-act sky-fs-btn" title="Full screen (Esc to exit)" aria-label="Full screen"><span aria-hidden="true">⛶</span><span class="sky-act-txt"> Full screen</span></button>
        <button type="button" class="sky-act sky-exit-btn" title="Back to the page (Esc)"><span aria-hidden="true">✕</span> Exit focus</button>
        <span class="sky-opts">
          <button type="button" class="sky-act sky-opts-btn" aria-haspopup="menu" aria-expanded="false" title="View options" aria-label="View options"><span aria-hidden="true">⋯</span></button>
          <span class="sky-opts-menu" role="menu" aria-label="View options" hidden>${menuItems}</span>
        </span>
      </span></div>
    <div class="sky-view" role="group" aria-roledescription="sky view" aria-label="Sky view">${LOADING_HTML}</div>
    <div class="sky-card-foot"></div>`;
  root.querySelector(".sky-focus-btn").setAttribute("aria-label", "Focus");
  const rec = { key, it, root, viewEl: root.querySelector(".sky-view"), view: null, creating: false, state: null, engaged: false };
  root.querySelector(".sky-focus-btn").addEventListener("click", () => enterFocus(rec));
  const fs = root.querySelector(".sky-fs-btn");
  fs.hidden = !document.fullscreenEnabled;
  fs.addEventListener("click", () => enterFocus(rec, true));
  root.querySelector(".sky-exit-btn").addEventListener("click", () => exitFocus());
  guardWheel(rec);
  bindPinchZoom(rec.viewEl, () => rec.view);
  // Phones: a vertical swipe over a view scrolls the page, a horizontal drag turns the view (CSS touch-action: pan-y).
  bindAxisLock(rec.viewEl);
  // A drag, a pinch, a zooming wheel or the view's keys make the camera the user's own (shared links then keep it,
  // skyShareState).
  rec.viewEl.addEventListener("pointerdown", () => (rec.camTouched = true));
  rec.viewEl.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey || rec.engaged) rec.camTouched = true;
  }, { passive: true });
  rec.viewEl.addEventListener("keydown", (e) => {
    if (/^Arrow|^[-+=_]$/.test(e.key)) rec.camTouched = true;
  });
  return rec;
}

// ---------------------------------------------------------------------------------------------
// "⋯" view options: a small menu in each card's head. An option applies to every view (and to views created later).

function closeMenus(except = null, focusButton = false) {
  for (const m of document.querySelectorAll(".sky-opts-menu:not([hidden])")) {
    if (m === except) continue;
    m.hidden = true;
    const btn = m.parentElement.querySelector(".sky-opts-btn");
    btn.setAttribute("aria-expanded", "false");
    if (focusButton) btn.focus();
  }
}

function applyOption(key) {
  if (key === "exposure") viewOpts.exposure = viewOpts.exposure === "camera" ? "eye" : "camera";
  else if (key === "hudLevel") viewOpts.hudLevel = viewOpts.hudLevel === "full" ? "minimal" : "full";
  else viewOpts[key] = !viewOpts[key];
  for (const b of document.querySelectorAll(`.sky-opt[data-opt="${key}"]`)) b.setAttribute("aria-checked", String(optionOn(key)));
  for (const rec of cards.values()) applyOptions(rec.view);
}

/** Give a view the shared options (C8 setOption; the 2D fallback has none of them). */
function applyOptions(view) {
  if (!view?.setOption) return;
  for (const [name, value] of Object.entries(viewOpts)) view.setOption(name, value);
}

function initOptionMenus() {
  const grid = $("sky-grid");
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".sky-opts-btn");
    if (btn) {
      const menu = btn.parentElement.querySelector(".sky-opts-menu");
      const open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      if (open) menu.querySelector(".sky-opt")?.focus();
      return;
    }
    const opt = e.target.closest(".sky-opt");
    if (opt) applyOption(opt.dataset.opt);
  });
  grid.addEventListener("keydown", (e) => {
    const menu = e.target.closest(".sky-opts-menu");
    if (!menu) return;
    const opts = [...menu.querySelectorAll(".sky-opt")];
    const i = opts.indexOf(e.target);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenus(null, true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      opts[(i + (e.key === "ArrowDown" ? 1 : opts.length - 1)) % opts.length].focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest?.(".sky-opts")) closeMenus();
  });
  document.addEventListener("focusin", (e) => {
    if (!e.target.closest?.(".sky-opts")) closeMenus();
  });
}

// ---------------------------------------------------------------------------------------------
// Focus mode: one view fills the window, with the time controls under it. Esc or "Exit focus" returns to the page.
// "Full screen" also asks the browser for full screen (Fullscreen API); leaving full screen leaves focus mode too.

let focusRec = null;
let focusFullscreen = false;
/** Drawing-buffer budget (device pixels) of a focused view: about a 2560 × 1440 screen at full resolution. */
const FOCUS_PIXELS = 4.2e6;

/**
 * A focused view gets more pixels. Every view may use a taller frame (C8 extras), so a high Earth fits with the
 * horizon: the frame keeps the full width whenever the body rule fits both, and narrows (with blurred side bands)
 * only for an Earth too high for that, e.g. Apollo 11 in a wide focused window or Apollo 16 in a 16:9 grid view.
 */
function setViewFocus(view, on) {
  view.setPixelBudget?.(on ? FOCUS_PIXELS : null);
  view.setTallFrames?.(true);
}

function enterFocus(rec, fullscreen = false) {
  if (focusRec && focusRec !== rec) exitFocus({ keepFullscreen: true });
  closeMenus();
  focusRec = rec;
  $("sky-panel").classList.add("focus");
  rec.root.classList.add("is-focus");
  document.body.classList.add("sky-focus");
  if (rec.view) setViewFocus(rec.view, true);
  if (fullscreen && document.fullscreenEnabled && !document.fullscreenElement) {
    focusFullscreen = true;
    document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => (focusFullscreen = false));
  }
  rec.root.querySelector(".sky-exit-btn").focus({ preventScroll: true });
}

function exitFocus({ keepFullscreen = false } = {}) {
  if (!focusRec) return;
  const rec = focusRec;
  focusRec = null;
  $("sky-panel").classList.remove("focus");
  rec.root.classList.remove("is-focus");
  document.body.classList.remove("sky-focus");
  if (rec.view) setViewFocus(rec.view, false);
  if (!keepFullscreen && focusFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (!keepFullscreen) focusFullscreen = false;
  if (rec.root.isConnected) {
    rec.root.scrollIntoView({ block: "nearest" });
    rec.root.querySelector(".sky-focus-btn").focus({ preventScroll: true });
  }
}

/** Leave focus mode (e.g. Back to another story while a view fills the window). */
export function leaveFocus() {
  exitFocus();
}

function initFocusKeys() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !focusRec || document.querySelector("dialog[open]")) return;
    e.preventDefault();
    exitFocus();
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && focusFullscreen) {
      focusFullscreen = false;
      exitFocus();
    }
  });
}

/**
 * Keep the page scrollable over the views: a plain wheel scrolls the page, and only Ctrl/Cmd + wheel (or a trackpad
 * pinch) zooms. After the user clicks or drags in a view, the wheel zooms it until the pointer leaves the view.
 */
function guardWheel(rec) {
  const el = rec.viewEl;
  let hintTimer = 0;
  el.addEventListener("pointerdown", () => (rec.engaged = true));
  el.addEventListener("pointerleave", () => (rec.engaged = false));
  el.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || e.metaKey || rec.engaged || !rec.view) return;
      e.stopPropagation(); // capture phase: the view's zoom handler never sees the event, so the page scrolls
      const hint = el.querySelector(".sky-hint");
      if (!hint) return;
      hint.hidden = false;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => (hint.hidden = true), 1400);
    },
    { capture: true, passive: true },
  );
}

/** 3D views hold GPU memory (shadow maps), so only a few stay alive: off-screen ones are released and rebuilt on return. */
const MAX_LIVE_VIEWS = 4;
function recycleViews() {
  const live = [...cards.values()].filter((r) => r.view);
  let extra = live.length - MAX_LIVE_VIEWS;
  for (const rec of live) {
    if (extra <= 0) break;
    if (rec.onScreen) continue;
    rec.view.dispose();
    rec.view = null;
    rec.viewEl.replaceChildren();
    rec.viewEl.insertAdjacentHTML("beforeend", LOADING_HTML);
    extra--;
  }
}

/**
 * Give a live view the card's current terrain. The 3D view swaps its terrain in place (setTerrain); a view without
 * that (the 2D fallback) is rebuilt.
 */
function swapTerrain(rec) {
  const it = rec.it;
  if (it.route && typeof rec.view.setTerrain === "function") {
    rec.rideStation = null; // the next update gives the rover's current station terrain
    return;
  }
  if (typeof rec.view.setTerrain === "function") {
    // Catalog sites keep their C4 patch file; custom points get the live patch (or none yet).
    rec.view.setTerrain(it.s.site_id ? { horizon: it.horizon } : { horizon: it.horizon, patch: skyPatch(it.patch) });
    return;
  }
  rec.view.dispose();
  rec.view = null;
  rec.viewEl.replaceChildren();
  rec.viewEl.insertAdjacentHTML("beforeend", LOADING_HTML);
  if (rec.onScreen && !rec.creating) createView(rec);
}

async function createView(rec) {
  rec.creating = true;
  try {
    const it = rec.it;
    // Catalog sites: the precomputed C4 patch file. Custom points: the live Moon Trek patch once it has arrived.
    const patchUrl = it.s.site_id ? await terrainPatchUrl(it.s.site_id) : null;
    // Rover traverses: the view starts where the rover is, with the ground of the route grid (web/js/rover).
    const ride = it.route ? rideAt(it, timeFor(it)) : null;
    if (ride) {
      rec.rideStation = ride.stationK;
      rec.rideSite = ride.site;
    }
    const { view, mode } = await makeSkyView(rec.viewEl, {
      site: ride ? { ...ride.site, horizon: ride.horizon } : it.site, terrainPatchUrl: patchUrl,
      terrainPatch: ride ? ridePatch(it, ride) : it.s.site_id ? null : skyPatch(it.patch),
      fovDeg: 70, earthNightTextureUrl: "assets/earth_night.jpg",
      closeUp: viewOpts.closeUp, showConstellations: viewOpts.constellations, exposure: viewOpts.exposure,
      hudLevel: viewOpts.hudLevel, buttons: false, // the card's "⋯" menu holds the toggles
      onNotes: (notes) => {
        rec.notes = notes;
        footNote(rec);
      },
    });
    if (!cards.has(rec.key)) {
      view.dispose(); // the scenario was removed while the view was loading
      return;
    }
    rec.view = view;
    rec.mode = mode;
    // The terrain may have changed while the view was loading (live terrain of a custom point).
    if (rec.it.horizon !== it.horizon || rec.it.patch !== it.patch) swapTerrain(rec);
    setViewFocus(view, rec === focusRec);
    rec.viewEl.querySelector(".sky-loading")?.remove();
    rec.lastT = null;
    await updateCard(rec);
    lookOne(rec, aimBody);
    // A shared link's camera (az, el, field of view) for the first view.
    const cam = pendingCamera;
    if (cam && items.length && rec.it === items[0] && rec.view.lookAt && rec.view.setFov) {
      pendingCamera = null;
      rec.view.lookAt(Number(cam.az_deg) || 0, Number(cam.el_deg) || 0);
      if (Number(cam.fov_deg) > 0) rec.view.setFov(Number(cam.fov_deg));
      rec.camTouched = true;
    }
  } catch (err) {
    console.error(err);
    const msg = rec.viewEl.querySelector(".sky-loading");
    if (msg) msg.textContent = "The sky view could not start.";
  } finally {
    rec.creating = false;
  }
}

function timeFor(it) {
  return it.t0 + Math.min(offsetMs, it.span || 0);
}

/** "Earth covers 81% of the Sun" while the Earth eclipses the Sun (C6 sun.eclipse_frac > 0), else "". */
function eclipseText(sun) {
  const e = sun.eclipse_frac ?? 0;
  if (!(e > 0)) return "";
  if (e >= 1) return "Total eclipse: the Earth hides the Sun";
  const p = e * 100;
  return `Eclipse: the Earth covers ${p > 99 || p < 1 ? (Math.floor(p * 10) / 10).toFixed(1) : Math.round(p)}% of the Sun`;
}

async function updateCard(rec) {
  const it = rec.it;
  const t = timeFor(it);
  rec.root.querySelector(".sky-card-time").textContent = formatUtc(t);
  if (rec.lastT === t && rec.state) return;
  // Rover traverses: sky, skyline and ground of the station the rover has reached (web/js/rover/sky_ride.js).
  const ride = it.route ? rideAt(it, t) : null;
  const st = await stateAt(ride ? ride.site : it.site, t);
  rec.state = st;
  rec.lastT = t;
  const moved = ride && rec.view?.setTerrain && rec.rideStation !== ride.stationK;
  if (moved && rec.rideSite && rec.view.getView) {
    // Keep looking at the same physical direction: the local azimuth frame turns as the rover moves.
    const v = rec.view.getView();
    rec.view.lookAt(v.az_deg + frameTurnDeg(rec.rideSite, ride.site), v.el_deg);
  }
  if (rec.view) rec.view.update(st);
  if (moved) {
    rec.rideStation = ride.stationK;
    rec.view.setTerrain({ horizon: ride.horizon, patch: ridePatch(it, ride) });
  }
  if (ride) rec.rideSite = ride.site;
  const foot = rec.root.querySelector(".sky-card-foot");
  // Plain words with the numbers (web/js/sky/words.js): "hidden behind terrain" when the skyline hides a body that is
  // above the horizontal plane, "below the horizon" only when the whole disk is below that plane.
  const skyline = ride ? ride.horizon : it.horizon;
  const skyAt = (b) => (skyline ? horizonElAt(skyline, b.az_deg) : 0);
  const [cs, ce] = compassPair(st.sun.az_deg, st.earth.az_deg);
  const sunTxt = bodyLine("Sun", st.sun, cs, skyAt(st.sun));
  const earthTxt = bodyLine("Earth", st.earth, ce, skyAt(st.earth), { neverRises: earthNeverRises(it.s.lat_deg, it.s.lon_deg) })
    + (st.earth.vis_frac > 0 ? ` · ${Math.round(st.earth.phase_frac * 100)}% lit` : "");
  const ecl = eclipseText(st.sun);
  foot.innerHTML = `${ecl ? `<span class="foot-eclipse">🌑 ${esc(ecl)}</span>` : ""}<span>☀ ${esc(sunTxt)}</span><span>🌍 ${esc(earthTxt)}</span>${
    ride ? `<span class="note">${esc(rideNote(it, ride))}</span>` : terrainNote(it)
  }<span class="note sky-foot-note"></span>`;
  footNote(rec);
  // Text alternative for screen readers, and the keys the view takes (C8 view: arrows turn, + and - zoom).
  rec.viewEl.setAttribute("aria-label", `Sky from ${it.label} at ${formatUtc(t)}. ${ecl ? `${ecl}. ` : ""}${sunTxt}. ${earthTxt}. Drag or use the arrow keys to look around; plus and minus zoom.`);
}

/**
 * The sky view's notes, in the card footer for narrow cards (app.css shows this span only there; the view hides its own
 * note there). The Sun and Earth notes are left out: the footer already says where they are; so is the eclipse note
 * while the footer names the eclipse.
 */
function footNote(rec) {
  const span = rec.root.querySelector(".sky-foot-note");
  if (!span) return;
  span.textContent = (rec.notes || []).filter((n) => n.id !== "sun" && n.id !== "earth" && n.id !== "eclipse").map((n) => n.text).join(" · ");
}

function terrainNote(it) {
  if (!it.s.site_id) {
    // Custom points: live terrain status ("Loading NASA terrain…", real Moon Trek terrain, or the coarse fallback).
    const text = terrainStatusText(it.s.lat_deg, it.s.lon_deg);
    const tip = it.horizon?.approximate
      ? "Until the NASA Moon Trek terrain arrives (or if it cannot be reached), custom points use a coarse LOLA grid (about 3.8 km per cell, 480 m near the south pole), so hills within a few km are missing."
      : "Horizon and 3D ground from NASA LRO LOLA elevation, fetched for this point from NASA Moon Trek.";
    return `<span class="note" title="${esc(tip)}">${esc(text)}</span>`;
  }
  if (it.horizon) return '<span class="note">real terrain horizon (LOLA)</span>';
  return '<span class="note">flat horizon: terrain profile not loaded yet</span>';
}

/** Recompute the states of all views for the current slider time (coalesced). */
async function refresh() {
  syncSlider();
  onTimeChange(maxSpan > 0 ? offsetMs : 0);
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  try {
    do {
      pending = false;
      // Views scrolled out of sight (or hidden behind a focused view) are skipped; they catch up when they return.
      await Promise.all([...cards.values()].filter((rec) => rec.inView !== false).map((rec) => updateCard(rec)));
    } while (pending);
  } finally {
    busy = false;
  }
}

function syncSlider() {
  const slider = $("sky-slider");
  slider.value = maxSpan > 0 ? String(Math.round((offsetMs / maxSpan) * 1000)) : "0";
  // Plain words for the time since the start (T+): "Start", "5 d 14 h after start".
  // On phones the words shorten to "T+5 d 14 h" (app.css).
  const clock = $("sky-clock");
  if (!(maxSpan > 0)) clock.textContent = "Single instant: add an end time or a duration to play a timelapse";
  else if (offsetMs < 30e3) clock.textContent = "Start";
  else clock.innerHTML = `<span class="clk-num">${formatDuration(offsetMs)}</span><span class="clk-word"> after start</span>`;
  clock.title = maxSpan > 0
    ? "Time since the start of each scenario (T+); missions are synchronised by it"
    : "Add an end time (or a duration) to a scenario to play a timelapse";
}

function play() {
  if (maxSpan <= 0) return;
  if (offsetMs >= maxSpan) offsetMs = 0;
  playing = true;
  $("btn-play").classList.add("playing");
  $("btn-play").setAttribute("aria-label", "Pause timelapse");
  lastFrame = performance.now();
  const tick = (now) => {
    if (!playing) return;
    const dt = Math.min(0.25, (now - lastFrame) / 1000);
    lastFrame = now;
    offsetMs += dt * Number($("sky-speed").value);
    if (offsetMs >= maxSpan) {
      offsetMs = maxSpan;
      stop();
    }
    refresh();
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stop() {
  playing = false;
  cancelAnimationFrame(rafId);
  $("btn-play").classList.remove("playing");
  $("btn-play").setAttribute("aria-label", "Play timelapse");
}

function lookOne(rec, body) {
  if (!rec.view || !rec.state) return;
  rec.camTouched = false;
  // The 3D view frames the body and the horizon together (C8 framing rule); the 2D fallback just turns to it.
  if (typeof rec.view.lookAtBody === "function") return rec.view.lookAtBody(body);
  const b = rec.state[body];
  rec.view.lookAt(b.az_deg, Math.max(b.el_deg, 5));
}
