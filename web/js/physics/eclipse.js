// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The Earth eclipsing the Sun, as seen from a lunar site (on Earth, the same event is a lunar eclipse).
// Port of the Python reference src/moonat/eclipse.py (same quadrature, so the numbers match to rounding).
//
// Geometry: both bodies are circular disks on the sky, seen from the site. Inputs are the apparent
// directions (light-time + aberration, as in the C1 table) and the angular radii asin(R / d). The
// Earth is an opaque disk of its solid-body radius (6378.137 km, the same radius that sizes the
// Earth's disk in the sky view); its atmosphere is not added to it (see docs/validation/eclipse.md
// for Danjon's 1/85 enlargement that NASA uses for the umbra, and what it changes).
// The overlap is computed in the plane of the sky (small angles: < 1.3 deg here, so the error from
// the curvature of the sky is of order rho² ≈ 5e-4 relative; contact times are exact, because
// "touching" circles on the sphere have centre distance = sum or difference of the angular radii).

import { DEG } from './frames.js';
import { LIMB_DARKENING_U } from './visibility.js';

/** Gauss–Legendre nodes across the band of partly covered solar rings. */
export const ECLIPSE_NODES = 24;

/** Gauss–Legendre nodes and weights on [−1, 1] (Newton iteration on P_n; ascending nodes). */
export function gaussLegendre(n) {
  const x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let dp = 1;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      dp = (n * (z * p1 - p2)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    x[n - 1 - i] = z;
    w[n - 1 - i] = 2 / ((1 - z * z) * dp * dp);
  }
  return { x, w };
}

// Band nodes on [0, 1]: x = (1 − cos θ)/2 with θ in [0, π] at Gauss–Legendre nodes; dx = (sin θ / 2) dθ.
// The substitution removes the square-root behaviour of the covered arc at both ends of the band
// and of the limb-darkening law at the solar limb, so the integrand is smooth in θ.
const NX = new Float64Array(ECLIPSE_NODES);
const NW = new Float64Array(ECLIPSE_NODES);
{
  const gl = gaussLegendre(ECLIPSE_NODES);
  for (let k = 0; k < ECLIPSE_NODES; k++) {
    const th = 0.5 * Math.PI * (gl.x[k] + 1);
    NX[k] = 0.5 * (1 - Math.cos(th));
    NW[k] = 0.25 * Math.PI * gl.w[k] * Math.sin(th);
  }
}

/** ∫₀^R I(r) 2r dr for the linear law I = 1 − u(1 − √(1 − r²)), r in solar radii, R in [0, 1]. */
function innerFlux(R, u) {
  const s = R * R;
  return (1 - u) * s + ((2 * u) / 3) * (1 - Math.pow(1 - s, 1.5));
}

/**
 * Fraction (0..1) of a limb-darkened solar disk's flux hidden by an opaque circular disk.
 * z = centre separation / solar angular radius; p = occulter angular radius / solar angular radius
 * (dimensionless). Limb darkening: linear, I(μ) = 1 − u(1 − μ) (u = 0.6, as for vis_frac/flux_frac).
 * Method: the solar disk is cut into rings of radius r; the covered share of a ring is
 * acos((r² + z² − p²) / (2rz)) / π. Rings entirely behind the occulter are integrated analytically,
 * the partly covered band |z − p| < r < min(1, z + p) with ECLIPSE_NODES Gauss–Legendre nodes in θ
 * (r = a + (b − a)(1 − cos θ)/2). Error below 1e-6 against the analytic lens area for a uniform disk (web/tests/physics_eclipse.test.mjs).
 */
export function occultedFluxFraction(z, p, u = LIMB_DARKENING_U) {
  if (!(z < 1 + p)) return 0; // disks apart (or touching)
  if (z <= p - 1) return 1; // the Sun is entirely behind the occulter
  const rIn = Math.min(1, Math.max(0, p - z)); // rings r < rIn are entirely covered
  const a = Math.abs(z - p);
  const b = Math.min(1, z + p);
  let f = innerFlux(rIn, u);
  if (a < b) {
    const w = b - a;
    const zz = z * z - p * p;
    let s = 0;
    for (let k = 0; k < ECLIPSE_NODES; k++) {
      const r = a + w * NX[k];
      const c = (r * r + zz) / (2 * r * z);
      const cov = c >= 1 ? 0 : c <= -1 ? 1 : Math.acos(c) / Math.PI;
      const m = 1 - r * r;
      s += (1 - u * (1 - Math.sqrt(m > 0 ? m : 0))) * cov * 2 * r * NW[k];
    }
    f += s * w;
  }
  const out = f / (1 - u / 3);
  return out < 0 ? 0 : out > 1 ? 1 : out;
}

/**
 * Eclipse of the Sun by the Earth seen from one site: the fraction of the Sun's limb-darkened flux
 * hidden by the Earth's disk (0..1), independent of the terrain.
 * sunEnu, earthEnu: unit apparent directions (any common frame, e.g. site ENU);
 * rhoSunDeg, rhoEarthDeg: angular radii (deg). Returns 0 without any overlap work when the
 * angular separation exceeds the sum of the radii (all but a few hours a year).
 */
export function sunEclipseFrac(sunEnu, rhoSunDeg, earthEnu, rhoEarthDeg) {
  const c = sunEnu[0] * earthEnu[0] + sunEnu[1] * earthEnu[1] + sunEnu[2] * earthEnu[2];
  const rs = rhoSunDeg * DEG, re = rhoEarthDeg * DEG;
  if (c <= Math.cos(rs + re)) return 0;
  return occultedFluxFraction(sepRad(sunEnu, earthEnu) / rs, re / rs);
}

