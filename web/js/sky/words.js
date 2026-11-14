// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// Plain words for where the Sun and the Earth are, shared by the sky HUD (web/js/sky), the Sky tab's card footers
// and the Compare cards (web/js/app). Pure functions (no DOM, no three.js), tested in web/tests/sky_words.test.mjs.
//
// Wording rule for a body out of sight (C6: vis_frac = share of the disk above the terrain horizon, 0..1):
//   - "below the horizon": the whole disk is below the local horizontal plane (el + r < 0). It would be hidden even on
//     perfectly flat ground, so the horizon in every sense (the flat one and the skyline) is above it.
//   - "hidden behind terrain": part of the disk is above the local horizontal plane (el + r >= 0), but the skyline in
//     its direction is higher. A positive elevation alone never means "visible".
// A body that is below the horizontal plane but above a lower skyline (seen from a peak) is visible: no wording.

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 16-point compass name of a true azimuth (deg, clockwise from north). */
export function compass16(azDeg) {
  return COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16];
}

/**
 * Compass names for two azimuths (deg). Within 1° of each other they get the same name (that of their mean), so two
 * bodies 0.3° apart are not called "W" and "WSW" because they straddle a sector boundary.
 */
export function compassPair(azA, azB) {
  const d = ((azB - azA + 540) % 360) - 180;
  if (Math.abs(d) >= 1) return [compass16(azA), compass16(azB)];
  const m = compass16(azA + d / 2);
  return [m, m];
}

/** Degrees with one decimal and a true minus sign; `plus` adds "+" to positive values. */
export function degText(x, { digits = 1, plus = false } = {}) {
  if (!Number.isFinite(x)) return '–';
  const a = Math.abs(x).toFixed(digits);
  const zero = Number(a) === 0;
  return `${x < 0 && !zero ? '−' : plus && !zero ? '+' : ''}${a}°`;
}

/**
 * Why a body is out of sight, from a C6 body state { el_deg, ang_radius_deg, vis_frac }.
 * Returns "below" (whole disk below the local horizontal plane), "terrain" (some of the disk above that plane, the
 * skyline higher) or null (at least part of the disk is visible, vis_frac > 0.001).
 */
export function hiddenReason(body) {
  if (!body || body.vis_frac == null || body.vis_frac > 0.001) return null;
  return body.el_deg + (body.ang_radius_deg ?? 0) < 0 ? 'below' : 'terrain';
}

/**
 * Short phrase for a hidden body: "below the horizon" or "hidden behind terrain (skyline +5.2°)".
 * skylineEl: terrain horizon elevation (deg) in the body's direction, or null when unknown. "" when visible.
 */
export function hiddenPhrase(body, skylineEl = null) {
  const why = hiddenReason(body);
  if (why === 'below') return 'below the horizon';
  if (why === 'terrain') return Number.isFinite(skylineEl) ? `hidden behind terrain (skyline ${degText(skylineEl, { plus: true })})` : 'hidden behind terrain';
  return '';
}

/**
 * One plain line for a body, as in the Sky tab's card footers:
 *   "Sun: height 10.7°, E (89°)", "Sun: height 0.2°, E (90°) · 40% visible",
 *   "Sun hidden behind terrain: height +3.0°, W (271°), skyline +5.2°", "Sun below the horizon: height −5.0°, W (265°)",
 *   "Earth below your feet: height −48.6°, S (181°) · it never rises here" (neverRises, see earthNeverRises).
 * body: C6 body state; compassName: from compass16/compassPair; skylineEl: terrain horizon (deg) in its direction.
 */
export function bodyLine(name, body, compassName, skylineEl = null, { neverRises = false } = {}) {
  const why = hiddenReason(body);
  const where = (plus) => `height ${degText(body.el_deg, { plus })}, ${compassName} (${Math.round(((body.az_deg % 360) + 360) % 360)}°)`;
  if (why === 'below' && neverRises) return `${name} below your feet: ${where(false)} · it never rises here`;
  if (why === 'below') return `${name} below the horizon: ${where(false)}`;
  if (why === 'terrain') return `${name} hidden behind terrain: ${where(true)}${Number.isFinite(skylineEl) ? `, skyline ${degText(skylineEl, { plus: true })}` : ''}`;
  const part = body.vis_frac != null && body.vis_frac < 0.999 ? ` · ${Math.round(body.vis_frac * 100)}% visible` : '';
  return `${name}: ${where(false)}${part}`;
}

