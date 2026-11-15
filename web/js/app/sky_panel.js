// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The sky panel: one sky view per scenario in a grid, the timelapse bar under it (a shared time slider: time since each
// scenario's start, so missions are synchronised; play/pause with a speed selector; the camera group: "Follow Sun" /
// "Follow Earth", which keeps the selected body framed in every view while the time runs, and, with a rover trip on
// screen, "Driver's view", which faces the way the rover drives), and the body every view is aimed at (the page's
// Sun | Earth switch, main.js). The panel sits in the page's stage, which fills the window (app.css .sky-stage). Each
// view's card has a "⋯" menu of the rarely used view options (Close-up, Constellations, Exposure, Numbers) and a full
// screen button. Views are created lazily, when they scroll into view.

import { formatDuration, formatUtc } from "./state.js";
import { icon } from "./icons.js";
import { infoTip } from "./info_tip.js";
import { horizonElAt } from "./derive.js";
import { bodyLine, compassPair, earthNeverRises } from "../sky/words.js";
import { stateAt } from "./physics_adapter.js";
import { makeSkyView, terrainPatchUrl, skyPatch } from "./sky_adapter.js";
import { terrainStatusText } from "./terrain_live.js";
import { bindPinchZoom, bindAxisLock } from "./gestures.js";
import { rideAt, rideGround, rideNote, rideCamera, rideTerrain } from "../rover/sky_ride.js";
import { autoSpeed } from "./playback.js";
import { linkViewCone, syncViewCone, pruneViewCones } from "./view_cone_link.js";

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
 * too. The HUD always shows the full readout (time, Sun and Earth heights and directions, visible and lit shares).
 */
const viewOpts = { closeUp: true, constellations: true, exposure: "eye", hudLevel: "full" };

/**
 * Open the next completely new set of scenarios (the one main.js is about to load) at a given moment and view:
 * offsetMs = time since the scenarios' start (ms); view = the camera of the first view ({ az_deg, el_deg, fov_deg },
 * deg, local horizon frame); speedMs (optional) = the timelapse speed (ms per s, a value of the speed menu). Null
 * fields keep the defaults (T+0, the views aimed at the selected body, the speed that follows the longest span).
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

const timeListeners = new Set();

/**
 * Call cb() whenever the time shown changes (slider, playback: every frame, a new set, jumpTo), like opts.onTime of
 * initSky but for any number of listeners (the globe's day and night, web/js/app/daylight_link.js). Returns a
 * function that removes it.
 */
export function onSkyTime(cb) {
  timeListeners.add(cb);
  return () => timeListeners.delete(cb);
}

/** The moment each view shows now, in card order: [{ id (scenario id), label, t_ms (UTC epoch ms) }]. */
export function skyMoments() {
  return items.map((it) => ({ id: it.s.id, label: it.label, t_ms: timeFor(it) }));
}

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
  $("btn-follow").addEventListener("click", () => pressCamera("body"));
  $("btn-driver").addEventListener("click", () => pressCamera("ahead"));
  syncCamGroup();
  initFullKeys();
  initOptionMenus();
}

/**
 * Aim every view at a body ("sun" | "earth"), now and for views created later. aim = false only records the body
 * (a story or a link about to load new views, which aim themselves when they are built). While Follow is on, the views
 * follow the new body (a pause made by a drag ends); a rover view in the driver's view keeps facing the way ahead.
 */
export function setSkyBody(body, { aim = true } = {}) {
  aimBody = body === "sun" ? "sun" : "earth";
  if (aim) {
    for (const rec of cards.values()) {
      if (trackMode === "body") {
        rec.camTouched = false;
        rec.trackPaused = false;
        applyTrack(rec, true);
      } else if (!(trackMode === "ahead" && rec.it.route && lookAheadFn)) lookOne(rec, aimBody);
    }
  }
  syncCamGroup();
}

