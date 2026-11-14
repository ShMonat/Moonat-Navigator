// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Sky tab: one sky view per scenario in a grid, a shared time slider (time since each scenario's start, so missions
// are synchronised), play/pause timelapse with a speed selector, and "Look at Earth" / "Look at Sun".
// Views are created lazily, when the tab is shown and the card scrolls into view.

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
let visible = false;
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
let lookTarget = null; // "earth" | "sun" after a Look button; views created later follow it
let speedTouched = false; // the user picked a playback speed; until then it follows the longest scenario

let pendingStart = null; // { offsetMs, look, view } for the next completely new set of scenarios
let pendingCamera = null; // { az_deg, el_deg, fov_deg } for the first view of that set, applied when it is built

/**
 * Open the next completely new set of scenarios (the one main.js is about to load) at a given moment and view:
 * offsetMs = time since the scenarios' start (ms); look = "earth" | "sun" (as the Look buttons); view = the camera
 * of the first view ({ az_deg, el_deg, fov_deg }, deg, local horizon frame). Null fields keep the defaults.
 */
export function queueSkyStart(start = null) {
  pendingStart = start;
}

/**
 * The Sky tab's shareable state: { offsetMs, look, view }. `view` is the first view's camera, only when the user has
 * turned or zoomed it (otherwise the opening framing, which adapts to the window, is kept). A queued start that has
 * not been applied yet is returned as it is.
 */
export function skyShareState() {
  if (pendingStart) return pendingStart;
  const first = items.length ? cards.get(`${items[0].s.id}|${items[0].key}`) : null;
  const view = first?.view && first.camTouched && first.view.getView ? first.view.getView() : pendingCamera;
  return { offsetMs: maxSpan > 0 ? offsetMs : 0, look: lookTarget, view: view || null };
}

/** Playback speeds offered (ms of scenario time per real second), as in the #sky-speed options. */
const SPEEDS = [600000, 3600000, 21600000, 86400000];
/** A timelapse should last at most about this long (s) at the automatic speed. */
const TARGET_PLAY_S = 90;

export function initSkyTab() {
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
      if (rec.inView && rec.view && visible) updateCard(rec);
    }
  });

  $("sky-slider").addEventListener("input", (e) => {
    offsetMs = (Number(e.target.value) / 1000) * maxSpan;
    stop();
    refresh();
  });
  $("btn-play").addEventListener("click", () => (playing ? stop() : play()));
  $("sky-speed").addEventListener("change", () => (speedTouched = true));
  $("btn-look-earth").addEventListener("click", () => lookAll("earth"));
  $("btn-look-sun").addEventListener("click", () => lookAll("sun"));
  initFocusKeys();
}

/** Show or hide the tab. Views are only built while it is visible. */
export function setSkyVisible(v) {
  visible = v;
  if (!v) {
    stop();
    exitFocus();
  }
  if (v) {
    for (const rec of cards.values()) watch(rec);
    refresh();
  }
}

/**
 * Update the list of scenarios to show. items: [{ s, label, color, t0, span, site, horizon }] for valid scenarios.
 * Cards whose scenario and physics inputs are unchanged keep their view.
 */
