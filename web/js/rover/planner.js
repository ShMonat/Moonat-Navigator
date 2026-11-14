// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Rover path planner: the fastest drivable path between two cells of an elevation grid (A* on travel time).
// Pure functions, no DOM and no network, so the same code runs in the Web Worker, the browser and `node --test`.
//
// Grid (`g`): { nx, ny, cell_m, z: Float32Array(ny·nx) heights (m, NaN = no data), row 0 = north edge, col 0 = west
//   edge; x0, y0: plane coordinates (m) of the centre of cell (0, 0) (x east, y north); inv4R2: 1 / (4 R²) of the
//   stereographic plane (0 for a flat synthetic grid) }.
// Distances: a plane step d is d / m(x, y) metres on the ground, m = 1 + (x² + y²)/(4R²) (the stereographic scale
// factor, below 1.0003 within 60 km of the centre). Heights are above the reference sphere, so dz / ds is the slope
// relative to the local horizontal (up = radial), as everywhere in Moonat.

import { speedFactor } from "./presets.js";

const RAD = 180 / Math.PI;

// 16-connectivity: the 8 king moves and the 8 knight moves. `via` lists the cells a straight segment crosses on its
// way (both must be drivable), so a move never jumps over or cuts the corner of an impassable cell.
const MOVES16 = [
  [-1, 0, []], [1, 0, []], [0, -1, []], [0, 1, []],
  [-1, -1, [[-1, 0], [0, -1]]], [-1, 1, [[-1, 0], [0, 1]]], [1, -1, [[1, 0], [0, -1]]], [1, 1, [[1, 0], [0, 1]]],
  [-1, -2, [[0, -1], [-1, -1]]], [-1, 2, [[0, 1], [-1, 1]]], [1, -2, [[0, -1], [1, -1]]], [1, 2, [[0, 1], [1, 1]]],
  [-2, -1, [[-1, 0], [-1, -1]]], [-2, 1, [[-1, 0], [-1, 1]]], [2, -1, [[1, 0], [1, -1]]], [2, 1, [[1, 0], [1, 1]]],
];

/**
 * Terrain slope of every cell (Horn's 3 × 3 gradient), and which cells are drivable.
 * @returns {{gx: Float32Array, gy: Float32Array, slope_deg: Float32Array, passable: Uint8Array}}
 *   gx, gy: dz/d(east), dz/d(north) per ground metre; slope_deg = atan(|∇z|) in degrees.
 *   A cell is drivable when its 3 × 3 block has data, it is not on the grid edge, and slope_deg ≤ maxSlopeDeg.
 */
export function slopeField(g, maxSlopeDeg = 90) {
  const { nx, ny, cell_m, z } = g;
  const inv4R2 = g.inv4R2 || 0;
  const N = nx * ny;
  const gx = new Float32Array(N), gy = new Float32Array(N), slope = new Float32Array(N).fill(NaN);
  const passable = new Uint8Array(N);
  const tanMax = Math.tan(Math.min(89.9, maxSlopeDeg) / RAD);
  for (let r = 1; r < ny - 1; r++) {
    const y = g.y0 - r * cell_m;
    for (let c = 1; c < nx - 1; c++) {
      const k = r * nx + c;
      const a = z[k - nx - 1], b = z[k - nx], cc = z[k - nx + 1];
      const d = z[k - 1], f = z[k + 1];
      const gg = z[k + nx - 1], h = z[k + nx], i = z[k + nx + 1];
      const x = g.x0 + c * cell_m;
      const ds = cell_m / (1 + (x * x + y * y) * inv4R2); // ground metres per cell
      const dzdx = (cc + 2 * f + i - (a + 2 * d + gg)) / (8 * ds);
      const dzdy = (a + 2 * b + cc - (gg + 2 * h + i)) / (8 * ds);
      if (!Number.isFinite(dzdx) || !Number.isFinite(dzdy) || !Number.isFinite(z[k])) continue;
      gx[k] = dzdx;
      gy[k] = dzdy;
      const t = Math.hypot(dzdx, dzdy);
      slope[k] = Math.atan(t) * RAD;
      passable[k] = t <= tanMax ? 1 : 0;
    }
  }
  return { gx, gy, slope_deg: slope, passable };
}

