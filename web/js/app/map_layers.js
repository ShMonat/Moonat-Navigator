// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The globe's "Layers" control, as on a web map: a button in the globe's tool column opens a small panel with the
// base map (Imagery, Elevation, Plain: a radio group), then the overlays: the day/night shading at the selected time
// (web/js/globe/daylight.js, on by default), the grid lines (on), the contour lines (off) and the polar map layers of
// web/js/globe/layers.js (NASA's permanently shadowed regions and the most sunlit ground). The choice lives in the store
// (store.mapStyle, store.daylight, store.mapLayers; the share link keeps all three in "ml"). Turning a polar layer on while no pole is in
// view flies to the nearer pole, since those layers only have data poleward of 80°. The legend under the map lists
// what is on.

import { store, subscribe, setUi } from "./store.js";
import {
  LAYERS,
  LAYER_LIMIT_LAT,
  POLE_VIEW,
  setLayer,
  poleFor,
  BASE_MAPS,
  GRID_LAYER,
  CONTOUR_LAYER,
  ELEV_RAMP,
  normalizeStyle,
} from "../globe/layers.js";
import { DAYLIGHT_LAYER } from "../globe/daylight.js";
import { sunSpotIcon } from "./icons.js";

/** The Elevation colour scale as a CSS gradient (left = low). */
const RAMP_CSS = `linear-gradient(90deg, ${ELEV_RAMP.stops.join(", ")})`;

/** Stacked layers (24 x 24): the web-map "Layers" button. */
const LAYERS_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8 3.4 8.4 12 13l8.6-4.6z"/><path d="m3.4 12.3 8.6 4.6 8.6-4.6"/>' +
  '<path d="m3.4 16.1 8.6 4.6 8.6-4.6"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

let globe = null;
let btn = null;
let panel = null;
let status = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Fly to a pole at the zoom that shows its whole layer area. */
function goToPole(pole) {
  const v = POLE_VIEW[pole];
  globe.flyTo(v.lat, v.lon, v.zoom);
}

/** A layer was turned on: if neither pole's layer area is in view, go to the nearer pole and say why. */
function reveal() {
  if (globe.layerPoleInView()) return;
  const pole = poleFor(globe.getView().dir);
  goToPole(pole);
  status.textContent = `Layers show at the poles: going to the ${pole} pole.`;
}

function buildPanel() {
  const p = el("div", "glayers");
  p.id = "globe-layers";
  p.hidden = true;
  p.setAttribute("role", "group");
  p.setAttribute("aria-label", "Map layers");
  const head = el("div", "glayers-head");
  const close = el("button", "glayers-close");
  close.type = "button";
  close.innerHTML = CLOSE_ICON;
  close.setAttribute("aria-label", "Close map layers");
  close.addEventListener("click", () => open(false, true));
  head.append(el("span", "glayers-title", "Map layers"), close);
  p.append(head);

  // Base map: one of three, as on a web map, with the chosen one's note (and the height scale for Elevation).
  p.append(el("div", "glayers-sub", "Base map"));
  const group = el("div", "glayers-base");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Base map");
  for (const b of BASE_MAPS) {
    const opt = el("label", "glayers-base-opt");
    opt.dataset.base = b.id;
    const r = el("input");
    r.type = "radio";
    r.name = "globe-base-map";
    r.value = b.id;
    r.dataset.base = b.id;
    r.addEventListener("change", () => {
      if (r.checked) setStyle({ base: b.id });
    });
    opt.append(r, el("i", `glayers-base-icon base-${b.id}`), el("span", "glayers-base-name", b.label));
    group.append(opt);
  }
  const baseNote = el("div", "glayers-base-note");
  p.append(group, baseNote, el("div", "glayers-sep"), el("div", "glayers-sub", "Overlays"));

  // Overlays: day and night at the selected time, the grid, the contour lines (everywhere), then the polar layers.
  const day = layerRow(DAYLIGHT_LAYER, (box) => {
    status.textContent = "";
    setUi({ daylight: box.checked });
  });
  day.querySelector("input").dataset.daylight = "on";
  day.classList.add("glayer-day");
  const grid = layerRow(GRID_LAYER, (box) => setStyle({ grid: box.checked }));
  grid.querySelector("input").dataset.grid = "on";
  const contours = layerRow(CONTOUR_LAYER, (box) => setStyle({ contours: box.checked }));
  contours.querySelector("input").dataset.contours = "on";
  p.append(day, grid, contours, el("div", "glayers-sep"));
  for (const layer of LAYERS) {
    const row = layerRow(layer, (box) => {
      status.textContent = "";
      setUi({ mapLayers: setLayer(store.mapLayers, layer.id, box.checked) });
      if (box.checked) reveal();
    });
    row.querySelector("input").dataset.layer = layer.id;
    p.append(row);
  }

  const foot = el("div", "glayers-foot");
  foot.append(el("span", "", `Data poleward of ${LAYER_LIMIT_LAT}°. Go to:`));
  for (const pole of ["south", "north"]) {
    const b = el("button", "glayers-pole", `${pole === "south" ? "South" : "North"} pole`);
    b.type = "button";
    b.addEventListener("click", () => goToPole(pole));
    foot.append(b);
  }
  status = el("p", "glayers-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  p.append(foot, status);
  p.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation(); // the panel closes, not the full-window map
      open(false, true);
    }
  });
  return p;
}

/** Change part of the map style ({ base, grid, contours }) in the store. */
function setStyle(patch) {
  status.textContent = "";
  setUi({ mapStyle: normalizeStyle({ ...store.mapStyle, ...patch }) });
}

/** "+4", "−8", "0": a height in km for the scale. */
function kmText(km) {
  return km > 0 ? `+${km}` : km < 0 ? `−${-km}` : "0";
}

