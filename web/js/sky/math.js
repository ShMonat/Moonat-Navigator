// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// Pure maths for the sky view (no three.js, no DOM), so it runs under `node --test`.
//
// Frames (docs/CONTRACTS.md §0):
//   ENU    site frame: x = east, y = north, z = up. Azimuth is clockwise from north (0 = N, 90 = E).
//   three  render frame: x = east, y = up, z = -north (right-handed). Camera (eye) at the origin.
//   ICRS   J2000 equatorial, z = celestial north pole.
//   body   Earth-fixed: z = north pole, x = (lat 0, lon 0), y = (lat 0, lon 90 E).
// All matrices are row-major arrays of 9 numbers; `mat3Vec(R, v)` computes R·v.
// Angles are degrees at function interfaces unless the name ends in `Rad`.

export const DEG = Math.PI / 180;
export const R_MOON_M = 1737400;

/** Fixed axis permutation from a z-up frame (ENU, ICRS, body) to a three.js-style y-up frame: (x, y, z) -> (x, z, -y). */
export const M_ZUP_TO_YUP = [1, 0, 0, 0, 0, 1, 0, -1, 0];

export function mat3Mul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}

export function mat3Vec(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function mat3Transpose(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Active rotation about +z by `deg` (counter-clockwise seen from +z): v' = Rz·v. */
export function rotZ(deg) {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** ENU vector [e, n, u] -> three.js vector [x, y, z] = [e, u, -n]. */
export function enuToThree(v) {
  return [v[0], v[2], -v[1]];
}

/** Unit ENU vector of a direction given by true azimuth and elevation (deg). */
export function azElToEnu(azDeg, elDeg) {
  const a = azDeg * DEG, e = elDeg * DEG;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

/** ENU vector -> { az_deg in 0..360, el_deg }. */
export function enuToAzEl(v) {
  const h = Math.hypot(v[0], v[1]);
  let az = Math.atan2(v[0], v[1]) / DEG;
  if (az < 0) az += 360;
  return { az_deg: az, el_deg: Math.atan2(v[2], h) / DEG };
}

/**
 * Convert a rotation R (target_zup = R · source_zup, e.g. r_icrs_to_enu) into the rotation that acts between the
 * y-up versions of both frames: three = (M·R·Mᵀ) · source_yup, where source_yup = M · source_zup.
 * Use it as the object matrix of anything whose geometry is stored as M · (z-up source vector).
 */
export function yupRotationFromZup(R) {
  return mat3Mul(mat3Mul(M_ZUP_TO_YUP, R), mat3Transpose(M_ZUP_TO_YUP));
}

/** Earth body frame -> ENU: R_icrs_to_enu · Rz(era). (C6: precession/nutation/polar motion are neglected.) */
export function earthBodyToEnu(rIcrsToEnu, eraDeg) {
  return mat3Mul(rIcrsToEnu, rotZ(eraDeg));
}

/** Unit vector in a z-up equatorial-type frame from longitude/RA and latitude/Dec (deg). */
export function lonLatToVec(lonDeg, latDeg) {
  const l = lonDeg * DEG, b = latDeg * DEG;
  return [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
}

/**
 * Local unit direction of the three.js SphereGeometry vertex with texture coordinates (u, v) (v = 1 at the top).
 * Replicates three r160 SphereGeometry: x = -cos(2πu)·sin(θ), y = cos(θ), z = sin(2πu)·sin(θ), θ = π(1 - v).
 */
export function sphereGeomDirFromUv(u, v) {
  const phi = 2 * Math.PI * u, theta = Math.PI * (1 - v);
  return [-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)];
}

/**
 * Label direction of a constellation: the normalised mean of the unit vectors of all the points of its lines.
 * polylines: [[[ra_deg, dec_deg], ...], ...] (ICRS). Returns a unit vector [x, y, z] (z = celestial north pole), or null.
 */
export function constellationCentroid(polylines) {
  const s = [0, 0, 0];
  for (const line of polylines || []) for (const p of line) { const v = lonLatToVec(p[0], p[1]); s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; }
  const n = Math.hypot(s[0], s[1], s[2]);
  return n > 1e-9 ? [s[0] / n, s[1] / n, s[2] / n] : null;
}

/** Texture coordinates of geographic (lon east-positive, lat) on an equirectangular map with lon 0 at the centre. */
export function equirectUv(lonDeg, latDeg) {
  return [lonDeg / 360 + 0.5, latDeg / 180 + 0.5];
}

/** Vertical FOV (deg) of a perspective camera with the given horizontal FOV (deg) and aspect = width / height. */
export function verticalFovDeg(hfovDeg, aspect) {
  return (2 * Math.atan(Math.tan((hfovDeg * DEG) / 2) / aspect)) / DEG;
}

/**
 * Camera pitch and horizontal FOV (deg) that show both the horizon and a body (Earth or Sun) on the camera's azimuth.
 * Perspective camera: a point at elevation e on the centre azimuth is at height tan(e - pitch) / tan(vfov / 2), in
 * units of half the frame height. The rule (contract C8):
 *   - the horizon line sits `margin` of the half-height below the centre (0.8 = 10% of the frame above the bottom
 *     edge) and the top of the body's disk the same distance above it (10% below the top edge);
 *   - the FOV is the default when that is wide enough, and widens up to maxHfovDeg otherwise;
 *   - at the widest FOV, the horizon may slide toward the bottom edge; if both still cannot fit, the body wins;
 *   - a body entirely below the horizon: default FOV, horizon one third of the frame height above the bottom edge.
 * Inputs: body centre elevation, body angular radius, horizon elevation at the body's azimuth (all deg), aspect = w/h.
 */
export function fitBodyView({ bodyElDeg, bodyRadiusDeg = 0, horizonElDeg = 0, aspect = 16 / 9, defaultHfovDeg = 60, maxHfovDeg = 100, margin = 0.8 }) {
  const top = bodyElDeg + bodyRadiusDeg, h0 = horizonElDeg, at = (x) => Math.atan(x) / DEG;
  const T0 = Math.tan((defaultHfovDeg * DEG) / 2) / aspect, Tmax = Math.max(T0, Math.tan((maxHfovDeg * DEG) / 2) / aspect);
  // both_fit: the horizon and the whole disk fit with the rule's margins (false once the widest FOV is not enough and the
  // horizon slides toward the bottom edge, or out of the frame).
  const out = (T, el, both = true) => ({ el_deg: el, hfov_deg: (2 * Math.atan(T * aspect)) / DEG, both_fit: both });
  if (top <= h0) return out(T0, h0 + at(T0 / 3));
  const T = Math.tan(((top - h0) / 2) * DEG) / margin;
  if (T <= T0) return out(T0, h0 + at(margin * T0));
  if (T <= Tmax) return out(T, (top + h0) / 2);
  const wanted = top - at(margin * Tmax), horizonInFrame = h0 + at(0.97 * Tmax), bodyInFrame = top - at(0.95 * Tmax);
  return out(Tmax, bodyInFrame <= horizonInFrame ? Math.max(bodyInFrame, Math.min(wanted, horizonInFrame)) : wanted, false);
}

/**
 * Widest frame (aspect = width / height) in which the fitBodyView rule fits both the horizon and a body at `maxHfovDeg`:
 * horizon `margin` of the half-height below the centre, top of the disk the same distance above it. A body is in that
 * frame exactly when tan(vfov / 2) >= tan((top - horizon) / 2) / margin, and tan(vfov / 2) = tan(hfov / 2) / aspect.
 * Inputs in degrees; returns Infinity for a body at or below the horizon (any frame works).
 */
export function bodyFitAspect({ bodyElDeg, bodyRadiusDeg = 0, horizonElDeg = 0, maxHfovDeg = 100, margin = 0.8 }) {
  const span = bodyElDeg + bodyRadiusDeg - horizonElDeg;
  if (span <= 0) return Infinity;
  return Math.tan((maxHfovDeg * DEG) / 2) / (Math.tan((span / 2) * DEG) / margin);
}

/**
 * Opening "photo" framing (contract C8): the view looks like a photo taken by an astronaut standing at the site, with
 * the horizon low in the frame and the body above it. Same camera model as fitBodyView (screen height y: -1 = bottom
 * edge, +1 = top edge; a point at elevation e on the centre azimuth is at y = tan(e - pitch) / tan(vfov / 2)).
 *   - the horizon sits at `horizonY` (-0.6 = 20% of the frame height above the bottom edge);
 *   - the FOV is `hfovDeg` when the top of the body's disk is then at or below `topY` (0.84 = 8% below the top edge);
 *     otherwise the FOV widens until the body's top is at `topY`, up to `maxHfovDeg`;
 *   - a body too high for that (e.g. the Earth at 59 deg seen from Apollo 11 in a 16:9 frame): the frame keeps the
 *     comfortable `hfovDeg` and the horizon at `horizonY`, and the body is above the frame (body_in_frame = false).
 *     `aspect_max` is then the widest frame (width / height) in which the body and the horizon fit at `maxHfovDeg`;
 *   - a body entirely below the horizon: `hfovDeg`, horizon one third of the frame height above the bottom edge.
 * Inputs: body centre elevation, body angular radius, horizon elevation at the body's azimuth (deg), aspect = w / h.
 * Returns { el_deg (camera pitch), hfov_deg, body_in_frame, aspect_max }.
 */
export function fitPhotoView({ bodyElDeg, bodyRadiusDeg = 0, horizonElDeg = 0, aspect = 16 / 9, hfovDeg = 70, maxHfovDeg = 80, horizonY = -0.6, topY = 0.84 }) {
  const top = bodyElDeg + bodyRadiusDeg, h0 = horizonElDeg, at = (x) => Math.atan(x) / DEG;
  const T0 = Math.tan((hfovDeg * DEG) / 2) / aspect;
  const pitch = (T) => h0 - at(horizonY * T);
  const out = (T, el, inFrame, aspectMax = Infinity) => ({ el_deg: el, hfov_deg: (2 * Math.atan(T * aspect)) / DEG, body_in_frame: inFrame, aspect_max: aspectMax });
  if (top <= h0) return out(T0, h0 + at(T0 / 3), false);
  // Screen height of the body's top when the horizon is held at horizonY; it falls as the frame gets taller (T grows).
  const yTop = (T) => {
    const d = top - pitch(T);
    return d >= 89.999 ? Infinity : Math.tan(d * DEG) / T;
  };
  if (yTop(T0) <= topY) return out(T0, pitch(T0), true);
  let lo = T0, hi = Math.max(2 * T0, 1);
  while (yTop(hi) > topY && hi < 1e4) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (yTop(mid) > topY) lo = mid; else hi = mid;
  }
  const Tneed = hi, aspectMax = Math.tan((maxHfovDeg * DEG) / 2) / Tneed;
  if (aspect <= aspectMax * (1 + 1e-9)) return out(Tneed, pitch(Tneed), true, aspectMax);
  return out(T0, pitch(T0), false, aspectMax);
}

/** Horizon elevation (deg) of a C3 profile at azimuth `azDeg`, linear interpolation, wrapping at 360. */
export function horizonElAt(horizon, azDeg) {
  return sampleRing(horizon.el_deg, horizon.az_step_deg, azDeg);
}

export function horizonDistKmAt(horizon, azDeg) {
  return sampleRing(horizon.dist_km, horizon.az_step_deg, azDeg);
}

function sampleRing(arr, stepDeg, azDeg) {
  const n = arr.length;
  let x = (((azDeg % 360) + 360) % 360) / stepDeg;
  const i = Math.floor(x), f = x - i;
  return arr[i % n] * (1 - f) + arr[(i + 1) % n] * f;
}

/** A C3-shaped smooth horizon (el = 0 everywhere) for sites without terrain. */
export function flatHorizon(observerHeightM = 2) {
  const n = 1440;
  return {
    id: null, observer_height_m: observerHeightM, az_step_deg: 0.25,
    el_deg: new Array(n).fill(0), dist_km: new Array(n).fill(Math.sqrt(2 * R_MOON_M * observerHeightM) / 1000),
    max_range_km: 0, smooth: true,
  };
}

/** Approximate linear-sRGB colour (0..1 each) of a star from its B−V index (Ballesteros temperature + blackbody fit). */
export function bvToRgb(bv) {
  if (!Number.isFinite(bv)) bv = 0.6;
  bv = Math.min(2.0, Math.max(-0.4, bv));
  const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const t = T / 100;
  let r, g, b;
  r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = [r, g, b].map((x) => Math.min(255, Math.max(0, x)) / 255);
  const m = Math.max(c[0], c[1], c[2]);
  // Normalise to the brightest channel and desaturate a little: star colours are subtle to the eye.
  return c.map((x) => 0.35 + 0.65 * (x / m));
}

/** Deterministic PRNG (mulberry32): returns a function giving uniform numbers in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 2-D value noise in 0..1. */
export function valueNoise(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * Bilinear sample of a C4 terrain patch at ENU (east, north) metres. Returns z_up (m, relative to the ground point).
 * Outside the patch the value of the nearest edge is returned.
 */
export function samplePatch(patch, east, north) {
  const { grid_n: N, spacing_m: d, half_extent_m: h } = patch.meta;
  let c = (east + h) / d, r = (h - north) / d;
  c = Math.min(N - 1, Math.max(0, c));
  r = Math.min(N - 1, Math.max(0, r));
  const c0 = Math.min(N - 2, Math.floor(c)), r0 = Math.min(N - 2, Math.floor(r));
  const fc = c - c0, fr = r - r0, z = patch.data, i = r0 * N + c0;
  return (z[i] * (1 - fc) + z[i + 1] * fc) * (1 - fr) + (z[i + N] * (1 - fc) + z[i + N + 1] * fc) * fr;
}

/**
 * Horizon profile (C3 shape) computed from a C4 patch alone: for each azimuth, the maximum elevation angle of the
 * patch surface seen from the eye (ground + observerHeightM at the patch centre). The patch values already include
 * the curvature drop, so straight rays in ENU are correct. Terrain beyond the patch is not seen (lower bound).
 */
export function horizonFromPatch(patch, observerHeightM = 2, azStepDeg = 0.25) {
  const { spacing_m: d, half_extent_m: h } = patch.meta;
  const n = Math.round(360 / azStepDeg), el = new Array(n), dist = new Array(n);
  const z0 = samplePatch(patch, 0, 0) + observerHeightM;
  for (let k = 0; k < n; k++) {
    const a = k * azStepDeg * DEG, se = Math.sin(a), sn = Math.cos(a);
    let best = -Infinity, bestR = 0;
    for (let r = 1; r <= h; r += Math.max(0.5, Math.min(0.5 * d, 0.02 * r))) {
      const t = (samplePatch(patch, r * se, r * sn) - z0) / r;
      if (t > best) { best = t; bestR = r; }
    }
    el[k] = Math.atan(best) / DEG;
    dist[k] = bestR / 1000;
  }
  return { id: patch.meta.id ?? null, observer_height_m: observerHeightM, az_step_deg: azStepDeg, el_deg: el, dist_km: dist, max_range_km: h / 1000, from_patch: true };
}

/** A number with `digits` decimals and a typographic minus sign (U+2212) when negative; "-0.0" prints as "0.0". */
export function signed1(x, digits = 1) {
  const a = Math.abs(x).toFixed(digits);
  return x < 0 && Number(a) !== 0 ? `−${a}` : a;
}

/** ISO-8601 UTC string (seconds precision) for a JS epoch in milliseconds. */
export function isoUtc(tMs) {
  return new Date(tMs).toISOString().replace(/\.\d+Z$/, 'Z');
}