/** Growable binary min-heap of (key, id). */
class Heap {
  constructor(cap = 1024) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
    this.n = 0;
  }
  push(key, id) {
    if (this.n === this.k.length) {
      const k = new Float64Array(this.n * 2), v = new Int32Array(this.n * 2);
      k.set(this.k); v.set(this.v);
      this.k = k; this.v = v;
    }
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p];
      i = p;
    }
    K[i] = key; V[i] = id;
  }
  pop() {
    const K = this.k, V = this.v;
    const top = V[0];
    const n = --this.n;
    if (n > 0) {
      const key = K[n], id = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        K[i] = K[c]; V[i] = V[c];
        i = c;
      }
      K[i] = key; V[i] = id;
    }
    return top;
  }
  peekKey() {
    return this.k[0];
  }
}

/**
 * Nearest drivable cell to (r, c) within `maxCells` (ring search), or null.
 * @returns {{r, c, moved_cells}|null}
 */
export function nearestPassable(g, passable, r, c, maxCells = 10) {
  const { nx, ny } = g;
  const ok = (rr, cc) => rr >= 0 && cc >= 0 && rr < ny && cc < nx && passable[rr * nx + cc];
  if (ok(r, c)) return { r, c, moved_cells: 0 };
  let best = null;
  for (let d = 1; d <= maxCells && !best; d++) {
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== d || !ok(r + dr, c + dc)) continue;
        const dist = Math.hypot(dr, dc);
        if (!best || dist < best.moved_cells) best = { r: r + dr, c: c + dc, moved_cells: dist };
      }
    }
  }
  return best;
}

/**
 * Fastest drivable path between two cells (A* on travel time, 8- or 16-connectivity).
 * Edge cost = surface distance / speed, with
 *   - along-track slope θ = atan(Δz / horizontal ground length) of the move (+ uphill), speed = v · speedFactor(θ);
 *   - surface distance = hypot(horizontal ground length, Δz);
 *   - hard limits: both cells (and the cells a diagonal or knight move crosses) drivable (terrain slope ≤ max),
 *     |θ| ≤ max slope, and the cross slope (the mean terrain gradient of the two cells across the move) ≤ max cross.
 * Heuristic: straight-line plane distance / (max scale factor · v), a lower bound of the travel time (admissible).
 * @param {object} g      grid (see top of file)
 * @param {{r,c}} start   start cell
 * @param {{r,c}} goal    goal cell
 * @param {object} rover  roverParams(): speed_mps, max_slope_deg, max_cross_deg, mu, power_margin
 * @param {object} [o]    {connectivity: 8 | 16 = 16, field: slopeField(g, ...) to reuse, snapCells: 10}
 * @returns {{ok: true, cells: number[] (flat indices), time_s: number[] (cumulative), dist_m: number[] (cumulative,
 *   along the surface), along_deg: number[], cross_deg: number[], speed_mps: number[] (per vertex, of the segment
 *   that ends there; 0 for the first), expanded, snapped: {start, goal} (cells moved)} | {ok: false, reason, expanded}}
 */
