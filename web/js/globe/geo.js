// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Pure geometry of the Moon globe picker (no three.js, so node tests can import it).
//
// Frame: MOON_ME on the unit sphere. +X points to latitude 0, longitude 0 (the mean sub-Earth point), +Y to 0 N 90 E,
// +Z to the north pole. Latitude is selenographic (-90..90 deg); longitude is east-positive in -180..180 deg
// (docs/CONTRACTS.md §0). The scene uses these coordinates directly.
//
// Camera: orthographic, looking at the Moon centre from direction `dir` (unit vector, centre -> camera), with the
// screen's up direction `up` (unit, perpendicular to `dir`). Screen right is up x dir. `zoom` 1 shows the whole disc
// with a small margin (FIT_MARGIN); the visible half-size of the smaller screen side is FIT_MARGIN / zoom Moon radii.

export const DEG = Math.PI / 180;
export const FIT_MARGIN = 1.06;

/** Unit vector [x, y, z] in MOON_ME from latitude and east longitude (deg). */
export function latLonToVec(latDeg, lonDeg) {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  const c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
}

/** Longitude wrapped to -180..180 deg (180 stays 180, -180 stays -180). */
export function wrapLon(lonDeg) {
  if (!Number.isFinite(lonDeg)) return lonDeg;
  if (lonDeg >= -180 && lonDeg <= 180) return lonDeg;
  return ((((lonDeg + 180) % 360) + 360) % 360) - 180;
}

/**
 * Latitude and east longitude (deg) of a vector in MOON_ME (any length > 0).
 * Longitude is in -180..180 (atan2 convention: -180 only for a -0 Y component). At a pole the longitude is 0.
 * @returns {{lat: number, lon: number}}
 */
export function vecToLatLon(v) {
  const [x, y, z] = v;
  const h = Math.hypot(x, y);
  const lat = Math.atan2(z, h) / DEG;
  const lon = h < 1e-12 ? 0 : Math.atan2(y, x) / DEG;
  return { lat, lon };
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function norm(a) {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
}

/** Screen-right unit vector of a view: up x dir. */
export function viewRight(view) {
  return cross(view.up, view.dir);
}

/**
 * Half-width and half-height of the orthographic view volume, in Moon radii.
 * The smaller screen side shows FIT_MARGIN / zoom radii on each side of the centre.
 * @param {number} zoom >= any positive value
 * @param {number} aspect width / height of the canvas
 */
export function frustumHalf(zoom, aspect) {
  const h = FIT_MARGIN / zoom;
  return aspect >= 1 ? { halfW: h * aspect, halfH: h } : { halfW: h, halfH: h / aspect };
}

/** Moon radius on screen in CSS pixels, for a canvas of width x height CSS px. */
export function radiusPx(zoom, width, height) {
  return (Math.min(width, height) / 2) * (zoom / FIT_MARGIN);
}

/**
 * The surface point under a screen position (orthographic ray along -dir), or null off the disc.
 * @param {{dir: number[], up: number[], zoom: number}} view
 * @param {number} ndcX -1 (left edge) .. 1 (right edge)
 * @param {number} ndcY -1 (bottom edge) .. 1 (top edge)
 * @param {number} aspect canvas width / height
 * @returns {number[]|null} unit vector in MOON_ME (the near-side intersection with the unit sphere)
 */
export function pickOrtho(view, ndcX, ndcY, aspect) {
  const { halfW, halfH } = frustumHalf(view.zoom, aspect);
  const r = viewRight(view);
  const a = ndcX * halfW;
  const b = ndcY * halfH;
  const p = [a * r[0] + b * view.up[0], a * r[1] + b * view.up[1], a * r[2] + b * view.up[2]];
  const q = a * a + b * b;
  if (q > 1) return null;
  const t = Math.sqrt(1 - q);
  return [p[0] + t * view.dir[0], p[1] + t * view.dir[1], p[2] + t * view.dir[2]];
}

/**
 * Screen position of a point in MOON_ME (inverse of pickOrtho for the visible hemisphere).
 * @returns {{x: number, y: number, depth: number}} NDC x, y and depth = v . dir (> 0 on the visible hemisphere for a unit v)
 */
export function projectOrtho(view, v, aspect) {
  const { halfW, halfH } = frustumHalf(view.zoom, aspect);
  const r = viewRight(view);
  return { x: dot(v, r) / halfW, y: dot(v, view.up) / halfH, depth: dot(v, view.dir) };
}

/** Same as pickOrtho, from CSS pixel coordinates inside a canvas of width x height (y down). */
export function pickPx(view, px, py, width, height) {
  return pickOrtho(view, (px / width) * 2 - 1, 1 - (py / height) * 2, width / height);
}

/** CSS pixel position of a point (y down), with its depth; see projectOrtho. */
export function projectPx(view, v, width, height) {
  const p = projectOrtho(view, v, width / height);
  return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height, depth: p.depth };
}

// ----- Rotations (quaternions [x, y, z, w]) -----

