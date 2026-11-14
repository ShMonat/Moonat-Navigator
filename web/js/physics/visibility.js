// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Visible fraction of a circular body disk (Sun, Earth) above a horizon profile.
// Port of the Python reference src/moonat/visibility.py (same sampling pattern and weights, so
// the numbers match to floating-point noise). See that file for the method and its accuracy.
// Frame: site ENU (x east, y north, z up). Angles in degrees at the interface.

import { DEG, RAD } from './frames.js';

export const N_DISK_POINTS = 400;
export const LIMB_DARKENING_U = 0.6;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Sunflower pattern: s_i = (i + 0.5)/N is the solid-angle fraction inside point i's ring,
// theta_i = i · golden angle its position angle.
const PAT_S = new Float64Array(N_DISK_POINTS);
const PAT_C = new Float64Array(N_DISK_POINTS);
const PAT_SN = new Float64Array(N_DISK_POINTS);
for (let i = 0; i < N_DISK_POINTS; i++) {
  PAT_S[i] = (i + 0.5) / N_DISK_POINTS;
  PAT_C[i] = Math.cos(i * GOLDEN_ANGLE);
  PAT_SN[i] = Math.sin(i * GOLDEN_ANGLE);
}

/**
 * Prepares a C3 horizon profile ({az_step_deg, el_deg[]}) or null for fast lookups.
 * Returns null for the smooth horizon (el = 0 everywhere).
 */
export function prepareHorizon(h) {
  if (!h) return null;
  const el = Float64Array.from(h.el_deg);
  let mn = Infinity, mx = -Infinity;
  for (const v of el) { if (v < mn) mn = v; if (v > mx) mx = v; }
  return { step: Number(h.az_step_deg), el, n: el.length, min: mn, max: mx };
}

/** Horizon elevation (deg) at true azimuth az (deg); periodic linear interpolation. */
export function horizonElAt(hz, az) {
  if (!hz) return 0;
  let x = (az % 360) / hz.step;
  if (x < 0) x += 360 / hz.step;
  let k0 = Math.floor(x);
  const f = x - k0;
  k0 %= hz.n;
  const k1 = k0 + 1 === hz.n ? 0 : k0 + 1;
  return hz.el[k0] * (1 - f) + hz.el[k1] * f;
}

