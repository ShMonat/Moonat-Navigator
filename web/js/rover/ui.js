// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Rover trips in the scenario cards, in the spirit of Google Maps directions: the "Trip" toggle next to the place
// turns a scenario into a trip from that place (point A); rows for the end (B) and the stops after it (+ Add stop),
// each set by a search (catalog places in reach, or typed coordinates) or on the globe, removable, movable and
// reversible; travel modes (the rover presets); the route summary (driving time, distance, arrival) with the rover's
// live position while the timelapse plays; and the route map and the elevation and slope profiles under "Details".
// Planning: index.js planTrip (leg by leg, cached). The globe shows each trip's path and the rover (globe_route.js).

import { store, subscribe, updateScenario, setActive } from "../app/store.js";
import { colorHex, parseUtc, formatDuration, formatUtc, fmtLat, fmtLon, normalizeLon, MAX_VIA, isPointLabel, pointLabel } from "../app/state.js";
import { catalogSites, shortName, searchSites } from "../app/catalog.js";
import { skyTime, setLookAheadSource } from "../app/sky_panel.js";
import { lookAheadDirection } from "./sky_ride.js";
import { planTrip, tripKey, tripProblems, onRouteProgress, RouteError, MAX_ROUTE_KM, routeTrack, waypointLetter, legAtDistance } from "./index.js";
import { makePlane, greatCircle } from "./terrain.js";
import { PRESETS } from "./presets.js";
import { newRouteFields, routeRequest, tripWaypoints } from "./app.js";
import { registerRouteCard, startPick, cancelPick, pickState, onPickChange } from "./pick.js";
import { showTripRoute, clearTripRoute, fitTrip, setRoverMarker, setTripStops, shownTrips } from "./globe_route.js";
import { icon as svgIcon } from "../app/icons.js";

// "Driver's view" (the sky panel's "ahead" track mode, in the timelapse bar's camera group): a trip's view faces the
// path's heading at the rover.
setLookAheadSource(lookAheadDirection);

/** Most points of a trip: the start, MAX_VIA stops and the end. */
const MAX_POINTS = MAX_VIA + 2;
const memory = new Map(); // scenario id -> its route while the trip is switched off (switching back restores it)
const adding = new Set(); // scenario ids with an empty "new end" row open
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

/** The catalog site at a point (within 1e-4°), or null. */
function siteAt(p) {
  if (!p) return null;
  const tol = 1e-4 + 1e-9;
  return catalogSites().find((x) => Math.abs(x.lat_deg - p.lat_deg) <= tol && Math.abs(normalizeLon(x.lon_deg - p.lon_deg)) <= tol) || null;
}
/** A point's name: its catalog place, else its coordinates ("89.44° S, 137.19° W"). */
export function pointName(p) {
  if (!p) return "";
  const site = siteAt(p);
  return site ? shortName(site) : `${fmtLat(p.lat_deg)}, ${fmtLon(normalizeLon(p.lon_deg))}`;
}

/** "−26.1, 3.7", "26.1 N 3.7 E", "26.1°N, 3.7°E" -> {lat_deg, lon_deg}, or null. */
export function parseLatLon(text) {
  const t = String(text || "").trim().replace(/[−–]/g, "-");
  const m = /^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i.exec(t);
  if (!m) return null;
  let lat = Number(m[1]), lon = Number(m[3]);
  if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 360)) return null;
  return { lat_deg: lat, lon_deg: normalizeLon(lon) };
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
    adding.delete(id);
    if (pickState()?.id === id) cancelPick();
    clearTripRoute(id);
    updateScenario(id, { route: null }, "structure");
    return;
  }
  const r = memory.get(id) || newRouteFields("viper");
  setActive(id);
  updateScenario(id, { route: { ...r } }, "structure");
  if (!Number.isFinite(r.end_lat_deg)) {
    // Like "Directions": the end row is ready for a search, and a click on the globe sets it.
    startPick(id, 1, "B, the end of the trip");
    requestAnimationFrame(() => document.querySelector(`#cards [data-id="${id}"] .trip-row[data-row="1"] .trip-input`)?.focus());
  }
}

// ---------------------------------------------------------------------------------------------
// The trip panel of a card.

