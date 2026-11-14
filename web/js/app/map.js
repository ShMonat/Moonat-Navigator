// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Moon map: Leaflet with NASA Moon Trek WMTS tiles (LRO WAC global mosaic, equirectangular).
// Click to place the selected scenario; scenario markers in their colours; catalog sites as small dots.

import * as L from "leaflet";
import { store, subscribe, activeScenario, updateScenario, addScenario } from "./store.js";
import { colorHex, fmtLat, fmtLon, pointLabel, isPointLabel } from "./state.js";
import { catalogSites } from "./catalog.js";
import { applySite } from "./scenarios_ui.js";

// Used when web/data/maptiles.json is missing (same layer as the catalog's config).
const DEFAULT_TILES = {
  url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg",
  tileSize: 256,
  minZoom: 0,
  maxZoom: 8,
  attribution: "Imagery: NASA/GSFC/Arizona State University (LRO WAC), via NASA Moon Trek",
};

let map;
let scenarioLayer;
let siteLayer;
let lastFitKey = "";

export async function initMap() {
  let cfg = DEFAULT_TILES;
  try {
    const r = await fetch("data/maptiles.json");
    if (r.ok) {
      const j = await r.json();
      const layer = (Array.isArray(j.layers) && j.layers[0]) || j;
      if (layer && layer.url) cfg = { ...DEFAULT_TILES, ...layer };
    }
  } catch {
    /* keep the default */
  }

  const bounds = L.latLngBounds([-90, -180], [90, 180]);
  map = L.map("map", {
    crs: L.CRS.EPSG4326, // Moon Trek EQ tiles: 2 x 1 tiles at zoom 0, the same grid as Leaflet's EPSG:4326
    center: [0, 0],
    zoom: 0,
    minZoom: -1,
    maxZoom: (cfg.maxZoom ?? 8) + 2,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    maxBounds: bounds,
    maxBoundsViscosity: 1,
    worldCopyJump: false,
    attributionControl: true,
  });
  map.attributionControl.setPrefix(false);
  // Touch screens: one finger scrolls the page (the map is as wide as the screen), two fingers pinch and move the map.
  if (window.matchMedia?.("(pointer: coarse)").matches) map.dragging.disable();
  L.tileLayer(cfg.url, {
    tileSize: cfg.tileSize || 256,
    minNativeZoom: cfg.minZoom ?? 0,
    maxNativeZoom: cfg.maxZoom ?? 8,
    noWrap: true,
    bounds,
    attribution: cfg.attribution,
  }).addTo(map);
  map.fitBounds(bounds);

  siteLayer = L.layerGroup().addTo(map);
  scenarioLayer = L.layerGroup().addTo(map);

  // Live coordinates under the cursor.
  const Coords = L.Control.extend({
    options: { position: "bottomleft" },
    onAdd() {
      const div = L.DomUtil.create("div", "map-coords");
      div.hidden = true;
      return div;
    },
  });
  const coords = new Coords().addTo(map);
  map.on("mousemove", (e) => {
    const c = coords.getContainer();
    c.hidden = false;
    c.textContent = `${fmtLat(e.latlng.lat, 2)}, ${fmtLon(wrapLon(e.latlng.lng), 2)}`;
  });
  map.on("mouseout", () => (coords.getContainer().hidden = true));

  map.on("click", (e) => {
    const lat = Math.max(-90, Math.min(90, e.latlng.lat));
    const lon = wrapLon(e.latlng.lng);
    placeActive(round(lat, 4), round(lon, 4));
  });

  drawSites();
  drawScenarios(true);
  subscribe((kind) => {
    if (kind === "structure") drawScenarios(true);
    else if (kind === "field" || kind === "label" || kind === "active" || kind === "ui") drawScenarios(false);
  });
  // The side panel may change size after layout.
  setTimeout(() => map.invalidateSize(), 200);
  return map;
}

function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}
function round(x, d) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

/** Put the selected scenario (or a new one) at a clicked point. It becomes a custom point. */
function placeActive(lat, lon) {
  let s = activeScenario();
  if (!s) s = addScenario({});
  // A name the user typed is kept; a catalog name or an automatic point name follows the new place.
  const keepLabel = s.label && !s.site_id && !isPointLabel(s.label);
  updateScenario(s.id, { lat_deg: lat, lon_deg: lon, site_id: null, label: keepLabel ? s.label : pointLabel(lat, lon) }, "field", { external: true });
}

function drawSites() {
  siteLayer.clearLayers();
  for (const site of catalogSites()) {
    const isMission = site.kind === "mission";
    const m = L.circleMarker([site.lat_deg, site.lon_deg], {
      radius: isMission ? 3.5 : 3,
      weight: 1,
      color: "rgba(0,0,0,0.6)",
      fillColor: isMission ? "#f2efe6" : "#9fc1ff",
      fillOpacity: 0.9,
      className: "site-dot",
    });
    const when = site.t_start_utc ? ` · ${site.t_start_utc.slice(0, 4)}` : "";
    const approx = site.kind === "candidate" ? " · approximate" : "";
    m.bindTooltip(`${escapeHtml(site.name)}<br><small>${escapeHtml(site.agency || "")}${when}${approx} · click to load</small>`, { direction: "top", offset: [0, -4] });
    m.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      let s = activeScenario();
      if (!s) s = addScenario({});
      applySite(s.id, site);
    });
    m.addTo(siteLayer);
  }
}

function drawScenarios(fit) {
  scenarioLayer.clearLayers();
  const pts = [];
  store.scenarios.forEach((s, i) => {
    if (s.lat_deg === null || s.lon_deg === null || !Number.isFinite(s.lat_deg) || !Number.isFinite(s.lon_deg)) return;
    const active = s.id === store.activeId && store.scenarios.length > 1;
    const m = L.circleMarker([s.lat_deg, s.lon_deg], {
      radius: active ? 9 : 7,
      weight: active ? 3 : 2,
      color: "#ffffff",
      fillColor: colorHex(s.color, store.theme),
      fillOpacity: 1,
    });
    m.bindTooltip(escapeHtml(s.label || `Scenario ${i + 1}`), { direction: "top", offset: [0, -6] });
    m.on("click", (e) => L.DomEvent.stopPropagation(e));
    m.addTo(scenarioLayer);
    pts.push([s.lat_deg, s.lon_deg]);
  });
  const key = pts.map((p) => p.join(",")).join(";");
  if (fit && pts.length && key !== lastFitKey) {
    lastFitKey = key;
    if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 1.5), { animate: true });
    else map.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 3, animate: true });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function refreshMapSize() {
  if (map) map.invalidateSize();
}

