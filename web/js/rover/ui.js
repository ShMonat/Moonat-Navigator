// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Rover trips in the scenario cards, laid out like Google Maps' directions panel. The "Trip" toggle next to the place
// turns a scenario into a trip from that place. The trip block shows, top to bottom: the travel modes (the rover
// presets) as icon tabs; the stacked point fields (the start with a hollow circle, the stops with a dot, the end with a
// pin in the place colour, joined by a dotted line) with a swap button on the right and "Add stop" below; the route
// card (the duration, coloured by the delay against a straight flat drive, the distance and the arrival) with the
// rover's live position while the timelapse plays; and the route map and the elevation and slope profiles under
// "Details". A focused point field lists its suggestions and takes the next click on the globe (trip_edit.js
// fieldState, pick.js); a trip's start and end pins can be dragged on the globe (map.js).
// Planning: index.js planTrip (leg by leg, cached). The globe shows each trip's path and the rover (globe_route.js).

import { store, subscribe, updateScenario, setActive } from "../app/store.js";
import { colorHex, parseUtc, formatDuration, formatUtc } from "../app/state.js";
import { catalogSites } from "../app/catalog.js";
import { skyTime, setLookAheadSource } from "../app/sky_panel.js";
import { lookAheadDirection } from "./sky_ride.js";
import { planTrip, tripKey, tripProblems, onRouteProgress, RouteError, routeTrack, waypointLetter, legAtDistance } from "./index.js";
import { makePlane } from "./terrain.js";
import { PRESETS } from "./presets.js";
import { newRouteFields, routeRequest } from "./app.js";
import { registerRouteCard, cancelPick, pickState, onPickChange, pointerOnMap, undismiss } from "./pick.js";
import { showTripRoute, clearTripRoute, fitTrip, setRoverMarker, setTripStops, shownTrips } from "./globe_route.js";
import {
  tripRows, rowRole, rowName, setRow, removeRow, swapRows, moveUp, addStopIndex, canAddStop, commitRows, stopSuggestions,
  fieldState, parseLatLon, autoArm, pointName as nameAt,
} from "./trip_edit.js";
import { tripDelay, delayText, DELAY_LEVELS } from "./delay.js";
import { icon as svgIcon } from "../app/icons.js";

// "Driver's view" (the sky panel's "ahead" track mode, in the timelapse bar's camera group): a trip's view faces the
// path's heading at the rover.
setLookAheadSource(lookAheadDirection);

const memory = new Map(); // scenario id -> its route while the trip is switched off (switching back restores it)
const gaps = new Map(); // scenario id -> index of the empty stop row that "Add stop" opened (before the end)
const results = new Map(); // scenario id -> { key, r (planned route), track, stopsKey }
const panels = new Map(); // scenario id -> panel API (refresh, live)
const fitted = new Map(); // scenario id -> trip key the globe was last fitted to

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}
const getS = (id) => store.scenarios.find((x) => x.id === id) || null;
const fmtNum = (v, d = 3) => (v === null || v === undefined || !Number.isFinite(+v) ? "" : String(+(+v).toFixed(d)));
const km = (m) => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
const coarse = () => !!window.matchMedia?.("(pointer: coarse)")?.matches;
const round4 = (x) => Math.round(x * 1e4) / 1e4;

/** A point's name: its catalog place, else its coordinates ("89.44° S, 137.19° W"). */
export const pointName = (p) => nameAt(p, catalogSites());

/** The travel modes' icons (icons.js). */
const MODE_ICON = { viper: "viper", lrv: "lrv", custom: "sliders" };
const modeIcon = (preset) => svgIcon(MODE_ICON[preset in PRESETS ? preset : "custom"]);

/** Bring the globe into view for "Choose on the map": at the top of a phone's page, else just into view. */
function revealMap() {
  const mb = document.getElementById("map-block");
  if (!mb) return;
  const phone = window.matchMedia?.("(max-width: 699.98px)")?.matches;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  mb.scrollIntoView({ block: phone ? "start" : "nearest", behavior: reduce ? "auto" : "smooth" });
}

// ---------------------------------------------------------------------------------------------
// The toggle next to the place.

const ICON_TRIP = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="15" r="2.2"/><path d="M5 12.6V9.5a3 3 0 0 1 3-3h7"/><path d="M12.4 3.8 15.2 6.5 12.4 9.2"/></svg>';

/** The "Trip" toggle of a card: on, the scenario is a rover trip from its place. */
export function buildTripToggle(s) {
  const on = !!s.route;
  const b = el("button", {
    type: "button", class: "trip-toggle", "aria-pressed": String(on), html: `${ICON_TRIP}<span>Trip</span>`,
    title: on ? "Back to a single place (the trip is kept if you switch it on again)" : "Plan a rover trip from this place: an end point, and stops if you like",
    "aria-label": on ? "Trip planning on (press to turn it off)" : "Plan a rover trip from this place",
  });
  b.addEventListener("click", () => toggleTrip(s.id));
  return b;
}

function toggleTrip(id) {
  const s = getS(id);
  if (!s) return;
  if (s.route) {
    memory.set(id, s.route);
    gaps.delete(id);
    if (pickState()?.id === id) cancelPick();
    clearTripRoute(id);
    updateScenario(id, { route: null }, "structure");
    return;
  }
  const r = memory.get(id) || newRouteFields("viper");
  setActive(id);
  undismiss(id);
  // The trip's empty end field takes the next click on the map at once (the panel arms it, autoArm).
  updateScenario(id, { route: { ...r } }, "structure");
  if (!Number.isFinite(r.end_lat_deg) && !coarse()) {
    // Like "Directions": with a mouse the end field also takes the focus and its suggestions open (a phone keeps its
    // keyboard closed: the map, the banner and the field are there to tap).
    requestAnimationFrame(() => document.querySelector(`#cards [data-id="${id}"] .trip-row.is-end .trip-input`)?.focus());
  }
}

// ---------------------------------------------------------------------------------------------
// The trip panel of a card.

/** The suggestion icons' classes (globe.css .gs-ico kinds; trip-only kinds in rover.css). */
const ICO_CLASS = { pick: "is-pick", coord: "is-coord", home: "k-home", place: "k-pin" };
const ICO_SVG = { pick: "pin", coord: "follow", home: "home" };

