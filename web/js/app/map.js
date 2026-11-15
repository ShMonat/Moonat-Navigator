// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Moon map: the globe picker (web/js/globe/) wired to the app store, Google Maps style. Several places can be selected:
// a click on a catalog marker adds that site, a click on a selected pin removes it, a click on the ground drops a new
// pin, and a dropped pin can be dragged. Selected places are pins in their scenario colours; the other catalog sites
// are small markers in their kind colours. The search box, the place card and Home: places.js. Other modules reach
// the globe through globe_api.js (routes, fly-to, fit-to-points).

import { createGlobe } from "../globe/globe.js";
import { store, subscribe, setActive } from "./store.js";
import { colorHex } from "./state.js";
import { catalogSites, siteById } from "./catalog.js";
import { consumeMapClick } from "../rover/pick.js";
import { initPlaces, selectSite, dropPin, removePlace, movePlace, showPlaceCard } from "./places.js";
import { attachGlobe } from "./globe_api.js";
import { initMapLayers } from "./map_layers.js";

let globe;
let lastFitKey = "";
let lastSitesKey = null;

/** opts.hiResAfter: a promise that holds back the globe's full-resolution textures (see createGlobe). */
export async function initMap(opts = {}) {
  globe = await createGlobe(document.getElementById("map"), {
    dataUrl: "data/moonmap/",
    hiResAfter: opts.hiResAfter,
    // A rover traverse being picked (or selected) takes the click first (web/js/rover/pick.js).
    onPick: (lat, lon) => {
      if (consumeMapClick(lat, lon)) return;
      const s = dropPin(lat, lon);
      if (s) showPlaceCard({ id: s.id });
    },
    onSite: (site) => {
      if (consumeMapClick(site.lat_deg, site.lon_deg)) return;
      const s = selectSite(site);
      if (s) showPlaceCard({ id: s.id });
    },
    onPin: (pin) => {
      if (consumeMapClick(pin.lat, pin.lon)) return;
      // Shay's rule: a click on a selected place deselects it. A rover traverse's pins only select its card.
      if (pin.route) setActive(pin.id);
      else removePlace(pin.id);
    },
    onPinDrag: (pin, lat, lon) => movePlace(pin.id, lat, lon),
  });
  initPlaces(globe);
  initMapLayers(globe);
  attachGlobe(globe);
  drawSites();
  drawScenarios(true);
  subscribe((kind) => {
    if (kind === "structure") {
      drawSites();
      drawScenarios(true);
    } else if (kind === "field" || kind === "label" || kind === "active" || kind === "ui") {
      drawSites();
      drawScenarios(false);
    }
  });
  return globe;
}

/** Catalog sites as markers; a site that a scenario shows is hidden under its pin. */
function drawSites() {
  const selected = new Set(store.scenarios.filter((s) => s.site_id && !s.route).map((s) => s.site_id));
  const key = [...selected].sort().join(",");
  if (key === lastSitesKey) return;
  lastSitesKey = key;
  globe.setSites(
    catalogSites().map((site) => {
      const when = site.t_start_utc ? ` · ${site.t_start_utc.slice(0, 4)}` : "";
      const approx = site.kind === "candidate" ? " · approximate" : "";
      const who = site.kind === "home" ? "Home base" : site.agency || "";
      return {
        lat: site.lat_deg,
        lon: site.lon_deg,
        name: site.name,
        sub: `${who}${when}${approx} · click to add`.replace(/^ · /, ""),
        kind: site.kind,
        data: site,
        hidden: selected.has(site.id),
      };
    }),
  );
}

function drawScenarios(fit) {
  const multi = store.scenarios.length > 1;
  const pins = [];
  store.scenarios.forEach((s, i) => {
    if (s.lat_deg === null || s.lon_deg === null || !Number.isFinite(s.lat_deg) || !Number.isFinite(s.lon_deg)) return;
    const site = s.site_id ? siteById(s.site_id) : null;
    const label = s.label || `Scenario ${i + 1}`;
    const color = colorHex(s.color, store.theme);
    const custom = !s.site_id && !s.route;
    pins.push({
      lat: s.lat_deg,
      lon: s.lon_deg,
      color,
      label,
      sub: s.route ? "rover start" : custom ? "click to remove · drag to move" : "click to remove",
      active: multi && s.id === store.activeId,
      draggable: custom,
      glyph: site?.kind,
      data: { id: s.id, lat: s.lat_deg, lon: s.lon_deg, route: !!s.route },
    });
    // Rover traverse: a second pin at the end point.
    if (s.route && Number.isFinite(s.route.end_lat_deg) && Number.isFinite(s.route.end_lon_deg)) {
      pins.push({
        lat: s.route.end_lat_deg, lon: s.route.end_lon_deg, color, label: `${label} (end)`, sub: "rover end", active: false,
        draggable: false, data: { id: s.id, lat: s.route.end_lat_deg, lon: s.route.end_lon_deg, route: true },
      });
    }
  });
  globe.setPins(pins);
  const key = pins.map((p) => `${p.lat},${p.lon}`).join(";");
  if (fit && pins.length && key !== lastFitKey) {
    lastFitKey = key;
    globe.showPoints(pins);
  }
}

export function refreshMapSize() {
  if (globe) globe.resize();
}