export function planPath(g, start, goal, rover, o = {}) {
  const { nx, ny, cell_m, z } = g;
  const inv4R2 = g.inv4R2 || 0;
  const field = o.field || slopeField(g, rover.max_slope_deg);
  const { gx, gy, passable } = field;
  const moves = (o.connectivity === 8 ? MOVES16.slice(0, 8) : MOVES16).map(([dr, dc, via]) => ({
    dr, dc, len: Math.hypot(dr, dc), off: dr * nx + dc, via: via.map(([a, b]) => a * nx + b), ux: dc / Math.hypot(dr, dc), uy: -dr / Math.hypot(dr, dc),
  }));
  const snap = o.snapCells ?? 10;
  const s = nearestPassable(g, passable, start.r, start.c, snap);
  const t = nearestPassable(g, passable, goal.r, goal.c, snap);
  if (!s) return { ok: false, reason: "start", expanded: 0 };
  if (!t) return { ok: false, reason: "goal", expanded: 0 };
  const sId = s.r * nx + s.c, tId = t.r * nx + t.c;

  const tanMax = Math.tan(Math.min(89.9, rover.max_slope_deg) / RAD);
  const tanCross = Math.tan(Math.min(89.9, rover.max_cross_deg ?? rover.max_slope_deg) / RAD);
  const v = rover.speed_mps, mu = rover.mu ?? 0.1, pm = rover.power_margin ?? 1;
  // Largest scale factor on the grid (at a corner): ground length ≥ plane length / mMax.
  const xs = [g.x0, g.x0 + (nx - 1) * cell_m], ys = [g.y0, g.y0 - (ny - 1) * cell_m];
  let mMax = 1;
  for (const x of xs) for (const y of ys) mMax = Math.max(mMax, 1 + (x * x + y * y) * inv4R2);
  const tr = t.r, tc = t.c;
  const hScale = cell_m / (mMax * v);
  const heur = (r, c) => Math.hypot(r - tr, c - tc) * hScale;

  const N = nx * ny;
  const gCost = new Float64Array(N).fill(Infinity);
  const parent = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new Heap(4096);
  gCost[sId] = 0;
  heap.push(heur(s.r, s.c), sId);
  let expanded = 0;
  while (heap.n > 0) {
    const id = heap.pop();
    if (closed[id]) continue;
    closed[id] = 1;
    expanded++;
    if (id === tId) break;
    const r = (id / nx) | 0, c = id - r * nx;
    const za = z[id], gxa = gx[id], gya = gy[id], ga = gCost[id];
    const x = g.x0 + c * cell_m, y = g.y0 - r * cell_m;
    for (const m of moves) {
      const rr = r + m.dr, cc = c + m.dc;
      if (rr < 0 || cc < 0 || rr >= ny || cc >= nx) continue;
      const nb = id + m.off;
      if (closed[nb] || !passable[nb]) continue;
      let blocked = false;
      for (const w of m.via) if (!passable[id + w]) { blocked = true; break; }
      if (blocked) continue;
      const xm = x + 0.5 * m.dc * cell_m, ym = y - 0.5 * m.dr * cell_m;
      const L = (m.len * cell_m) / (1 + (xm * xm + ym * ym) * inv4R2);
      const dz = z[nb] - za;
      const tanAlong = dz / L;
      if (Math.abs(tanAlong) > tanMax) continue;
      const cross = Math.abs(0.5 * ((gxa + gx[nb]) * m.uy - (gya + gy[nb]) * m.ux));
      if (cross > tanCross) continue;
      const speed = v * speedFactor(Math.atan(tanAlong) * RAD, mu, pm);
      const cost = ga + Math.hypot(L, dz) / speed;
      if (cost < gCost[nb]) {
        gCost[nb] = cost;
        parent[nb] = id;
        heap.push(cost + heur(rr, cc), nb);
      }
    }
  }
  if (!closed[tId]) return { ok: false, reason: "blocked", expanded };

  const cells = [];
  for (let id = tId; id !== -1; id = parent[id]) cells.push(id);
  cells.reverse();
  const n = cells.length;
  const time_s = new Array(n).fill(0), dist_m = new Array(n).fill(0);
  const along_deg = new Array(n).fill(0), cross_deg = new Array(n).fill(0), speed_mps = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const a = cells[i - 1], b = cells[i];
    const ra = (a / nx) | 0, ca = a - ra * nx, rb = (b / nx) | 0, cb = b - rb * nx;
    const dr = rb - ra, dc = cb - ca, len = Math.hypot(dr, dc);
    const xm = g.x0 + 0.5 * (ca + cb) * cell_m, ym = g.y0 - 0.5 * (ra + rb) * cell_m;
    const L = (len * cell_m) / (1 + (xm * xm + ym * ym) * inv4R2);
    const dz = z[b] - z[a];
    const th = Math.atan(dz / L) * RAD;
    const ux = dc / len, uy = -dr / len;
    const cross = Math.abs(0.5 * ((gx[a] + gx[b]) * uy - (gy[a] + gy[b]) * ux));
    const sp = v * speedFactor(th, mu, pm);
    const d3 = Math.hypot(L, dz);
    dist_m[i] = dist_m[i - 1] + d3;
    time_s[i] = time_s[i - 1] + d3 / sp;
    along_deg[i] = th;
    cross_deg[i] = Math.atan(cross) * RAD;
    speed_mps[i] = sp;
  }
  return {
    ok: true, cells, time_s, dist_m, along_deg, cross_deg, speed_mps, expanded,
    snapped: { start: s.moved_cells, goal: t.moved_cells },
  };
}

/** Cells crossed by the straight segments of a path (the vertices plus the `via` cells of each move). */
export function pathFootprint(g, cells) {
  const { nx } = g;
  const out = new Set(cells);
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1], b = cells[i];
    const ra = (a / nx) | 0, ca = a - ra * nx, rb = (b / nx) | 0, cb = b - rb * nx;
    const m = MOVES16.find(([dr, dc]) => dr === rb - ra && dc === cb - ca);
    if (m) for (const [vr, vc] of m[2]) out.add((ra + vr) * nx + ca + vc);
  }
  return [...out];
}