/**
 * The trip section of a card (scenarios with a `route`): the travel modes, the points, the plan and its route card.
 * @param {object} s  C7 scenario with `route`
 */
export function buildTripPanel(s) {
  const id = s.id;
  const sec = el("section", { class: "trip", "aria-label": "Rover trip" });
  const modesEl = el("div", { class: "trip-modes", role: "group", "aria-label": "Rover (travel mode)" });
  const noteEl = el("p", { class: "trip-note" });
  const rowsEl = el("ol", { class: "trip-stops", "aria-label": "Trip points" });
  const swapBtn = el("button", {
    type: "button", class: "icon-btn trip-swap", html: svgIcon("swap"),
    title: "Reverse the trip (swap the start and the end)", "aria-label": "Reverse the trip (swap the start and the end)",
  });
  const routeEl = el("div", { class: "trip-route" }, rowsEl, swapBtn);
  const addEl = el("div", { class: "trip-add" });
  const optsEl = el("details", { class: "trip-opts" });
  const planEl = el("div", { class: "trip-plan", hidden: true },
    el("div", { class: "trip-bar" }, el("div", { class: "trip-bar-fill" })), el("span", { class: "trip-status", role: "status" }));
  const msgEl = el("p", { class: "scen-msg trip-msg", role: "alert", hidden: true });
  const sumEl = el("div", { class: "trip-sum", hidden: true, "aria-live": "polite" });
  const liveEl = el("p", { class: "trip-live", hidden: true });
  const detailsEl = el("details", { class: "trip-details", hidden: true });
  sec.append(modesEl, noteEl, routeEl, addEl, optsEl, planEl, msgEl, sumEl, liveEl, detailsEl);

  let seq = 0;
  let mapDrawn = null; // the route the details map was drawn for
  const cur = () => getS(id) || s;

  // ---- points
  /** The rows: [start, ...stops, end] (unset points null) and the empty stop row "Add stop" opened. */
  const rowsNow = () => tripRows(cur(), gaps.get(id) ?? null);
  /**
   * Write rows to the store (trip_edit.js commitRows); an empty stop row between set points stays open. The fields are
   * drawn again, so a map pick armed for one of them ends.
   */
  const apply = (rows) => {
    const g = rows.findIndex((p, k) => k > 0 && k < rows.length - 1 && !p);
    if (g > 0 && rows.every((p, k) => k === g || p)) gaps.set(id, g);
    else gaps.delete(id);
    if (pickState()?.id === id) cancelPick();
    commitRows(id, rows, catalogSites());
  };
  const setPoint = (i, p) => apply(setRow(rowsNow(), i, p));
  /** After a choice in a field: the next empty field, else "Add stop", takes the focus (not on a touch screen). */
  const focusNext = () => {
    if (coarse()) return;
    requestAnimationFrame(() => (rowsEl.querySelector(".trip-input:placeholder-shown") || addEl.querySelector("button"))?.focus());
  };
  const dropRow = (i) => {
    const rows = rowsNow();
    if (!rows[i] && gaps.get(id) === i) {
      if (pickState()?.id === id) cancelPick();
      // The empty stop row: nothing to write.
      gaps.delete(id);
      renderRows();
      return;
    }
    apply(removeRow(rows, i));
  };
  const reverse = () => {
    const rows = rowsNow();
    if (rows.every(Boolean)) apply(swapRows(rows));
  };
  const up = (i) => {
    const rows = rowsNow();
    if (!rows[i] || !rows[i - 1]) return;
    apply(moveUp(rows, i));
    requestAnimationFrame(() => rowsEl.querySelector(`.trip-row[data-row="${i - 1}"] .trip-up`)?.focus());
  };
  const addStop = () => {
    const rows = rowsNow();
    if (!canAddStop(rows)) return;
    const g = addStopIndex(rows);
    gaps.set(id, g);
    undismiss(id);
    if (pickState()?.id === id) cancelPick(); // the rows move: the new stop field takes the map instead (arm)
    renderRows();
    if (!coarse()) requestAnimationFrame(() => rowsEl.querySelector(`.trip-row[data-row="${g}"] .trip-input`)?.focus());
  };
  let disposed = false;
  /** While this trip is the selected card, its first empty field takes the next map click (trip_edit.js autoArm). */
  const arm = () => {
    if (disposed || !sec.isConnected || !cur().route || store.activeId !== id) return;
    autoArm(id, rowsNow());
  };
  swapBtn.addEventListener("click", reverse);
  const addBtn = el("button", { type: "button", class: "trip-add-btn", title: "Add a stop before the end", onclick: addStop },
    el("span", { class: "trip-add-ico", "aria-hidden": "true", html: svgIcon("plus") }), el("span", { text: "Add stop" }));

  function renderRows() {
    const rows = rowsNow();
    rowsEl.replaceChildren(...rows.map((p, i) => pointRow(i, p, rows)));
    swapBtn.disabled = !rows.every(Boolean);
    addEl.replaceChildren(...(canAddStop(rows) ? [addBtn] : []));
    syncPickMarks();
    queueMicrotask(arm); // after the card is on the page
  }

  /** The other places on the map (the scenarios' places), for the suggestions. */
  const mapPlaces = () => store.scenarios.filter((x) => Number.isFinite(x.lat_deg) && Number.isFinite(x.lon_deg))
    .map((x) => ({ lat_deg: x.lat_deg, lon_deg: x.lon_deg, label: x.label || pointName(x), color: colorHex(x.color, store.theme) }));

  /** One point field: its marker, a search box with its suggestions, move up and remove. */
  function pointRow(i, p, rows) {
    const n = rows.length;
    const role = rowRole(i, n);
    const name = rowName(i, n);
    const L = waypointLetter(i);
    const verb = coarse() ? "tap" : "click";
    const listId = `trip-${id}-${i}`;
    const shown = p ? pointName(p) : "";
    const input = el("input", {
      type: "text", class: "trip-input", role: "combobox", "aria-expanded": "false", "aria-controls": listId,
      "aria-autocomplete": "list", autocomplete: "off", spellcheck: "false", enterkeyhint: "search", value: shown,
      placeholder: role === "start" ? `Choose start point, or ${verb} the map` : role === "end" ? `Choose end point, or ${verb} the map` : `Add a stop, or ${verb} the map`,
      "aria-label": `${role === "start" ? "Start" : role === "end" ? "End" : "Stop"} ${L}: search a place, type coordinates, or choose on the map`,
    });
    const list = el("ul", { class: "trip-list", id: listId, role: "listbox", hidden: true, tabindex: "-1", "aria-label": `Places for ${name}` });
    const field = el("div", { class: "trip-field" }, input, list);
    // Distances are given from the point before (for the start, from the point after it).
    const nb = i === 0 ? 1 : i - 1;
    let opts = [];
    let sel = -1;
    const onDocDown = (e) => st.pointerDown(field.contains(e.target));
    const closeList = () => {
      list.hidden = true;
      field.classList.remove("open");
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      document.removeEventListener("pointerdown", onDocDown, true);
    };
    const st = fieldState(id, i, name, { onOpen: (open) => open || closeList() });

    /** The globe's block when it is pinned over the top of the inputs column (wide screens, pick.js), else null. */
    const pinnedMap = () => {
      const mb = document.getElementById("map-block");
      return mb && getComputedStyle(mb).position === "sticky" ? mb : null;
    };
    /** With the globe pinned over the top of the inputs column, bring the field out from under it. */
    const keepInView = () => {
      const mb = pinnedMap();
      const scroller = sec.closest(".inputs");
      if (!mb || !scroller) return;
      const fr = input.getBoundingClientRect();
      const top = mb.getBoundingClientRect().bottom + 8;
      const bottom = scroller.getBoundingClientRect().bottom - 8;
      if (fr.top < top) scroller.scrollTop -= top - fr.top;
      else if (fr.bottom > bottom) scroller.scrollTop += fr.bottom - bottom;
    };
    /** Open below the field, or above it when there is more room there, never over the globe. */
    const place = () => {
      list.classList.remove("up");
      const fr = input.getBoundingClientRect();
      const scroller = sec.closest(".inputs");
      const own = scroller && /auto|scroll/.test(getComputedStyle(scroller).overflowY);
      const vv = window.visualViewport;
      const top = Math.max(own ? scroller.getBoundingClientRect().top : 0, vv ? vv.offsetTop : 0);
      const bottom = Math.min(own ? scroller.getBoundingClientRect().bottom : window.innerHeight, vv ? vv.offsetTop + vv.height : window.innerHeight);
      const map = (pinnedMap() || document.getElementById("map"))?.getBoundingClientRect();
      const mapAbove = map && map.right > fr.left && map.left < fr.right && map.bottom <= fr.top + 1 ? map.bottom : -Infinity;
      const below = bottom - fr.bottom - 8;
      const above = fr.top - Math.max(top, mapAbove) - 8;
      const want = Math.min(list.scrollHeight, 360);
      if (below < Math.min(want, 200) && above > below) {
        list.classList.add("up");
        list.style.maxHeight = `${Math.max(0, Math.min(360, above))}px`;
      } else list.style.maxHeight = `${Math.min(360, Math.max(160, below))}px`;
    };
    const highlight = () => {
      const items = list.querySelectorAll(".trip-opt");
      items.forEach((li, k) => li.setAttribute("aria-selected", k === sel ? "true" : "false"));
      const c = items[sel];
      if (!c) {
        input.removeAttribute("aria-activedescendant");
        return;
      }
      input.setAttribute("aria-activedescendant", c.id);
      // Scroll inside the list only (the page stays where it is).
      if (c.offsetTop < list.scrollTop) list.scrollTop = c.offsetTop;
      else if (c.offsetTop + c.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = c.offsetTop + c.offsetHeight - list.clientHeight;
    };
    const optionEl = (o, k) => {
      const ico = el("span", {
        class: `gs-ico trip-ico ${ICO_CLASS[o.kind] || `k-${o.site?.kind || "poi"}`}`, "aria-hidden": "true",
        html: ICO_SVG[o.kind] ? svgIcon(ICO_SVG[o.kind]) : "",
      });
      if (o.kind === "place" && o.color) ico.style.setProperty("--k", o.color);
      const li = el("li", {
        class: `gs-item trip-opt is-${o.kind}`, role: "option", id: `${listId}-${k}`, "aria-selected": "false",
        "aria-disabled": o.disabled ? "true" : null,
      }, ico, el("span", { class: "gs-text" }, el("span", { class: "gs-name", text: o.name }), o.meta ? el("span", { class: "gs-sub", text: o.meta }) : null));
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(k);
      });
      return li;
    };
    const render = () => {
      const q = input.value.trim();
      const query = q === shown ? "" : q;
      opts = stopSuggestions({
        query, from: rows[nb] || null, fromLetter: waypointLetter(nb), sites: catalogSites(), places: mapPlaces(),
        exclude: i === 0 ? [] : [rows[i + 1]], tap: coarse(),
      });
      sel = query ? opts.findIndex((o) => !o.disabled && o.kind !== "pick") : -1;
      const lis = opts.map(optionEl);
      if (!query && !opts.some((o) => o.kind !== "pick" && !o.disabled)) {
        const from = rows[nb];
        const eg = from ? `${(from.lat_deg + (from.lat_deg > 0 ? -0.05 : 0.05)).toFixed(2)}, ${from.lon_deg.toFixed(2)}` : "26.08, 3.66";
        lis.push(el("li", { class: "gs-empty", text: `No catalog place in reach of ${waypointLetter(nb)}. ${verb === "tap" ? "Tap" : "Click"} the map, or type coordinates such as ${eg}.` }));
      }
      list.replaceChildren(...lis);
      list.hidden = false;
      field.classList.add("open");
      input.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", onDocDown, true);
      place();
      list.scrollTop = 0;
      highlight();
    };
    const choose = (k) => {
      const o = opts[k];
      if (!o || o.disabled) return;
      if (o.kind === "pick") {
        st.chooseOnMap();
        input.value = shown;
        input.blur();
        revealMap();
        return;
      }
      st.chose();
      input.value = pointName(o.p);
      setPoint(i, o.p);
      focusNext();
    };
    list.addEventListener("mousedown", (e) => e.preventDefault()); // the list's scrollbar keeps the focus in the field
    input.addEventListener("focus", () => {
      st.focus();
      keepInView();
      render();
    });
    input.addEventListener("input", () => {
      st.typed();
      render();
    });
    // A click in the focused field (after Esc or a press outside) opens the suggestions and arms the map again.
    input.addEventListener("click", () => {
      if (!list.hidden) return;
      st.focus();
      keepInView();
      render();
    });
    input.addEventListener("blur", (e) => {
      const to = e.relatedTarget;
      setTimeout(() => {
        if (!input.isConnected || document.activeElement === input) return;
        // A press on the globe keeps the field's pick: that click sets the point.
        st.blur(to ? !!to.closest?.("#map-block") : pointerOnMap());
        input.value = shown;
      }, 0);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (list.hidden) {
          st.typed();
          render();
        }
        const step = e.key === "ArrowDown" ? 1 : -1;
        let k = sel;
        for (let tries = 0; tries < opts.length; tries++) {
          k = Math.max(0, Math.min(opts.length - 1, k + step));
          if (!opts[k]?.disabled) break;
        }
        if (!opts[k]?.disabled) sel = k;
        highlight();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!list.hidden && sel >= 0) return choose(sel);
        const coord = parseLatLon(input.value);
        if (coord) {
          st.chose();
          setPoint(i, coord);
          focusNext();
        }
      } else if (e.key === "Escape") {
        const wasOpen = !list.hidden;
        if (st.escape()) {
          e.preventDefault();
          if (wasOpen) {
            e.stopPropagation(); // the first Esc closes the list; the next one ends the map pick (pick.js)
            input.value = shown;
          }
        }
      }
    });
    const upBtn = i >= 2 && p && rows[i - 1]
      ? el("button", { type: "button", class: "icon-btn trip-up", title: `Move ${L} up`, "aria-label": `Move point ${L} up`, html: svgIcon("up"), onclick: () => up(i) })
      : null;
    // Like Google Maps: with only a start and an end there is nothing to remove (edit or swap them instead).
    const rmBtn = n > 2
      ? el("button", {
        type: "button", class: "icon-btn trip-rm", title: p ? `Remove ${L}` : "Remove this stop", "aria-label": p ? `Remove point ${L}` : "Remove this empty stop",
        html: svgIcon("close"), onclick: () => dropRow(i),
      })
      : null;
    const mk = el("span", { class: `trip-mk mk-${role}`, "aria-hidden": "true", html: role === "end" ? svgIcon("pin") : "" });
    // The row buttons in a column of their own, so the fields line up.
    return el("li", { class: `trip-row is-${role}`, "data-row": String(i) }, mk, field, n > 2 ? el("span", { class: "trip-acts" }, upBtn, rmBtn) : null);
  }

  function syncPickMarks() {
    const pk = pickState();
    for (const li of rowsEl.querySelectorAll(".trip-row")) li.classList.toggle("picking", pk?.id === id && String(pk.row) === li.dataset.row);
  }

  // ---- rover (travel mode) and options
  function renderModes() {
    const r = cur().route || {};
    const preset = r.preset in PRESETS ? r.preset : "custom";
    const lim = (v, sl) => `${fmtNum(v)} m/s, slopes up to ${fmtNum(sl)}°`;
    const tab = (key, name, tip) => el("button", {
      type: "button", class: "trip-mode", "data-mode": key, "aria-pressed": String(preset === key), title: `${name}: ${tip}`,
      onclick: () => setMode(key),
    }, el("span", { class: "tm-ico", "aria-hidden": "true", html: svgIcon(MODE_ICON[key]) }), el("span", { class: "tm-name", text: name }));
    modesEl.replaceChildren(
      tab("viper", "VIPER-class", lim(PRESETS.viper.speed_mps, PRESETS.viper.max_slope_deg)),
      tab("lrv", "Apollo LRV", lim(PRESETS.lrv.speed_mps, PRESETS.lrv.max_slope_deg)),
      tab("custom", "Custom", preset === "custom" ? lim(r.speed_mps, r.max_slope_deg) : "your own speed and slope limits"),
    );
    const p = PRESETS[preset];
    noteEl.textContent = p ? p.note : `Custom rover: ${lim(r.speed_mps, r.max_slope_deg)} (Speed, slopes and rest stops below).`;
  }
  function setMode(key) {
    const r = { ...cur().route };
    if (key === "custom") {
      r.preset = "custom";
      optsEl.open = true;
    } else {
      const p = PRESETS[key];
      Object.assign(r, { preset: key, speed_mps: p.speed_mps, max_slope_deg: p.max_slope_deg, max_cross_deg: p.max_cross_deg });
    }
    updateScenario(id, { route: r }, "field");
  }
  function renderOpts() {
    const r = cur().route || {};
    const num = (key, text, ph, tip) => {
      const input = el("input", { type: "number", step: "any", min: "0", inputmode: "decimal", placeholder: ph, value: r[key] ? fmtNum(r[key]) : "", title: tip });
      input.addEventListener("change", () => {
        const v = input.value === "" ? 0 : Number(input.value);
        if (!Number.isFinite(v) || v < 0) return;
        const nr = { ...cur().route, [key]: v };
        if (["speed_mps", "max_slope_deg", "max_cross_deg"].includes(key)) nr.preset = "custom";
        updateScenario(id, { route: nr }, "field");
      });
      return el("label", { class: "field" }, el("span", { text }), input);
    };
    const keepOpen = optsEl.open;
    optsEl.replaceChildren(
      el("summary", { text: "Speed, slopes and rest stops" }),
      el("div", { class: "fields trip-rover" },
        num("speed_mps", "Speed (m/s)", "0.2", "Level-ground speed, 0–20 m/s; uphill the rover slows (power-limited)"),
        num("max_slope_deg", "Max slope (°)", "15", "Steepest terrain the rover may drive on, 1–45°"),
        num("max_cross_deg", "Max cross slope (°)", "15", "Steepest sideways tilt, 1–45°")),
      el("div", { class: "trip-rest" }, el("span", { text: "Rest every" }), restIn("stop_every_km", "km"), el("span", { text: "km for" }),
        restIn("stop_h", "h"), el("span", { text: "h (optional)" })),
    );
    optsEl.open = keepOpen;
    function restIn(key, unit) {
      const input = el("input", { type: "number", step: "any", min: "0", inputmode: "decimal", placeholder: "–", value: r[key] ? fmtNum(r[key]) : "", "aria-label": key === "stop_h" ? "Rest stop length in hours" : "Rest stop every N km" });
      input.addEventListener("change", () => {
        const v = input.value === "" ? 0 : Number(input.value);
        if (Number.isFinite(v) && v >= 0) updateScenario(id, { route: { ...cur().route, [key]: v } }, "field");
      });
      return input;
    }
  }

  // ---- planning and the summary
  /** The card's message line; retry (optional): a "Try again" button that plans again. */
  function setMsg(text, warn = false, retry = null) {
    msgEl.textContent = text || "";
    if (text && retry) {
      msgEl.append(" ", el("button", { type: "button", class: "link-btn trip-retry", text: "Try again", onclick: retry }));
    }
    msgEl.hidden = !text;
    msgEl.classList.toggle("warn", warn);
  }
  async function plan() {
    const my = ++seq;
    const s1 = cur();
    const req = routeRequest(s1);
    if (!req.complete) {
      results.delete(id);
      planEl.hidden = true;
      sumEl.hidden = true;
      liveEl.hidden = true;
      detailsEl.hidden = true;
      clearTripRoute(id);
      const missing = req.waypoints.findIndex((p) => !p);
      setMsg(missing === 0 ? "Choose the start first (the place above)." : "", true);
      return;
    }
    const probs = tripProblems(req.waypoints);
    if (probs.length) {
      planEl.hidden = true;
      sumEl.hidden = true;
      detailsEl.hidden = true;
      setMsg(probs[0]);
      return;
    }
    const key = tripKey(req.waypoints, req.rover);
    const have = results.get(id);
    if (have?.key === key) {
      planEl.hidden = true; // a plan still running for other points no longer matters
      setMsg("");
      return showResult(have.r);
    }
    setMsg("");
    planEl.hidden = false;
    sumEl.classList.add("stale");
    const fill = planEl.querySelector(".trip-bar-fill");
    const status = planEl.querySelector(".trip-status");
    status.textContent = "Fetching NASA terrain…";
    fill.style.width = "0%";
    const stop = onRouteProgress(key, (stage, frac, leg = 0, legs = 1) => {
      if (my !== seq) return;
      const base = { terrain: 0, plan: 0.25, horizons: 0.3 }[stage] ?? 0;
      const w = { terrain: 0.25, plan: 0.05, horizons: 0.7 }[stage] ?? 0;
      fill.style.width = `${Math.round((100 * (leg + base + w * frac)) / legs)}%`;
      const what = stage === "terrain" ? "fetching NASA terrain (LOLA, Moon Trek)…" : stage === "plan" ? "finding the fastest drivable path…" : `tracing the horizon along the path… ${Math.round(frac * 100)}%`;
      status.textContent = legs > 1 ? `Leg ${waypointLetter(leg)} → ${waypointLetter(leg + 1)}: ${what}` : what[0].toUpperCase() + what.slice(1);
    });
    try {
      const r = await planTrip(req.waypoints, req.rover);
      if (my !== seq) return;
      results.set(id, { key, r, track: null, stopsKey: "" });
      planEl.hidden = true;
      showResult(r);
    } catch (err) {
      if (my !== seq) return;
      planEl.hidden = true;
      sumEl.hidden = true;
      detailsEl.hidden = true;
      results.delete(id);
      clearTripRoute(id);
      // A failure without a planner reason (code "error": Moon Trek did not answer, the network dropped) can pass on a
      // second try: "Try again" plans the trip again, for this card and for the sky (a field change recomputes both).
      const transient = !(err instanceof RouteError) || !err.code || err.code === "error";
      const raw = String(err?.message || err);
      const trek = transient ? /Moon Trek [^:]*: (.{1,80})$/.exec(raw) : null; // trek.js: "Moon Trek <layer>: HTTP 500"
      const text = !transient ? raw : trek ? `${raw.slice(0, trek.index)}NASA Moon Trek did not send the terrain (${trek[1]}).` : `Planning failed: ${raw}`;
      setMsg(text, false, transient ? () => updateScenario(id, { route: { ...cur().route } }, "field") : null);
    } finally {
      stop();
    }
  }

  /** The drive timeline (stops included), cached per result and rest-stop settings. */
  function trackOf(entry) {
    const req = routeRequest(cur());
    const k = JSON.stringify(req.stops);
    if (!entry.track || entry.stopsKey !== k) {
      entry.track = routeTrack(entry.r, req.stops);
      entry.stopsKey = k;
    }
    return entry.track;
  }

  function showResult(r) {
    const entry = results.get(id);
    if (!entry) return;
    const s1 = cur();
    const track = trackOf(entry);
    const st = r.stats;
    const total = track.arrival_ms;
    const rest = total - st.drive_s * 1000;
    const t0 = parseUtc(s1.t_start_utc || "");
    const t1 = s1.t_end_utc ? parseUtc(s1.t_end_utc) : NaN;
    const legs = r.leg_info || null;
    const arrive = Number.isFinite(t0) ? `Arrives ${formatUtc(t0 + total)}` : "Set a start time to see when the rover arrives.";
    // Google Maps' traffic colours: the route time against a straight flat drive through the same points (delay.js).
    const delay = tripDelay(r, routeRequest(s1).stops, total);
    const level = delay.level || "green";
    const ratioTip = Number.isFinite(delay.ratio)
      ? `${delay.ratio.toFixed(2)} × the time of a straight drive on flat ground (green below ${DELAY_LEVELS.orange}, orange below ${DELAY_LEVELS.red}, red from ${DELAY_LEVELS.red})`
      : "";
    const main = el("div", { class: "trip-card-main" },
      el("div", { class: "trip-card-why", text: `Fastest route within the ${fmtNum(r.rover.max_slope_deg)}° slope limit` }),
      el("div", { class: "trip-sum-sub", text: arrive }),
      el("div", { class: `trip-delay lv-${level}`, text: delayText(delay), title: ratioTip || null }),
      el("div", { class: "trip-sum-fine", text: [
        `${st.mean_speed_mps < 1 ? st.mean_speed_mps.toFixed(2) : st.mean_speed_mps.toFixed(1)} m/s on average`,
        `+${Math.round(st.climb_m)} / −${Math.round(st.descent_m)} m`,
        `steepest ${st.max_along_deg.toFixed(1)}°`,
        track.timeline.stops ? `${track.timeline.stops} rest stop${track.timeline.stops > 1 ? "s" : ""} (${formatDuration(rest)})` : "",
      ].filter(Boolean).join(" · ") }));
    if (legs) {
      // Each leg by the names of its ends (their letters are on the globe's stop dots).
      const w = r.waypoints || [];
      main.append(el("ol", { class: "trip-legs" }, ...legs.map((l, j) => el("li", { title: `${waypointLetter(j)} → ${waypointLetter(j + 1)}` },
        el("span", { class: "tl-pts", text: `${pointName(w[j])} → ${pointName(w[j + 1])}` }),
        el("span", { class: "tl-len", text: `${km(l.length_m)} · ${formatDuration(l.drive_s * 1000)}` })))));
    }
    sumEl.replaceChildren(el("div", { class: "trip-card", "data-level": level },
      el("span", { class: "trip-card-ico", "aria-hidden": "true", html: modeIcon(s1.route?.preset) }),
      main,
      el("div", { class: "trip-card-side" },
        el("b", { class: `trip-time lv-${level}`, text: formatDuration(total), title: ratioTip || null }),
        el("span", { class: "trip-dist", text: km(st.length_m) }))));
    sumEl.classList.remove("stale");
    sumEl.hidden = false;
    // An end time before the arrival cuts the drive short.
    if (Number.isFinite(t0) && Number.isFinite(t1) && t1 - t0 < total) {
      const d = track.distanceAt(t1 - t0);
      setMsg(`The end time stops the drive at ${km(d)} of ${km(st.length_m)}. Clear the end time to follow it to the arrival.`, true);
    } else setMsg("");
    // Details: the route map and the profiles (drawn when opened).
    detailsEl.hidden = false;
    if (!detailsEl.firstChild) {
      detailsEl.append(el("summary", { text: "Route map and profiles" }), el("div", { class: "trip-details-body" }));
      detailsEl.addEventListener("toggle", () => detailsEl.open && drawDetails());
    }
    if (detailsEl.open) drawDetails();
    // The globe: the path, fitted when it is new; the rover where the timelapse is.
    const color = colorHex(s1.color, store.theme);
    showTripRoute(id, globePoints(r), color);
    const w = r.waypoints || [];
    setTripStops(id, w.slice(1, -1).map((p, k) => ({ lat: p.lat_deg, lon: p.lon_deg, letter: waypointLetter(k + 1) })), color);
    if (fitted.get(id) !== entry.key && (store.activeId === id || store.scenarios.filter((x) => x.route).length === 1)) {
      fitted.set(id, entry.key);
      fitTrip(globePoints(r));
    }
    live(skyTime().offsetMs);
  }

  function drawDetails() {
    const entry = results.get(id);
    if (!entry || mapDrawn === entry.r) return;
    mapDrawn = entry.r;
    const r = entry.r;
    const body = detailsEl.querySelector(".trip-details-body");
    const canvas = el("canvas", { class: "route-map", role: "img", "aria-label": "Route map: shaded relief with the planned path and its points" });
    const n = (r.waypoints || [r.start, r.end]).length;
    body.replaceChildren(canvas,
      el("p", { class: "route-legend" }, el("span", { class: "lg-path" }), "planned path ", el("span", { class: "lg-steep" }),
        ` steeper than ${r.rover.max_slope_deg}° (no-go) `, el("span", { class: "lg-start", text: "A" }), " start ",
        n > 2 ? el("span", { class: "lg-via", text: "B" }) : null, n > 2 ? " stops " : null,
        el("span", { class: "lg-end", text: waypointLetter(n - 1) }), " end"),
      profile(r, "elev"), profile(r, "slope"),
      el("p", { class: "route-arrive muted", text: `Terrain: NASA LOLA ${Math.round(r.meta.fine_cell_m)} m grid via Moon Trek${r.legs ? ` (${r.legs.length} legs)` : ""}` }));
    requestAnimationFrame(() => drawMap(canvas, r, colorHex(cur().color, store.theme)));
  }

  /** The live line and the globe's rover dot at `offsetMs` after the start (the sky's timelapse). */
  function live(offsetMs) {
    const entry = results.get(id);
    const s1 = cur();
    if (!entry) {
      liveEl.hidden = true;
      setRoverMarker(id, null);
      return;
    }
    const track = trackOf(entry);
    const r = entry.r;
    const t0 = parseUtc(s1.t_start_utc || "");
    const t1 = s1.t_end_utc ? parseUtc(s1.t_end_utc) : NaN;
    const span = Number.isFinite(t1) ? t1 - t0 : Math.max(track.arrival_ms, 3600e3);
    const dt = Math.max(0, Math.min(offsetMs || 0, span));
    const d = track.distanceAt(dt);
    const L = track.length_m;
    const pos = track.positionAt(d);
    const ahead = d < L - 1 ? track.positionAt(Math.min(L, d + Math.max(30, L / 400))) : null;
    setRoverMarker(id, {
      lat: pos.lat_deg, lon: pos.lon_deg, color: colorHex(s1.color, store.theme), label: s1.label || "Rover",
      ahead: ahead ? { lat: ahead.lat_deg, lon: ahead.lon_deg } : null,
    });
    if (!(offsetMs > 0) || !Number.isFinite(t0)) {
      liveEl.hidden = true;
      return;
    }
    const arrived = dt >= track.arrival_ms;
    const parked = !arrived && Math.abs(track.distanceAt(dt + 60e3) - d) < 1e-6;
    const n = (r.waypoints || [r.start, r.end]).length;
    const j = legAtDistance(r, d);
    const legTxt = n > 2 && !arrived ? ` on ${waypointLetter(j)} → ${waypointLetter(j + 1)}` : "";
    liveEl.replaceChildren();
    if (arrived) {
      liveEl.append(el("span", { class: "tl-ico", "aria-hidden": "true", html: svgIcon("check") }),
        el("b", { text: `Arrived at ${waypointLetter(n - 1)}` }), ` · ${km(L)} in ${formatDuration(track.arrival_ms)}, ${formatUtc(t0 + track.arrival_ms)}`);
    } else {
      const eta = t0 + track.arrival_ms;
      liveEl.append(el("span", { class: "tl-ico", "aria-hidden": "true", html: svgIcon(parked ? "pause" : "play") }),
        el("b", { text: `${km(d)} driven` }), `${legTxt} · ${km(L - d)} to go · `,
        el("span", { class: "tl-eta", text: `arrives ${formatUtc(eta)} (in ${formatDuration(eta - (t0 + dt))})` }),
        parked ? " · resting" : "");
    }
    liveEl.hidden = false;
  }

  // After an edit the plan waits a moment (typed start coordinates change on every key); a planned trip shows at once.
  let planTimer = 0;
  function refresh(now = false) {
    renderRows();
    renderModes();
    renderOpts();
    clearTimeout(planTimer);
    const req = routeRequest(cur());
    const cached = req.complete && results.get(id)?.key === tripKey(req.waypoints, req.rover);
    if (now || cached || !req.complete) plan();
    else planTimer = setTimeout(plan, 350);
  }

  // Globe picks fill the armed row (row 0 the start, -1 the end: a dragged pin); the field shows the new point.
  const offPick = registerRouteCard(id, {
    onPoint: (row, lat, lon) => {
      setActive(id);
      setPoint(row, { lat_deg: round4(lat), lon_deg: round4(lon) });
    },
  });
  // A pick that ended (used, cancelled, a field let go of it) hands the map back to the first empty field, if any.
  const offPickMarks = onPickChange((pk) => {
    syncPickMarks();
    if (!pk) queueMicrotask(arm);
  });
  panels.get(id)?.dispose();
  panels.set(id, {
    sec,
    refresh,
    live,
    arm,
    dispose() {
      disposed = true;
      clearTimeout(planTimer);
      seq++;
      offPick();
      offPickMarks();
    },
  });
  refresh(true);
  return sec;
}

