// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Reference frames and small vector maths for the browser physics (docs/CONTRACTS.md §0).
// Frames: MOON_ME (Moon body-fixed, Mean Earth / polar axis), ICRS, and the site's local ENU
// (x = east, y = north, z = up, up = unit vector from the Moon's centre to the site).
// All matrices are row-major 3x3 arrays of 9 numbers. Angles are radians inside, degrees at the API.

export const MOON_RADIUS_KM = 1737.4; // LOLA reference sphere
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Row-major 3x3 matrix times 3-vector. `out` may be given to avoid allocation. */
export function matVec(m, v, out = [0, 0, 0]) {
  const x = v[0], y = v[1], z = v[2];
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[3] * x + m[4] * y + m[5] * z;
  out[2] = m[6] * x + m[7] * y + m[8] * z;
  return out;
}

/** Row-major 3x3 product a·b. */
export function matMul(a, b) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      o[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
    }
  }
  return o;
}

export function norm(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

/**
 * Rotation matrix (row-major) of a unit quaternion (w, x, y, z), as an active rotation:
 * v_out = q · v_in · q*. With q = q_icrs_to_me this maps ICRS vectors to MOON_ME vectors.
 */
export function quatToMatrix(q) {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/**
 * Site position and local frame in MOON_ME.
 * lat/lon: selenographic ME (deg, lon east-positive); heights in metres above the 1737.4 km sphere.
 * Returns {pos_me: [km], r_me_to_enu: [9]} where the matrix rows are the east, north and up unit
 * vectors (so enu = R · v_me). North is the projection of ME +Z on the horizontal plane; exactly at
 * a pole (|lat| > 89.9999 deg) north is the direction toward the 0 deg meridian (ME +X).
 */
export function siteFrame(lat_deg, lon_deg, ground_elev_m = 0, observer_height_m = 2) {
  const lat = lat_deg * DEG, lon = lon_deg * DEG;
  const r = MOON_RADIUS_KM + (ground_elev_m + observer_height_m) / 1000;
  const cl = Math.cos(lat), sl = Math.sin(lat), co = Math.cos(lon), so = Math.sin(lon);
  const up = [cl * co, cl * so, sl];
  let east, north;
  if (Math.abs(lat_deg) > 89.9999) {
    up[0] = 0; up[1] = 0; up[2] = Math.sign(lat_deg);
    north = [1, 0, 0];
    // east = north × up keeps (east, north, up) right-handed.
    east = [north[1] * up[2] - north[2] * up[1], north[2] * up[0] - north[0] * up[2], north[0] * up[1] - north[1] * up[0]];
  } else {
    east = [-so, co, 0];
    north = [-sl * co, -sl * so, cl];
  }
  return {
    pos_me: [r * up[0], r * up[1], r * up[2]],
    r_me_to_enu: [...east, ...north, ...up],
  };
}

/**
 * True azimuth (deg, 0..360, clockwise from north) and elevation (deg) of an ENU vector, and its
 * length (same unit as the input).
 */
export function enuToAzEl(v) {
  const r = norm(v);
  let az = Math.atan2(v[0], v[1]) * RAD;
  if (az < 0) az += 360;
  const el = Math.atan2(v[2], Math.hypot(v[0], v[1])) * RAD;
  return { az_deg: az, el_deg: el, r };
}

/** Unit ENU vector for a true azimuth and elevation (deg). */
export function azElToEnu(az_deg, el_deg) {
  const az = az_deg * DEG, el = el_deg * DEG;
  return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
}

/**
 * Earth Rotation Angle (deg, 0..360) for a UTC epoch in ms, taking UT1 = UTC (error < 0.9 s,
 * i.e. < 0.004 deg). IERS Conventions 2010 eq. 5.15:
 * ERA = 2π (0.7790572732640 + 1.00273781191135448 · (JD_UT1 − 2451545.0)).
 */
export function eraDeg(tMs) {
  const du = (tMs - 946728000000) / 86400000; // days since 2000-01-01T12:00:00Z (JD 2451545.0)
  // Split the integer day to keep precision: ERA = 2π(frac(du) + 0.779... + 0.00273...·du).
  const f = (du % 1) + 0.7790572732640 + 0.00273781191135448 * du;
  let deg = (f % 1) * 360;
  if (deg < 0) deg += 360;
  return deg;
}
