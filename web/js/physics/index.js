// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Browser physics API (contract C6 `sky-state`, docs/CONTRACTS.md): where the Sun, the Earth and
// the planets are in the sky of a lunar site, how much of each disk clears the terrain horizon,
// solar flux and Earth phase, for one instant (skyState) or a time range (series).
//
// Chain: ephemeris table (Moon-centred MOON_ME positions, ICRS->ME quaternion) -> site position and
// ENU frame in MOON_ME -> topocentric vector = body − site -> az/el/distance/angular radius ->
// disk visibility vs the horizon profile -> eclipse of the Sun by the Earth -> flux and phase.

import { openEphem, ensureRange, stateAtMs, REC, OFFSETS } from './ephem.js';
import { siteFrame, matVec, matMul, quatToMatrix, enuToAzEl, eraDeg, RAD } from './frames.js';
import { prepareHorizon, diskFractions, LIMB_DARKENING_U } from './visibility.js';
import { sunEclipseFrac, combinedFluxFrac, eclipseEvents, sepRad, MAX_SEP_RATE_DEG_PER_MS } from './eclipse.js';
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
  const earth = bodyAt(P, s, E, R_EARTH);
  const ecl = sunEclipseFrac(sun.enu, sun.ang_radius_deg, earth.enu, earth.ang_radius_deg);
  const occ = ecl > 0 ? { enu: earth.enu, rho_deg: earth.ang_radius_deg } : null;
  const sf = diskFractions(sun.az_deg, sun.el_deg, sun.ang_radius_deg, P.hz, LIMB_DARKENING_U, sun.enu, occ);
  sun.vis_frac = sf.vis;
  sun.eclipse_frac = ecl;
  sun.flux_frac = combinedFluxFrac(sf, ecl);
  sun.flux_normal_wm2 = fluxNormalWm2(sun.dist_km, sun.flux_frac);
  sun.flux_horiz_wm2 = fluxHorizWm2(sun.dist_km, sun.flux_frac, sun.el_deg);

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
 * sun.vis_frac is terrain-only; sun.eclipse_frac = share of the Sun's limb-darkened flux hidden by
 * the Earth's disk (eclipse.js); sun.flux_frac combines both (terrain and Earth).
 * Extra fields beyond C6: sun.flux_normal_wm2, sun.flux_horiz_wm2. All `enu` vectors are unit.
 */
export async function skyState(site, tMs) {
  await ensureRange(requireEph(), tMs);
  return stateAt(site, tMs);
}

const SUB_BUF = new Float64Array(REC);

/**
 * Sub-solar point on the Moon at one UTC instant (epoch ms, POSIX time like JS Date): the point of the Moon's mean
 * sphere (1737.4 km) where the centre of the Sun is at the zenith. Day and night on a smooth Moon follow from it: a
 * point at angular distance θ from it has the Sun's centre at elevation 90° − θ.
 * Frame: MOON_ME (mean Earth / polar axis, the frame of the C1 tables and of every skyState() azimuth); latitude north
 * and longitude east, in degrees, longitude in −180..180.
 * Direction: the same apparent Sun as skyState(): the C1 `sun_me` direction from the Moon's centre (light time and
 * aberration applied), so the globe's terminator and the sky view agree. On a sphere, planetocentric and
 * planetodetic latitudes are equal.
 * Assumptions: smooth sphere, no terrain (local shadows are the sky view's and the PSR layer's job); seen from the
 * Moon's centre, so a surface site's Sun elevation differs from 90° − θ by the parallax, at most
 * R_moon / d_sun ≈ 0.0007°.
 * Returns { lat_deg, lon_deg, dir_me: [x, y, z] (unit vector toward the Sun, MOON_ME), sun_me_km, earth_me_km }, the
 * last two the C1 apparent positions (km, MOON_ME, from the Moon's centre) of the Sun and the Earth, for the Earth's
 * shadow on the Moon during an eclipse (web/js/globe/daylight.js).
 * Checked against JPL Horizons (SunSub-LON / SunSub-LAT, MOON_ME) in web/tests/physics_subsolar.test.mjs.
 */
export async function subsolarPoint(tMs) {
  const eph = requireEph();
  await ensureRange(eph, tMs);
  const s = stateAtMs(eph, tMs, SUB_BUF);
  const S = OFFSETS.sun;
  const r = Math.hypot(s[S], s[S + 1], s[S + 2]);
  const dir = [s[S] / r, s[S + 1] / r, s[S + 2] / r];
  const E = OFFSETS.earth;
  return {
    lat_deg: Math.asin(Math.max(-1, Math.min(1, dir[2]))) * RAD,
    lon_deg: Math.atan2(dir[1], dir[0]) * RAD,
    dir_me: dir,
    sun_me_km: [s[S], s[S + 1], s[S + 2]],
    earth_me_km: [s[E], s[E + 1], s[E + 2]],
  };
}