const MODE_ICONS = {
  viper: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="9" width="14" height="5.5" rx="1.4"/><path d="M15.5 9V4.5M13.6 4.3h3.8"/><circle cx="7" cy="17.6" r="1.9"/><circle cx="11.5" cy="17.6" r="1.9"/><circle cx="16" cy="17.6" r="1.9"/></svg>',
  lrv: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 13.5h19M8 13.5V9.5h3M13.5 13.5V9.5h3M19 9.2a2.6 2.6 0 0 0-3.6 0"/><circle cx="6" cy="16.6" r="2.4"/><circle cx="18" cy="16.6" r="2.4"/></svg>',
  custom: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/><circle cx="9" cy="6" r="2" class="k"/><circle cx="15" cy="12" r="2" class="k"/><circle cx="8" cy="18" r="2" class="k"/></svg>',
};

/**
 * The trip section of a card (scenarios with a `route`): the points, the rover, the plan and its summary.
 * @param {object} s  C7 scenario with `route`
 */
export function buildTripPanel(s) {
  const id = s.id;
  const sec = el("section", { class: "trip", "aria-label": "Rover trip" });
  const rowsEl = el("ol", { class: "trip-stops", "aria-label": "Trip points" });
  const modesEl = el("div", { class: "trip-modes", role: "group", "aria-label": "Rover (travel mode)" });
  const noteEl = el("p", { class: "trip-note" });
  const optsEl = el("details", { class: "trip-opts" });
  const planEl = el("div", { class: "trip-plan", hidden: true },
    el("div", { class: "trip-bar" }, el("div", { class: "trip-bar-fill" })), el("span", { class: "trip-status", role: "status" }));
  const msgEl = el("p", { class: "scen-msg trip-msg", role: "alert", hidden: true });
  const sumEl = el("div", { class: "trip-sum", hidden: true, "aria-live": "polite" });
  const liveEl = el("p", { class: "trip-live", hidden: true });
  const detailsEl = el("details", { class: "trip-details", hidden: true });
  sec.append(rowsEl, modesEl, noteEl, optsEl, planEl, msgEl, sumEl, liveEl, detailsEl);

  let seq = 0;
  let mapDrawn = null; // the route the details map was drawn for
  const cur = () => getS(id) || s;

  // ---- points
  /** The rows after A: the trip's points (the end may be null) and an empty new end while adding. */
  const rowPoints = () => {
    const w = tripWaypoints(cur()).slice(1);
    if (adding.has(id) && w.at(-1)) w.push(null);
    return w;
  };
  /** Commit the rows (in order; empty rows are dropped) to the scenario's route: the last is the end. */
  const commitRows = (rows) => {
    const set = rows.filter(Boolean).slice(0, MAX_POINTS - 1);
    const r = { ...cur().route };
    const last = set.at(-1) || null;
    r.end_lat_deg = last ? round4(last.lat_deg) : null;
    r.end_lon_deg = last ? round4(last.lon_deg) : null;
    const via = set.slice(0, -1).map((p) => ({ lat_deg: round4(p.lat_deg), lon_deg: round4(p.lon_deg) }));
    if (via.length) r.via = via;
    else delete r.via;
    updateScenario(id, { route: r }, "field");
  };
  const setRow = (i, p) => {
    if (pickState()?.id === id) cancelPick(); // a point found by search ends "Choose on the globe"
    const rows = rowPoints();
    rows[i - 1] = p;
    if (rows.at(-1)) adding.delete(id);
    commitRows(rows);
    // Next: an empty row if any, else "+ Add stop".
    requestAnimationFrame(() => (sec.querySelector(".trip-row .trip-input:placeholder-shown") || sec.querySelector(".trip-add-btn"))?.focus());
  };
  const removeRow = (i) => {
    const rows = rowPoints();
    if (rows[i - 1] === null) adding.delete(id);
    rows.splice(i - 1, 1);
    if (pickState()?.id === id) cancelPick();
    commitRows(rows);
  };
  const moveUp = (i) => {
    const rows = rowPoints();
    if (i < 2 || !rows[i - 1] || !rows[i - 2]) return;
    [rows[i - 2], rows[i - 1]] = [rows[i - 1], rows[i - 2]];
    commitRows(rows);
    requestAnimationFrame(() => sec.querySelector(`.trip-row[data-row="${i - 1}"] .trip-up, .trip-row[data-row="${i - 1}"] .trip-input`)?.focus());
  };
  const reverse = () => {
    const s0 = cur();
    const w = tripWaypoints(s0);
    if (w.some((p) => !p)) return;
    const rev = [...w].reverse();
    const a = rev[0];
    const site = siteAt(a);
    const oldSite = siteAt(w[0]);
    const autoName = !s0.label || isPointLabel(s0.label) || (oldSite && s0.label === shortName(oldSite));
    const r = { ...s0.route, end_lat_deg: rev.at(-1).lat_deg, end_lon_deg: rev.at(-1).lon_deg };
    const via = rev.slice(1, -1);
    if (via.length) r.via = via.map((p) => ({ ...p }));
    else delete r.via;
    // The times stay (the trip is driven the other way, not moved to another place).
    updateScenario(id, {
      lat_deg: a.lat_deg, lon_deg: a.lon_deg, site_id: site ? site.id : null, route: r,
      ...(autoName ? { label: site ? shortName(site) : pointLabel(a.lat_deg, a.lon_deg) } : {}),
      t_start_utc: s0.t_start_utc, t_end_utc: s0.t_end_utc, ...(s0.t_src ? { t_src: s0.t_src } : {}),
    }, "structure");
  };
  const addRow = () => {
    adding.add(id);
    renderRows();
    const n = rowPoints().length;
    startPick(id, n, `${waypointLetter(n)}, the new end`);
    requestAnimationFrame(() => sec.querySelector(`.trip-row[data-row="${n}"] .trip-input`)?.focus());
  };

  function renderRows() {
    const s1 = cur();
    const rows = rowPoints();
    if (!rows.length) rows.push(null);
    const start = tripWaypoints(s1)[0];
    const items = [el("li", { class: "trip-row is-start", "data-row": "0" },
      el("span", { class: "trip-mk start", "aria-hidden": "true", text: "A" }),
      el("span", { class: "trip-start" }, el("b", { text: start ? pointName(start) : "Choose the start: the globe or the coordinates above" }), el("small", { text: "start: this card's place" })),
      start && rows.every(Boolean)
        ? el("button", { type: "button", class: "icon-btn trip-rev", title: "Reverse the trip", "aria-label": "Reverse the trip", text: "⇅", onclick: reverse })
        : null)];
    rows.forEach((p, k) => items.push(pointRow(k + 1, p, k === rows.length - 1, rows)));
    const canAdd = rows.every(Boolean) && rows.length + 1 < MAX_POINTS;
    if (canAdd) {
      items.push(el("li", { class: "trip-add" },
        el("button", { type: "button", class: "trip-add-btn", text: "+ Add stop", title: "Drive on from the end to another point", onclick: addRow })));
    }
    rowsEl.replaceChildren(...items);
    syncPickMarks();
  }

  /** One point row: its letter, a search box (places in reach, coordinates, "Choose on the globe"), ↑ and ✕. */
  function pointRow(i, p, isEnd, rows) {
    const L = waypointLetter(i);
    const what = isEnd ? "the end" : "a stop";
    const listId = `trip-${id}-${i}`;
    const input = el("input", {
      type: "search", class: "trip-input", role: "combobox", "aria-expanded": "false", "aria-controls": listId,
      "aria-autocomplete": "list", autocomplete: "off", spellcheck: "false", value: p ? pointName(p) : "",
      placeholder: isEnd ? "Choose the end: search or click the globe" : "Choose a stop",
      "aria-label": `Point ${L}, ${what}: search a place, type coordinates, or choose on the globe`,
    });
    const list = el("ul", { class: "picker-list trip-list", id: listId, role: "listbox", hidden: true, tabindex: "-1" });
    const prev = () => (i === 1 ? tripWaypoints(cur())[0] : rows[i - 2]);
    let opts = [];
    let sel = -1;
    const close = () => {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    };
    const open = () => {
      const q = input.value.trim();
      const shownName = p ? pointName(p) : "";
      const query = q === shownName ? "" : q;
      const from = prev();
      opts = [];
      const coord = parseLatLon(query);
      if (coord) opts.push({ kind: "coord", p: coord, name: `Use ${fmtLat(coord.lat_deg)}, ${fmtLon(coord.lon_deg)}`, meta: from ? `${km(greatCircle(from, coord).dist_m)} from ${waypointLetter(i - 1)}` : "" });
      const tap = window.matchMedia?.("(pointer: coarse)")?.matches;
      opts.push({ kind: "pick", name: "Choose on the globe", meta: `the next ${tap ? "tap" : "click"} on the Moon sets it` });
      // Places in reach of the previous point, nearest first; a search ranks an exact name first, then places in reach,
      // nearest first. The previous point itself is not offered.
      const ql = query.toLowerCase();
      const near = (query ? searchSites(query, catalogSites()) : catalogSites()).map((site) => {
        const d = from ? greatCircle(from, site).dist_m : NaN;
        const exact = !!ql && (site.name.toLowerCase() === ql || shortName(site).toLowerCase() === ql);
        return { site, d, exact, reach: Number.isFinite(d) && d <= MAX_ROUTE_KM * 1000 };
      }).filter((x) => !(x.d <= 1) && (query || x.reach));
      near.sort((a, b) => (b.exact - a.exact) || (b.reach - a.reach) || ((a.d || 0) - (b.d || 0)));
      for (const { site, d } of near.slice(0, 12)) {
        const far = Number.isFinite(d) && d > MAX_ROUTE_KM * 1000;
        opts.push({
          kind: "site", p: { lat_deg: site.lat_deg, lon_deg: site.lon_deg }, name: site.name, disabled: far,
          // The kind tells apart places of the same name (the Malapert Massif region and place of interest).
          meta: [site.kind === "candidate" ? "Potential Artemis site" : site.kind === "home" ? "Home base" : "",
            Number.isFinite(d) ? `${km(d)} from ${waypointLetter(i - 1)}${far ? ` · too far for one leg (max ${MAX_ROUTE_KM} km)` : ""}` : ""].filter(Boolean).join(" · "),
        });
      }
      sel = opts.findIndex((o) => !o.disabled && o.kind !== "pick");
      if (sel < 0) sel = 0;
      const lis = opts.map((o, k) => {
        const li = el("li", {
          class: `picker-item trip-opt${o.kind === "pick" ? " is-pick" : ""}`, role: "option", id: `${listId}-${k}`,
          "aria-selected": k === sel ? "true" : "false", "aria-disabled": o.disabled ? "true" : null,
        }, el("div", { class: "pi-name" }, o.kind === "pick" ? el("span", { class: "ico pi-ico", "aria-hidden": "true", html: svgIcon("pin") }) : null, o.name), o.meta ? el("div", { class: "pi-meta", text: o.meta }) : null);
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          choose(k);
        });
        return li;
      });
      if (!query && !near.length) {
        lis.push(el("li", { class: "picker-empty", text: `No catalog place within ${MAX_ROUTE_KM} km of ${waypointLetter(i - 1)}. Click the globe, or type coordinates such as ${from ? `${(from.lat_deg + (from.lat_deg > 0 ? -0.05 : 0.05)).toFixed(2)}, ${from.lon_deg.toFixed(2)}` : "26.08, 3.66"}.` }));
      }
      list.replaceChildren(...lis);
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      highlight();
    };
    const highlight = () => {
      list.querySelectorAll(".picker-item").forEach((li, k) => li.setAttribute("aria-selected", k === sel ? "true" : "false"));
      const c = list.querySelector(`#${CSS.escape(`${listId}-${sel}`)}`);
      if (c) {
        c.scrollIntoView({ block: "nearest" });
        input.setAttribute("aria-activedescendant", c.id);
      }
    };
    const choose = (k) => {
      const o = opts[k];
      if (!o || o.disabled) return;
      close();
      if (o.kind === "pick") {
        input.value = p ? pointName(p) : "";
        startPick(id, i, `${L}, ${what}`);
        document.getElementById("map-block")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        // With a mouse, the globe's "Search the Moon" box is ready too (its choice fills the row, pick.js).
        if (window.matchMedia("(pointer: fine)").matches) document.getElementById("globe-search")?.focus({ preventScroll: true });
        return;
      }
      input.value = pointName(o.p);
      setRow(i, o.p);
    };
    input.addEventListener("focus", open);
    input.addEventListener("input", open);
    input.addEventListener("blur", () => setTimeout(() => {
      close();
      if (document.activeElement !== input) input.value = p ? pointName(p) : "";
    }, 150));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) open(); sel = Math.min(opts.length - 1, sel + 1); highlight(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); highlight(); }
      else if (e.key === "Enter") {
        e.preventDefault();
        const coord = parseLatLon(input.value);
        if (coord && list.hidden) setRow(i, coord);
        else if (sel >= 0) choose(sel);
      } else if (e.key === "Escape" && !list.hidden) {
        e.preventDefault();
        e.stopPropagation();
        close();
        input.value = p ? pointName(p) : "";
      }
    });
    const up = i >= 2 && p && rows[i - 2]
      ? el("button", { type: "button", class: "icon-btn trip-up", title: `Move ${L} up`, "aria-label": `Move ${L} up`, text: "↑", onclick: () => moveUp(i) })
      : null;
    const rm = el("button", {
      type: "button", class: "icon-btn trip-rm", title: p ? `Remove ${L}` : "Remove this row", "aria-label": p ? `Remove point ${L}` : "Remove this empty row", html: svgIcon("close"),
      onclick: () => removeRow(i),
    });
    // The first row's ✕ with nothing else to remove: nothing to do.
    if (i === 1 && rows.length === 1 && !p) rm.hidden = true;
    return el("li", { class: "trip-row", "data-row": String(i) },
      el("span", { class: `trip-mk${isEnd ? " end" : ""}`, "aria-hidden": "true", text: L }),
      el("div", { class: "trip-field" }, input, list), up, rm);
  }

  function syncPickMarks() {
    const pk = pickState();
    for (const li of rowsEl.querySelectorAll(".trip-row")) li.classList.toggle("picking", pk?.id === id && String(pk.row) === li.dataset.row);
  }

  // ---- rover (travel mode) and options
  function renderModes() {
    const r = cur().route || {};
    const preset = r.preset in PRESETS ? r.preset : "custom";
    const btn = (key, label, sub, tip) => el("button", {
      type: "button", class: "trip-mode", "data-mode": key, "aria-pressed": String(preset === key), title: tip,
      html: `${MODE_ICONS[key]}<span class="tm-text"><b></b><small></small></span>`,
      onclick: () => setMode(key),
    });
    const items = [
      btn("viper", "VIPER-class", `${PRESETS.viper.speed_mps} m/s`, PRESETS.viper.note),
      btn("lrv", "Apollo LRV", `${PRESETS.lrv.speed_mps} m/s`, PRESETS.lrv.note),
      btn("custom", "Custom", preset === "custom" ? `${fmtNum(r.speed_mps)} m/s` : "your limits", "Your own speed and slope limits (Speed, slopes and stops below)"),
    ];
    const texts = [["VIPER-class", `${PRESETS.viper.speed_mps} m/s · ≤ ${PRESETS.viper.max_slope_deg}°`], ["Apollo LRV", `${PRESETS.lrv.speed_mps} m/s · ≤ ${PRESETS.lrv.max_slope_deg}°`],
      ["Custom", preset === "custom" ? `${fmtNum(r.speed_mps)} m/s · ≤ ${fmtNum(r.max_slope_deg)}°` : "your limits"]];
    items.forEach((b, k) => {
      b.querySelector("b").textContent = texts[k][0];
      b.querySelector("small").textContent = texts[k][1];
    });
    modesEl.replaceChildren(...items);
    const p = PRESETS[preset];
    noteEl.textContent = p ? p.note : "Custom rover: your own speed and slope limits.";
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
    const parts = [
      el("div", { class: "trip-sum-main" },
        el("span", { class: "trip-mode-ico", "aria-hidden": "true", html: MODE_ICONS[s1.route?.preset in PRESETS ? s1.route.preset : "custom"] }),
        el("b", { class: "trip-time", text: formatDuration(total) }),
        el("span", { class: "trip-dist", text: `(${km(st.length_m)})` })),
      el("div", { class: "trip-sum-sub", text: arrive }),
      el("div", { class: "trip-sum-fine", text: [
        `${st.mean_speed_mps < 1 ? st.mean_speed_mps.toFixed(2) : st.mean_speed_mps.toFixed(1)} m/s on average`,
        `+${Math.round(st.climb_m)} / −${Math.round(st.descent_m)} m`,
        `steepest ${st.max_along_deg.toFixed(1)}°`,
        track.timeline.stops ? `${track.timeline.stops} rest stop${track.timeline.stops > 1 ? "s" : ""} (${formatDuration(rest)})` : "",
      ].filter(Boolean).join(" · ") }),
    ];
    if (legs) {
      parts.push(el("ol", { class: "trip-legs" }, ...legs.map((l, j) => el("li", {},
        el("span", { class: "tl-pts", text: `${waypointLetter(j)} → ${waypointLetter(j + 1)}` }),
        el("span", { text: `${km(l.length_m)} · ${formatDuration(l.drive_s * 1000)}` })))));
    }
    sumEl.replaceChildren(...parts);
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

  // Globe picks fill the armed row.
  const offPick = registerRouteCard(id, {
    onPoint: (row, lat, lon) => {
      setActive(id);
      setRow(row, { lat_deg: Math.round(lat * 1e4) / 1e4, lon_deg: Math.round(lon * 1e4) / 1e4 });
    },
  });
  const offPickMarks = onPickChange(syncPickMarks);
  panels.get(id)?.dispose();
  panels.set(id, {
    sec,
    refresh,
    live,
    dispose() {
      clearTimeout(planTimer);
      seq++;
      offPick();
      offPickMarks();
    },
  });
  refresh(true);
  return sec;
}

const round4 = (x) => Math.round(x * 1e4) / 1e4;

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
