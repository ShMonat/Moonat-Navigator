// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Places on the Moon globe, the Google Maps way:
//   - "Search the Moon": one search box floating on the globe. Focused and empty it lists Home (StarHab), the missions,
//     the Artemis III candidate regions and the places of interest; typing filters them; typed coordinates offer
//     "Go to …". A choice flies the globe there, selects the place and opens its place card.
//   - The place card (bottom of the map): name, kind, coordinates, blurb, and Remove (or Add).
//   - The Home button (house icon) flies to the home base.
//   - The selection actions the map uses: a catalog pin or a search result adds a place, a selected pin removes it, a
//     click on the ground drops a new pin, a dragged pin moves.
// Each selected place is one scenario (contract C7) in the store, so the scenario cards stay in step both ways.
// Pure helpers (coordinates, the result list): place_search.js.

import { store, subscribe, removeScenario, updateScenario, setActive, setScenarios, activeScenario } from "./store.js";
import { colorHex, pointLabel, isPointLabel, PALETTE } from "./state.js";
import { catalogSites, siteById, shortName, scenarioFieldsFromSite, HOME_SITE_ID } from "./catalog.js";
import { applySite, clearAll } from "./scenarios_ui.js";
import { placeResults, siteSubtitle, fmtSigned, fmtHemi, KIND_ONE } from "./place_search.js";
import { HOUSE_PATH } from "../globe/globe.js";

/** Most places the map selects at once (one per palette colour). "+ Add location" in the cards has no limit. */
export const MAX_PLACES = PALETTE.dark.length;

let globe = null;

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

