// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Moon map: the globe picker (web/js/globe/) wired to the app store. Click or tap to place the selected scenario;
// scenario pins in their colours; catalog sites as small dots (click to load one).

import { createGlobe } from "../globe/globe.js";
import { store, subscribe, activeScenario, updateScenario, addScenario } from "./store.js";
import { colorHex, pointLabel, isPointLabel } from "./state.js";
import { catalogSites } from "./catalog.js";
import { applySite } from "./scenarios_ui.js";
import { consumeMapClick } from "../rover/pick.js";

let globe;
let lastFitKey = "";

export async function initMap() {
  globe = await createGlobe(document.getElementById("map"), {
    dataUrl: "data/moonmap/",
    // A rover traverse being picked (or selected) takes the click first (web/js/rover/pick.js).
    onPick: (lat, lon) => consumeMapClick(lat, lon) || placeActive(round(lat, 4), round(lon, 4)),
    onSite: (site) => {
      if (consumeMapClick(site.lat_deg, site.lon_deg)) return;
      let s = activeScenario();
      if (!s) s = addScenario({});
      applySite(s.id, site);
    },
  });
  drawSites();
  drawScenarios(true);
  subscribe((kind) => {
    if (kind === "structure") drawScenarios(true);
    else if (kind === "field" || kind === "label" || kind === "active" || kind === "ui") drawScenarios(false);
  });
  return globe;
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
  globe.setSites(
    catalogSites().map((site) => {
      const when = site.t_start_utc ? ` · ${site.t_start_utc.slice(0, 4)}` : "";
      const approx = site.kind === "candidate" ? " · approximate" : "";
      return {
        lat: site.lat_deg,
        lon: site.lon_deg,
        name: site.name,
        sub: `${site.agency || ""}${when}${approx} · click to load`.replace(/^ · /, ""),
        kind: site.kind,
        data: site,
      };
    }),
  );
}

function drawScenarios(fit) {
  const multi = store.scenarios.length > 1;
  const pins = [];
  store.scenarios.forEach((s, i) => {
    if (s.lat_deg === null || s.lon_deg === null || !Number.isFinite(s.lat_deg) || !Number.isFinite(s.lon_deg)) return;
    pins.push({
      lat: s.lat_deg,
      lon: s.lon_deg,
      color: colorHex(s.color, store.theme),
      label: s.label || `Scenario ${i + 1}`,
      active: multi && s.id === store.activeId,
    });
    // Rover traverse: a second pin at the end point.
    if (s.route && Number.isFinite(s.route.end_lat_deg) && Number.isFinite(s.route.end_lon_deg)) {
      pins.push({ lat: s.route.end_lat_deg, lon: s.route.end_lon_deg, color: colorHex(s.color, store.theme), label: `${s.label || `Scenario ${i + 1}`} (end)`, active: false });
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
