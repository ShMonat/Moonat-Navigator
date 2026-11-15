// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// World-anchored decorative detail for a moving view (a rover drive): gentle bumps, small craters and rocks that LOLA
// does not resolve, placed by position in a fixed map frame (metres; for a trip, the route's stereographic plane), so
// they stay at the same places on the Moon while the view moves. Static views keep the eye-centred detail of
// terrain.js. Pure maths (no three.js, no DOM): it runs in the rover's ground worker and under `node --test`.
//
// Anchor of a ground point g: { x0, y0 } = map position of g; ax = [dx, dy] map metres per metre east at g;
// an = [dx, dy] map metres per metre north at g. A point at local (east, north) from g is at map
// (x0 + east·ax[0] + north·an[0], y0 + east·ax[1] + north·an[1]) (first order; < 1 mm over the near field).

import { rng, valueNoise } from './math.js';

/** Polar near mesh of the sky view (terrain.js): azimuth divisions, radial growth per ring, first ring radius (m). */
export const AZ_NEAR = 720, RING_RATIO = 1.035, R_FIRST = 0.35;
/** Rocks are drawn out to this distance (m), bumps and craters fade out to MICRO_FADE_M (as the static detail). */
export const ROCK_MAX_M = 380, MICRO_FADE_M = 900;
/** Hash period (lattice cells) of the world-anchored shader noise (shaders.js WORLD_DETAIL). */
export const NOISE_PERIOD = 4096;

/** Radius (m) where the polar mesh hands over to the C4 patch grid (needs patch meta {half_extent_m, spacing_m}). */
export function nearSwitch(meta) {
  return Math.max(300, Math.min(0.5 * meta.half_extent_m, 60 * meta.spacing_m));
}

/** Ring radii (m) of the polar mesh out to rSwitch. */
export function polarRadii(rSwitch) {
  const radii = [];
  for (let r = R_FIRST; r < rSwitch; r *= RING_RATIO) radii.push(r);
  radii.push(rSwitch);
  return radii;
}

/** Local (east, north) of every polar-mesh vertex (index 0 = the centre), as terrain.js builds the mesh. */
export function polarPoints(rSwitch) {
  const radii = polarRadii(rSwitch), nv = 1 + radii.length * AZ_NEAR;
  const east = new Float64Array(nv), north = new Float64Array(nv);
  let v = 1;
  for (let j = 0; j < radii.length; j++) {
    for (let i = 0; i < AZ_NEAR; i++, v++) {
      const a = ((i + 0.5 * (j & 1)) / AZ_NEAR) * 2 * Math.PI;
      east[v] = radii[j] * Math.sin(a);
      north[v] = radii[j] * Math.cos(a);
    }
  }
  return { radii, east, north };
}

/** 32-bit mix of integers (cell indices, salt) for per-cell random streams. */
function mix(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Gentle bumps (m) at map point (x, y): the four octaves of the static detail, in map metres. */
export function bumps(x, y, seed) {
  return 0.55 * (valueNoise(x / 34, y / 34, seed + 1) - 0.5) + 0.22 * (valueNoise(x / 9, y / 9, seed + 2) - 0.5)
    + 0.07 * (valueNoise(x / 2.3, y / 2.3, seed + 3) - 0.5) + 0.02 * (valueNoise(x / 0.6, y / 0.6, seed + 4) - 0.5);
}

const CRATER_CELL = 50; // m; a crater (radius ≤ 22 m, reach 2.2 R) never reaches beyond the next cell

/** The craters of map cell (cx, cy): 0–2 of them, power-law radii 0.45–22 m, as the static detail. */
function cellCraters(cx, cy, seed) {
  const rand = rng(mix(cx, cy, seed + 101));
  const u = rand(), n = u < 0.3 ? 0 : u < 0.75 ? 1 : 2, out = [];
  for (let k = 0; k < n; k++) {
    const R = Math.min(22, 0.45 * Math.pow(1 - rand(), -1 / 1.9));
    out.push({ x: (cx + rand()) * CRATER_CELL, y: (cy + rand()) * CRATER_CELL, R, depth: (0.12 + 0.1 * rand()) * R });
  }
  return out;
}

/**
 * The craters of the map cells within `reach` (m) of (x0, y0), for craterHeight: {i0, j0, w, h, lists}. Cells outside
 * are generated on demand.
 */
export function craterGrid(x0, y0, reach, seed) {
  const i0 = Math.floor((x0 - reach) / CRATER_CELL) - 1, j0 = Math.floor((y0 - reach) / CRATER_CELL) - 1;
  const w = Math.floor((x0 + reach) / CRATER_CELL) + 2 - i0, h = Math.floor((y0 + reach) / CRATER_CELL) + 2 - j0;
  const lists = new Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) lists[j * w + i] = cellCraters(i0 + i, j0 + j, seed);
  return { i0, j0, w, h, lists };
}