const hasPlace = (s) => Number.isFinite(s.lat_deg) && Number.isFinite(s.lon_deg);
const round4 = (x) => Math.round(x * 1e4) / 1e4;
const houseSvg = (cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${HOUSE_PATH}"/></svg>`;

// ---------------------------------------------------------------------------------------------
// Selection actions

/** The scenario showing catalog site `siteId` (not a rover traverse), or null. */
export function scenarioOfSite(siteId) {
  return store.scenarios.find((s) => s.site_id === siteId && !s.route) || null;
}

/** The times a new place takes: the selected scenario's, else the first scenario with a start (as "+ Add location"). */
function sharedTimes() {
  const src = [activeScenario(), ...store.scenarios].find((s) => s && s.t_start_utc);
  return { t_start_utc: src?.t_start_utc || null, t_end_utc: src?.t_end_utc || null };
}

/** An empty card (no place yet, not a rover traverse) that a new place fills instead of adding a card. */
function emptyScenario() {
  const s = activeScenario();
  if (s && !hasPlace(s) && !s.route) return s;
  return store.scenarios.find((x) => !hasPlace(x) && !x.route) || null;
}

function isFull() {
  return store.scenarios.filter(hasPlace).length >= MAX_PLACES;
}

/**
 * Append a scenario and select it, without moving the page: a place picked on the map stays in view (the store's
 * addScenario would scroll the new card into view and focus it, which is right for "+ Add location").
 */
function appendScenario(partial) {
  setScenarios([...store.scenarios, partial]);
  const s = store.scenarios[store.scenarios.length - 1];
  setActive(s.id);
  return s;
}

function fullToast() {
  toast(`Up to ${MAX_PLACES} places on the map at once. Click a selected pin to remove one.`);
}

/**
 * Select a catalog site. A site already shown becomes the selected card; otherwise it fills an empty card or is added
 * as a new scenario (missions bring their landing-to-liftoff times; other sites take the selected scenario's times).
 * Returns the scenario, or null when the map is full.
 */
export function selectSite(site) {
  const have = scenarioOfSite(site.id);
  if (have) {
    setActive(have.id);
    return have;
  }
  const empty = emptyScenario();
  if (empty) {
    applySite(empty.id, site);
    setActive(empty.id);
    return empty;
  }
  if (isFull()) {
    fullToast();
    return null;
  }
  // One complete scenario in one step (applySite's fields), so the new card does not grab the focus.
  const f = scenarioFieldsFromSite(site);
  const patch = { label: f.label, site_id: f.site_id, lat_deg: f.lat_deg, lon_deg: f.lon_deg };
  if (f.t_start_utc) {
    patch.t_start_utc = f.t_start_utc;
    patch.t_end_utc = f.t_end_utc;
  }
  return appendScenario({ ...sharedTimes(), ...patch });
}

/** Drop a pin at a custom point (lat, east lon, deg): fills an empty card or adds a scenario. Returns it, or null. */
export function dropPin(lat, lon) {
  lat = round4(lat);
  lon = round4(lon);
  const empty = emptyScenario();
  if (empty) {
    // A name the user typed is kept; an automatic one follows the place.
    const keep = empty.label && !isPointLabel(empty.label);
    updateScenario(empty.id, { lat_deg: lat, lon_deg: lon, site_id: null, label: keep ? empty.label : pointLabel(lat, lon) }, "field", { external: true });
    setActive(empty.id);
    return empty;
  }
  if (isFull()) {
    fullToast();
    return null;
  }
  return appendScenario({ ...sharedTimes(), lat_deg: lat, lon_deg: lon, site_id: null, label: pointLabel(lat, lon) });
}

/** Move a dropped pin (a custom point) to lat, east lon (deg). Catalog places and rover traverses do not move. */
export function movePlace(id, lat, lon) {
  const s = store.scenarios.find((x) => x.id === id);
  if (!s || s.site_id || s.route) return;
  lat = round4(lat);
  lon = round4(lon);
  const keep = s.label && !isPointLabel(s.label);
  updateScenario(id, { lat_deg: lat, lon_deg: lon, label: keep ? s.label : pointLabel(lat, lon) }, "field", { external: true });
  setActive(id);
  if (card?.id === id) renderCard();
}

/** Remove a place (its scenario); the last one leaves an empty card that keeps its times. A toast offers Undo. */
export function removePlace(id) {
  const s = store.scenarios.find((x) => x.id === id);
  if (!s) return;
  const before = store.scenarios.map((x) => structuredClone(x));
  const activeBefore = store.activeId;
  if (store.scenarios.length > 1) removeScenario(id);
  else clearAll();
  toast(`Removed ${s.label || "the place"}.`, {
    label: "Undo",
    run: () => {
      setScenarios(before);
      if (before.some((x) => x.id === activeBefore)) setActive(activeBefore);
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Toast with an optional action (the page's #toast element)

let toastTimer = 0;
let toastStructureOff = null;
function toast(msg, action = null) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.replaceChildren(el("span", { text: msg }));
  if (action) {
    const b = el("button", { type: "button", class: "toast-action", text: action.label });
    b.addEventListener("click", () => {
      t.hidden = true;
      clearTimeout(toastTimer);
      action.run();
    });
    t.append(" ", b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 6000 : 3200);
  // An Undo only applies to the state it was offered for: the next change of places hides it.
  toastStructureOff?.();
  toastStructureOff = null;
  if (action) {
    toastStructureOff = subscribe((kind) => {
      if (kind !== "structure") return;
      if (t.querySelector(".toast-action")) t.hidden = true;
      toastStructureOff?.();
      toastStructureOff = null;
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Flying the globe to a place

function zoomFor(lat) {
  return Math.abs(lat) > 80 ? 5 : 3.5;
}

/** Fly to a place, landing it in the middle of the map area the controls and the place card leave free. */
function flyToPlace(lat, lon) {
  globe?.flyTo(lat, lon, zoomFor(lat), { avoidControls: true });
}

// ---------------------------------------------------------------------------------------------
// Place card

let card = null; // { id: scenario id } (a selected place) or { siteId } (a catalog place shown, not selected)
let cardEl = null;

/** Show the place card of a scenario (by id) or, unselected, of a catalog site (by site id). */
export function showPlaceCard(target) {
  card = target;
  renderCard();
}

export function closePlaceCard() {
  card = null;
  renderCard();
}

function cardKind(s, site) {
  if (site) {
    const year = site.t_start_utc ? ` · ${site.t_start_utc.slice(0, 4)}` : "";
    const agency = site.kind === "mission" && site.agency ? ` · ${site.agency}` : "";
    return `${KIND_ONE[site.kind] || "Place"}${agency}${year}${site.kind === "candidate" ? " · approximate point" : ""}`;
  }
  if (s?.route) return "Rover traverse (start)";
  return "Dropped pin · drag it to move";
}

function renderCard() {
  if (!cardEl) return;
  let s = card?.id ? store.scenarios.find((x) => x.id === card.id) : null;
  if (card?.id && (!s || !hasPlace(s))) card = null;
  if (card?.siteId) s = scenarioOfSite(card.siteId);
  const site = s ? (s.site_id ? siteById(s.site_id) : null) : card?.siteId ? siteById(card.siteId) : null;
  if (!card || (!s && !site)) {
    cardEl.hidden = true;
    globe?.element.classList.remove("has-card");
    return;
  }
  const lat = s ? s.lat_deg : site.lat_deg;
  const lon = s ? s.lon_deg : site.lon_deg;
  const name = s?.label || (site ? shortName(site) : pointLabel(lat, lon));
  const kind = site?.kind || "pin";
  const ico = el("span", { class: `gplace-ico k-${kind}${s ? " sel" : ""}`, "aria-hidden": "true", html: kind === "home" ? houseSvg() : "" });
  if (s) ico.style.setProperty("--c", colorHex(s.color, store.theme));
  const close = el("button", { type: "button", class: "gplace-close", "aria-label": "Close the place card", title: "Close", text: "✕" });
  close.addEventListener("click", closePlaceCard);
  const act = el("button", { type: "button", class: `gplace-btn ${s ? "gplace-remove" : "gplace-add"}`, text: s ? "Remove" : "Add place" });
  act.addEventListener("click", () => {
    if (s) {
      removePlace(s.id);
      return;
    }
    const added = selectSite(site);
    if (added) showPlaceCard({ id: added.id });
  });
  const blurb = site?.blurb || (s && !site ? "A point you chose. Its terrain loads live from NASA Moon Trek." : "");
  cardEl.replaceChildren(
    el("div", { class: "gplace-head" }, ico,
      el("div", { class: "gplace-title" },
        el("h3", { class: "gplace-name", text: name }),
        el("p", { class: "gplace-kind", text: cardKind(s, site) })),
      close),
    el("div", { class: "gplace-row" },
      el("p", { class: "gplace-coords", text: `${fmtHemi(lat, lon, 3)}${s ? "" : " · not selected"}` }), act),
    blurb ? el("p", { class: "gplace-blurb", text: blurb }) : null,
  );
  cardEl.hidden = false;
  cardEl.dataset.kind = kind;
  globe?.element.classList.add("has-card");
  globe?.element.style.setProperty("--card-h", `${cardEl.offsetHeight}px`);
}

// ---------------------------------------------------------------------------------------------
// "Search the Moon"

let searchSeq = 0;

function buildSearch() {
  const id = `gs${++searchSeq}`;
  const input = el("input", {
    type: "search", id: "globe-search", class: "gsearch-input", placeholder: "Search the Moon", autocomplete: "off", spellcheck: "false",
    role: "combobox", "aria-expanded": "false", "aria-controls": id, "aria-autocomplete": "list",
    "aria-label": "Search the Moon: missions, Artemis III regions, places, or coordinates such as 89.5S 130E",
    enterkeyhint: "go",
  });
  const icon = el("span", { class: "gsearch-ico", "aria-hidden": "true", html: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.2"/><path d="M15.2 15.2 20 20"/></svg>' });
  const clear = el("button", { type: "button", class: "gsearch-clear", "aria-label": "Clear the search", title: "Clear", text: "✕", hidden: true });
  const list = el("ul", { class: "gsearch-list", id, role: "listbox", "aria-label": "Places", hidden: true, tabindex: "-1" });
  const wrap = el("div", { class: "gsearch", role: "search" }, el("div", { class: "gsearch-box" }, icon, input, clear), list);

  let items = [];
  let sel = -1;

  const option = (i, cls, ico, name, sub, selected) => {
    const li = el("li", { class: `gs-item ${cls}`, role: "option", id: `${id}-${i}`, "aria-selected": "false" },
      ico,
      el("span", { class: "gs-text" }, el("span", { class: "gs-name", text: name }), sub ? el("span", { class: "gs-sub", text: sub }) : null),
      selected ? el("span", { class: "gs-on", title: "On the map", "aria-label": "selected", html: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.4l3 3 6.6-7"/></svg>' }) : null);
    if (selected) li.style.setProperty("--c", selected);
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      choose(i);
    });
    return li;
  };
  const kindIco = (kind) => el("span", { class: `gs-ico k-${kind}`, "aria-hidden": "true", html: kind === "home" ? houseSvg() : "" });
  const selColor = (site) => {
    const s = scenarioOfSite(site.id);
    return s ? colorHex(s.color, store.theme) : null;
  };

  const open = () => {
    const r = placeResults(input.value, catalogSites());
    items = [];
    const nodes = [];
    if (r.coords) {
      const { lat, lon } = r.coords;
      items.push({ type: "coords", lat, lon });
      nodes.push(option(0, "gs-coords", el("span", { class: "gs-ico k-pin", "aria-hidden": "true" }), `Go to ${fmtSigned(lat, lon)}`, `${fmtHemi(lat, lon)} · drop a pin here`, null));
    }
    if (r.home) {
      items.push({ type: "site", site: r.home });
      nodes.push(option(items.length - 1, "gs-home", kindIco("home"), "Home", `${shortName(r.home)} · ${siteSubtitle(r.home)}`, selColor(r.home)));
    }
    for (const g of r.groups) {
      nodes.push(el("li", { class: "gs-group", role: "presentation", text: g.label }));
      for (const site of g.sites) {
        items.push({ type: "site", site });
        nodes.push(option(items.length - 1, "", kindIco(site.kind), site.name, siteSubtitle(site), selColor(site)));
      }
    }
    if (!items.length) nodes.push(el("li", { class: "gs-empty", role: "presentation", text: "No match. Try “Apollo”, “pole”, a crew name, or coordinates like 89.5S 130E." }));
    list.replaceChildren(...nodes);
    // Typed text: the first result is ready for Enter (as in a web map); the empty list waits for the arrow keys.
    sel = input.value.trim() && items.length ? 0 : -1;
    highlight();
    // The list fits inside the globe, under the box.
    const host = globe?.element;
    if (host) list.style.maxHeight = `${Math.max(140, host.clientHeight - (wrap.offsetTop + wrap.offsetHeight) - 18)}px`;
    list.hidden = false;
    list.scrollTop = 0;
    input.setAttribute("aria-expanded", "true");
    wrap.classList.add("open");
    clear.hidden = !input.value;
  };
  const close = () => {
    list.hidden = true;
    wrap.classList.remove("open");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const highlight = () => {
    list.querySelectorAll(".gs-item").forEach((li, i) => li.setAttribute("aria-selected", i === sel ? "true" : "false"));
    const cur = sel >= 0 ? list.querySelector(`#${id}-${sel}`) : null;
    if (cur) {
      cur.scrollIntoView({ block: "nearest" });
      input.setAttribute("aria-activedescendant", cur.id);
    } else input.removeAttribute("aria-activedescendant");
  };
  const choose = (i) => {
    const it = items[i];
    if (!it) return;
    close();
    input.value = "";
    clear.hidden = true;
    input.blur();
    // The card first, so the flight lands the place above it.
    if (it.type === "coords") {
      const s = dropPin(it.lat, it.lon);
      if (s) showPlaceCard({ id: s.id });
      flyToPlace(it.lat, it.lon);
      return;
    }
    const s = selectSite(it.site);
    showPlaceCard(s ? { id: s.id } : { siteId: it.site.id });
    flyToPlace(it.site.lat_deg, it.site.lon_deg);
  };

  input.addEventListener("focus", open);
  input.addEventListener("input", open);
  input.addEventListener("blur", () => setTimeout(() => {
    if (document.activeElement !== input) close();
  }, 150));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (list.hidden) open();
      sel = Math.min(items.length - 1, sel + 1);
      highlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(0, sel - 1);
      highlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (sel >= 0) choose(sel);
    } else if (e.key === "Escape") {
      // First Esc closes the list, the second leaves the box (and never closes the enlarged map).
      e.stopPropagation();
      if (!list.hidden) close();
      else input.blur();
    }
  });
  clear.addEventListener("click", () => {
    input.value = "";
    input.focus();
    open();
  });
  // Results change with the selection (the check marks) and the theme (their colours).
  subscribe((kind) => {
    if (!list.hidden && (kind === "structure" || kind === "ui")) open();
  });
  return wrap;
}

// ---------------------------------------------------------------------------------------------
// Home

/** Fly to the home base and show its place card (with "Add place" when it is not selected yet). */
export function goHome() {
  const home = siteById(HOME_SITE_ID);
  if (!home) return;
  const s = scenarioOfSite(home.id);
  showPlaceCard(s ? { id: s.id } : { siteId: home.id });
  flyToPlace(home.lat_deg, home.lon_deg);
}

// ---------------------------------------------------------------------------------------------
// Wiring

/** Put the search box, the place card and the Home button on the globe (web/js/app/map.js calls this once). */
export function initPlaces(g) {
  globe = g;
  g.slots.top.append(buildSearch());
  cardEl = el("section", { class: "gplace", "aria-label": "Place", "aria-live": "polite", hidden: true });
  cardEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closePlaceCard();
    }
  });
  g.slots.bottom.append(cardEl);
  if (siteById(HOME_SITE_ID)) {
    g.addTool({
      html: houseSvg("home-ico"), label: "Home: StarHab", title: "Home: StarHab, our lunar base concept",
      className: "globe-home", onClick: goHome,
    });
  }
  // The card follows its place: renamed, moved, recoloured, or gone (removed in the cards or on the map).
  subscribe((kind) => {
    if (card && kind !== "active") renderCard();
  });
  new ResizeObserver(() => {
    if (card && cardEl && !cardEl.hidden) g.element.style.setProperty("--card-h", `${cardEl.offsetHeight}px`);
  }).observe(cardEl);
}