/** Angle (rad) between two unit vectors; atan2 form, accurate for small angles. */
export function sepRad(a, b) {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(x, y, z), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

/**
 * Visible share of the Sun's flux when both the terrain and the Earth may hide part of the disk.
 * ecl = sunEclipseFrac(...); df = the diskFractions() result for the Sun computed with the Earth as
 * occulter (its `fluxLit` = share of the un-eclipsed flux that clears the terrain).
 * Returns the combined flux fraction (0..1): (1 − ecl) · terrain share. It reduces exactly to the
 * terrain-only flux when ecl = 0, and to 1 − ecl when the whole disk clears the terrain.
 */
export function combinedFluxFrac(df, ecl) {
  if (!(ecl > 0)) return df.flux;
  if (ecl >= 1 || df.vis <= 0) return 0;
  if (df.vis >= 1) return 1 - ecl;
  return (1 - ecl) * df.fluxLit;
}

/**
 * Largest rate (deg per ms) at which the Sun–Earth separation can change in a lunar sky: the Sun
 * moves 12.19 deg/day against the near-fixed Earth (0.51 deg/h); libration and topocentric
 * effects add a few hundredths. 0.75 deg/h is a safe bound for bracketing events between samples.
 */
export const MAX_SEP_RATE_DEG_PER_MS = 0.75 / 3.6e6;

// Bisection for a sign change of f on [a, b] (f(a) and f(b) of opposite sign); returns the time
// of the first instant on the f(b) side, to tolMs.
function crossing(f, a, b, tolMs) {
  const fa = f(a) > 0;
  while (Math.abs(b - a) > tolMs) {
    const m = 0.5 * (a + b);
    if ((f(m) > 0) === fa) a = m; else b = m;
  }
  return b;
}

// Golden-section minimum of f on [a, b], to tolMs. Returns [t, f(t)].
function goldenMin(f, a, b, tolMs) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = f(c), fd = f(d);
  while (b - a > tolMs) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  const t = 0.5 * (a + b);
  return [t, f(t)];
}

/**
 * Eclipse events (the Earth in front of the Sun) in a sampled time series.
 * t_ms: sample times (UTC epoch ms, evenly spaced); margin: per sample, separation − (ρ_sun + ρ_earth)
 * in deg (Infinity where the bodies are far apart); geomAt(tMs) -> {sep, rs, re} (deg) evaluates one
 * instant; fracAt(tMs) -> eclipse fraction; visAt(tMs) -> terrain-only Sun visibility.
 * Events between samples are found too: every local minimum of the margin that could dip below 0
 * between samples is refined by golden section.
 * Returns [{start_ms, max_ms, end_ms, max_frac, total_start_ms, total_end_ms, sun_vis_at_max}]:
 * start/end = first/last contact (the site enters/leaves the penumbra; null when outside the series),
 * max = minimum Sun–Earth separation (greatest eclipse at the site), total_* = the Sun entirely
 * hidden (the site in the umbra; null when not total or outside the series). Times refined to tolMs.
 */
export function eclipseEvents(t_ms, margin, geomAt, fracAt, visAt, tolMs = 1000) {
  const n = t_ms.length;
  if (n === 0) return [];
  const step = n > 1 ? t_ms[1] - t_ms[0] : 0;
  const slack = MAX_SEP_RATE_DEG_PER_MS * step;
  const mPart = (t) => { const g = geomAt(t); return g.sep - (g.rs + g.re); };
  const mTot = (t) => { const g = geomAt(t); return g.sep - (g.re - g.rs); };
  const events = [];
  for (let i = 0; i < n; i++) {
    const m = margin[i];
    if (!(m < slack)) continue;
    if (i > 0 && !(m < margin[i - 1])) continue; // not a local minimum (plateaus count once)
    if (i + 1 < n && m > margin[i + 1]) continue;
    const a = t_ms[Math.max(0, i - 1)], b = t_ms[Math.min(n - 1, i + 1)];
    const [tMax, mMin] = b > a ? goldenMin(mPart, a, b, tolMs) : [t_ms[i], m];
    if (!(mMin < 0)) continue;
    // First contact: the last sample before tMax that is outside, then bisection.
    let start = null;
    for (let j = i; j >= 0; j--) {
      if (t_ms[j] < tMax && margin[j] >= 0) {
        const hi = j + 1 <= i && t_ms[j + 1] <= tMax && margin[j + 1] < 0 ? t_ms[j + 1] : tMax;
        start = crossing(mPart, t_ms[j], hi, tolMs);
        break;
      }
    }
    let end = null;
    for (let j = i; j < n; j++) {
      if (t_ms[j] > tMax && margin[j] >= 0) {
        const lo = j - 1 >= i && t_ms[j - 1] >= tMax && margin[j - 1] < 0 ? t_ms[j - 1] : tMax;
        end = crossing(mPart, lo, t_ms[j], tolMs);
        break;
      }
    }
    const maxFrac = fracAt(tMax);
    let totStart = null, totEnd = null;
    if (mTot(tMax) <= 0) {
      if (start !== null) totStart = crossing(mTot, start, tMax, tolMs);
      if (end !== null) totEnd = crossing(mTot, end, tMax, tolMs);
    }
    events.push({
      start_ms: start, max_ms: tMax, end_ms: end, max_frac: maxFrac,
      total_start_ms: totStart, total_end_ms: totEnd, sun_vis_at_max: visAt(tMax),
    });
  }
  return events;
}
