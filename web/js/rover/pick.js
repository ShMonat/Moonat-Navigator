// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Two-step pick of a rover traverse on the Moon globe: "click the start", then "click the end".
// The globe (web/js/app/map.js -> web/js/globe) offers every surface click to consumeMapClick() first. A click is
// taken here while a pick is running, or when the selected scenario is a traverse (that click then starts a new
// two-step pick at the clicked start). Route cards register a handler per scenario (registerRouteCard).

import { activeScenario } from "../app/store.js";

const cards = new Map(); // scenario id -> { onPoint(which, lat, lon), onDone() }
let pending = null; // { id, step: "start" | "end" }
let banner = null;

/** A route card's pick handlers: onPoint("start" | "end", lat, lon) for each click, onDone() after the end. */
export function registerRouteCard(id, handlers) {
  cards.set(id, handlers);
  return () => {
    if (cards.get(id) === handlers) cards.delete(id);
    if (pending?.id === id) cancelPick();
  };
}

/** Start a two-step pick for a traverse scenario (first the start, then the end). */
export function startPick(id, first = "start") {
  pending = { id, step: first };
  showBanner();
}

export function cancelPick() {
  pending = null;
  showBanner();
}

export function pickState() {
  return pending ? { ...pending } : null;
}

/** Offer a globe click (lat, lon in deg). Returns true when the rover planner took it. */
export function consumeMapClick(lat, lon) {
  if (!pending) {
    const s = activeScenario();
    if (!s || !s.route || !cards.has(s.id)) return false;
    pending = { id: s.id, step: "start" };
  }
  const h = cards.get(pending.id);
  if (!h) {
    cancelPick();
    return false;
  }
  const step = pending.step;
  h.onPoint(step, lat, lon);
  if (step === "start") {
    pending = { id: pending.id, step: "end" };
    showBanner();
  } else {
    pending = null;
    showBanner();
    h.onDone?.();
  }
  return true;
}

const listeners = new Set();
/** Listen to pick state changes (start, next step, done, cancel). Returns an unsubscribe function. */
export function onPickChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function showBanner() {
  for (const fn of listeners) fn(pending);
  if (typeof document === "undefined") return;
  const host = document.getElementById("map-block");
  if (!host) return;
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "rover-pick-banner";
    banner.setAttribute("role", "status");
    banner.innerHTML = '<span class="rover-pick-text"></span><button type="button" class="ghost rover-pick-cancel">Cancel</button>';
    banner.querySelector("button").addEventListener("click", cancelPick);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && pending) cancelPick();
    });
  }
  if (!pending) {
    banner.remove();
    host.classList.remove("rover-picking");
    return;
  }
  banner.querySelector(".rover-pick-text").textContent = pending.step === "start"
    ? "Rover traverse: click the START point on the Moon"
    : "Now click the END point (up to 60 km away)";
  host.classList.add("rover-picking");
  if (!banner.isConnected) host.prepend(banner);
}