/**
 * Time series from t0Ms to t1Ms (inclusive when it falls on the grid) every stepMs (C6).
 * The site frame is computed once; each sample interpolates the table and evaluates both disks.
 * Beyond the C6 arrays: sun_eclipse (eclipse fraction), sun_flux_frac (visible flux fraction, terrain
 * and Earth) and `eclipses`, the list of eclipse events in the window (eclipse.js eclipseEvents).
 * summary.sun_vis_pct counts samples with some sunlight (sun_flux_frac > 0): a total eclipse is not
 * sunlight. Set times follow the terrain-only visibility.
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
    sun_eclipse: new Array(n), sun_flux_frac: new Array(n),
  };
  if (n === 0) {
    out.eclipses = [];
    out.summary = seriesSummary([], [], [], []);
    return out;
  }
  await ensureRange(eph, t0Ms, t0Ms + (n - 1) * stepMs);
  const P = physicsOf(site);
  const S = OFFSETS.sun, E = OFFSETS.earth;
  const v = [0, 0, 0];
  // Scratch geometry of the last evaluated instant: unit directions and angular radii (deg).
  const us = [0, 0, 0], ue = [0, 0, 0];
  const occ = { enu: ue, rho_deg: 0 };
  let sAz = 0, sEl = 0, sR = 0, sRho = 0, eAz = 0, eEl = 0, eR = 0, eRho = 0;
  const geom = (s) => {
    topo(P, s, S, v);
    ({ az_deg: sAz, el_deg: sEl, r: sR } = enuToAzEl(v));
    sRho = Math.asin(R_SUN / sR) * RAD;
    us[0] = v[0] / sR; us[1] = v[1] / sR; us[2] = v[2] / sR;
    topo(P, s, E, v);
    ({ az_deg: eAz, el_deg: eEl, r: eR } = enuToAzEl(v));
    eRho = Math.asin(R_EARTH / eR) * RAD;
    ue[0] = v[0] / eR; ue[1] = v[1] / eR; ue[2] = v[2] / eR;
  };
  // Separation − (ρ_sun + ρ_earth) (deg), only computed when the bodies are close; Infinity otherwise.
  const nearCos = Math.cos(Math.min(Math.PI, (1.5 + 2 * MAX_SEP_RATE_DEG_PER_MS * stepMs) * Math.PI / 180));
  const margin = new Float64Array(n).fill(Infinity);

  for (let i = 0; i < n; i++) {
    const t = t0Ms + i * stepMs;
    geom(stateAtMs(eph, t, BUF));
    const c = us[0] * ue[0] + us[1] * ue[1] + us[2] * ue[2];
    if (c > nearCos) margin[i] = sepRad(us, ue) * RAD - (sRho + eRho);
    const ecl = margin[i] < 0 ? sunEclipseFrac(us, sRho, ue, eRho) : 0;
    occ.rho_deg = eRho;
    const f = diskFractions(sAz, sEl, sRho, P.hz, LIMB_DARKENING_U, us, ecl > 0 ? occ : null);
    const flux = combinedFluxFrac(f, ecl);
    out.t_ms[i] = t; out.sun_az[i] = sAz; out.sun_el[i] = sEl; out.sun_vis[i] = f.vis;
    out.sun_eclipse[i] = ecl; out.sun_flux_frac[i] = flux;
    out.flux_normal_wm2[i] = fluxNormalWm2(sR, flux);
    out.flux_horiz_wm2[i] = fluxHorizWm2(sR, flux, sEl);
    out.earth_az[i] = eAz; out.earth_el[i] = eEl;
    out.earth_vis[i] = diskFractions(eAz, eEl, eRho, P.hz, null, ue).vis;
    out.earth_ang_diam_deg[i] = 2 * eRho;
    out.earth_phase[i] = earthPhaseFrac([BUF[E], BUF[E + 1], BUF[E + 2]], [BUF[S], BUF[S + 1], BUF[S + 2]], P.pos);
  }

  const at = (t) => geom(stateAtMs(eph, t, BUF));
  const sunVisAt = (t) => { at(t); return diskFractions(sAz, sEl, sRho, P.hz, LIMB_DARKENING_U, us).vis; };
  const earthVisAt = (t) => { at(t); return diskFractions(eAz, eEl, eRho, P.hz, null, ue).vis; };
  out.eclipses = eclipseEvents(
    out.t_ms, margin,
    (t) => { at(t); return { sep: sepRad(us, ue) * RAD, rs: sRho, re: eRho }; },
    (t) => { at(t); return sunEclipseFrac(us, sRho, ue, eRho); },
    sunVisAt,
  );
  out.summary = seriesSummary(
    out.t_ms, out.sun_vis, out.earth_vis, out.flux_horiz_wm2, sunVisAt, earthVisAt, out.sun_flux_frac,
  );
  return out;
}
