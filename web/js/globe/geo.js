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

// ----- Routes, fit-to-points and flights (the globe API for routes and trips; docs/CONTRACTS.md C8b) -----

const clampN = (x, a, b) => Math.max(a, Math.min(b, x));

/**
 * Point at fraction t (0..1) of the great-circle arc from unit vector a to unit vector b (spherical linear
 * interpolation). Antipodal pairs turn about any perpendicular axis. Returns a unit vector.
 */
export function slerpVec(a, b, t) {
  const th = Math.acos(clampN(dot(a, b), -1, 1));
  if (th < 1e-12) return [...a];
  let ax = cross(a, b);
  if (Math.hypot(...ax) < 1e-12) ax = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
  ax = norm(ax);
  const p = cross(ax, a); // unit, perpendicular to a, toward b
  const c = Math.cos(t * th);
  const s = Math.sin(t * th);
  return [a[0] * c + p[0] * s, a[1] * c + p[1] * s, a[2] * c + p[2] * s];
}

/**
 * Polyline that follows the great circles between consecutive points, for drawing a route on the globe.
 * @param {number[][]} points unit vectors in MOON_ME (any length > 0; they are normalised)
 * @param {object} [o]
 * @param {number} [o.maxStepDeg] longest arc between two vertices, deg (default 0.5)
 * @param {number} [o.lift] radius of the vertices in Moon radii (default 1.001, about 1.7 km above the reference
 *   sphere), so the line is drawn just above the surface and stays visible up to the limb
 * @returns {number[][]} vertices [x, y, z] in Moon radii; the input points are vertices too
 */
export function greatCirclePath(points, { maxStepDeg = 0.5, lift = 1.001 } = {}) {
  const out = [];
  let a = null;
  for (const p of points) {
    const b = norm(p);
    if (!a) out.push(scale(b, lift));
    else {
      const n = Math.max(1, Math.ceil(angleDeg(a, b) / maxStepDeg));
      for (let k = 1; k <= n; k++) out.push(scale(slerpVec(a, b, k / n), lift));
    }
    a = b;
  }
  return out;
}

/**
 * Parts of a 3D polyline that the unit sphere does not hide, for an orthographic view.
 * A vertex (radius >= 1) is hidden when it is behind the plane of the limb (v . dir < 0) and its projection falls
 * inside the disc. Returns inclusive index ranges [[i0, i1], ...] of consecutive visible vertices.
 */