function horizonRange(hz, azLo, azHi) {
  if (!hz) return [0, 0];
  const kLo = Math.floor(azLo / hz.step), kHi = Math.ceil(azHi / hz.step);
  if (kHi - kLo + 1 >= hz.n) return [hz.min, hz.max];
  let mn = Infinity, mx = -Infinity;
  for (let k = kLo; k <= kHi; k++) {
    const v = hz.el[((k % hz.n) + hz.n) % hz.n];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return [mn, mx];
}

const RESULT = { vis: 0, flux: 0, fluxLit: 0 };

function done(v) {
  RESULT.vis = v; RESULT.flux = v; RESULT.fluxLit = v;
  return RESULT;
}

/**
 * Visible fraction of a disk centred at (az_deg, el_deg) with angular radius rho_deg, against the
 * prepared horizon `hz` (from prepareHorizon, or null = smooth horizon).
 * Returns {vis, flux, fluxLit}: vis = solid-angle fraction; flux = the fraction weighted by linear limb
 * darkening I(mu) = 1 − u(1 − mu) (only computed when `u` is a number, else flux = vis).
 * `uEnu` (optional) is the unit ENU vector of the centre if already known.
 * `occ` (optional, with `u`): an opaque disk in front of this one, {enu: unit ENU centre, rho_deg}
 * (the Earth in front of the Sun). Then fluxLit = the share of the flux NOT hidden by `occ` that
 * clears the terrain (each sample also weighted by an anti-aliased "outside occ" step); without
 * `occ`, fluxLit = flux. Used with the analytic eclipse fraction in eclipse.js (combinedFluxFrac).
 * The returned object is reused between calls; copy the values if you keep them.
 */
export function diskFractions(az_deg, el_deg, rho_deg, hz, u = null, uEnu = null, occ = null) {
  const rho = rho_deg * DEG;
  const delta = rho_deg * Math.sqrt(Math.PI / N_DISK_POINTS);
  const halfRamp = 0.5 * delta + 1e-9;

  // Fast paths on the disk's elevation and azimuth bounds.
  const lo = el_deg - rho_deg;
  const hi = Math.min(el_deg + rho_deg, 90);
  const gMin = hz ? hz.min : 0, gMax = hz ? hz.max : 0;
  if (lo - halfRamp > gMax) return done(1);
  if (hi + halfRamp < gMin) return done(0);
  if (hz) {
    const cosEl = Math.cos(el_deg * DEG);
    let hMin, hMax;
    if (el_deg + rho_deg >= 90 || Math.sin(rho) >= cosEl) {
      hMin = gMin; hMax = gMax;
    } else {
      const daz = Math.asin(Math.sin(rho) / cosEl) * RAD;
      [hMin, hMax] = horizonRange(hz, az_deg - daz, az_deg + daz);
    }
    if (lo - halfRamp > hMax) return done(1);
    if (hi + halfRamp < hMin) return done(0);
  }

  // Tangent-plane basis at the centre direction: e1 toward the zenith, e2 = e1 × u.
  let ux, uy, uz;
  if (uEnu) { ux = uEnu[0]; uy = uEnu[1]; uz = uEnu[2]; } else {
    const az = az_deg * DEG, el = el_deg * DEG;
    ux = Math.cos(el) * Math.sin(az); uy = Math.cos(el) * Math.cos(az); uz = Math.sin(el);
  }
  let e1x = -uz * ux, e1y = -uz * uy, e1z = 1 - uz * uz;
  let nn = Math.hypot(e1x, e1y, e1z);
  if (nn < 1e-9) { e1x = -uy * ux; e1y = 1 - uy * uy; e1z = -uy * uz; nn = Math.hypot(e1x, e1y, e1z); }
  e1x /= nn; e1y /= nn; e1z /= nn;
  const e2x = e1y * uz - e1z * uy, e2y = e1z * ux - e1x * uz, e2z = e1x * uy - e1y * ux;

  const oneMinusCosRho = 1 - Math.cos(rho);
  const sinRho = Math.sin(rho);
  const ld = typeof u === 'number';
  const oc = ld && occ ? occ : null;
  const ox = oc ? oc.enu[0] : 0, oy = oc ? oc.enu[1] : 0, oz = oc ? oc.enu[2] : 0, orho = oc ? oc.rho_deg : 0;
  let sumV = 0, sumW = 0, sumWV = 0, sumWO = 0, sumWVO = 0;
  for (let i = 0; i < N_DISK_POINTS; i++) {
    const omc = PAT_S[i] * oneMinusCosRho;
    const ca = 1 - omc;
    const sa = Math.sqrt(omc * (2 - omc));
    const a = sa * PAT_C[i], b = sa * PAT_SN[i];
    const px = ca * ux + a * e1x + b * e2x;
    const py = ca * uy + a * e1y + b * e2y;
    const pz = ca * uz + a * e1z + b * e2z;
    const el = Math.asin(pz > 1 ? 1 : pz < -1 ? -1 : pz) * RAD;
    let h = 0;
    if (hz) {
      let az = Math.atan2(px, py) * RAD;
      if (az < 0) az += 360;
      h = horizonElAt(hz, az);
    }
    let w = 0.5 + (el - h) / delta;
    w = w < 0 ? 0 : w > 1 ? 1 : w;
    sumV += w;
    if (ld) {
      let r = sa / sinRho;
      if (r > 1) r = 1;
      const wl = 1 - u * (1 - Math.sqrt(1 - r * r));
      sumW += wl;
      sumWV += wl * w;
      if (oc) {
        const d = px * ox + py * oy + pz * oz;
        let wo = 0.5 + (Math.acos(d > 1 ? 1 : d < -1 ? -1 : d) * RAD - orho) / delta;
        wo = wo < 0 ? 0 : wo > 1 ? 1 : wo;
        sumWO += wl * wo;
        sumWVO += wl * w * wo;
      }
    }
  }
  RESULT.vis = sumV / N_DISK_POINTS;
  RESULT.flux = ld ? sumWV / sumW : RESULT.vis;
  RESULT.fluxLit = oc ? (sumWO > 0 ? sumWVO / sumWO : RESULT.flux) : RESULT.flux;
  return RESULT;
}

/** Plain visible fraction (0..1); see diskFractions. `horizon` is a raw C3 object or null. */
export function visibleFraction(az_deg, el_deg, rho_deg, horizon = null, u = null) {
  const hz = horizon && horizon.el ? horizon : prepareHorizon(horizon);
  const r = diskFractions(az_deg, el_deg, rho_deg, hz, u);
  return u === null ? r.vis : r.flux;
}