// ---------------------------------------------------------------------------------------------
// The camera group of the timelapse bar: "Follow Sun" / "Follow Earth" (track mode "body": every view follows the body
// of the Sun | Earth switch while the time changes, C8 extra setTrack) or, with a rover trip on screen, "Driver's
// view" (track mode "ahead": trip views face the direction of travel, given by setLookAheadSource). One mode at a
// time: the last one chosen wins, and pressing the one that is on turns it off (free look). A drag in a view pauses
// it there until its button is pressed again.

let trackMode = null; // null | "body" | "ahead"
let lookAheadFn = null; // (item, tMs, ride) -> { az_deg, el_deg } | null
const trackListeners = new Set();

/**
 * Turn tracking on or off for every view: "body" (Follow: the Sun | Earth switch's body), "ahead" (Driver's view:
 * rover traverses face their direction of travel; other views are left free) or null (free look). Choosing a mode
 * replaces the other one and ends any pause. Listeners (onTrackModeChange) hear every change.
 */
export function setTrackMode(mode) {
  const m = mode === "body" || mode === "ahead" ? mode : null;
  const changed = m !== trackMode;
  trackMode = m;
  for (const rec of cards.values()) {
    rec.trackPaused = false;
    if (m === "body") rec.camTouched = false;
    applyTrack(rec, true);
  }
  syncCamGroup();
  if (changed) for (const cb of trackListeners) cb(trackMode);
}

/** The track mode now: null | "body" | "ahead". */
export function getTrackMode() {
  return trackMode;
}

/** Call cb(mode) whenever the track mode changes (the camera group, setTrackMode, or a new set of scenarios). Returns an unsubscribe. */
export function onTrackModeChange(cb) {
  trackListeners.add(cb);
  return () => trackListeners.delete(cb);
}

/**
 * The direction a rover view looks in "ahead" mode (Driver's view): fn(item, tMs, ride) -> { az_deg, el_deg } (deg, the local horizon
 * frame of the view's current site: ride.site of web/js/rover/sky_ride.js rideAt) or null. Called for every frame of a
 * traverse's view; the view eases toward it (C8 setTrack). Pass null to remove it.
 */
export function setLookAheadSource(fn) {
  lookAheadFn = typeof fn === "function" ? fn : null;
  if (trackMode === "ahead") for (const rec of cards.values()) applyTrack(rec);
}

function lookAheadDir(rec, ride = null) {
  if (!lookAheadFn || !rec.it.route) return null;
  try {
    const t = timeFor(rec.it);
    return lookAheadFn(rec.it, t, ride ?? rideAt(rec.it, t)) || null;
  } catch (err) {
    console.warn("[moonat] look-ahead direction failed", err);
    return null;
  }
}

/** Give one view the current track mode (C8 setTrack; the 2D fallback has a simple one). resume: end a drag's pause. */
function applyTrack(rec, resume = false, ride = null) {
  const v = rec.view;
  if (!v?.setTrack) return;
  if (trackMode === "body") {
    if (resume || !rec.trackPaused) v.setTrack(aimBody);
  } else if (trackMode === "ahead") v.setTrack(lookAheadDir(rec, ride), { resume });
  else v.setTrack(null);
}

/** A view reports its tracking state ({ mode, body, paused }): a drag paused it, or it started or stopped. */
function onViewTrack(rec, info) {
  rec.trackPaused = !!(info && info.mode && info.paused);
  syncCamGroup();
}

/**
 * A camera button ("body": Follow, "ahead": Driver's view). Off: turn its mode on (the other one goes off). On:
 * turn it off (free look). On but paused by a drag: follow again.
 */
function pressCamera(mode) {
  const paused = [...cards.values()].filter((r) => r.view && r.trackPaused);
  if (trackMode === mode && paused.length) {
    for (const rec of paused) {
      rec.trackPaused = false;
      if (trackMode === "body") rec.camTouched = false;
      applyTrack(rec, true);
    }
    syncCamGroup();
    return;
  }
  setTrackMode(trackMode === mode ? null : mode);
}

