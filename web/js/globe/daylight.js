// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Day and night on the Moon globe (contract C8b): the shader code that shades the sphere by the direction of the Sun,
// its JavaScript twin for the tests, the moment the globe shows and the words of its caption and Layers row.
// Pure: no DOM and no three.js. globe.js puts the GLSL into its fragment shader; web/js/app/daylight_link.js feeds the
// Sun's direction (web/js/physics subsolarPoint) at the sky playback's moment. Tests: web/tests/globe_daylight.test.mjs.
//
// Model: a smooth sphere. At a point with unit position u (MOON_ME), the Sun's centre is at elevation h = asin(u · s),
// s the unit vector toward the Sun from the Moon's centre (parallax below 0.001°). Day where h > 0, night where h < 0.
// The real edge is the Sun's disk setting, 0.53° wide in h; the globe softens it to TERMINATOR_HALF_DEG on each side
// (and at least one screen pixel, so it never aliases). During an eclipse the Earth's shadow dims the day side too:
// at each point, the share of the Sun's disk (uniform brightness) that the Earth's disk hides, seen from that point
// (positions from the Moon's centre, km, MOON_ME; the solid Earth, as in the sky view). Terrain shadows are not
// modelled here: the sky view and the permanent-shadow layer show them.

import { SUN_RADIUS_KM, EARTH_RADIUS_KM } from "../physics/metrics.js";
import { MOON_RADIUS_KM } from "../physics/frames.js";

/** Half-width of the soft day/night edge, in degrees of Sun elevation (the edge spans −0.5°..+0.5°). */
export const TERMINATOR_HALF_DEG = 0.5;

/**
 * Multiplier of the map colour on the night side (linear 0..1 per channel, sRGB values): about 30 % of the day
 * brightness with a slight blue tint, so the night reads as night while the map stays legible.
 */
export const NIGHT_RGB = [0.27, 0.3, 0.37];

/** Share of the night dimming that the map layers' colours take (0: none, 1: like the ground), so they stay readable. */
export const LAYER_NIGHT_SHARE = 0.5;

/** GLSL uniforms of the day/night shading (globe.js declares them in its fragment shader). */
export const DAYLIGHT_UNIFORMS_GLSL = /* glsl */ `
uniform vec3 uSunDir;       // unit vector toward the Sun from the Moon's centre (MOON_ME = scene frame)
uniform float uDayOn;       // 1: shade day and night, 0: the whole Moon lit
uniform vec3 cNight;        // night-side multiplier of the map colour
uniform vec3 uSunKm;        // apparent Sun position from the Moon's centre, km, MOON_ME
uniform vec3 uEarthKm;      // apparent Earth position from the Moon's centre, km, MOON_ME
uniform float uEclOn;       // 1 while the Earth's shadow can touch the Moon (else the shadow is skipped)`;