/** A trip's path for the globe: at most ~600 points [{lat, lon}]. */
function globePoints(r) {
  if (r._globePts) return r._globePts;
  const P = r.path, n = P.lat.length, step = Math.max(1, Math.ceil(n / 600));
  const pts = [];
  for (let i = 0; i < n; i += step) pts.push({ lat: P.lat[i], lon: P.lon[i] });
  if ((n - 1) % step) pts.push({ lat: P.lat[n - 1], lon: P.lon[n - 1] });
  Object.defineProperty(r, "_globePts", { value: pts, enumerable: false });
  return pts;
}

/** The trip cards' live lines and the rovers on the globe at `offsetMs` after the start (main.js, on every sky time). */
export function tripTime(offsetMs) {
  for (const p of panels.values()) p.live(offsetMs);
}

// Store changes: re-plan the edited trip, drop the panels and globe routes of scenarios that are gone or no longer
// trips, recolour on a theme change, and fit the globe to a trip when it is selected.
subscribe((kind, detail = {}) => {
  if (kind === "field" && detail.id && panels.has(detail.id)) {
    const s = getS(detail.id);
    if (s?.route && panels.get(detail.id).sec.isConnected) panels.get(detail.id).refresh();
  }
  if (kind === "structure" || kind === "field") {
    for (const [id, p] of panels) {
      const s = getS(id);
      if (!s || !s.route) {
        p.dispose();
        panels.delete(id);
        results.delete(id);
        clearTripRoute(id);
      }
    }
    for (const id of shownTrips()) if (!getS(id)?.route) clearTripRoute(id);
  }
  if (kind === "ui" && "theme" in detail) {
    for (const [id, e] of results) {
      const s = getS(id);
      if (s) showTripRoute(id, globePoints(e.r), colorHex(s.color, store.theme));
    }
    tripTime(skyTime().offsetMs);
  }
  if (kind === "active") {
    const e = results.get(store.activeId);
    if (e) {
      fitted.set(store.activeId, e.key);
      fitTrip(globePoints(e.r));
    }
    // Another card selected: a trip's map pick ends (globe clicks are ordinary again); a selected trip with an empty
    // field takes the map.
    const pk = pickState();
    if (pk && pk.id !== store.activeId) cancelPick();
    panels.get(store.activeId)?.arm();
  }
});