/**
 * The camera group's words and states: "Follow Sun" / "Follow Earth" (the switch's body) and "Driver's view" (only
 * with a rover trip on screen); aria-pressed "true" (on), "mixed" (on, paused by a drag, "· paused") or "false".
 */
function syncCamGroup() {
  const follow = $("btn-follow"), driver = $("btn-driver");
  if (!follow || !driver) return;
  const paused = !!trackMode && [...cards.values()].some((r) => r.view && r.trackPaused);
  const name = aimBody === "sun" ? "Sun" : "Earth";
  const state = (m) => (trackMode !== m ? "false" : paused ? "mixed" : "true");
  follow.setAttribute("aria-pressed", state("body"));
  follow.querySelector(".cam-body").textContent = name;
  follow.querySelector(".cam-state").textContent = trackMode === "body" && paused ? "paused" : "";
  follow.title = trackMode !== "body"
    ? `Follow the ${name}: keep it framed in every view while the timelapse plays (the body last aimed with the Sun | Earth | Both switch)`
    : paused
      ? `Paused: you turned a view. Press to follow the ${name} again.`
      : `Following the ${name}: every view keeps it framed as the time runs. You can still zoom; a drag pauses it. Press for free look.`;
  driver.hidden = !items.some((it) => it.route);
  driver.setAttribute("aria-pressed", state("ahead"));
  driver.querySelector(".cam-state").textContent = trackMode === "ahead" && paused ? "paused" : "";
  driver.title = trackMode !== "ahead"
    ? "Driver's view: the rover's view faces the way it drives as the timelapse plays"
    : paused
      ? "Paused: you turned a view. Press to face the way the rover drives again."
      : "Driver's view: the view faces the way the rover drives. A drag pauses it. Press for free look.";
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
    // A story may choose the speed (start.speedMs, one of the menu's); it then holds like one the user picked.
    speedTouched = false;
    if (start.speedMs && [...$("sky-speed").options].some((o) => Number(o.value) === start.speedMs)) {
      $("sky-speed").value = String(start.speedMs);
      speedTouched = true;
    }
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
    syncViewCone(rec); // the globe's wedge: a moved place or a new theme colour
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
    if (rec === fullRec) exitFull();
    unwatch(rec);
    if (rec.view) rec.view.dispose();
    rec.root.remove();
    cards.delete(key);
  }
  pruneViewCones(items);
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
  // The driver's view needs a rover traverse on screen.
  if (trackMode === "ahead" && !items.some((it) => it.route)) setTrackMode(null);
  syncCamGroup();
  refresh();
}

const LOADING_HTML = '<div class="sky-loading">Loading sky…</div><div class="sky-hint" hidden>Ctrl + scroll to zoom</div>';

const OPTION_ITEMS = [
  { key: "closeUp", text: "Close-up (6× zoom)", tip: "The round inset that magnifies the Earth (and the Sun while hills or the Earth cover part of it)" },
  { key: "constellations", text: "Constellations", tip: "Constellation lines and the names of well-known ones" },
  { key: "exposure", text: "Camera exposure", tip: "Exposed for the sunlit ground, as in the Apollo photographs: the stars vanish while the Sun is up. Off: the eye, with the stars dimmed but visible." },
];
function optionOn(key) {
  if (key === "exposure") return viewOpts.exposure === "camera";
  return !!viewOpts[key];
}