/**
 * Label of a hidden body's dashed outline in the sky view (math.js bodyMarker): "Earth · behind terrain" or
 * "Earth · below the horizon (−7.5°)". hidden: "terrain" | "below" (hiddenReason); elDeg: the body's height.
 */
export function ghostText(name, hidden, elDeg) {
  return hidden === 'below' ? `${name} · below the horizon (${degText(elDeg)})` : `${name} · behind terrain`;
}

/**
 * Short offset text of an edge arrow (math.js bodyMarker): how far to turn, and which way. Left and right edges: the
 * azimuth turn ("35° right"); top and bottom: the elevation change ("44° up"). Where those do not describe the turn
 * (a body over the zenith side, or a change under 0.5°), the great-circle angle `sepDeg` from the view centre is used.
 * edge: "left" | "right" | "top" | "bottom"; dAzDeg: signed azimuth turn (+ = right); dElDeg: body − view elevation.
 */
export function offsetText(edge, dAzDeg, dElDeg, sepDeg) {
  const side = edge === 'left' || edge === 'right';
  let n = Math.round(Math.abs(side ? dAzDeg : dElDeg));
  const sameWay = side || (edge === 'top' ? dElDeg > 0 : dElDeg < 0);
  if (!sameWay || n < 1) n = Math.max(1, Math.round(sepDeg));
  return `${n}° ${{ left: 'left', right: 'right', top: 'up', bottom: 'down' }[edge]}`;
}

/**
 * Covered share of the Sun during an eclipse (C6 sun.eclipse_frac, 0..1) as percent text without the sign: "100" only
 * when total, one decimal below 1 % and above 99 % (so a sliver is never rounded to "100"), else a whole number.
 */
export function eclipsePctText(ecl) {
  if (ecl >= 1) return '100';
  const p = ecl * 100;
  return p > 99 || p < 1 ? (Math.floor(p * 10) / 10).toFixed(1) : String(Math.round(p));
}

/** One short eclipse status line, e.g. "Earth eclipses the Sun · 81 %", or "" without an eclipse (eclipse_frac 0). */
export function eclipseStatus(sun) {
  const e = sun?.eclipse_frac ?? 0;
  return e > 0 ? `Earth eclipses the Sun · ${eclipsePctText(e)} %` : '';
}

/** Tooltip of the "ring illustrative" note of the close-up during an eclipse (Shay's decision: keep the ring, labelled). */
export const RING_NOTE = "Sunlight refracted by Earth's atmosphere; drawn for illustration, not computed.";

/**
 * True when the Earth can never rise above the local horizontal plane at a site, whatever the date.
 * Geometry: the Earth's direction from a site is about 90° minus the angular distance d between the site and the
 * sub-Earth point. Libration moves the sub-Earth point at most about 10.4° from (0° N, 0° E) (up to 7.9° in longitude
 * and 6.7° in latitude), the Earth's angular radius is at most 1.03° (perigee) and the parallax of the site (one lunar
 * radius at the Earth's distance) at most 0.28°. So the top of the Earth's disk stays below the horizontal plane when
 * d > 101.7°; 105° leaves about 3° for a skyline that dips below the horizontal (a site on a peak).
 * Inputs: selenographic latitude and east longitude (deg, Mean Earth frame).
 */
export function earthNeverRises(latDeg, lonDeg) {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return false;
  const r = Math.PI / 180;
  const cosD = Math.cos(latDeg * r) * Math.cos(lonDeg * r);
  return Math.acos(Math.max(-1, Math.min(1, cosD))) / r > EARTH_NEVER_RISES_DEG;
}
/** Angular distance (deg) from the mean sub-Earth point beyond which the Earth never rises (see earthNeverRises). */
export const EARTH_NEVER_RISES_DEG = 105;

/** An Earth this far below the horizontal plane (deg, top of the disk) gets a text message instead of a close-up. */
export const EARTH_DEEP_BELOW_DEG = -5;
