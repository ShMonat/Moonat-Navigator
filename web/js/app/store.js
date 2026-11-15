// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Tiny app store: the list of C7 scenarios plus UI state, with change notifications.
//
// Change kinds passed to listeners:
//   "structure" - scenarios added, removed, reordered or replaced (cards rebuild, physics recompute)
//   "field"     - a location or time changed in place (physics recompute; the edited card is not rebuilt)
//   "label"     - a label changed (outputs relabel, no recompute)
//   "active"    - the selected scenario changed
//   "ui"        - the Sun | Earth choice, the time axis, the theme, the globe's map layers or its day/night changed

import { makeScenario, nextColorSlot, copyLabel } from "./state.js";

const listeners = new Set();

export const store = {
  scenarios: [],
  activeId: null,
  xaxis: "met",
  body: "sun", // the Sun | Earth | Both switch: "sun" | "earth" (the views aim at it, its data shows) | "both" (both bodies' data)
  theme: "dark",
  mapLayers: [], // the globe's map layers that are on ("psr", "sun"; web/js/globe/layers.js)
  // the globe's base map ("imagery" | "elevation" | "plain"), grid lines (on) and contour lines (off); link "ml"
  mapStyle: { base: "imagery", grid: true, contours: false },
  daylight: true, // the globe shows day and night at the sky's moment (web/js/globe/daylight.js; link "ml=noday" when off)
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(kind, detail = {}) {
  for (const fn of listeners) fn(kind, detail);
}

export function getScenario(id) {
  return store.scenarios.find((s) => s.id === id) || null;
}

export function activeScenario() {
  return getScenario(store.activeId) || store.scenarios[store.scenarios.length - 1] || null;
}

/** Replace all scenarios (quick start, URL load, clear). */
export function setScenarios(partials) {
  const list = [];
  for (const p of partials) list.push(makeScenario(p, list));
  store.scenarios = list;
  store.activeId = list.length ? list[0].id : null;
  emit("structure");
}

/** Append a scenario and select it. */
export function addScenario(partial = {}) {
  const s = makeScenario({ ...partial, color: undefined, id: undefined }, store.scenarios);
  store.scenarios = [...store.scenarios, s];
  store.activeId = s.id;
  emit("structure", { focus: s.id });
  return s;
}

export function duplicateScenario(id) {
  const i = store.scenarios.findIndex((s) => s.id === id);
  if (i < 0) return null;
  const src = store.scenarios[i];
  const label = copyLabel(src.label, store.scenarios.map((x) => x.label));
  const s = makeScenario({ ...src, id: undefined, color: undefined, label }, store.scenarios);
  store.scenarios = [...store.scenarios.slice(0, i + 1), s, ...store.scenarios.slice(i + 1)];
  store.activeId = s.id;
  emit("structure", { focus: s.id });
  return s;
}

export function removeScenario(id) {
  const i = store.scenarios.findIndex((s) => s.id === id);
  if (i < 0) return;
  store.scenarios = store.scenarios.filter((s) => s.id !== id);
  if (store.activeId === id) {
    const next = store.scenarios[Math.min(i, store.scenarios.length - 1)];
    store.activeId = next ? next.id : null;
  }
  emit("structure");
}

let placeRule = null;

/**
 * The rule for times when a scenario moves to another place: fn(scenario, patch) -> extra fields for the patch
 * (state.js timesForPlaceChange: a catalog mission's dates do not follow the scenario to another place).
 */
export function setPlaceRule(fn) {
  placeRule = fn;
}

/**
 * Patch one scenario. `kind` is "field" for physics inputs, "label" for the label, "structure" to rebuild its card.
 * Times set without a source (t_src) are the user's. A move to another place goes through the place rule; when that
 * changes the times, listeners get `timesReset: true` (the card then shows the new times).
 */
export function updateScenario(id, patch, kind = "field", extra = {}) {
  const s = getScenario(id);
  if (!s) return;
  let p = patch;
  let timesReset = false;
  if (("t_start_utc" in p || "t_end_utc" in p) && !("t_src" in p)) p = { ...p, t_src: "user" };
  else if (placeRule && ("lat_deg" in p || "lon_deg" in p || "site_id" in p)) {
    const t = placeRule(s, p) || {};
    if ("t_start_utc" in t) {
      p = { ...p, ...t };
      timesReset = true;
    }
  }
  Object.assign(s, p);
  emit(kind, { id, ...extra, ...(timesReset ? { timesReset } : {}) });
}

export function setActive(id) {
  if (store.activeId === id) return;
  store.activeId = id;
  emit("active", { id });
}

export function setUi(patch) {
  Object.assign(store, patch);
  emit("ui", patch);
}

/** A fresh colour slot for the next scenario (used for previews). */
export function peekColor() {
  return nextColorSlot(store.scenarios);
}
