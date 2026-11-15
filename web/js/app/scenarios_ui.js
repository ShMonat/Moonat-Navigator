// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Scenario cards: progressive builder (the place from the globe or typed coordinates, start and optional end time in
// UTC), validation, the "+ Add location" / "+ Add time" buttons, the date and time picker of the Start and End fields
// with "✨ Suggested for this place" (time_picker.js, web/js/suggest/), and the trip rows of a rover trip
// (web/js/rover/ui.js). Missions and sites are chosen on the globe (its "Search the Moon" box and pins,
// web/js/app/places.js). A catalog mission's dates do not follow the scenario to another place.

import {
  store, subscribe, addScenario, duplicateScenario, removeScenario, updateScenario, setActive, setScenarios, activeScenario,
  setPlaceRule,
} from "./store.js";
import {
  colorHex, validateScenario, parseUtc, toUtcText, isoUtc, normalizeLon, formatDuration, scenarioTimes, pointLabel,
  isPointLabel, parseDuration, durationUnit, durationValueText, endFromDuration, MAX_SPAN_MS, hasMissionDates, defaultTimes,
  timesForPlaceChange, coverageEnd,
} from "./state.js";
import { scenarioFieldsFromSite, siteById, catalogSites, isTrimmedMission, shortName } from "./catalog.js";
import { physicsCoverage, siteFor } from "./physics_adapter.js";
import { suggestDates, suggestKey, suggestCaveat } from "./suggest_adapter.js";
import { terrainStatusText, terrainState, onTerrainChange } from "./terrain_live.js";
import { attachTimePicker, closeTimePicker, refreshSuggestions } from "./time_picker.js";
import { buildTripToggle, buildTripPanel } from "../rover/ui.js";
import { icon as svgIcon } from "./icons.js";

const $ = (sel, root = document) => root.querySelector(sel);

let cardsEl;
let addLocBtn;
let addTimeBtn;
let clearBtn;
// Per scenario id: how the end is given ("end" | "dur") and the unit last used for the duration. UI view only.
const endModes = new Map();
const endUnits = new Map();
let onSuggestPick = () => {};

/** The catalog site of a scenario (null for a custom point). */
const siteOf = (s) => (s?.site_id ? siteById(s.site_id) || null : null);

