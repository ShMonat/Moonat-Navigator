// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Scenario cards: progressive builder (location three ways, start and optional end time in UTC), validation,
// the "+ Add location" / "+ Add time" buttons and the searchable missions-and-sites picker.

import {
  store, subscribe, addScenario, duplicateScenario, removeScenario, updateScenario, setActive, setScenarios, activeScenario,
} from "./store.js";
import {
  colorHex, validateScenario, parseUtc, toUtcText, isoUtc, normalizeLon, formatDuration, scenarioTimes, pointLabel, isPointLabel,
  parseDuration, durationUnit, durationValueText, endFromDuration,
} from "./state.js";
import { searchSites, scenarioFieldsFromSite, siteById, KIND_LABEL, catalogSites, isTrimmedMission, shortName } from "./catalog.js";
import { physicsCoverage } from "./physics_adapter.js";
import { terrainStatusText, onTerrainChange } from "./terrain_live.js";

const $ = (sel, root = document) => root.querySelector(sel);

let cardsEl;
let addLocBtn;
let addTimeBtn;
let clearBtn;
// Per scenario id: how the end is given ("end" | "dur") and the unit last used for the duration. UI view only.
const endModes = new Map();
const endUnits = new Map();

export function initScenarioUI() {
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
    addScenario({ lat_deg: src.lat_deg, lon_deg: src.lon_deg, site_id: src.site_id, label: `${base} #${n}`, t_start_utc: null, t_end_utc: null });
  });
  clearBtn.addEventListener("click", () => setScenarios([{}]));

  subscribe((kind, detail) => {
    if (kind === "structure") renderCards(detail.focus);
    else if (kind === "active") markActive();
    else if (kind === "ui" && "theme" in detail) recolor();
    else if (kind === "field" && detail.id && detail.external) syncCard(detail.id);
    if (kind !== "ui") updateAddButtons();
  });
  // Custom points: the status line follows the live terrain ("Loading NASA terrain…" → real terrain or fallback).
  onTerrainChange(() => {
    for (const s of store.scenarios) {
      const card = cardsEl.querySelector(`[data-id="${s.id}"]`);
      if (card && !s.site_id) refreshCard(card, s);
    }
  });
}

function scenarioColor(s) {
  return colorHex(s.color, store.theme);
}

