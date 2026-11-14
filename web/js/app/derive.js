// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Small derived quantities the UI needs from C6 series and C3 horizon profiles. Pure functions (no DOM).

/**
 * Terrain horizon elevation (deg) at a true azimuth (deg, clockwise from north), from a C3 profile.
 * Linear interpolation between samples, wrapping at 360°. Returns 0 (the smooth horizon) when there is no profile.
 */
export function horizonElAt(horizon, azDeg) {
  if (!horizon || !Array.isArray(horizon.el_deg) || !horizon.el_deg.length) return 0;
  const n = horizon.el_deg.length;
  const step = horizon.az_step_deg || 360 / n;
  const x = ((((azDeg % 360) + 360) % 360) / step);
  const i0 = Math.floor(x) % n;
  const i1 = (i0 + 1) % n;
  const f = x - Math.floor(x);
  return horizon.el_deg[i0] * (1 - f) + horizon.el_deg[i1] * f;
}

/**
 * Find rise and set events in a visibility series.
 * `t` epoch ms, `vis` fraction 0..1 (same length). A body is "up" when vis > `thresh`.
 * Returns { upAtStart, nextSet, nextRise } with event times in epoch ms (linear interpolation between samples), or null.
 */
export function findEvents(t, vis, thresh = 0) {
  const out = { upAtStart: null, nextSet: null, nextRise: null };
  if (!t || !t.length) return out;
  const up = (v) => v > thresh;
  out.upAtStart = up(vis[0]);
  for (let i = 1; i < t.length; i++) {
    const a = up(vis[i - 1]);
    const b = up(vis[i]);
    if (a === b) continue;
    const dv = vis[i] - vis[i - 1];
    const f = dv !== 0 ? Math.min(1, Math.max(0, (thresh - vis[i - 1]) / dv)) : 0.5;
    const te = t[i - 1] + f * (t[i] - t[i - 1]);
    if (a && !b && out.nextSet === null) out.nextSet = te;
    if (!a && b && out.nextRise === null) out.nextRise = te;
    if (out.nextSet !== null && out.nextRise !== null) break;
  }
  return out;
}

/** Min, max and mean of a numeric array (ignores non-finite values). */
export function stats(arr) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (const v of arr || []) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n++;
  }
  return n ? { min, max, mean: sum / n } : { min: NaN, max: NaN, mean: NaN };
}

/** Percentage of samples with value > thresh. */
export function pctAbove(arr, thresh = 0) {
  if (!arr || !arr.length) return NaN;
  let k = 0;
  for (const v of arr) if (v > thresh) k++;
  return (100 * k) / arr.length;
}

/** Compass point name for an azimuth in degrees (16 points). */
export function compassPoint(azDeg) {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16];
}