/** GLSL functions of the day/night shading; call them in uniform control flow (they use fwidth). */
export const DAYLIGHT_FUNCS_GLSL = /* glsl */ `
// Daylight at the unit position u: 0 at night, 1 by day, a smooth step across the terminator. h: the elevation of the
// Sun's centre (rad) on the smooth sphere.
float daylight(vec3 u) {
  float h = asin(clamp(dot(u, uSunDir), -1.0, 1.0));
  float hw = max(${((TERMINATOR_HALF_DEG * Math.PI) / 180).toFixed(8)}, fwidth(h));
  return smoothstep(-hw, hw, h);
}
// Share (0..1) of a uniform disk of angular radius rs hidden by a disk of radius re at centre distance d (rad).
float diskCover(float d, float rs, float re) {
  if (d >= rs + re) return 0.0;
  if (d <= re - rs) return 1.0;
  if (d <= rs - re) return (re * re) / (rs * rs);
  float a = rs * rs * acos(clamp((d * d + rs * rs - re * re) / (2.0 * d * rs), -1.0, 1.0));
  float b = re * re * acos(clamp((d * d + re * re - rs * rs) / (2.0 * d * re), -1.0, 1.0));
  float k = 0.5 * sqrt(max(0.0, (-d + rs + re) * (d + rs - re) * (d - rs + re) * (d + rs + re)));
  return clamp((a + b - k) / (3.14159265 * rs * rs), 0.0, 1.0);
}
// The Earth's shadow at the unit position u: the share of the Sun's disk the Earth hides, seen from that point.
float earthShadow(vec3 u) {
  if (uEclOn < 0.5) return 0.0;
  vec3 p = u * ${MOON_RADIUS_KM.toFixed(1)};
  vec3 s = uSunKm - p;
  vec3 e = uEarthKm - p;
  float ls = length(s);
  float le = length(e);
  s /= ls;
  e /= le;
  float d = atan(length(cross(s, e)), dot(s, e));
  return diskCover(d, asin(${SUN_RADIUS_KM.toFixed(1)} / ls), asin(${EARTH_RADIUS_KM.toFixed(3)} / le));
}
// Colour multiplier for a daylight value (white by day, cNight at night; white everywhere when the shading is off).
vec3 dayShade(float lit) { return mix(vec3(1.0), mix(cNight, vec3(1.0), lit), uDayOn); }`;

/** GLSL smoothstep in JavaScript. */
export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Daylight (0 night .. 1 day) at the point with selenographic latitude and east longitude (deg, MOON_ME) for the
 * unit vector toward the Sun `sunDir` (MOON_ME), as the shader computes it (without the one-pixel widening).
 * Returns { lit, sun_el_deg } with sun_el_deg the elevation of the Sun's centre on the smooth sphere.
 */
export function daylightAt(lat_deg, lon_deg, sunDir) {
  const d = Math.PI / 180;
  const u = [Math.cos(lat_deg * d) * Math.cos(lon_deg * d), Math.cos(lat_deg * d) * Math.sin(lon_deg * d), Math.sin(lat_deg * d)];
  const x = u[0] * sunDir[0] + u[1] * sunDir[1] + u[2] * sunDir[2];
  const h = Math.asin(Math.max(-1, Math.min(1, x))) / d;
  return { lit: smoothstep(-TERMINATOR_HALF_DEG, TERMINATOR_HALF_DEG, h), sun_el_deg: h };
}

/** Share (0..1) of a uniform disk of angular radius rs hidden by a disk of radius re at centre distance d (rad). */
export function diskCover(d, rs, re) {
  if (d >= rs + re) return 0;
  if (d <= re - rs) return 1;
  if (d <= rs - re) return (re * re) / (rs * rs);
  const a = rs * rs * Math.acos(Math.max(-1, Math.min(1, (d * d + rs * rs - re * re) / (2 * d * rs))));
  const b = re * re * Math.acos(Math.max(-1, Math.min(1, (d * d + re * re - rs * rs) / (2 * d * re))));
  const k = 0.5 * Math.sqrt(Math.max(0, (-d + rs + re) * (d + rs - re) * (d - rs + re) * (d + rs + re)));
  return Math.max(0, Math.min(1, (a + b - k) / (Math.PI * rs * rs)));
}

/**
 * The Earth's shadow at a point of the Moon's surface (lat, east lon in deg, MOON_ME; on the 1737.4 km sphere), as
 * the shader computes it: the share (0..1) of the Sun's disk, taken as uniformly bright, that the Earth's disk hides,
 * seen from that point. sunKm, earthKm: apparent positions from the Moon's centre (km, MOON_ME; subsolarPoint's
 * sun_me_km and earth_me_km). The solid Earth (equatorial radius), as in the sky view.
 */
