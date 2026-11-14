// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Browser physics API (contract C6 `sky-state`, docs/CONTRACTS.md): where the Sun, the Earth and
// the planets are in the sky of a lunar site, how much of each disk clears the terrain horizon,
// solar flux and Earth phase, for one instant (skyState) or a time range (series).
//
// Chain: ephemeris table (Moon-centred MOON_ME positions, ICRS->ME quaternion) -> site position and
// ENU frame in MOON_ME -> topocentric vector = body − site -> az/el/distance/angular radius ->
// disk visibility vs the horizon profile -> flux and phase.

import { openEphem, ensureRange, stateAtMs, REC, OFFSETS } from './ephem.js';
import { siteFrame, matVec, matMul, quatToMatrix, enuToAzEl, eraDeg, RAD } from './frames.js';
import { prepareHorizon, diskFractions, LIMB_DARKENING_U } from './visibility.js';
import {
  fluxNormalWm2, fluxHorizWm2, earthPhaseFrac, seriesSummary, SUN_RADIUS_KM, EARTH_RADIUS_KM,
} from './metrics.js';

/**
 * Terrain horizon of any point from the coarse DEM tiles (C5), in the C3 shape plus
 * {source: "dem-tiles", approximate: true, label} (see terrain.js):
 * `await horizonFromTiles(lat_deg, lon_deg, {observer_height_m = 2, az_step_deg = 0.5, baseUrl = "data/dem"})`
 */
export { horizonFromTiles } from './terrain.js';

let EPH = null;
const BUF = new Float64Array(REC);
// Body radii (km): from the manifest's body_radii_km when present (one source with moonat.ephem).
let R_SUN = SUN_RADIUS_KM, R_EARTH = EARTH_RADIUS_KM;

/**
 * Fetches web/data/ephem/manifest.json under `baseUrl` (e.g. "data/ephem"). Year tables load
 * lazily when a time in that year is first requested. Returns the manifest.
 * `opts.fetch` replaces the global fetch (used by the Node tests to read local files).
 */
export async function loadEphem(baseUrl = 'data/ephem', opts = {}) {
  const fetchFn = opts.fetch ?? ((url) => globalThis.fetch(url));
  EPH = await openEphem(baseUrl, fetchFn);
  R_SUN = EPH.manifest.body_radii_km?.sun ?? SUN_RADIUS_KM;
  R_EARTH = EPH.manifest.body_radii_km?.earth ?? EARTH_RADIUS_KM;
  return EPH.manifest;
}

/**
 * A lunar site. lat/lon: selenographic MOON_ME (deg, lon east-positive). ground_elev_m: DEM height
 * above the 1737.4 km sphere (defaults to horizon.ground_elev_m when a horizon is given, else 0).
 * observer_height_m: eye above the ground (default 2). horizon: C3 profile object or null (smooth).
 */
export function makeSite({ lat_deg, lon_deg, ground_elev_m, observer_height_m = 2, horizon = null } = {}) {
  if (!Number.isFinite(lat_deg) || !Number.isFinite(lon_deg)) throw new Error('makeSite: lat_deg and lon_deg are required');
  const elev = ground_elev_m ?? horizon?.ground_elev_m ?? 0;
  const f = siteFrame(lat_deg, lon_deg, elev, observer_height_m);
  const site = { lat_deg, lon_deg, ground_elev_m: elev, observer_height_m, horizon };
  Object.defineProperty(site, '_physics', {
    value: { pos: f.pos_me, R: f.r_me_to_enu, hz: prepareHorizon(horizon) },
    enumerable: false,
  });
  return site;
}

function physicsOf(site) {
  return site._physics ?? makeSite(site)._physics;
}

function requireEph() {
  if (!EPH) throw new Error('physics: call loadEphem(baseUrl) first');
  return EPH;
}

// Topocentric ENU vector (km) of a Moon-centred MOON_ME position at offset `o` of the state buffer.
function topo(P, s, o, out) {
  const d = [s[o] - P.pos[0], s[o + 1] - P.pos[1], s[o + 2] - P.pos[2]];
  return matVec(P.R, d, out);
}

function bodyAt(P, s, o, radiusKm) {
  const v = topo(P, s, o, [0, 0, 0]);
  const { az_deg, el_deg, r } = enuToAzEl(v);
  return {
    az_deg, el_deg, dist_km: r,
    ang_radius_deg: Math.asin(Math.min(1, radiusKm / r)) * RAD,
    enu: [v[0] / r, v[1] / r, v[2] / r],
  };
}