export function setSkyItems(newItems) {
  items = newItems;
  const grid = $("sky-grid");
  $("sky-empty").hidden = items.length > 0;
  $("sky-controls").hidden = items.length === 0;

  const keep = new Set();
  const order = [];
  // A completely new set of scenarios (a quick start, a shared link) starts at T+0 with the default framing, or at the
  // moment and view queued for it (queueSkyStart).
  if (items.length && !items.some((it) => cards.has(`${it.s.id}|${it.key}`))) {
    const start = pendingStart || {};
    pendingStart = null;
    offsetMs = Math.max(0, Number(start.offsetMs) || 0);
    lookTarget = start.look === "earth" || start.look === "sun" ? start.look : null;
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
      if (visible) watch(rec);
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
  $("sky-slider").disabled = !hasMission;
  $("btn-play").disabled = !hasMission;
  $("sky-speed").disabled = !hasMission;
  $("sky-note").textContent = hasMission
    ? `${LOOK_HINT}. Missions are synchronised by time since their start.`
    : `${LOOK_HINT}. Add an end time to a scenario to play a timelapse.`;
  if (!hasMission) stop();
  if (hasMission && !speedTouched) $("sky-speed").value = String(autoSpeed(maxSpan));
  syncSlider();
  if (visible) refresh();
}

/** Slowest offered speed that plays the longest scenario in TARGET_PLAY_S seconds or less. */
function autoSpeed(spanMs) {
  return SPEEDS.find((v) => spanMs / v <= TARGET_PLAY_S) ?? SPEEDS[SPEEDS.length - 1];
}

const COARSE = window.matchMedia?.("(pointer: coarse)").matches;
const LOOK_HINT = COARSE ? "Drag a view to look around; pinch to zoom" : "Drag a view to look around; Ctrl + scroll to zoom";
const LOADING_HTML = '<div class="sky-loading">Loading sky…</div><div class="sky-hint" hidden>Ctrl + scroll to zoom</div>';

function buildCard(it, key) {
  const root = document.createElement("article");
  root.className = "sky-card";
  root.innerHTML = `
    <div class="sky-card-head"><span class="swatch" aria-hidden="true"></span><span class="mcard-title"></span><span class="sky-card-time"></span>
      <span class="sky-card-acts">
        <button type="button" class="sky-act sky-focus-btn" title="Focus: fill the window with this view (Esc to exit)"><span aria-hidden="true">⤢</span> Focus</button>
        <button type="button" class="sky-act sky-fs-btn" title="Full screen (Esc to exit)" aria-label="Full screen"><span aria-hidden="true">⛶</span><span class="sky-act-txt"> Full screen</span></button>
        <button type="button" class="sky-act sky-exit-btn" title="Back to the grid (Esc)"><span aria-hidden="true">✕</span> Exit focus</button>
      </span></div>
    <div class="sky-view" role="group" aria-roledescription="sky view" aria-label="Sky view">${LOADING_HTML}</div>
    <div class="sky-card-foot"></div>`;
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
// Focus mode: one view fills the window, with the time controls above it. Esc or "Exit focus" returns to the grid.
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
  focusRec = rec;
  $("tab-sky").classList.add("focus");
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
  $("tab-sky").classList.remove("focus");
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
  if (visible && rec.onScreen && !rec.creating) createView(rec);
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
    if (lookTarget) lookOne(rec, lookTarget);
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
    rec.viewEl.querySelector(".sky-loading").textContent = "The sky view could not start.";
  } finally {
    rec.creating = false;
  }
}

function timeFor(it) {
  return it.t0 + Math.min(offsetMs, it.span || 0);
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
  foot.innerHTML = `<span>☀ ${esc(sunTxt)}</span><span>🌍 ${esc(earthTxt)}</span>${
    ride ? `<span class="note">${esc(rideNote(it, ride))}</span>` : terrainNote(it)
  }<span class="note sky-foot-note"></span>`;
  footNote(rec);
  // Text alternative for screen readers, and the keys the view takes (C8 view: arrows turn, + and - zoom).
  rec.viewEl.setAttribute("aria-label", `Sky from ${it.label} at ${formatUtc(t)}. ${sunTxt}. ${earthTxt}. Arrow keys turn the view; plus and minus zoom.`);
}

/**
 * The sky view's notes, in the card footer for narrow cards (app.css shows this span only there; the view hides its own
 * note there). The Sun and Earth notes are left out: the footer already says where they are.
 */
function footNote(rec) {
  const span = rec.root.querySelector(".sky-foot-note");
  if (!span) return;
  span.textContent = (rec.notes || []).filter((n) => n.id !== "sun" && n.id !== "earth").map((n) => n.text).join(" · ");
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
  if (it.s.site_id) return '<span class="note">flat horizon: terrain profile not loaded yet</span>';
  return '<span class="note">terrain not included for custom points (yet)</span>';
}

/** Recompute the states of all views for the current slider time (coalesced). */
async function refresh() {
  if (!visible) return;
  syncSlider();
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
  $("sky-clock").textContent = maxSpan > 0 ? (offsetMs < 30e3 ? "Start" : `${formatDuration(offsetMs)} after start`) : "Single instant";
  $("sky-clock").title = "Time since the start of each scenario (T+); missions are synchronised by it";
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

function lookAll(body) {
  lookTarget = body;
  for (const rec of cards.values()) lookOne(rec, body);
}
