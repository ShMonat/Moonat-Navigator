// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// PLACEHOLDER[sky-state]: a LOW-PRECISION stand-in for web/js/physics/index.js (contract C6), used only by the sky
// demo page and tests until the real physics layer lands. Accuracy is roughly 0.1-0.5 deg:
//   - Sun and planets: JPL "approximate positions of the planets" Keplerian elements (J2000 ecliptic).
//   - Moon: leading terms of the Meeus (ELP-2000/82 truncated) series.
//   - Lunar orientation: Cassini's laws with mean elements (optical libration only; no physical libration).
//   - No light-time, no aberration, UT = TT.
// Do NOT use these numbers for anything shown as a result. Output shapes follow C6 exactly.

import { DEG, mat3Mul, mat3Vec, normalize, enuToAzEl, horizonElAt } from './math.js';

const AU_KM = 149597870.7, R_MOON_KM = 1737.4, R_EARTH_KM = 6378.137, R_SUN_KM = 695700;
const OBLIQUITY_DEG = 23.4392911;

// name: [a AU, e, I deg, L deg, long.peri deg, long.node deg, dL deg/cy, dPeri deg/cy, dNode deg/cy]
const ELEMENTS = {
  mercury: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 149472.67411175, 0.16047689, -0.12534081],
  venus: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 58517.81538729, 0.00268329, -0.27769418],
  emb: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0, 35999.37244981, 0.32327364, 0.0],
  mars: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 19140.30268499, 0.44441088, -0.29257343],
  jupiter: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, 3034.74612775, 0.21252668, 0.20469106],
  saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, 1222.49362201, -0.41897216, -0.28867794],
};
const PLANETS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'];