/** Quaternion of the rotation by `angle` (rad) about the unit `axis`. */
export function quatAxisAngle(axis, angle) {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** Shortest rotation that takes unit vector a to unit vector b. Antiparallel vectors turn about any perpendicular. */
export function quatBetween(a, b) {
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  if (d > 1 - 1e-15) return [0, 0, 0, 1];
  let axis = cross(a, b);
  if (Math.hypot(...axis) < 1e-12) {
    axis = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
  }
  return quatAxisAngle(norm(axis), Math.acos(d));
}

/** Rotate vector v by quaternion q. */
export function quatApply(q, v) {
  const [x, y, z, w] = q;
  // t = 2 q.xyz x v; v' = v + w t + q.xyz x t
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** The view turned by quaternion q about the Moon centre (camera direction and up both rotate). */
export function rotateView(view, q) {
  const dir = norm(quatApply(q, view.dir));
  let up = quatApply(q, view.up);
  up = norm(sub(up, scale(dir, dot(up, dir)))); // keep it exactly perpendicular
  return { ...view, dir, up };
}

/**
 * "Grab" rotation: the view turned so that the surface point `grabbed` (unit vector) sits under the screen position
 * where `current` (the point now under that position) is. Exact for an orthographic camera.
 */
export function dragView(view, grabbed, current) {
  return rotateView(view, quatBetween(current, grabbed));
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** Views centred poleward of this latitude (deg) use the top-down polar orientation. */
export const POLAR_VIEW_LAT = 75;

/**
 * Default screen-up vector for a view centred on `dir`: north at the top, except poleward of POLAR_VIEW_LAT, where
 * the standard top-down polar orientation is used (as in the polar presets and the LOLA polar maps): longitude 180 at
 * the top over the north pole, longitude 0 at the top over the south pole, 90 E on the right in both.
 */
export function northUp(dir) {
  const sinLim = Math.sin(POLAR_VIEW_LAT * DEG);
  let ref = [0, 0, 1];
  if (dir[2] > sinLim) ref = [-1, 0, 0];
  else if (dir[2] < -sinLim) ref = [1, 0, 0];
  return norm(sub(ref, scale(dir, dot(ref, dir))));
}

/** The four preset views. Near and far side have north up; the poles are seen top-down. */
export const PRESETS = {
  near: { label: "Near side", dir: [1, 0, 0], up: [0, 0, 1] },
  far: { label: "Far side", dir: [-1, 0, 0], up: [0, 0, 1] },
  north: { label: "North pole", dir: [0, 0, 1], up: [-1, 0, 0] },
  south: { label: "South pole", dir: [0, 0, -1], up: [1, 0, 0] },
};

/** View centred on latitude / longitude (deg), north up (pole orientation at the poles). */
export function viewAt(latDeg, lonDeg, zoom = 1) {
  const dir = latLonToVec(latDeg, lonDeg);
  return { dir, up: northUp(dir), zoom };
}

/**
 * Centre and zoom that show all `points` (unit vectors): centre = normalised mean direction; zoom so that every
 * point is inside `fill` of the smaller half-size. Points beyond the limb of that centre give zoom 1.
 * @returns {{dir: number[], zoom: number}}
 */
export function fitPoints(points, { fill = 0.8, maxZoom = 8 } = {}) {
  if (!points.length) return { dir: [1, 0, 0], zoom: 1 };
  let m = [0, 0, 0];
  for (const p of points) m = [m[0] + p[0], m[1] + p[1], m[2] + p[2]];
  const dir = Math.hypot(...m) < 1e-6 ? points[0] : norm(m);
  let maxR = 0;
  for (const p of points) {
    const d = dot(p, dir);
    if (d < 0.15) return { dir, zoom: 1 };
    maxR = Math.max(maxR, Math.sqrt(Math.max(0, 1 - d * d)));
  }
  const zoom = maxR < 1e-9 ? maxZoom : (FIT_MARGIN * fill) / maxR;
  return { dir, zoom: Math.max(1, Math.min(maxZoom, zoom)) };
}

/**
 * Polar-cap texture coordinates of a point (the projection of web/data/moonmap/moonmap.json, as in the shader):
 * stereographic about the pole with sign s (+1 north, -1 south); k = 1 / (1 + s uz); X = k uy; Y = -s k ux;
 * u = 0.5 + X / (2 rmax), v = 0.5 + Y / (2 rmax), rmax = tan(psiMax / 2). v = 1 is the top row of the image.
 */
export function capUv(v, pole, psiMaxDeg) {
  const rmax = Math.tan((psiMaxDeg * DEG) / 2);
  const k = 1 / (1 + pole * v[2]);
  return [0.5 + (k * v[1]) / (2 * rmax), 0.5 + (-pole * k * v[0]) / (2 * rmax)];
}

/** Great-circle angle between two unit vectors, deg. */
export function angleDeg(a, b) {
  return Math.atan2(Math.hypot(...cross(a, b)), dot(a, b)) / DEG;
}