function renderCards(focusId) {
  cardsEl.replaceChildren(...store.scenarios.map((s, i) => buildCard(s, i)));
  markActive();
  updateAddButtons();
  if (focusId) {
    const card = cardsEl.querySelector(`[data-id="${focusId}"]`);
    if (card) {
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const s = store.scenarios.find((x) => x.id === focusId);
      const target = s && s.lat_deg === null ? card.querySelector(".picker input") : card.querySelector('[name="t_start_utc"]');
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
  const card = el("article", { class: "scen", "data-id": s.id, "aria-label": `Scenario ${index + 1}` });
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
  const rm = el("button", { class: "icon-btn", title: "Remove", "aria-label": "Remove scenario", text: "✕" });
  rm.addEventListener("click", () => (store.scenarios.length > 1 ? removeScenario(s.id) : setScenarios([{}])));
  card.append(el("div", { class: "scen-head" }, el("span", { class: "swatch", "aria-hidden": "true" }), label, dup, rm));

  // Missions and sites picker.
  card.append(buildPicker(s));

  // Coordinates.
  const lat = numberField("Latitude (° north +)", "lat_deg", s.lat_deg, -90, 90, "e.g. 0.674");
  const lon = numberField("Longitude (° east +)", "lon_deg", s.lon_deg, -180, 180, "e.g. 23.473");
  card.append(el("div", { class: "fields" }, lat.wrap, lon.wrap));
  for (const f of [lat, lon]) {
    f.input.addEventListener("input", () => {
      let v = f.input.value === "" ? null : Number(f.input.value);
      if (v !== null && !Number.isFinite(v)) v = null;
      const patch = { [f.key]: v };
      // Typing coordinates turns a catalog site into a custom point, and the catalog name no longer applies.
      let autoName = !s.label || isPointLabel(s.label);
      if (s.site_id) {
        const site = siteById(s.site_id);
        if (site && Math.abs((f.key === "lat_deg" ? site.lat_deg : site.lon_deg) - (v ?? NaN)) > 1e-6) {
          patch.site_id = null;
          if (s.label === shortName(site)) autoName = true;
        } else autoName = false;
      }
      const la = f.key === "lat_deg" ? v : s.lat_deg;
      const lo = f.key === "lon_deg" ? v : s.lon_deg;
      if (autoName && la !== null && lo !== null && Math.abs(la) <= 90 && Math.abs(lo) <= 360) {
        patch.label = pointLabel(la, lo);
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

  // Times (UTC).
  // The end is given either as a date-time or as a mission duration; both are views of t_end_utc.
  const t0 = timeField("Start (UTC)", "t_start_utc", s.t_start_utc, false);
  const t1 = timeField("End (UTC)", "t_end_utc", s.t_end_utc, true);
  const end = buildEndField(s, card, t0, t1);
  card.append(el("div", { class: "fields times" }, t0.wrap, end.wrap));
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
  let clear = null;
  let inner = input;
  if (clearable) {
    clear = el("button", { type: "button", class: "clear", title: "Remove the end time (single instant)", "aria-label": "Clear end time", text: "✕" });
    clear.hidden = !value;
    inner = el("div", { class: "with-clear" }, input, clear);
  }
  const wrap = el("label", { class: "field" }, el("span", { text }), inner);
  return { input, wrap, body: inner, key, clear };
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
    el("div", { class: "end-head" }, el("span", { text: "End (UTC, optional)" }), toggle), t1.body, durBody);

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
  const errs = Object.values(v.errors);
  const hint = card._endHint;
  const text = (hint && hint.bad ? hint.text : "") || errs[0] || (hint ? hint.text : "") || v.warnings[0] || "";
  msg.textContent = text;
  msg.hidden = !text;
  msg.classList.toggle("warn", !errs.length && !(hint && hint.bad) && !!text);

  const meta = card.querySelector(".scen-meta");
  const parts = [];
  if (s.lat_deg === null || s.lon_deg === null) parts.push("Pick a mission or site, type coordinates, or click the map.");
  else if (!s.t_start_utc) parts.push("Now pick a start time (UTC).");
  else if (v.ok) {
    const { span } = scenarioTimes(s);
    const site = s.site_id ? siteById(s.site_id) : null;
    if (site && isTrimmedMission(s, site)) {
      const full = parseUtc(site.t_end_utc) - parseUtc(site.t_start_utc);
      parts.push(`First ${formatDuration(span)} of a ${formatDuration(full)} mission`);
    } else {
      parts.push(span ? `Mission: ${formatDuration(span)}` : "Single instant (add an end time for a mission)");
    }
    if (site && site.kind === "candidate") parts.push("· approximate location (Artemis III candidate region)");
    if (!s.site_id) parts.push(`· ${terrainStatusText(s.lat_deg, s.lon_deg)}`);
  }
  meta.textContent = parts.join(" ");
  meta.hidden = !parts.length;
  updateAddButtons();
}

/** Re-sync a card's inputs after an external change (map click). */
function syncCard(id) {
  const card = cardsEl.querySelector(`[data-id="${id}"]`);
  const s = store.scenarios.find((x) => x.id === id);
  if (!card || !s) return;
  card.querySelector('[name="lat_deg"]').value = s.lat_deg === null ? "" : String(+s.lat_deg.toFixed(5));
  card.querySelector('[name="lon_deg"]').value = s.lon_deg === null ? "" : String(+s.lon_deg.toFixed(5));
  card.querySelector(".scen-label").value = s.label || "";
  const pick = card.querySelector(".picker input");
  if (pick) pick.value = "";
  refreshCard(card, s);
}

// ---------------------------------------------------------------------------------------------
// Searchable picker ("Historical missions & sites").

let pickerSeq = 0;

function buildPicker(s) {
  const id = `pk${++pickerSeq}`;
  const input = el("input", {
    type: "search", placeholder: "Historical missions & sites…", "aria-label": "Search historical missions and sites",
    role: "combobox", "aria-expanded": "false", "aria-controls": id, "aria-autocomplete": "list", autocomplete: "off",
  });
  const list = el("ul", { class: "picker-list", id, role: "listbox", hidden: true });
  const wrap = el("div", { class: "picker" }, input, list);
  let items = [];
  let sel = -1;

  const open = () => {
    const results = searchSites(input.value, catalogSites());
    items = results;
    sel = results.length ? 0 : -1;
    list.replaceChildren();
    if (!results.length) {
      list.append(el("li", { class: "picker-empty", text: "No match. Try “Apollo”, “pole” or a crew name." }));
    } else {
      let lastKind = null;
      results.forEach((site, i) => {
        if (site.kind !== lastKind) {
          lastKind = site.kind;
          list.append(el("li", { class: "picker-group", role: "presentation", text: KIND_LABEL[site.kind] || "Other" }));
        }
        const when = site.t_start_utc ? new Date(parseUtc(site.t_start_utc)).getUTCFullYear() : null;
        const metaBits = [site.agency, site.crew && site.crew.length ? site.crew.join(", ") : site.lander, when,
          site.kind === "candidate" ? "approximate location" : null].filter(Boolean);
        const li = el("li", { class: "picker-item", role: "option", id: `${id}-${i}`, "aria-selected": i === sel ? "true" : "false" },
          el("div", { class: "pi-name", text: site.name }),
          el("div", { class: "pi-meta", text: metaBits.join(" · ") }));
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          choose(i);
        });
        list.append(li);
      });
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
  };
  const highlight = () => {
    list.querySelectorAll(".picker-item").forEach((li, i) => li.setAttribute("aria-selected", i === sel ? "true" : "false"));
    const cur = list.querySelector(`#${id}-${sel}`);
    if (cur) {
      cur.scrollIntoView({ block: "nearest" });
      input.setAttribute("aria-activedescendant", cur.id);
    }
  };
  const choose = (i) => {
    const site = items[i];
    if (!site) return;
    close();
    input.value = "";
    applySite(s.id, site);
  };

  input.addEventListener("focus", open);
  input.addEventListener("input", open);
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) open(); sel = Math.min(items.length - 1, sel + 1); highlight(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); highlight(); }
    else if (e.key === "Enter") { e.preventDefault(); if (sel >= 0) choose(sel); }
    else if (e.key === "Escape") { close(); }
  });
  return wrap;
}

/**
 * Load a catalog site into a scenario. Missions bring their landing-to-liftoff times. A site with no times keeps the
 * scenario's times.
 */
export function applySite(scenarioId, site) {
  const s = store.scenarios.find((x) => x.id === scenarioId);
  if (!s) return;
  const f = scenarioFieldsFromSite(site);
  const patch = { label: f.label, site_id: f.site_id, lat_deg: f.lat_deg, lon_deg: f.lon_deg };
  if (f.t_start_utc) {
    patch.t_start_utc = f.t_start_utc;
    patch.t_end_utc = f.t_end_utc;
  }
  updateScenario(scenarioId, patch, "structure");
}