/** Height (m) of the craters around map point (x, y): bowl inside, raised rim outside (as the static detail). */
export function craterHeight(x, y, seed, grid = null) {
  const cx = Math.floor(x / CRATER_CELL), cy = Math.floor(y / CRATER_CELL);
  let z = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gi = cx + i - (grid?.i0 ?? 0), gj = cy + j - (grid?.j0 ?? 0);
      const list = grid && gi >= 0 && gj >= 0 && gi < grid.w && gj < grid.h
        ? grid.lists[gj * grid.w + gi] : cellCraters(cx + i, cy + j, seed);
      for (const c of list) {
        const dx = x - c.x, dy = y - c.y, R = c.R;
        if (Math.abs(dx) > 2.2 * R || Math.abs(dy) > 2.2 * R) continue;
        const q = Math.hypot(dx, dy) / R;
        if (q < 1) z += -c.depth * (1 - q * q) + 0.22 * c.depth * q * q * q;
        else if (q < 2.2) z += 0.22 * c.depth * Math.exp(-(q - 1) / 0.28);
      }
    }
  }
  return z;
}

/** Bumps and craters (m) at a map point, before the distance fade (grid: craterGrid, optional, for speed). */
export function microAt(x, y, seed, grid = null) {
  return bumps(x, y, seed) + craterHeight(x, y, seed, grid);
}

/** Fade of the bumps and craters with distance r (m) from the view's ground point (1 inside half of MICRO_FADE_M). */
export function microFade(r) {
  if (r >= MICRO_FADE_M) return 0;
  return r < 0.5 * MICRO_FADE_M ? 1 : 1 - (r - 0.5 * MICRO_FADE_M) / (0.5 * MICRO_FADE_M);
}

/** Map position of local (east, north) around an anchor. */
export function toMap(anchor, east, north) {
  return [anchor.x0 + east * anchor.ax[0] + north * anchor.an[0], anchor.y0 + east * anchor.ax[1] + north * anchor.an[1]];
}

/** Local (east, north) of a map position around an anchor (inverse of toMap). */
export function toLocal(anchor, x, y) {
  const a = anchor.ax[0], b = anchor.an[0], c = anchor.ax[1], d = anchor.an[1], det = a * d - b * c;
  const dx = x - anchor.x0, dy = y - anchor.y0;
  return [(d * dx - b * dy) / det, (a * dy - c * dx) / det];
}

// Rocks: a world population with a power-law size distribution (cumulative n(> s) = ROCK_A·s^−2.3 per m²), drawn
// where they would look big enough: within s / ROCK_ANGLE (and ROCK_MAX_M) of the view, every rock of 3.5 cm and up
// nearer than 11.7 m. Sizes in octave bins, each in square map cells of about two rocks.
const ROCK_A = 5e-4, ROCK_ANGLE = 0.003, ROCK_MIN = 0.035, ROCK_TOP = 1.5;
const BINS = (() => {
  const out = [];
  for (let s0 = ROCK_MIN; s0 < ROCK_TOP; s0 *= 2) {
    const s1 = Math.min(ROCK_TOP, 2 * s0);
    const density = ROCK_A * (Math.pow(s0, -2.3) - Math.pow(s1, -2.3));
    out.push({ s0, s1, cell: Math.sqrt(2 / density), reach: Math.min(ROCK_MAX_M, Math.max(s1, ROCK_MIN) / ROCK_ANGLE) });
  }
  return out;
})();
/** Floats per rock in driveDetail's rocks array: east, north, lift, rotX, rotY, rotZ, scaleX, scaleY, scaleZ, tint,
 *  shape (0–3: the static detail's rock shapes), key (0..1, stable: the order small views keep a share by). */
export const ROCK_STRIDE = 12;

