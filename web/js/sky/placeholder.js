// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// Synthetic stand-ins so the sky view can be built and demonstrated before the real data layers exist.
// Nothing here is real lunar or stellar data.

import { R_MOON_M, rng, valueNoise } from './math.js';

/**
 * PLACEHOLDER[terrain-patch]: a synthetic C4 patch (same shape as web/data/terrain/<id>.json + .bin, in memory):
 * rolling fractal hills, a few large craters and a distant ridge, plus the lunar curvature drop. z_up is in metres
 * relative to the ground point at the centre.
 */
export function makePlaceholderPatch({ gridN = 257, halfExtentM = 8000, seed = 11 } = {}) {
  const N = gridN, h = halfExtentM, d = (2 * h) / (N - 1), data = new Float32Array(N * N), rand = rng(seed);
  const craters = [];
  for (let i = 0; i < 14; i++) {
    const R = 150 + 900 * Math.pow(rand(), 2.2);
    let x, y;
    do { x = (rand() * 2 - 1) * h; y = (rand() * 2 - 1) * h; } while (Math.hypot(x, y) < R * 1.6 + 200);
    craters.push({ x, y, R, depth: 0.18 * R });
  }
  const raw = (x, y) => {
    let z = 0, amp = 260, lam = 5200;
    for (let o = 0; o < 6; o++) { z += amp * (valueNoise(x / lam + 7.3 * o, y / lam - 3.1 * o, seed + o) - 0.5); amp *= 0.46; lam *= 0.47; }
    // A ridge to the north-west and a massif to the south, to give the skyline some character.
    z += 420 * Math.exp(-Math.pow((y - 0.35 * x - 5200) / 900, 2)) * (0.6 + 0.8 * valueNoise(x / 1500, 3.3, seed + 20));
    z += 520 * Math.exp(-(Math.pow(x + 2500, 2) + Math.pow(y + 6000, 2)) / (2 * 1500 * 1500));
    for (const c of craters) {
      const q = Math.hypot(x - c.x, y - c.y) / c.R;
      if (q < 1) z += -c.depth * (1 - q * q) + 0.045 * c.R * q * q;
      else if (q < 2.5) z += 0.045 * c.R * Math.exp(-(q - 1) / 0.35);
    }
    return z;
  };
  const z0 = raw(0, 0);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const x = -h + c * d, y = h - r * d, rr = Math.hypot(x, y);
      // Flatten the terrain gently toward the observer so the site itself is a plausible landing spot.
      const k = 1 - Math.exp(-(rr * rr) / (2 * 700 * 700));
      data[r * N + c] = (raw(x, y) - z0) * k - (rr * rr) / (2 * R_MOON_M);
    }
  }
  return {
    meta: {
      id: 'placeholder', grid_n: N, spacing_m: d, half_extent_m: h,
      encoding: 'float32 LE, row-major, row 0 = north edge, col 0 = west edge', albedo: null,
      dem_sources: ['synthetic placeholder'],
      _generated_by: 'AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.',
    },
    data,
  };
}

/**
 * PLACEHOLDER[star-catalog]: random stars with a realistic magnitude distribution, in the shape of
 * web/data/stars/stars.json ({ stars: [{ ra_deg, dec_deg, vmag, bv }] }). Not real stars.
 */
export function makePlaceholderStars(count = 3500, seed = 5) {
  const rand = rng(seed), stars = [];
  for (let i = 0; i < count; i++) {
    const z = rand() * 2 - 1;
    // Cumulative star counts grow about 10^(0.5 m): invert for m in [-1, 6.5].
    const vmag = 6.5 + Math.log10(rand() * (1 - 1e-4) + 1e-4) / 0.5;
    stars.push({ ra_deg: rand() * 360, dec_deg: (Math.asin(z) * 180) / Math.PI, vmag: Math.max(-1.2, vmag), bv: -0.2 + 1.7 * Math.pow(rand(), 1.5) });
  }
  return { stars, placeholder: true };
}
