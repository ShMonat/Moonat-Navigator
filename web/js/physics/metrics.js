// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Derived metrics: solar flux, Earth phase, set times and series summaries.
// Port of the Python reference src/moonat/metrics.py. Units: km, deg, W/m², UTC epoch ms.

export const SOLAR_CONSTANT_WM2 = 1361; // total solar irradiance at 1 au
export const AU_KM = 149597870.7;
// Default body radii; index.js prefers the ephemeris manifest's body_radii_km.
export const SUN_RADIUS_KM = 695700; // IAU 2015 Resolution B3 nominal (as JPL Horizons)
export const EARTH_RADIUS_KM = 6378.137; // IAU 2015 nominal equatorial

/** Irradiance on a surface facing the Sun: 1361 · (1 au / r)² · flux_frac (W/m²); r in km. */
export function fluxNormalWm2(dist_km, flux_frac) {
  const k = AU_KM / dist_km;
  return SOLAR_CONSTANT_WM2 * k * k * flux_frac;
}

/** Irradiance on the local horizontal plane: flux_normal · max(0, sin el) (W/m²); el in deg. */
export function fluxHorizWm2(dist_km, flux_frac, el_deg) {
  const s = Math.sin((el_deg * Math.PI) / 180);
  return s > 0 ? fluxNormalWm2(dist_km, flux_frac) * s : 0;
}

/**
 * Illuminated fraction of the Earth's disk: (1 + cos α)/2, α = Sun–Earth–observer angle.
 * Positions in one common frame and unit (e.g. MOON_ME km).
 */
export function earthPhaseFrac(earth, sun, observer) {
  const ax = sun[0] - earth[0], ay = sun[1] - earth[1], az = sun[2] - earth[2];
  const bx = observer[0] - earth[0], by = observer[1] - earth[1], bz = observer[2] - earth[2];
  let c = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz));
  c = c > 1 ? 1 : c < -1 ? -1 : c;
  return 0.5 * (1 + c);
}

/**
 * First time (ms) the visible fraction drops from > 0 to 0, or null. The bracketing samples are
 * refined by bisection with `evaluate(tMs) -> vis` to `tolMs`; without it, the first zero sample
 * time is returned.
 */
export function nextSetTime(t_ms, vis, evaluate = null, tolMs = 1000) {
  for (let i = 0; i + 1 < vis.length; i++) {
    if (vis[i] > 0 && vis[i + 1] <= 0) {
      let a = t_ms[i], b = t_ms[i + 1];
      if (!evaluate) return b;
      while (b - a > tolMs) {
        const m = 0.5 * (a + b);
        if (evaluate(m) > 0) a = m; else b = m;
      }
      return b;
    }
  }
  return null;
}

/**
 * C6 series summary: percent of samples with the body visible, next set times, mean horizontal flux.
 * `sunLit` (optional): per-sample visible flux fraction of the Sun (terrain and eclipse); when given,
 * sun_vis_pct counts samples with sunLit > 0, so a total eclipse counts as "not in sunlight".
 * Set times always follow the terrain-only `sun_vis`.
 */
export function seriesSummary(t_ms, sun_vis, earth_vis, flux_horiz, evalSun = null, evalEarth = null, sunLit = null) {
  const n = t_ms.length;
  const lit = sunLit ?? sun_vis;
  let sv = 0, ev = 0, fh = 0;
  for (let i = 0; i < n; i++) {
    if (lit[i] > 0) sv++;
    if (earth_vis[i] > 0) ev++;
    fh += flux_horiz[i];
  }
  return {
    sun_vis_pct: n ? (100 * sv) / n : 0,
    earth_vis_pct: n ? (100 * ev) / n : 0,
    next_sunset_ms: nextSetTime(t_ms, sun_vis, evalSun),
    next_earthset_ms: nextSetTime(t_ms, earth_vis, evalEarth),
    mean_flux_horiz_wm2: n ? fh / n : 0,
  };
}