export function earthShadowAt(lat_deg, lon_deg, sunKm, earthKm) {
  const d = Math.PI / 180;
  const r = MOON_RADIUS_KM;
  const p = [r * Math.cos(lat_deg * d) * Math.cos(lon_deg * d), r * Math.cos(lat_deg * d) * Math.sin(lon_deg * d), r * Math.sin(lat_deg * d)];
  const s = sunKm.map((x, i) => x - p[i]);
  const e = earthKm.map((x, i) => x - p[i]);
  const ls = Math.hypot(...s);
  const le = Math.hypot(...e);
  const c = [s[1] * e[2] - s[2] * e[1], s[2] * e[0] - s[0] * e[2], s[0] * e[1] - s[1] * e[0]];
  const sep = Math.atan2(Math.hypot(...c) / (ls * le), (s[0] * e[0] + s[1] * e[1] + s[2] * e[2]) / (ls * le));
  return diskCover(sep, Math.asin(SUN_RADIUS_KM / ls), Math.asin(EARTH_RADIUS_KM / le));
}

/**
 * Whether the Earth's shadow can touch the Moon (uEclOn): the Sun-Earth separation seen from the Moon's centre is
 * below the sum of their angular radii plus a margin for the points of the surface (the Earth's direction changes by
 * up to R_moon / d_earth, at most 0.28 deg, across the Moon; margin 0.3 deg). Positions as in earthShadowAt.
 */
export function eclipsePossible(sunKm, earthKm) {
  const ls = Math.hypot(...sunKm);
  const le = Math.hypot(...earthKm);
  const c = (sunKm[0] * earthKm[0] + sunKm[1] * earthKm[1] + sunKm[2] * earthKm[2]) / (ls * le);
  const sep = Math.acos(Math.max(-1, Math.min(1, c)));
  return sep < Math.asin(SUN_RADIUS_KM / ls) + Math.asin(EARTH_RADIUS_KM / le) + (0.3 * Math.PI) / 180;
}

/**
 * The moment the globe shows (epoch ms). sky: [{ id, label, t_ms }], each sky view's moment (web/js/app/sky_panel.js
 * skyMoments); starts: [{ id, label, t_ms }], each scenario's start time (NaN when it has none); activeId: the selected
 * scenario; nowMs: the clock. Picks the selected scenario's view, else the first view; before the views exist, the
 * selected (else the first) scenario's start; with no scenario, now. Returns { t_ms, label, now }.
 */
export function pickMoment(sky, starts, activeId, nowMs) {
  for (const list of [sky ?? [], starts ?? []]) {
    for (const m of [list.find((x) => x.id === activeId), ...list]) {
      if (m && Number.isFinite(m.t_ms)) return { t_ms: m.t_ms, label: m.label || "", now: false };
    }
  }
  return { t_ms: nowMs, label: "", now: true };
}

/** "20 Jul 1969, 20:17 UTC" (the app's UTC format, minutes). */
function utcText(ms) {
  const d = new Date(ms);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** The map caption for a pickMoment result: "Daylight at 20 Jul 1969, 20:17 UTC (Apollo 11)", or "Daylight now, …". */
export function daylightCaption({ t_ms, label, now }) {
  if (now) return `Daylight now, ${utcText(t_ms)}`;
  return `Daylight at ${utcText(t_ms)}${label ? ` (${label})` : ""}`;
}

/** Tooltip of the caption and note of the Layers row: what the shading shows and what it leaves out. */
export const DAYLIGHT_NOTE =
  "Day and night on a smooth Moon, and the Earth's shadow during an eclipse, at the moment the sky view shows " +
  "(the selected scenario). " +
  "Local terrain shadows are shown in the sky view and in the permanent shadow layer, not by this shading.";

/** The Layers panel row (web/js/app/map_layers.js) and the map key entry. */
export const DAYLIGHT_LAYER = {
  id: "daylight",
  label: "Daylight at the selected time",
  note: DAYLIGHT_NOTE,
  source: "Sun direction: JPL DE421 (this site's physics)",
  swatches: [["#3b4356", "Night side (smooth Moon)"]],
};