/** opts.onSuggest(scenario, suggestion): a suggested date was chosen (main.js sets the times and the Sun | Earth switch). */
export function initScenarioUI({ onSuggest } = {}) {
  if (onSuggest) onSuggestPick = onSuggest;
  // A catalog mission's dates stay with the mission: another place gets today's date (state.js timesForPlaceChange).
  setPlaceRule((s, patch) => timesForPlaceChange(s, patch, { siteById: (id) => siteById(id) || null, nowMs: Date.now(), years: physicsCoverage() }));
  cardsEl = $("#cards");
  addLocBtn = $("#btn-add-location");
  addTimeBtn = $("#btn-add-time");
  clearBtn = $("#btn-clear");

  addLocBtn.addEventListener("click", () => {
    const src = activeScenario();
    addScenario({ t_start_utc: src?.t_start_utc || null, t_end_utc: src?.t_end_utc || null, label: "" });
  });
  addTimeBtn.addEventListener("click", () => {
    const src = activeScenario();
    if (!src) return;
    // Same place, new time: number the label so the cards and chart legends stay distinct. An unnamed source gets
    // its automatic name first, so "#2" has something to refer to.
    if (!src.label) updateScenario(src.id, { label: pointLabel(src.lat_deg, src.lon_deg) }, "label");
    const base = (src.label || "Site").replace(/ #\d+$/, "");
    const n = Math.max(2, store.scenarios.filter((x) => (x.label || "").replace(/ #\d+$/, "") === base).length + 1);
    addScenario({ lat_deg: src.lat_deg, lon_deg: src.lon_deg, site_id: src.site_id, label: `${base} #${n}`, t_start_utc: null, t_end_utc: null, route: src.route });
  });
  clearBtn.addEventListener("click", clearAll);

  subscribe((kind, detail) => {
    if (kind === "structure") renderCards(detail.focus);
    else if (kind === "active") markActive();
    else if (kind === "ui" && "theme" in detail) recolor();
    else if (kind === "field" && detail.id) {
      if (detail.external) syncCard(detail.id);
      if (detail.timesReset) syncTimes(detail.id);
    }
    if (kind !== "ui") updateAddButtons();
  });
  // Custom points: the status line follows the live terrain ("Loading NASA terrain…" → real terrain or fallback).
  onTerrainChange(() => {
    for (const s of store.scenarios) {
      const card = cardsEl.querySelector(`[data-id="${s.id}"]`);
      if (card && !s.site_id && !s.route) refreshCard(card, s);
    }
    // An open calendar's suggested dates were searched with the approximate horizon: search again with the real one.
    refreshSuggestions();
  });
}

/**
 * Start again with one empty scenario that keeps the selected scenario's times, so a click on the map (or typed
 * coordinates) gives results at once. A catalog mission's dates are not kept: the new scenario starts now.
 */
export function clearAll() {
  const src = activeScenario();
  const ok = src && validateScenario({ ...src, lat_deg: null, lon_deg: null }, physicsCoverage());
  const keep = ok && !ok.errors.t_start_utc && !ok.errors.t_end_utc;
  if (keep && hasMissionDates(src, siteOf(src))) {
    setScenarios([{ ...defaultTimes(Date.now(), physicsCoverage()), t_src: "default" }]);
    return;
  }
  setScenarios([keep ? { t_start_utc: src.t_start_utc, t_end_utc: src.t_end_utc, t_src: src.t_src } : {}]);
}

/** The catalog site at a typed point (within 1e-4° in latitude and longitude), or null. */
function catalogSiteAt(lat, lon) {
  const tol = 1e-4 + 1e-9;
  return catalogSites().find((x) => Math.abs(x.lat_deg - lat) <= tol && Math.abs(normalizeLon(x.lon_deg - lon)) <= tol) || null;
}

function scenarioColor(s) {
  return colorHex(s.color, store.theme);
}

const FOCUSABLE = "button, input, select, textarea, summary, a[href], [tabindex]:not([tabindex='-1'])";
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((e) => !e.disabled && e.getClientRects().length > 0);

/**
 * Where the keyboard focus is in the card list, which a rebuild replaces: { id, index } of its card and its control.
 * Only keyboard focus (:focus-visible) counts: a tap must not move the focus into a text field (a phone's keyboard).
 */
function cardFocus() {
  const a = document.activeElement;
  if (!a?.matches?.(":focus-visible")) return null;
  if (a === clearBtn) return { id: null, index: 0, ctl: 0 };
  const card = a && cardsEl.contains(a) ? a.closest("[data-id]") : null;
  if (!card || card.parentElement !== cardsEl) return null;
  return { id: card.dataset.id, index: [...cardsEl.children].indexOf(card), ctl: focusables(card).indexOf(a) };
}

/**
 * Give the keyboard focus back after a rebuild: the same control of the same card; for a removed card (or after
 * "Clear all") the first field of the card now in its place.
 */
function restoreCardFocus(f) {
  const a = document.activeElement;
  if (!f || (a && a !== document.body && a.isConnected && !(a === clearBtn && clearBtn.hidden))) return;
  const cards = [...cardsEl.children];
  if (!cards.length) return;
  const same = f.id ? cards.find((c) => c.dataset.id === f.id) : null;
  const list = focusables(same || cards[Math.min(Math.max(f.index, 0), cards.length - 1)]);
  const target = same ? list[Math.min(Math.max(f.ctl, 0), list.length - 1)] : list[0];
  target?.focus({ preventScroll: true });
}

function renderCards(focusId) {
  closeTimePicker();
  const had = focusId ? null : cardFocus();
  cardsEl.replaceChildren(...store.scenarios.map((s, i) => buildCard(s, i)));
  markActive();
  updateAddButtons();
  restoreCardFocus(had);
  if (focusId) {
    const card = cardsEl.querySelector(`[data-id="${focusId}"]`);
    if (card) {
      const s = store.scenarios.find((x) => x.id === focusId);
      const target = s && s.lat_deg === null ? placeFocusTarget(card) : card.querySelector('[name="t_start_utc"]');
      if (target?.id !== "globe-search") card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (target && !(s && s.lat_deg !== null && s.t_start_utc)) target.focus({ preventScroll: true });
    }
  }
}

function markActive() {
  for (const el of cardsEl.children) el.classList.toggle("active", el.dataset.id === store.activeId && store.scenarios.length > 1);
}

function recolor() {
  for (const el of cardsEl.children) {
    const s = store.scenarios.find((x) => x.id === el.dataset.id);
    if (s) el.style.setProperty("--c", scenarioColor(s));
  }
}

function updateAddButtons() {
  const src = activeScenario();
  const v = src ? validateScenario(src, physicsCoverage()) : null;
  const hasLoc = src && src.lat_deg !== null && src.lon_deg !== null;
  // Progressive: the add buttons appear once the selected scenario is complete and valid.
  const ready = !!(hasLoc && v && v.ok);
  document.getElementById("add-row").hidden = !ready;
  addLocBtn.title = "New place, same times";
  addTimeBtn.title = "Same place, new time";
  clearBtn.hidden = store.scenarios.length < 2;
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

function buildCard(s, index) {
  const card = el("article", { class: `scen${s.route ? " is-trip" : ""}`, "data-id": s.id, "aria-label": `Scenario ${index + 1}${s.route ? ": rover trip" : ""}` });
  card.style.setProperty("--c", scenarioColor(s));
  card.addEventListener("focusin", () => setActive(s.id));
  card.addEventListener("pointerdown", () => setActive(s.id));

  // Header: colour swatch, editable label, duplicate and remove.
  const label = el("input", {
    class: "scen-label", value: s.label || "", placeholder: `Scenario ${index + 1}`, "aria-label": "Scenario name", maxlength: "80",
  });
  label.addEventListener("input", () => updateScenario(s.id, { label: label.value }, "label"));
  const dup = el("button", { class: "icon-btn", title: "Duplicate", "aria-label": "Duplicate scenario", text: "⧉" });
  dup.addEventListener("click", () => duplicateScenario(s.id));
  const rm = el("button", { class: "icon-btn", title: "Remove", "aria-label": "Remove scenario" });
  rm.innerHTML = svgIcon("close");
  rm.addEventListener("click", () => (store.scenarios.length > 1 ? removeScenario(s.id) : clearAll()));
  // The "Trip" toggle next to the place's name: a rover trip from this place (web/js/rover/ui.js).
  card.append(el("div", { class: "scen-head" }, el("span", { class: "swatch", "aria-hidden": "true" }), label, buildTripToggle(s), dup, rm));

  // Coordinates.
  const lat = numberField("Latitude (° north +)", "lat_deg", s.lat_deg, -90, 90, "e.g. 0.674");
  const lon = numberField("Longitude (° east +)", "lon_deg", s.lon_deg, -180, 180, "e.g. 23.473");
  card.append(el("div", { class: "fields" }, lat.wrap, lon.wrap));
  for (const f of [lat, lon]) {
    f.input.addEventListener("input", () => {
      let v = f.input.value === "" ? null : Number(f.input.value);
      if (v !== null && !Number.isFinite(v)) v = null;
      const patch = { [f.key]: v };
      const la = f.key === "lat_deg" ? v : s.lat_deg;
      const lo = f.key === "lon_deg" ? v : s.lon_deg;
      // Typed coordinates on a catalog site (within 1e-4°, a few metres) are that site, with its precomputed horizon;
      // anywhere else they are a custom point. The name follows the place unless the user typed one.
      const prev = s.site_id ? siteById(s.site_id) : null;
      const autoName = !s.label || isPointLabel(s.label) || (!!prev && s.label === shortName(prev));
      const site = la !== null && lo !== null ? catalogSiteAt(la, lo) : null;
      patch.site_id = site ? site.id : null;
      if (autoName && la !== null && lo !== null && Math.abs(la) <= 90 && Math.abs(lo) <= 360) {
        patch.label = site ? shortName(site) : pointLabel(la, lo);
        label.value = patch.label;
      }
      updateScenario(s.id, patch);
      refreshCard(card, s);
    });
    f.input.addEventListener("change", () => {
      if (f.key === "lon_deg" && s.lon_deg !== null && s.lon_deg > 180 && s.lon_deg <= 360) {
        updateScenario(s.id, { lon_deg: normalizeLon(s.lon_deg) });
        f.input.value = String(+s.lon_deg.toFixed(5));
        refreshCard(card, s);
      }
    });
  }

  // A rover trip: the points after this place, the rover, the plan and its summary (web/js/rover/ui.js).
  if (s.route) card.append(buildTripPanel(s));

  // Times (UTC).
  // The end is given either as a date-time or as a mission duration; both are views of t_end_utc.
  const t0 = timeField("Start (UTC)", "t_start_utc", s.t_start_utc, false);
  const t1 = timeField("End (UTC)", "t_end_utc", s.t_end_utc, true);
  const end = buildEndField(s, card, t0, t1);
  card.append(el("div", { class: "fields times" }, buildStartField(s, t0), end.wrap));
  attachPickers(s, t0, t1);
  // After a change of place reset the times (timesForPlaceChange), the fields show the new ones.
  card._syncTimes = () => {
    t0.input.value = s.t_start_utc ? toUtcText(parseUtc(s.t_start_utc)) : "";
    t1.input.value = s.t_end_utc ? toUtcText(parseUtc(s.t_end_utc)) : "";
    if (t1.clear) t1.clear.hidden = !s.t_end_utc;
    end.fill();
    refreshCard(card, s);
  };
  for (const f of [t0, t1]) {
    const commit = () => {
      const raw = f.input.value;
      const ms = raw ? parseUtc(raw) : NaN;
      const val = raw ? (Number.isFinite(ms) ? isoUtc(ms) : raw) : null;
      updateScenario(s.id, { [f.key]: val });
      if (f.clear) f.clear.hidden = !raw;
      // In duration mode the duration stays and the end follows a new start.
      if (f === t0) end.followStart();
      refreshCard(card, s);
    };
    f.input.addEventListener("change", commit);
    f.input.addEventListener("input", commit);
    if (f.clear) {
      f.clear.addEventListener("click", () => {
        f.input.value = "";
        commit();
      });
    }
  }

  card.append(el("p", { class: "scen-msg", role: "alert", hidden: true }));
  card.append(el("p", { class: "scen-meta", hidden: true }));
  refreshCard(card, s);
  return card;
}

function numberField(text, key, value, min, max, placeholder) {
  const input = el("input", {
    type: "number", name: key, step: "any", min: String(min), max: String(max), inputmode: "decimal", placeholder,
    value: value === null ? "" : String(+(+value).toFixed(5)),
  });
  const wrap = el("label", { class: "field" }, el("span", { text }), input);
  return { input, wrap, key };
}

function timeField(text, key, value, clearable) {
  const ms = value ? parseUtc(value) : NaN;
  // Plain text in ISO order with a 24-hour clock ("1969-07-20 20:17:40"), whatever the browser's locale: a native
  // date-time control would show e.g. "07/20/1969 08:17:40 PM" next to a UTC label.
  const input = el("input", {
    type: "text", name: key, value: Number.isFinite(ms) ? toUtcText(ms) : "", placeholder: "YYYY-MM-DD hh:mm:ss",
    autocomplete: "off", spellcheck: "false", class: "utc-input", title: "UTC, 24-hour clock: YYYY-MM-DD hh:mm[:ss]",
  });
  // A valid entry is tidied to the full form when the field is left ("1969-7-20 20:17" stays as typed until then).
  input.addEventListener("blur", () => {
    const t = parseUtc(input.value);
    if (Number.isFinite(t)) input.value = toUtcText(t);
  });
  // The field and its buttons: ✕ (End) and the calendar (📅, time_picker.js, added by attachPickers).
  let clear = null;
  if (clearable) {
    clear = el("button", { type: "button", class: "clear", title: "Remove the end time (single instant)", "aria-label": "Clear end time" });
    clear.innerHTML = svgIcon("close");
    clear.hidden = !value;
  }
  const inner = el("div", { class: `with-cal${clearable ? " with-clear" : ""}` }, input, clear);
  const wrap = el("label", { class: "field" }, el("span", { text }), inner);
  return { input, wrap, body: inner, key, clear };
}

/**
 * The date and time pickers of a card's Start and End fields (time_picker.js), each with "✨ Suggested for this place"
 * (the C11 engine): a chosen suggestion sets the start and the end (main.js onSuggest).
 */
function attachPickers(s, t0, t1) {
  const cur = () => store.scenarios.find((x) => x.id === s.id) || s;
  const startMs = () => parseUtc(cur().t_start_utc || "");
  const suggest = {
    place: () => {
      const x = cur();
      return x.lat_deg === null || x.lon_deg === null ? null : x.label || pointLabel(x.lat_deg, x.lon_deg);
    },
    // Windows as long as the card's mission; a single instant gets the engine's default, one lunar day.
    durationMs: () => {
      const x = cur();
      const span = x.t_end_utc ? parseUtc(x.t_end_utc) - startMs() : NaN;
      return span > 0 ? span : undefined;
    },
    // The place's terrain horizon: the catalog site's C3 profile, or the live one of a custom point once it is there.
    run: async (o) => {
      const x = cur();
      const { horizon } = await siteFor(x);
      return suggestDates({ lat_deg: x.lat_deg, lon_deg: x.lon_deg, horizon }, o);
    },
    // A custom point's horizon changes when its NASA Moon Trek terrain arrives (or fails): the list follows it.
    key: () => {
      const x = cur();
      return suggestKey(x, terrainState(x.lat_deg, x.lon_deg));
    },
    note: () => {
      const x = cur();
      return suggestCaveat(x, terrainState(x.lat_deg, x.lon_deg));
    },
    pick: (g) => onSuggestPick(cur(), g),
  };
  const p0 = attachTimePicker(t0.input, { title: "Start (UTC)", coverage: physicsCoverage, emptyText: "No start yet", suggest });
  t0.body.append(p0.button);
  const p1 = attachTimePicker(t1.input, {
    title: "End (UTC)",
    coverage: physicsCoverage,
    emptyText: s.route ? "No end: until the rover arrives" : "No end: a single instant",
    rangeStart: startMs,
    defaultTime: startMs,
    // The end: after the start, and inside the start's run of covered years (a span may not cross a gap in the tables,
    // validateScenario), within MAX_SPAN_MS.
    limits: () => {
      const t = startMs();
      if (!Number.isFinite(t)) return {};
      const runEnd = coverageEnd(t, physicsCoverage());
      if (runEnd === null) return { min: t, note: "The end comes after the start." };
      const max = Math.min(t + MAX_SPAN_MS, runEnd) - 1;
      return { min: t, max, note: `The end comes after the start, by 31 Dec ${new Date(max).getUTCFullYear()} at the latest (the sky tables run without a break until then).` };
    },
    suggest,
  });
  t1.body.append(p1.button);
}

/** Show a scenario's times in its card again (after the place rule reset them). */
function syncTimes(id) {
  cardsEl.querySelector(`[data-id="${id}"]`)?._syncTimes?.();
}

/**
 * The "End" part of a card: a segmented "End time | Duration" toggle over either the end date-time field or a
 * duration field (number and unit). Only t_end_utc is stored; the mode (per scenario, kept across card rebuilds) is a
 * view. Switching converts, so the end instant stays the same.
 */
function buildEndField(s, card, t0, t1) {
  const startMs = () => parseUtc(t0.input.value);
  const unitSel = el("select", { class: "dur-unit", "aria-label": "Duration unit" },
    el("option", { value: "h", text: "hours" }), el("option", { value: "d", text: "days" }));
  const input = el("input", {
    type: "text", name: "duration", inputmode: "decimal", autocomplete: "off", spellcheck: "false", class: "dur-input",
    placeholder: "e.g. 21.6 or 1 d 6 h", "aria-label": "Mission duration (a number, optionally with h, d or min)",
    title: "Mission length: a number in the unit on the right, or text like 36 h, 2.5 d, 90 min",
  });
  const durBody = el("div", { class: "dur-row" }, input, unitSel);
  const toggle = el("div", { class: "seg seg-sm", role: "group", "aria-label": "How to give the end" });
  const bEnd = el("button", { type: "button", text: "End time", "aria-pressed": "true" });
  const bDur = el("button", { type: "button", text: "Duration", "aria-pressed": "false" });
  toggle.append(bEnd, bDur);
  const wrap = el("div", { class: "field end-field", role: "group", "aria-label": "End of the mission" },
    el("div", { class: "end-head" }, el("span", { text: s.route ? "End (UTC; empty: on arrival)" : "End (UTC, optional)" }), toggle), t1.body, durBody);

  card._endHint = null;
  let prevUnit = "h";
  const mode = () => endModes.get(s.id) || "end";
  const showMode = () => {
    const dur = mode() === "dur";
    t1.body.hidden = dur;
    durBody.hidden = !dur;
    bEnd.setAttribute("aria-pressed", String(!dur));
    bDur.setAttribute("aria-pressed", String(dur));
  };
  /** Fill the duration field from the current end (the end instant is the truth). */
  const fillFromEnd = () => {
    const ms = parseUtc(s.t_end_utc || "") - parseUtc(s.t_start_utc || "");
    if (s.t_end_utc && ms > 0) {
      unitSel.value = endUnits.get(s.id) || durationUnit(ms);
      prevUnit = unitSel.value;
      input.value = durationValueText(ms, unitSel.value);
    } else if (!s.t_end_utc && !card._endHint) input.value = "";
  };
  /** Read the duration field, set t_end_utc from it and mirror it into the date-time field. */
  const commitDuration = () => {
    const text = input.value.trim();
    card._endHint = null;
    let endIso = null;
    if (text) {
      const p = parseDuration(text, unitSel.value);
      if (!p) card._endHint = { text: "Enter a duration such as 36 h, 2.5 d or 90 min.", bad: true };
      else {
        // Text with its own unit moves the selector (not for minutes, which the selector does not offer).
        if (p.unit !== "min" && !/^[\d.,\s]+$/.test(text)) unitSel.value = p.unit;
        prevUnit = unitSel.value;
        endUnits.set(s.id, unitSel.value);
        endIso = endFromDuration(t0.input.value, p.ms);
        if (!endIso && !Number.isFinite(startMs())) card._endHint = { text: "Set the start time first; the end follows from it." };
      }
    }
    updateScenario(s.id, { t_end_utc: endIso });
    t1.input.value = endIso ? toUtcText(parseUtc(endIso)) : "";
    if (t1.clear) t1.clear.hidden = !endIso;
    refreshCard(card, s);
  };
  const setMode = (m) => {
    if (m === mode()) return;
    endModes.set(s.id, m);
    card._endHint = null;
    if (m === "dur") {
      endUnits.delete(s.id);
      fillFromEnd();
    } else t1.input.value = s.t_end_utc ? toUtcText(parseUtc(s.t_end_utc)) : "";
    showMode();
    refreshCard(card, s);
  };
  bEnd.addEventListener("click", () => setMode("end"));
  bDur.addEventListener("click", () => setMode("dur"));
  input.addEventListener("input", commitDuration);
  unitSel.addEventListener("change", () => {
    // A new unit converts the number, so the duration stays the same.
    const p = parseDuration(input.value, prevUnit);
    if (p) input.value = durationValueText(p.ms, unitSel.value);
    prevUnit = unitSel.value;
    commitDuration();
  });
  if (mode() === "dur") fillFromEnd();
  showMode();
  return {
    wrap,
    followStart() {
      if (mode() === "dur") commitDuration();
    },
    /** Show the scenario's end again (after its times changed from outside the card). */
    fill() {
      card._endHint = null;
      if (mode() === "dur") {
        input.value = "";
        fillFromEnd();
      }
    },
  };
}

/** Update validation messages and the meta line of a card in place (no rebuild, so focus is kept). */
function refreshCard(card, s) {
  const v = validateScenario(s, physicsCoverage());
  for (const key of ["lat_deg", "lon_deg", "t_start_utc", "t_end_utc"]) {
    const input = card.querySelector(`[name="${key}"]`);
    if (input) input.setAttribute("aria-invalid", key in v.errors ? "true" : "false");
  }
  const durInput = card.querySelector('[name="duration"]');
  if (durInput) durInput.setAttribute("aria-invalid", ("t_end_utc" in v.errors || card._endHint?.bad) ? "true" : "false");
  const msg = card.querySelector(".scen-msg");
  // Every problem at once (e.g. a bad latitude and a date outside the tables), not only the first.
  const errs = [...new Set(Object.values(v.errors))];
  const hint = card._endHint;
  const text = [hint && hint.bad ? hint.text : "", ...errs].filter(Boolean).join(" ") || (hint ? hint.text : "") || v.warnings[0] || "";
  msg.textContent = text;
  msg.hidden = !text;
  msg.classList.toggle("warn", !errs.length && !(hint && hint.bad) && !!text);

  const meta = card.querySelector(".scen-meta");
  const parts = [];
  if (s.lat_deg === null || s.lon_deg === null) parts.push("Search the Moon or click the globe, or type coordinates here.");
  else if (!s.t_start_utc) parts.push("Now pick a start time (UTC).");
  else if (v.ok) {
    const { span } = scenarioTimes(s);
    const site = s.site_id ? siteById(s.site_id) : null;
    if (site && isTrimmedMission(s, site)) {
      const full = parseUtc(site.t_end_utc) - parseUtc(site.t_start_utc);
      parts.push(`First ${formatDuration(span)} of a ${formatDuration(full)} mission`);
    } else if (!span) {
      // A mission's length is not repeated here: the Start and End fields above already give it.
      parts.push(s.route ? "Ends when the rover arrives" : "Single instant (add an end time for a mission)");
    }
    if (site && site.kind === "candidate") parts.push("approximate location (potential Artemis site)");
    if (!s.site_id && !s.route) parts.push(terrainStatusText(s.lat_deg, s.lon_deg));
  }
  meta.textContent = parts.join(" · ");
  meta.hidden = !parts.length;
  updateAddButtons();
}

/** The start field: its label and the input with the calendar button (the picker with suggested dates opens under it). */
function buildStartField(s, t0) {
  const id = `st-${s.id}`;
  t0.input.id = id;
  const head = el("div", { class: "end-head" }, el("label", { for: id, text: "Start (UTC)" }));
  return el("div", { class: "field start-field" }, head, t0.body);
}

/** Re-sync a card's inputs after an external change (map click). */
function syncCard(id) {
  const card = cardsEl.querySelector(`[data-id="${id}"]`);
  const s = store.scenarios.find((x) => x.id === id);
  if (!card || !s) return;
  card.querySelector('[name="lat_deg"]').value = s.lat_deg === null ? "" : String(+s.lat_deg.toFixed(5));
  card.querySelector('[name="lon_deg"]').value = s.lon_deg === null ? "" : String(+s.lon_deg.toFixed(5));
  card.querySelector(".scen-label").value = s.label || "";
  refreshCard(card, s);
}

// ---------------------------------------------------------------------------------------------
// Places: catalog sites go into a card from the globe's "Search the Moon" box and its pins (web/js/app/places.js).

/**
 * Where a new card without a place sends the keyboard: the globe's search box, brought into view (its list of places
 * opens on focus), or the card's latitude field when the globe is not there.
 */
function placeFocusTarget(card) {
  const search = document.getElementById("globe-search");
  if (!search || !search.getClientRects().length) return card.querySelector('[name="lat_deg"]');
  const r = search.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    (search.closest(".globe") || search).scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }
  return search;
}

/**
 * Load a catalog site into a scenario. Missions bring their landing-to-liftoff times (marked as the mission's). A site
 * with no times keeps the scenario's times, unless those are another mission's: then it starts now (the place rule).
 */
export function applySite(scenarioId, site) {
  const s = store.scenarios.find((x) => x.id === scenarioId);
  if (!s) return;
  const f = scenarioFieldsFromSite(site);
  const patch = { label: f.label, site_id: f.site_id, lat_deg: f.lat_deg, lon_deg: f.lon_deg };
  if (f.t_start_utc) {
    patch.t_start_utc = f.t_start_utc;
    patch.t_end_utc = f.t_end_utc;
    patch.t_src = "mission";
  }
  updateScenario(scenarioId, patch, "structure");
}