export function visibleRuns(view, path) {
  const r = viewRight(view);
  const runs = [];
  let start = -1;
  for (let i = 0; i <= path.length; i++) {
    let vis = false;
    if (i < path.length) {
      const v = path[i];
      const x = dot(v, r);
      const y = dot(v, view.up);
      vis = dot(v, view.dir) >= 0 || x * x + y * y >= 1;
    }
    if (vis && start < 0) start = i;
    else if (!vis && start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  return runs;
}

/** {top, right, bottom, left} padding in CSS px from a number or a partial object. */
export function padBox(padding = 0) {
  if (typeof padding === "number") return { top: padding, right: padding, bottom: padding, left: padding };
  return { top: 0, right: 0, bottom: 0, left: 0, ...padding };
}

/**
 * The view that shows all `points` (unit vectors in MOON_ME) in a width x height CSS px canvas, inside `padding`,
 * like a web map's "fit bounds". The centre is moved (4 passes) until the points' screen box sits in the middle of
 * the padded box; screen up is northUp(centre) (top-down at the poles). The zoom is then the largest at which every
 * point is inside the padded box, clamped to [minZoom, maxZoom]. Points that cannot all face the camera (some more
 * than about 84 deg from their mean direction) give the mean direction at minZoom (the whole disc).
 * @param {number[][]} points unit vectors
 * @param {{width: number, height: number, padding?: number|object, minZoom?: number, maxZoom?: number}} o
 * @returns {{dir: number[], up: number[], zoom: number}|null} null for no points
 */
export function fitView(points, { width, height, padding = 0, minZoom = 1, maxZoom = 8 } = {}) {
  const vs = points.map(norm).filter((v) => Math.hypot(...v) > 0.5);
  if (!vs.length) return null;
  const pad = padBox(padding);
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  const availW = Math.max(1, W - pad.left - pad.right);
  const availH = Math.max(1, H - pad.top - pad.bottom);
  const zoomPerPx = (2 * FIT_MARGIN) / Math.min(W, H); // zoom = zoomPerPx * (CSS px per Moon radius)
  let m = [0, 0, 0];
  for (const v of vs) m = [m[0] + v[0], m[1] + v[1], m[2] + v[2]];
  let dir = Math.hypot(...m) < 1e-6 ? vs[0] : norm(m);
  if (vs.some((v) => dot(v, dir) < 0.1)) return { dir, up: northUp(dir), zoom: minZoom };
  const extent = (d) => {
    const up = northUp(d);
    const r = cross(up, d);
    const xs = vs.map((v) => dot(v, r));
    const ys = vs.map((v) => dot(v, up));
    return { up, r, xs, ys, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  for (let pass = 0; pass < 4; pass++) {
    const e = extent(dir);
    const sx = e.x1 - e.x0 > 1e-12 ? availW / (e.x1 - e.x0) : Infinity;
    const sy = e.y1 - e.y0 > 1e-12 ? availH / (e.y1 - e.y0) : Infinity;
    const zoom = clampN(zoomPerPx * Math.min(sx, sy), minZoom, maxZoom);
    const s = radiusPx(zoom, W, H);
    // The box centre must sit this far (Moon radii) from the view centre to land in the middle of the padded box.
    const a = (e.x0 + e.x1) / 2 - (pad.left - pad.right) / (2 * s);
    const b = (e.y0 + e.y1) / 2 - (pad.bottom - pad.top) / (2 * s);
    const q = a * a + b * b;
    if (q < 1e-20 || q >= 0.98) break;
    const t = Math.sqrt(1 - q);
    dir = norm([dir[0] * t + e.r[0] * a + e.up[0] * b, dir[1] * t + e.r[1] * a + e.up[1] * b, dir[2] * t + e.r[2] * a + e.up[2] * b]);
  }
  // Final zoom for the final centre: every point inside the padded box (screen y grows downwards).
  const e = extent(dir);
  let s = Infinity;
  e.xs.forEach((x) => {
    if (x > 1e-12) s = Math.min(s, (W / 2 - pad.right) / x);
    else if (x < -1e-12) s = Math.min(s, (W / 2 - pad.left) / -x);
  });
  e.ys.forEach((y) => {
    if (y > 1e-12) s = Math.min(s, (H / 2 - pad.top) / y);
    else if (y < -1e-12) s = Math.min(s, (H / 2 - pad.bottom) / -y);
  });
  const zoom = clampN(s > 0 ? zoomPerPx * s : minZoom, minZoom, maxZoom);
  return { dir, up: e.up, zoom };
}

/**
 * Zoom along a flight from zoom z0 to z1 over a turn of `angleRad`, at eased progress u (0..1). Interpolates in log
 * zoom; when both ends are zoomed in further than a view that holds both places (about FIT_MARGIN * 0.8 /
 * sin(angle / 2)), it zooms out to that view half-way and back in, like a web map's fly-to.
 */
export function flightZoom(z0, z1, angleRad, u) {
  const L0 = Math.log(z0);
  const L1 = Math.log(z1);
  const both = (FIT_MARGIN * 0.8) / Math.max(1e-9, Math.sin(Math.min(Math.PI, angleRad) / 2));
  const Lm = Math.log(Math.max(1, Math.min(both, z0, z1)));
  const lin = L0 + (L1 - L0) * u;
  if (Lm >= Math.min(L0, L1) - 1e-9) return Math.exp(lin);
  // Quadratic Bezier in log zoom through (0, L0), (0.5, Lm), (1, L1).
  const c = 2 * Lm - (L0 + L1) / 2;
  return Math.exp((1 - u) * (1 - u) * L0 + 2 * u * (1 - u) * c + u * u * L1);
}

/** Duration (ms) of an animated flight: longer for a bigger turn and a bigger change of zoom, 450 to 1600 ms. */
export function flightMs(angleRad, z0, z1) {
  return Math.round(clampN(450 + 520 * (angleRad / Math.PI) + 140 * Math.abs(Math.log2(z1 / z0)), 450, 1600));
}

// ----- Zoom limits and snapping -----

/** Mean Moon radius (km), the sphere the globe draws (IAU 2015). */
export const R_MOON_KM = 1737.4;

/**
 * Zoom limits. MIN_ZOOM shows the disc with room around it. MAX_ZOOM shows about 1.5 km across the frame's shorter
 * side (viewSpanKm); the images are stretched past their own resolution there (blurred, not wrong). FIT_MAX_ZOOM caps
 * the automatic "fit these points" moves (about 60 km across), so they never dive in further than a person would.
 */
export const MIN_ZOOM = 0.9;
export const MAX_ZOOM = 2500;
export const FIT_MAX_ZOOM = 60;

/** Ground distance (km) across the frame's shorter side at `zoom`, for a view straight down (orthographic). */
export function viewSpanKm(zoom) {
  return (2 * FIT_MARGIN * R_MOON_KM) / zoom;
}

/** Pointer distance (CSS px) within which a click or a dragged pin snaps onto a sunlit-spot marker. */
export const SNAP_PX = 12;

/**
 * The marker a pointer at (x, y) (CSS px) snaps to, or null: the nearest of `items` [{x, y, rPx, depth}] within its
 * reach. The reach is SNAP_PX around a small marker (a sun symbol); a ring drawn around a larger spot reaches to the
 * ring plus 4 px, at most `maxPx`, so that a deep zoom can still place a pin anywhere inside a big ring's centre area.
 * Items with depth <= 0.05 (at or behind the limb) never snap.
 */
export function snapTarget(items, x, y, { minPx = SNAP_PX, maxPx = 40 } = {}) {
  let best = null;
  let bestD = Infinity;
  for (const it of items) {
    if (!(it.depth > 0.05)) continue;
    const d = Math.hypot(it.x - x, it.y - y);
    const reach = Math.min(maxPx, Math.max(minPx, (it.rPx || 0) + 4));
    if (d <= reach && d < bestD) {
      best = it;
      bestD = d;
    }
  }
  return best;
}
