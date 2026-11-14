// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Rover trips on the Moon globe, through the globe's API (web/js/app/globe_api.js, contract C8b): each trip's path as
// a route line, its stops as lettered dots (B, C, …; the start and the end are the scenario's pins), the globe fitted
// to a trip (like a route in Google Maps), and the rover's position dot, with an arrow toward the way ahead, which
// moves along the path while the sky's timelapse plays. globe_api.js keeps calls made before the globe has loaded.

import { showRoute, clearRoute, fitTo, setMarker, clearMarker } from "../app/globe_api.js";

const STOP_COLOR = "#4f5f86";
const routes = new Map(); // scenario id -> { points, color } (to skip identical redraws)
const stopCount = new Map(); // scenario id -> number of stop dots shown
const roverOn = new Set(); // scenario ids with a rover dot

const rid = (id) => `trip-${id}`;
const ll = (p) => ({ lat_deg: p.lat, lon_deg: p.lon });

/** Show (or update) a trip's path: points [{lat, lon}] (deg, selenographic, east-positive), colour as CSS. */
export function showTripRoute(id, points, color) {
  const prev = routes.get(id);
  if (prev && prev.color === color && prev.points === points) return;
  routes.set(id, { points, color });
  showRoute(rid(id), points.map(ll), { color });
}

/** Remove a trip's path, its stop letters and its rover dot. */
export function clearTripRoute(id) {
  if (routes.delete(id)) clearRoute(rid(id));
  setTripStops(id, null);
  setRoverMarker(id, null);
}

/** Ids of the trips shown. */
export function shownTrips() {
  return [...routes.keys()];
}

/** Lettered dots at a trip's stops: [{lat, lon, letter}] (B, C, …), or null to remove them. */
export function setTripStops(id, points) {
  const n = points?.length || 0;
  (points || []).forEach((p, k) => {
    setMarker(`${rid(id)}-stop${k}`, { lat: p.lat, lon: p.lon, color: STOP_COLOR, text: p.letter, label: `Stop ${p.letter}` });
  });
  for (let k = n; k < (stopCount.get(id) || 0); k++) clearMarker(`${rid(id)}-stop${k}`);
  if (n) stopCount.set(id, n);
  else stopCount.delete(id);
}

/** Turn and zoom the globe so that a trip's path, points [{lat, lon}], fills it. */
export function fitTrip(points) {
  if (points?.length) fitTo(points.map(ll));
}

/**
 * The rover's dot of a trip: {lat, lon, color, label, ahead: {lat, lon} (a point further on: the dot's arrow)}, or
 * null to remove it.
 */
export function setRoverMarker(id, m) {
  if (!m) {
    if (roverOn.delete(id)) clearMarker(`${rid(id)}-rover`);
    return;
  }
  roverOn.add(id);
  setMarker(`${rid(id)}-rover`, m);
}
