// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The Moon globe's API for other parts of the page (contract C8b `globe-view` in docs/CONTRACTS.md): route lines,
// fly-to and fit-to-points. Import from here, not from web/js/globe/: the globe loads late (web/js/app/map.js, after
// the first sky view), and calls made before it exists are kept and applied when it arrives (every route is drawn;
// the last flyTo or fitTo is played). This module has no imports, so it adds nothing to the page's first load.
//
// Coordinates: selenographic latitude and east-positive longitude in degrees (MOON_ME, docs/CONTRACTS.md §0).

let globe = null;
const routes = new Map(); // id -> [points, opts]
const dots = new Map(); // id -> marker
let pendingMove = null; // ["flyTo" | "fitTo", ...args]
const waiters = [];

/** web/js/app/map.js hands the globe over once it exists. */
export function attachGlobe(g) {
  globe = g;
  for (const [id, [points, opts]] of routes) g.showRoute(id, points, opts);
  for (const [id, m] of dots) g.setMarker(id, m);
  if (pendingMove) {
    const [fn, ...args] = pendingMove;
    pendingMove = null;
    g[fn](...args);
  }
  for (const w of waiters.splice(0)) w(g);
}

/** Resolves with the globe API (createGlobe's object) once the globe exists. */
export function globeReady() {
  return globe ? Promise.resolve(globe) : new Promise((resolve) => waiters.push(resolve));
}

/**
 * Draw or replace route `id`: a line along the great circles through points [{lat_deg, lon_deg}, ...], drawn just
 * above the surface and hidden where it passes behind the Moon. opts: { color: CSS colour (default the theme
 * accent), width: line width in CSS px (default 4) }.
 */
export function showRoute(id, points, opts = {}) {
  routes.set(String(id), [points, opts]);
  globe?.showRoute(id, points, opts);
}

/** Remove route `id` (no-op when there is none). */
export function clearRoute(id) {
  routes.delete(String(id));
  globe?.clearRoute(id);
}

/**
 * Turn and zoom the globe smoothly so that all points [{lat_deg, lon_deg}, ...] are in view, like a web map's
 * "fit bounds". opts: { padding: CSS px, a number or {top, right, bottom, left} (default: clear of the search box,
 * the tools and the place card), maxZoom (default 60, the globe's limit, about 60 km across; 1 = the whole disc) }.
 */
export function fitTo(points, opts = {}) {
  if (globe) globe.fitTo(points, opts);
  else pendingMove = ["fitTo", points, opts];
}

/**
 * Show or move dot `id` (e.g. a rover on its route): { lat, lon (deg), color (CSS), label, ahead: {lat, lon} | null,
 * text }; with `ahead`, an arrow on the dot points toward it; `text` (1–2 characters, e.g. a trip's stop letter) is
 * written in the dot. lat_deg / lon_deg are accepted too.
 */
export function setMarker(id, marker) {
  dots.set(String(id), marker);
  globe?.setMarker(id, marker);
}

/** Remove dot `id` (no-op when there is none). */
export function clearMarker(id) {
  dots.delete(String(id));
  globe?.clearMarker(id);
}

/** Fly the globe to latitude, east longitude (deg) at `zoom` (1 = the whole disc; default: keep the zoom). */
export function flyTo(lat, lon, zoom) {
  if (globe) globe.flyTo(lat, lon, zoom);
  else pendingMove = ["flyTo", lat, lon, zoom];
}