/** The Elevation colour scale: a bar with heights in km relative to the 1737.4 km reference sphere. */
function rampBar() {
  const wrap = el("span", "glayer-ramp");
  const bar = el("i", "glayer-ramp-bar");
  bar.style.setProperty("--ramp", RAMP_CSS);
  const ticks = el("span", "glayer-ramp-ticks");
  const [lo, hi] = ELEV_RAMP.rangeKm;
  for (const km of [lo, lo / 2, 0, hi / 2, hi]) ticks.append(el("span", "", kmText(km)));
  wrap.append(bar, ticks, el("span", "glayer-ramp-unit", "Height in km relative to the 1737.4 km reference sphere"));
  return wrap;
}

/** A panel row: a checkbox, the layer's name, its colour keys, note and source. onChange(box) runs on a change. */
function layerRow(layer, onChange) {
  const row = el("label", "glayer");
  const box = el("input");
  box.type = "checkbox";
  box.addEventListener("change", () => onChange(box));
  const body = el("span", "glayer-body");
  body.append(el("span", "glayer-name", layer.label));
  const keys = el("span", "glayer-keys");
  for (const [color, text] of layer.swatches) {
    const k = el("span", "glayer-key");
    const sw = el("i", "glayer-sw");
    sw.style.setProperty("--c", color);
    k.append(sw, text);
    keys.append(k);
  }
  if (layer.swatches.length) body.append(keys);
  body.append(el("span", "glayer-note", layer.note));
  if (layer.source) body.append(el("span", "glayer-src", layer.source));
  row.append(box, body);
  return row;
}

function open(on, focusButton = false) {
  panel.hidden = !on;
  btn.setAttribute("aria-expanded", String(on));
  btn.classList.toggle("open", on);
  if (!on) status.textContent = "";
  if (!on && focusButton) btn.focus({ preventScroll: true });
}

/** The globe, the panel, the button and the legend under the map follow store.mapLayers and store.daylight. */
function sync() {
  const on = store.mapLayers;
  const style = normalizeStyle(store.mapStyle);
  for (const box of panel.querySelectorAll("input[data-layer]")) box.checked = on.includes(box.dataset.layer);
  panel.querySelector("input[data-daylight]").checked = store.daylight;
  panel.querySelector("input[data-grid]").checked = style.grid;
  panel.querySelector("input[data-contours]").checked = style.contours;
  for (const r of panel.querySelectorAll("input[data-base]")) r.checked = r.dataset.base === style.base;
  const base = BASE_MAPS.find((b) => b.id === style.base);
  const note = panel.querySelector(".glayers-base-note");
  note.replaceChildren(el("span", "glayer-note", base.note));
  if (base.id === "elevation") note.append(rampBar());
  note.append(el("span", "glayer-src", base.source));
  const n = on.length + (style.contours ? 1 : 0) + (style.base !== "imagery" ? 1 : 0);
  btn.classList.toggle("has-layers", n > 0);
  btn.title = n ? `Map layers (${n} on)` : "Map layers";
  globe.setLayers(on).catch(() => {
    status.textContent = "The layer data could not load. Check the connection and try again.";
  });
  globe.setStyle(style).catch(() => {
    status.textContent = "The map data could not load. Check the connection and try again.";
  });
  const legend = document.querySelector(".map-legend");
  if (legend) {
    for (const li of legend.querySelectorAll(".lg-layer")) li.remove();
    if (style.base === "elevation") {
      const li = el("li", "lg-layer lg-ramp");
      const sw = el("span", "lg-ramp-bar");
      sw.setAttribute("aria-hidden", "true");
      sw.style.setProperty("--ramp", RAMP_CSS);
      const [lo, hi] = ELEV_RAMP.rangeKm;
      li.append(sw, `Height ${kmText(lo)} to ${kmText(hi)} km (re 1737.4 km)`);
      legend.append(li);
    }
    for (const layer of [DAYLIGHT_LAYER, CONTOUR_LAYER, ...LAYERS]) {
      if (layer === DAYLIGHT_LAYER ? !store.daylight : layer === CONTOUR_LAYER ? !style.contours : !on.includes(layer.id)) {
        continue;
      }
      for (const [color, text] of layer.swatches) {
        const li = el("li", "lg-layer");
        // The sunlight classes: the globe's sun marker in the class colour (icons.js sunSpotIcon); else a colour patch.
        const sun = layer.id === "sun";
        const sw = el("span", sun ? "lg lg-sun" : "lg lg-area");
        sw.setAttribute("aria-hidden", "true");
        if (sun) sw.innerHTML = sunSpotIcon(color);
        else sw.style.setProperty("--c", color);
        li.append(sw, text);
        legend.append(li);
      }
    }
  }
}

/** Add the Layers button and panel to the globe (web/js/app/map.js calls this once, after the Home button). */
export function initMapLayers(g) {
  globe = g;
  btn = g.addTool({ html: LAYERS_ICON, label: "Map layers", title: "Map layers", className: "globe-layers-btn" });
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "globe-layers");
  panel = buildPanel();
  btn.parentElement.append(panel);
  btn.addEventListener("click", (e) => {
    const on = panel.hidden;
    open(on);
    // From the keyboard, focus the first choice.
    if (on && e.detail === 0) panel.querySelector("input")?.focus({ preventScroll: true });
  });
  // A press anywhere else (the globe, the page) closes the panel, as on a web map.
  document.addEventListener("pointerdown", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) open(false);
  });
  subscribe((kind, detail) => {
    if (kind === "ui" && ("mapLayers" in detail || "daylight" in detail || "mapStyle" in detail)) sync();
  });
  sync();
}