/** Heliocentric J2000-ecliptic position (AU) from mean Keplerian elements at T Julian centuries from J2000. */
function helio(name, T) {
  const [a, e, I, L0, w0, O0, dL, dw, dO] = ELEMENTS[name];
  const L = L0 + dL * T, wb = w0 + dw * T, O = O0 + dO * T;
  const w = (wb - O) * DEG;
  let M = ((L - wb) % 360) * DEG, E = M;
  for (let i = 0; i < 8; i++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O * DEG), sO = Math.sin(O * DEG), cI = Math.cos(I * DEG), sI = Math.sin(I * DEG);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** Geocentric Moon in J2000 ecliptic (km), plus the mean arguments needed for the orientation. */
function moonGeo(T) {
  const Lp = 218.3164477 + 481267.88123421 * T, D = (297.8501921 + 445267.1114034 * T) * DEG;
  const M = (357.5291092 + 35999.0502909 * T) * DEG, Mp = (134.9633964 + 477198.8675055 * T) * DEG;
  const Fdeg = 93.272095 + 483202.0175233 * T, F = Fdeg * DEG, s = Math.sin, c = Math.cos;
  const lonDate = Lp + 6.288774 * s(Mp) + 1.274027 * s(2 * D - Mp) + 0.658314 * s(2 * D) + 0.213618 * s(2 * Mp)
    - 0.185116 * s(M) - 0.114332 * s(2 * F) + 0.058793 * s(2 * D - 2 * Mp) + 0.057066 * s(2 * D - M - Mp)
    + 0.053322 * s(2 * D + Mp) + 0.045758 * s(2 * D - M) - 0.040923 * s(M - Mp) - 0.03472 * s(D)
    - 0.030383 * s(M + Mp) + 0.015327 * s(2 * D - 2 * F) - 0.012528 * s(Mp + 2 * F) + 0.01098 * s(Mp - 2 * F);
  const lat = 5.128122 * s(F) + 0.280602 * s(Mp + F) + 0.277693 * s(Mp - F) + 0.173237 * s(2 * D - F)
    + 0.055413 * s(2 * D - Mp + F) + 0.046271 * s(2 * D - Mp - F) + 0.032573 * s(2 * D + F) + 0.017198 * s(2 * Mp + F);
  const dist = 385000.56 - 20905.355 * c(Mp) - 3699.111 * c(2 * D - Mp) - 2955.968 * c(2 * D) - 569.925 * c(2 * Mp)
    + 48.888 * c(M) - 3.149 * c(2 * F) + 246.158 * c(2 * D - 2 * Mp) - 152.138 * c(2 * D - M - Mp)
    - 170.733 * c(2 * D + Mp) - 204.586 * c(2 * D - M) - 129.62 * c(M - Mp) + 108.743 * c(D) + 104.755 * c(M + Mp);
  const prec = 1.396971 * T; // general precession in longitude: ecliptic of date -> J2000
  const lon = (lonDate - prec) * DEG, b = lat * DEG;
  const nodeDeg = 125.0445479 - 1934.1362891 * T - prec;
  return { pos: [dist * c(b) * c(lon), dist * c(b) * s(lon), dist * s(b)], Fdeg, nodeDeg };
}

function r3(deg) { // passive rotation about z
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}
function r1(deg) { // passive rotation about x
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

/** C6 makeSite. */
export function makeSite({ lat_deg, lon_deg, ground_elev_m = 0, observer_height_m = 2, horizon = null }) {
  return { lat_deg, lon_deg, ground_elev_m, observer_height_m, horizon };
}

/** C6 skyState (low precision; synchronous result wrapped in a promise to match the real API). */
export async function skyState(site, tMs) {
  return skyStateSync(site, tMs);
}

export function skyStateSync(site, tMs) {
  const jd = tMs / 86400000 + 2440587.5, T = (jd - 2451545.0) / 36525;
  const emb = helio('emb', T), moon = moonGeo(T);
  const eclToMe = mat3Mul(r3(moon.Fdeg), mat3Mul(r1(1.5424), r3(moon.nodeDeg + 180)));
  const eqToEcl = r1(OBLIQUITY_DEG);
  const la = site.lat_deg * DEG, lo = site.lon_deg * DEG;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
  const meToEnu = [...east, ...north, ...up];
  const eclToEnu = mat3Mul(meToEnu, eclToMe);
  const rSite = R_MOON_KM + (site.ground_elev_m + site.observer_height_m) / 1000;
  const siteEnu = [0, 0, rSite];

  const topo = (eclMoonCentred) => { // Moon-centred J2000-ecliptic km -> topocentric ENU km
    const v = mat3Vec(eclToEnu, eclMoonCentred);
    return [v[0] - siteEnu[0], v[1] - siteEnu[1], v[2] - siteEnu[2]];
  };
  const sunM = [-emb[0] * AU_KM - moon.pos[0], -emb[1] * AU_KM - moon.pos[1], -emb[2] * AU_KM - moon.pos[2]];
  const earthM = moon.pos.map((x) => -x);
  const hor = (az) => (site.horizon ? horizonElAt(site.horizon, az) : 0);
  const body = (vEnu, radiusKm) => {
    const dist = Math.hypot(...vEnu), { az_deg, el_deg } = enuToAzEl(vEnu);
    const rho = Math.asin(radiusKm / dist) / DEG;
    const vis = Math.min(1, Math.max(0, (el_deg - hor(az_deg)) / (2 * rho) + 0.5));
    return { az_deg, el_deg, dist_km: dist, ang_radius_deg: rho, vis_frac: vis, enu: normalize(vEnu) };
  };
  const sunT = topo(sunM), earthT = topo(earthM);
  const sun = body(sunT, R_SUN_KM);
  sun.flux_frac = sun.vis_frac;
  const earth = body(earthT, R_EARTH_KM);
  const e2s = normalize([sunT[0] - earthT[0], sunT[1] - earthT[1], sunT[2] - earthT[2]]);
  const e2o = normalize(earthT.map((x) => -x));
  earth.phase_frac = (1 + e2s[0] * e2o[0] + e2s[1] * e2o[1] + e2s[2] * e2o[2]) / 2;
  earth.sun_dir_enu = e2s;
  earth.era_deg = (((360 * (0.779057273264 + 1.00273781191135448 * (jd - 2451545.0))) % 360) + 360) % 360;   // IAU 2000 ERA, UT1 = UTC
  const planets = PLANETS.map((name) => {
    const p = helio(name, T);
    const v = topo([(p[0] - emb[0]) * AU_KM - moon.pos[0], (p[1] - emb[1]) * AU_KM - moon.pos[1], (p[2] - emb[2]) * AU_KM - moon.pos[2]]);
    return { name, ...enuToAzEl(v), enu: normalize(v) };
  });
  return { t_ms: tMs, sun, earth, planets, r_icrs_to_enu: mat3Mul(eclToEnu, eqToEcl) };
}