// ---------------------------------------------------------------------------------------------
// Details: the route map (hillshade of each leg's terrain, the path and the points) and the profiles.

/** Affine map (leg plane -> trip plane) of a leg: [m11, m12, m21, m22, tx, ty]; identity for the trip's own plane. */
function planeAffine(legCentre, tripCentre) {
  if (Math.abs(legCentre.lat_deg - tripCentre.lat_deg) < 1e-12 && Math.abs(legCentre.lon_deg - tripCentre.lon_deg) < 1e-12) return [1, 0, 0, 1, 0, 0];
  const A = makePlane(legCentre.lat_deg, legCentre.lon_deg), B = makePlane(tripCentre.lat_deg, tripCentre.lon_deg);
  const to = (X, Y) => {
    const ll = A.toLatLon(X, Y);
    return B.toXY(ll.lat_deg, ll.lon_deg);
  };
  const b = 2000;
  const o = to(0, 0), ex = to(b, 0), ey = to(0, b);
  return [(ex[0] - o[0]) / b, (ey[0] - o[0]) / b, (ex[1] - o[1]) / b, (ey[1] - o[1]) / b, o[0], o[1]];
}

/** Hillshade crop around the path with the path, the points (A, B, …), a scale bar and a north arrow. */
function drawMap(canvas, r, color) {
  const P = r.path;
  const layers = r.legs ? r.legs.map((L) => ({ pv: L.preview, M: planeAffine(L.centre, r.centre) })) : [{ pv: r.preview, M: [1, 0, 0, 1, 0, 0] }];
  let x0 = Math.min(...P.x), x1 = Math.max(...P.x), y0 = Math.min(...P.y), y1 = Math.max(...P.y);
  const pad = Math.max(0.18 * Math.max(x1 - x0, y1 - y0), 800);
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  // Canvas shape follows the route (between 0.6 and 1.1 of the width tall).
  const W = canvas.clientWidth || 340, H = Math.round(W * Math.min(1.1, Math.max(0.6, (y1 - y0) / (x1 - x0))));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext("2d");
  // Match the canvas aspect.
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let w = x1 - x0, h = y1 - y0;
  if (w / h > W / H) h = (w * H) / W; else w = (h * W) / H;
  let ccx = cx, ccy = cy;
  if (!r.legs) {
    // One leg: keep the crop inside its terrain grid when it fits (no empty margins).
    const pv = r.preview;
    const clamp = (c, half, lo, hi) => (hi - lo >= 2 * half ? Math.min(hi - half, Math.max(lo + half, c)) : (lo + hi) / 2);
    ccx = clamp(cx, w / 2, pv.x0, pv.x1);
    ccy = clamp(cy, h / 2, pv.y0, pv.y1);
  }
  x0 = ccx - w / 2; x1 = ccx + w / 2; y0 = ccy - h / 2; y1 = ccy + h / 2;
  const ax = W / (x1 - x0), ay = H / (y1 - y0);
  const sx = (x) => (x - x0) * ax, sy = (y) => (y1 - y) * ay;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  for (const { pv, M } of layers) {
    if (!pv) continue;
    const off = document.createElement("canvas");
    off.width = pv.width;
    off.height = pv.height;
    off.getContext("2d").putImageData(new ImageData(pv.rgba, pv.width, pv.height), 0, 0);
    // Image pixel (u, v) -> leg plane (X, Y) -> trip plane (x, y) -> canvas (CSS px) -> device px.
    const su = (pv.x1 - pv.x0) / pv.width, sv = (pv.y1 - pv.y0) / pv.height;
    const [m11, m12, m21, m22, tx, ty] = M;
    const c1 = m11 * pv.x0 + m12 * pv.y1 + tx, c2 = m21 * pv.x0 + m22 * pv.y1 + ty;
    ctx.setTransform(dpr * ax * m11 * su, dpr * -ay * m21 * su, dpr * -ax * m12 * sv, dpr * ay * m22 * sv,
      dpr * (ax * (c1 - x0)), dpr * (ay * (y1 - c2)));
    ctx.drawImage(off, 0, 0);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const line = (width, style) => {
    ctx.beginPath();
    P.x.forEach((x, i) => (i ? ctx.lineTo(sx(x), sy(P.y[i])) : ctx.moveTo(sx(x), sy(P.y[i]))));
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.stroke();
  };
  line(5, "rgba(0,0,0,0.75)");
  line(2.6, color);
  const marker = (x, y, text, fill) => {
    ctx.beginPath();
    ctx.arc(sx(x), sy(y), 8, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, sx(x), sy(y) + 0.5);
  };
  // The points: A (start), the stops, the end (the path vertex where each leg starts, and the last one).
  const at = r.leg_info ? [...r.leg_info.map((l) => l.vertex0), P.x.length - 1] : [0, P.x.length - 1];
  at.forEach((v, k) => marker(P.x[v], P.y[v], waypointLetter(k), k === 0 ? "#1a8f5a" : k === at.length - 1 ? "#c0392b" : "#4f5f86"));

  // Scale bar (1-2-5 km) and north arrow (+y of the plane = north at the trip centre).
  const target = (x1 - x0) / 4;
  const nice = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  const len = (nice / (x1 - x0)) * W;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(8, H - 26, len + 16, 20);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(16, H - 12); ctx.lineTo(16 + len, H - 12);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 16 + len / 2, H - 13);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(W - 26, 6, 20, 30);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(W - 16, 10); ctx.lineTo(W - 21, 22); ctx.lineTo(W - 11, 22);
  ctx.fill();
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("N", W - 16, 33);
}