/** Distance (m) from point (x, y) to the polyline segments [x0, y0, x1, y1, ...] (Infinity without segments). */
function laneDistance(x, y, segs) {
  let best = Infinity;
  for (let k = 0; k < segs.length; k += 4) {
    const ax = segs[k], ay = segs[k + 1], dx = segs[k + 2] - ax, dy = segs[k + 3] - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

/** Segments of a path {x: [], y: []} (map metres) with a vertex within `reach` of (x0, y0). */
export function laneSegments(path, x0, y0, reach) {
  const segs = [];
  if (!path?.x?.length) return segs;
  for (let i = 0; i + 1 < path.x.length; i++) {
    const near = Math.hypot(path.x[i] - x0, path.y[i] - y0) < reach || Math.hypot(path.x[i + 1] - x0, path.y[i + 1] - y0) < reach;
    if (near) segs.push(path.x[i], path.y[i], path.x[i + 1], path.y[i + 1]);
  }
  return segs;
}

const POINTS = new Map(); // rSwitch -> polarPoints

/**
 * The detail for the sky view's terrain on a C4 patch with meta `meta` (its polar mesh), around the ground point of
 * `anchor`: driveDetail plus the anchor ({anchor, lift, rocks, nRocks}), as buildTerrain / setGround take it.
 */
export function groundDetail(meta, { anchor, lane = [], seed = 1969 }) {
  const rs = nearSwitch(meta);
  if (!POINTS.has(rs)) POINTS.set(rs, polarPoints(rs));
  return { anchor, ...driveDetail({ anchor, points: POINTS.get(rs), lane, seed }) };
}

/**
 * The detail of a moving view around one ground point.
 * @param anchor  map frame at the ground point (see above)
 * @param points  {east, north} of the polar-mesh vertices (polarPoints)
 * @param lane    path segments (laneSegments, map metres): no rock within 1.6 m (+ its size) of the rover's path
 * @returns {{lift: Float32Array (m, per polar vertex: bumps + craters, faded with distance), rocks: Float32Array
 *   (ROCK_STRIDE per rock), nRocks}}
 */
export function driveDetail({ anchor, points, lane = [], seed = 1969 }) {
  const cache = craterGrid(anchor.x0, anchor.y0, MICRO_FADE_M * 1.01, seed);
  const { east, north } = points, nv = east.length, lift = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    const r = Math.hypot(east[v], north[v]), f = microFade(r);
    if (f <= 0) continue;
    const [x, y] = toMap(anchor, east[v], north[v]);
    lift[v] = microAt(x, y, seed, cache) * f;
  }
  const rocks = [];
  BINS.forEach((bin, b) => {
    const c = bin.cell, R = bin.reach;
    // Map cells that can hold a rock within reach (the map axes are the local ones turned and scaled by ≈ 1).
    const span = R * 1.01 + c;
    const i0 = Math.floor((anchor.x0 - span) / c), i1 = Math.floor((anchor.x0 + span) / c);
    const j0 = Math.floor((anchor.y0 - span) / c), j1 = Math.floor((anchor.y0 + span) / c);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const rand = rng(mix(i, j, seed * 16 + b));
        const n = Math.floor(rand() * 4.0); // 0–3 rocks, about two per cell
        for (let k = 0; k < n; k++) {
          const x = (i + rand()) * c, y = (j + rand()) * c;
          const s = bin.s0 * Math.pow(1 - rand() * (1 - Math.pow(bin.s1 / bin.s0, -2.3)), -1 / 2.3);
          const sy = s * (0.5 + 0.35 * rand());
          const rx = (rand() - 0.5) * 0.7, ry = rand() * 6.283, rz = (rand() - 0.5) * 0.7;
          const sx = s * (0.75 + 0.5 * rand()), sz = s * (0.75 + 0.5 * rand());
          const tint = 0.78 + 0.42 * rand(), shape = (s >= 0.28 ? 0 : 2) + (rand() < 0.5 ? 0 : 1), key = rand();
          const [e, nn] = toLocal(anchor, x, y);
          const r = Math.hypot(e, nn);
          // Seen big enough from here: within s / ROCK_ANGLE (all from 3.5 cm within 11.7 m), shrinking over the
          // last quarter of that range so a rock never pops in or out.
          const vis = Math.min(ROCK_MAX_M, Math.max(s, ROCK_MIN) / ROCK_ANGLE);
          if (r < 2.2 || r >= vis) continue;
          if (lane.length && laneDistance(x, y, lane) < 1.6 + 0.75 * s) continue;
          const g = Math.min(1, (vis - r) / (0.25 * vis));
          const fl = microAt(x, y, seed, cache) * microFade(r);
          rocks.push(e, nn, fl, rx, ry, rz, sx * g, sy * g, sz * g, tint, shape, key);
        }
      }
    }
  });
  return { lift, rocks: Float32Array.from(rocks), nRocks: rocks.length / ROCK_STRIDE };
}