function buildCard(it, key) {
  const root = document.createElement("article");
  root.className = "sky-card";
  const menuItems = OPTION_ITEMS.map((o) => `<button type="button" class="sky-opt" role="menuitemcheckbox" data-opt="${o.key}"
      aria-checked="${optionOn(o.key)}" title="${esc(o.tip)}"><span class="sky-opt-box" aria-hidden="true"></span>${esc(o.text)}</button>`).join("");
  root.innerHTML = `
    <div class="sky-card-head"><span class="swatch" aria-hidden="true"></span><span class="mcard-title"></span>
      <span class="sky-card-acts">
        <span class="sky-opts">
          <button type="button" class="sky-act sky-opts-btn" aria-haspopup="menu" aria-expanded="false" title="View options" aria-label="View options"><span aria-hidden="true">⋯</span></button>
          <span class="sky-opts-menu" role="menu" aria-label="View options" hidden>${menuItems}</span>
        </span>
        <button type="button" class="sky-act sky-fs-btn" title="Full screen (Esc to exit)" aria-label="Full screen">${icon("fullscreen")}</button>
        <button type="button" class="sky-act sky-exit-btn" title="Back to the page (Esc)">${icon("close")}<span>Exit full screen</span></button>
      </span></div>
    <div class="sky-view" role="group" aria-roledescription="sky view" aria-label="Sky view">${LOADING_HTML}</div>
    <div class="sky-card-foot"></div>`;
  const rec = { key, it, root, viewEl: root.querySelector(".sky-view"), view: null, creating: false, state: null, engaged: false };
  root.querySelector(".sky-fs-btn").addEventListener("click", () => enterFull(rec));
  root.querySelector(".sky-exit-btn").addEventListener("click", () => exitFull());
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
// Full screen: one view fills the screen, with the timelapse bar and the camera group under it. The browser's full
// screen (Fullscreen API) is asked for when it has one; without it (iPhone Safari) the view fills the window. Esc or
// "Exit full screen" returns to the page; leaving the browser's full screen leaves this mode too.

let fullRec = null;
let fullNative = false; // the browser's full screen was asked for by this mode
/** Drawing-buffer budget (device pixels) of a full-screen view: about a 2560 × 1440 screen at full resolution. */
const FULL_PIXELS = 4.2e6;

/**
 * A full-screen view gets more pixels. Every view may use a taller frame (C8 extras), so a high Earth fits with the
 * horizon: the frame keeps the full width whenever the body rule fits both, and narrows (with blurred side bands)
 * only for an Earth too high for that, e.g. Apollo 11 in a wide window or Apollo 16 in a 16:9 grid view.
 */
function setViewFull(view, on) {
  view.setPixelBudget?.(on ? FULL_PIXELS : null);
  view.setTallFrames?.(true);
}

function enterFull(rec) {
  if (fullRec && fullRec !== rec) exitFull({ keepNative: true });
  closeMenus();
  fullRec = rec;
  $("sky-panel").classList.add("full");
  rec.root.classList.add("is-full");
  document.body.classList.add("sky-full");
  if (rec.view) setViewFull(rec.view, true);
  if (document.fullscreenEnabled && !document.fullscreenElement) {
    fullNative = true;
    document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => (fullNative = false));
  }
  rec.root.querySelector(".sky-exit-btn").focus({ preventScroll: true });
}