/** Small SVG profile against distance: "elev" (m above the 1737.4 km sphere) or "slope" (along-track, deg); the stops marked. */
function profile(r, kind) {
  const P = r.path;
  const d = P.dist_m.map((x) => x / 1000);
  const y = kind === "elev" ? P.elev_m : P.along_deg;
  const W = 340, H = 92, L = 40, R = 8, T = 16, B = 20;
  let lo = Math.min(...y), hi = Math.max(...y);
  if (kind === "slope") {
    const m = Math.max(r.rover.max_slope_deg, Math.ceil(Math.max(Math.abs(lo), Math.abs(hi))));
    lo = -m; hi = m;
  } else if (hi - lo < 20) {
    const c = (hi + lo) / 2;
    lo = c - 10; hi = c + 10;
  }
  const dMax = Math.max(1e-6, d[d.length - 1]);
  const X = (v) => L + (v / dMax) * (W - L - R), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const pts = d.map((v, i) => `${X(v).toFixed(1)},${Y(y[i]).toFixed(1)}`).join(" ");
  const fmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Math.round(v)));
  const title = kind === "elev" ? "Elevation (m, above the 1737.4 km sphere)" : `Slope along the path (°, + uphill) · limit ±${r.rover.max_slope_deg}°`;
  const limits = kind === "slope"
    ? `<line x1="${L}" x2="${W - R}" y1="${Y(r.rover.max_slope_deg)}" y2="${Y(r.rover.max_slope_deg)}" class="pf-limit"/>
       <line x1="${L}" x2="${W - R}" y1="${Y(-r.rover.max_slope_deg)}" y2="${Y(-r.rover.max_slope_deg)}" class="pf-limit"/>
       <line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" class="pf-zero"/>`
    : "";
  const stops = (r.leg_info || []).slice(1).map((l, j) => {
    const x = X(l.dist0_m / 1000);
    return `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${T}" y2="${H - B}" class="pf-stop"/><text x="${(x + 3).toFixed(1)}" y="${T + 9}" class="pf-tick">${waypointLetter(j + 1)}</text>`;
  }).join("");
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="route-profile" role="img" aria-label="${title}">
    <text x="${L}" y="11" class="pf-title">${title}</text>
    <line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" class="pf-axis"/><line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="pf-axis"/>
    ${limits}${stops}
    <polyline points="${pts}" class="pf-line"/>
    <text x="${L - 4}" y="${T + 4}" class="pf-tick" text-anchor="end">${fmt(hi)}</text>
    <text x="${L - 4}" y="${H - B}" class="pf-tick" text-anchor="end">${fmt(lo)}</text>
    <text x="${L}" y="${H - 6}" class="pf-tick">0</text>
    <text x="${W - R}" y="${H - 6}" class="pf-tick" text-anchor="end">${dMax.toFixed(dMax < 10 ? 2 : 1)} km</text>
  </svg>`;
  const wrap = el("div", { class: "route-profile-wrap" });
  wrap.innerHTML = svg;
  return wrap;
}