function stateAt(site, tMs) {
  const eph = requireEph();
  const P = physicsOf(site);
  const s = stateAtMs(eph, tMs, BUF);
  const S = OFFSETS.sun, E = OFFSETS.earth;

  const sun = bodyAt(P, s, S, R_SUN);
  const sf = diskFractions(sun.az_deg, sun.el_deg, sun.ang_radius_deg, P.hz, LIMB_DARKENING_U, sun.enu);
  sun.vis_frac = sf.vis;
  sun.flux_frac = sf.flux;
  sun.flux_normal_wm2 = fluxNormalWm2(sun.dist_km, sun.flux_frac);
  sun.flux_horiz_wm2 = fluxHorizWm2(sun.dist_km, sun.flux_frac, sun.el_deg);

  const earth = bodyAt(P, s, E, R_EARTH);
  earth.vis_frac = diskFractions(earth.az_deg, earth.el_deg, earth.ang_radius_deg, P.hz, null, earth.enu).vis;
  const earthMe = [s[E], s[E + 1], s[E + 2]];
  const sunMe = [s[S], s[S + 1], s[S + 2]];
  earth.phase_frac = earthPhaseFrac(earthMe, sunMe, P.pos);
  const es = [sunMe[0] - earthMe[0], sunMe[1] - earthMe[1], sunMe[2] - earthMe[2]];
  const esn = Math.hypot(es[0], es[1], es[2]);
  earth.sun_dir_enu = matVec(P.R, [es[0] / esn, es[1] / esn, es[2] / esn]);
  earth.era_deg = eraDeg(tMs);

  const q = [s[OFFSETS.q], s[OFFSETS.q + 1], s[OFFSETS.q + 2], s[OFFSETS.q + 3]];
  const rIcrsToEnu = matMul(P.R, quatToMatrix(q));
  const names = eph.manifest.planets ?? [];
  const planets = names.map((name, k) => {
    const o = OFFSETS.planets + 3 * k;
    const enu = matVec(rIcrsToEnu, [s[o], s[o + 1], s[o + 2]]);
    const { az_deg, el_deg } = enuToAzEl(enu);
    return { name, az_deg, el_deg, enu };
  });

  return { t_ms: tMs, sun, earth, planets, r_icrs_to_enu: rIcrsToEnu };
}

/**
 * Sky state at one UTC instant (epoch ms): Sun, Earth and planets in the site's sky (C6).
 * Extra fields beyond C6: sun.flux_normal_wm2, sun.flux_horiz_wm2. All `enu` vectors are unit.
 */
export async function skyState(site, tMs) {
  await ensureRange(requireEph(), tMs);
  return stateAt(site, tMs);
}

/**
 * Time series from t0Ms to t1Ms (inclusive when it falls on the grid) every stepMs (C6).
 * The site frame is computed once; each sample interpolates the table and evaluates both disks.
 */
export async function series(site, t0Ms, t1Ms, stepMs) {
  const eph = requireEph();
  if (!(stepMs > 0)) throw new Error('series: stepMs must be > 0');
  const n = t1Ms >= t0Ms ? Math.floor((t1Ms - t0Ms) / stepMs + 1e-9) + 1 : 0;
  if (n > 2_000_000) throw new Error(`series: too many samples (${n})`);
  const out = {
    t_ms: new Array(n), sun_el: new Array(n), sun_az: new Array(n), sun_vis: new Array(n),
    flux_horiz_wm2: new Array(n), flux_normal_wm2: new Array(n),
    earth_el: new Array(n), earth_az: new Array(n), earth_vis: new Array(n),
    earth_phase: new Array(n), earth_ang_diam_deg: new Array(n),
  };
  if (n === 0) {
    out.summary = seriesSummary([], [], [], []);
    return out;
  }
  await ensureRange(eph, t0Ms, t0Ms + (n - 1) * stepMs);
  const P = physicsOf(site);
  const S = OFFSETS.sun, E = OFFSETS.earth;
  const v = [0, 0, 0];

  const sunAt = (s, i, t) => {
    topo(P, s, S, v);
    const { az_deg, el_deg, r } = enuToAzEl(v);
    const rho = Math.asin(R_SUN / r) * RAD;
    const f = diskFractions(az_deg, el_deg, rho, P.hz, LIMB_DARKENING_U, [v[0] / r, v[1] / r, v[2] / r]);
    if (i < 0) return f.vis;
    out.t_ms[i] = t; out.sun_az[i] = az_deg; out.sun_el[i] = el_deg; out.sun_vis[i] = f.vis;
    out.flux_normal_wm2[i] = fluxNormalWm2(r, f.flux);
    out.flux_horiz_wm2[i] = fluxHorizWm2(r, f.flux, el_deg);
    return f.vis;
  };
  const earthAt = (s, i) => {
    topo(P, s, E, v);
    const { az_deg, el_deg, r } = enuToAzEl(v);
    const rho = Math.asin(R_EARTH / r) * RAD;
    const vis = diskFractions(az_deg, el_deg, rho, P.hz, null, [v[0] / r, v[1] / r, v[2] / r]).vis;
    if (i < 0) return vis;
    out.earth_az[i] = az_deg; out.earth_el[i] = el_deg; out.earth_vis[i] = vis;
    out.earth_ang_diam_deg[i] = 2 * rho;
    out.earth_phase[i] = earthPhaseFrac([s[E], s[E + 1], s[E + 2]], [s[S], s[S + 1], s[S + 2]], P.pos);
    return vis;
  };

  for (let i = 0; i < n; i++) {
    const t = t0Ms + i * stepMs;
    const s = stateAtMs(eph, t, BUF);
    sunAt(s, i, t);
    earthAt(s, i);
  }
  out.summary = seriesSummary(
    out.t_ms, out.sun_vis, out.earth_vis, out.flux_horiz_wm2,
    (t) => sunAt(stateAtMs(eph, t, BUF), -1, t),
    (t) => earthAt(stateAtMs(eph, t, BUF), -1),
  );
  return out;
}