function exitFull({ keepNative = false } = {}) {
  if (!fullRec) return;
  const rec = fullRec;
  fullRec = null;
  $("sky-panel").classList.remove("full");
  rec.root.classList.remove("is-full");
  document.body.classList.remove("sky-full");
  if (rec.view) setViewFull(rec.view, false);
  if (!keepNative && fullNative && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (!keepNative) fullNative = false;
  if (rec.root.isConnected) {
    rec.root.scrollIntoView({ block: "nearest" });
    rec.root.querySelector(".sky-fs-btn").focus({ preventScroll: true });
  }
}

function initFullKeys() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !fullRec || document.querySelector("dialog[open]")) return;
    e.preventDefault();
    exitFull();
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && fullNative) {
      fullNative = false;
      exitFull();
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
    rec.rideGroundKey = null; // the next update gives the ground where the rover is
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
    // Rover trips: the view starts where the rover is, with the ground of the route grid (web/js/rover/sky_ride.js).
    const ride = it.route ? rideAt(it, timeFor(it)) : null;
    const ground = ride ? rideGround(it, ride) : null;
    if (ride) {
      rec.rideGroundKey = `${it.key}|${ride.ground.index}`;
      rec.rideSite = ride.site;
    }
    const { view, mode } = await makeSkyView(rec.viewEl, {
      site: ride ? { ...ride.site, horizon: ground.horizon } : it.site, terrainPatchUrl: patchUrl,
      terrainPatch: ride ? ground.patch : it.s.site_id ? null : skyPatch(it.patch),
      terrainDetail: ride ? ground.detail : null, // a drive: decorative detail anchored to the ground (sky/detail.js)
      fovDeg: 70, earthNightTextureUrl: "assets/earth_night.jpg",
      closeUp: viewOpts.closeUp, showConstellations: viewOpts.constellations, exposure: viewOpts.exposure,
      hudLevel: viewOpts.hudLevel, buttons: false, // the card's "⋯" menu holds the toggles
      onNotes: (notes) => {
        rec.notes = notes;
        footNote(rec);
      },
      onTrack: (info) => onViewTrack(rec, info),
    });
    if (!cards.has(rec.key)) {
      view.dispose(); // the scenario was removed while the view was loading
      return;
    }
    rec.view = view;
    rec.mode = mode;
    linkViewCone(rec); // the view's camera drives its wedge on the globe
    // The terrain may have changed while the view was loading (live terrain of a custom point).
    if (rec.it.horizon !== it.horizon || rec.it.patch !== it.patch) swapTerrain(rec);
    setViewFull(view, rec === fullRec);
    rec.viewEl.querySelector(".sky-loading")?.remove();
    rec.lastT = null;
    await updateCard(rec);
    lookOne(rec, aimBody);
    // Follow or Driver's view on: the new view follows from its first frame (a view rebuilt after scrolling away starts
    // again unpaused).
    rec.trackPaused = false;
    if (trackMode) applyTrack(rec, true);
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
  if (rec.lastT === t && rec.state) return;
  // Rover trips: the sky at the rover's exact position on the path, the camera turned with it (or facing the way
  // ahead), the 3D ground rebuilt where it is (web/js/rover/sky_ride.js).
  const ride = it.route ? rideAt(it, t) : null;
  const st = await stateAt(ride ? ride.site : it.site, t);
  rec.state = st;
  rec.lastT = t;
  if (ride) rideCamera(rec, ride, { ahead: trackMode === "ahead" });
  if (rec.view) rec.view.update(st);
  if (ride) rideTerrain(rec, it, ride);
  if (ride) syncViewCone(rec); // the wedge rides with the rover even when the camera did not turn
  // Driver's view (rover traverses): a new direction of travel for every frame; the view eases toward it.
  if (trackMode === "ahead" && it.route && rec.view) applyTrack(rec, false, ride);
  // Plain words with the numbers (web/js/sky/words.js), for screen readers: the view's HUD shows the same numbers.
  // "hidden behind terrain" when the skyline hides a body that is above the horizontal plane, "below the horizon" only
  // when the whole disk is below that plane.
  const skyline = ride ? ride.horizon : it.horizon;
  const skyAt = (b) => (skyline ? horizonElAt(skyline, b.az_deg) : 0);
  const [cs, ce] = compassPair(st.sun.az_deg, st.earth.az_deg);
  const sunTxt = bodyLine("Sun", st.sun, cs, skyAt(st.sun));
  const earthTxt = bodyLine("Earth", st.earth, ce, skyAt(st.earth), { neverRises: earthNeverRises(it.s.lat_deg, it.s.lon_deg) })
    + (st.earth.vis_frac > 0 ? ` · ${Math.round(st.earth.phase_frac * 100)}% lit` : "");
  const ecl = eclipseText(st.sun);
  syncFoot(rec, ride ? rideFoot(rideNote(it, ride)) : terrainFoot(it));
  footNote(rec);
  // Text alternative for screen readers, and the keys the view takes (C8 view: arrows turn, + and - zoom).
  rec.viewEl.setAttribute("aria-label", `Sky from ${it.label} at ${formatUtc(t)}. ${ecl ? `${ecl}. ` : ""}${sunTxt}. ${earthTxt}. Drag or use the arrow keys to look around; plus and minus zoom.`);
}

/**
 * The sky view's notes, in the card footer for narrow cards (app.css shows this span only there; the view hides its own
 * note there). The Sun, Earth and eclipse notes are left out: the view's readout (full HUD) already says them.
 */
function footNote(rec) {
  const span = rec.root.querySelector(".sky-foot-note");
  if (!span) return;
  span.textContent = (rec.notes || []).filter((n) => n.id !== "sun" && n.id !== "earth" && n.id !== "eclipse").map((n) => n.text).join(" · ");
}

const EPHEM_SOURCE = "Sun and Earth positions: JPL DE421 ephemeris.";

/**
 * The status line under a view (built once per card, then only its texts change, so an open "i" stays open while the
 * time runs): progress (a rover trip's "Rover 5.51 of 5.8 km · driving"), status (a live terrain status shown while
 * it matters, e.g. "Loading NASA terrain…"), the view's notes in narrow cards, and the data source behind an "i" icon.
 */
function syncFoot(rec, { progress = "", status = "", source = "" }) {
  const foot = rec.root.querySelector(".sky-card-foot");
  if (!foot.querySelector(".info-tip")) {
    foot.innerHTML = `<span class="foot-ride" hidden>${icon("rover")}<span class="foot-ride-txt"></span></span><span class="note foot-status" hidden></span><span class="note sky-foot-note"></span>${infoTip("", { label: "Data sources of this view", end: true })}`;
  }
  const set = (sel, text) => {
    const el = foot.querySelector(sel);
    el.hidden = !text;
    const t = el.querySelector(".foot-ride-txt") || el;
    if (t.textContent !== text) t.textContent = text;
  };
  set(".foot-ride", progress);
  set(".foot-status", status);
  const pop = foot.querySelector(".info-pop");
  const text = `${source} ${EPHEM_SOURCE}`.trim();
  if (pop.textContent !== text) pop.textContent = text;
}

/** A rover trip's status line: its progress shown, the route grid's terrain behind the "i" (rover/sky_ride.js rideNote). */
function rideFoot(note) {
  const i = note.lastIndexOf(" · terrain: ");
  if (i < 0) return { progress: note };
  return { progress: note.slice(0, i), source: `Terrain: ${note.slice(i + 12)} (NASA LRO LOLA).` };
}

/** A place's status line: the terrain behind the "i"; a live terrain status that matters (loading, missing) shown. */
function terrainFoot(it) {
  if (!it.s.site_id) {
    // Custom points: live terrain status ("Loading NASA terrain…", real Moon Trek terrain, or the coarse fallback).
    const text = terrainStatusText(it.s.lat_deg, it.s.lon_deg);
    const tip = it.horizon?.approximate
      ? "Until the NASA Moon Trek terrain arrives (or if it cannot be reached), custom points use a coarse LOLA grid (about 3.8 km per cell, 480 m near the south pole), so hills within a few km are missing."
      : "Horizon and 3D ground from NASA LRO LOLA elevation, fetched for this point from NASA Moon Trek.";
    return { status: /^Loading/.test(text) ? text : "", source: `${text}. ${tip}` };
  }
  if (it.horizon) return { source: "Real terrain horizon from NASA LRO LOLA elevation." };
  return { status: "Flat horizon: terrain profile not loaded yet", source: "Flat horizon: the terrain profile is not loaded yet." };
}

/** Recompute the states of all views for the current slider time (coalesced). */
async function refresh() {
  syncSlider();
  onTimeChange(maxSpan > 0 ? offsetMs : 0);
  for (const cb of timeListeners) cb();
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  try {
    do {
      pending = false;
      // Views scrolled out of sight (or hidden behind a full-screen view) are skipped; they catch up when they return.
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
