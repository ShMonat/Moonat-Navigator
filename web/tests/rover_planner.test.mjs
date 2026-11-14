// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Rover path planner (web/js/rover/planner.js) on synthetic terrain: flat ground, a wall with a gap, a hill that
// the slope limit forces the rover around, random rough terrain, and the slope-dependent speed model.

import { test } from "node:test";
import assert from "node:assert/strict";
import { planPath, slopeField, pathFootprint } from "../js/rover/planner.js";
import { roverParams, speedFactor, PRESETS } from "../js/rover/presets.js";

/** Flat synthetic grid (no curvature) of nx × ny cells, heights from fn(x, y) with x east, y north (m). */
function grid(nx, ny, cell, fn) {
  const z = new Float32Array(nx * ny);
  const x0 = -((nx - 1) / 2) * cell, y0 = ((ny - 1) / 2) * cell;
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) z[r * nx + c] = fn(x0 + c * cell, y0 - r * cell);
  return { nx, ny, cell_m: cell, z, x0, y0, inv4R2: 0 };
}
const rc = (g, id) => [Math.floor(id / g.nx), id % g.nx];
const VIPER = roverParams("viper");

test("flat ground: the path is the straight line, and the time is distance / speed", () => {
  const g = grid(121, 61, 20, () => 0);
  const p = planPath(g, { r: 30, c: 10 }, { r: 30, c: 110 }, VIPER);
  assert.ok(p.ok);
  for (const id of p.cells) assert.equal(rc(g, id)[0], 30);
  assert.equal(p.dist_m.at(-1), 2000);
  assert.ok(Math.abs(p.time_s.at(-1) - 2000 / 0.2) < 1e-6);
  // An oblique line: 16-connectivity keeps the length within 3 % of the straight distance.
  const q = planPath(g, { r: 5, c: 5 }, { r: 55, c: 115 }, VIPER);
  const straight = Math.hypot(50, 110) * 20;
  assert.ok(q.dist_m.at(-1) <= 1.03 * straight && q.dist_m.at(-1) >= straight - 1e-6, `${q.dist_m.at(-1)} vs ${straight}`);
  // 8-connectivity is longer on the same line (up to 8 %).
  const q8 = planPath(g, { r: 5, c: 5 }, { r: 55, c: 115 }, VIPER, { connectivity: 8 });
  assert.ok(q8.dist_m.at(-1) > q.dist_m.at(-1));
});

test("a wall with a gap: the path goes through the gap", () => {
  // A 60 m high wall along x = 0 (north-south), 3 cells thick, with a 9-cell gap near the north end.
  const gapY = [300, 480];
  const g = grid(101, 101, 10, (x, y) => (Math.abs(x) <= 10 && !(y > gapY[0] && y < gapY[1]) ? 60 : 0));
  const f = slopeField(g, VIPER.max_slope_deg);
  const p = planPath(g, { r: 80, c: 20 }, { r: 80, c: 80 }, VIPER, { field: f });
  assert.ok(p.ok);
  const xs = p.cells.map((id) => g.x0 + rc(g, id)[1] * 10);
  const ys = p.cells.map((id) => g.y0 - rc(g, id)[0] * 10);
  for (let i = 0; i < xs.length; i++) if (Math.abs(xs[i]) <= 10) assert.ok(ys[i] > gapY[0] && ys[i] < gapY[1], `crossed at y=${ys[i]}`);
  for (const id of pathFootprint(g, p.cells)) assert.equal(f.passable[id], 1);
  // Close the gap: no route.
  const closed = grid(101, 101, 10, (x) => (Math.abs(x) <= 10 ? 60 : 0));
  const none = planPath(closed, { r: 80, c: 20 }, { r: 80, c: 80 }, VIPER);
  assert.equal(none.ok, false);
  assert.equal(none.reason, "blocked");
});

test("a slope limit forces a detour around a steep hill; a steeper limit drives over it", () => {
  // Cone-shaped hill, 200 m high, flanks of about 22°, right on the straight line.
  const hill = (x, y) => Math.max(0, 200 - Math.hypot(x, y) * Math.tan((22 * Math.PI) / 180));
  const g = grid(161, 161, 10, hill);
  const lo = roverParams("viper", { max_slope_deg: 15 });
  const hi = roverParams("viper", { max_slope_deg: 30 });
  const a = planPath(g, { r: 80, c: 5 }, { r: 80, c: 155 }, lo);
  const b = planPath(g, { r: 80, c: 5 }, { r: 80, c: 155 }, hi);
  assert.ok(a.ok && b.ok);
  const fa = slopeField(g, 15);
  for (const id of pathFootprint(g, a.cells)) assert.equal(fa.passable[id], 1, "stepped on a cell steeper than 15°");
  const maxH = (p) => Math.max(...p.cells.map((id) => g.z[id]));
  assert.ok(maxH(a) < 1, `15° rover climbed to ${maxH(a)} m`);
  assert.ok(a.dist_m.at(-1) > 1600, "detour expected");
  // The 30° rover may climb, but only if that is faster; either way it must not be slower than the detour.
  assert.ok(b.time_s.at(-1) <= a.time_s.at(-1) + 1e-6);
});

test("random rough terrain: the path never touches an impassable cell, and the limits hold on every move", () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const bumps = Array.from({ length: 40 }, () => ({ x: (rnd() - 0.5) * 2400, y: (rnd() - 0.5) * 2400, h: 10 + 50 * rnd(), s: 80 + 200 * rnd() }));
  const g = grid(121, 121, 20, (x, y) => bumps.reduce((a, b) => a + b.h * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.s ** 2)), 0));
  const rover = roverParams("viper", { max_slope_deg: 12, max_cross_deg: 8 });
  const f0 = slopeField(g, 90);
  const steep = [...f0.slope_deg].filter((s) => s > 12).length;
  assert.ok(steep > 200, `the terrain should have impassable cells (${steep})`);
  const f = slopeField(g, rover.max_slope_deg);
  const p = planPath(g, { r: 10, c: 10 }, { r: 110, c: 110 }, rover, { field: f });
  assert.ok(p.ok, p.reason);
  for (const id of pathFootprint(g, p.cells)) assert.equal(f.passable[id], 1);
  for (let i = 1; i < p.cells.length; i++) {
    assert.ok(Math.abs(p.along_deg[i]) <= 12 + 1e-9);
    assert.ok(p.cross_deg[i] <= 8 + 1e-9);
  }
  // Time is consistent with the speeds of the moves.
  let t = 0;
  for (let i = 1; i < p.cells.length; i++) t += (p.dist_m[i] - p.dist_m[i - 1]) / p.speed_mps[i];
  assert.ok(Math.abs(t - p.time_s.at(-1)) < 1e-6 * t);
});

test("speed model: level and downhill at full speed, uphill power-limited", () => {
  assert.equal(speedFactor(0), 1);
  assert.equal(speedFactor(-10), 1);
  // v / v0 = μ / (μ cos θ + sin θ) with μ = 0.1: 10° -> 0.367, 15° -> 0.281.
  assert.ok(Math.abs(speedFactor(10, 0.1, 1) - 0.1 / (0.1 * Math.cos(0.17453292519943295) + Math.sin(0.17453292519943295))) < 1e-12);
  assert.ok(Math.abs(speedFactor(15, 0.1, 1) - 0.2811) < 1e-3);
  // More power holds full speed up to a steeper slope.
  assert.equal(speedFactor(5, 0.1, 2), 1);
  assert.equal(PRESETS.viper.speed_mps, 0.2);
  assert.equal(PRESETS.lrv.max_slope_deg, 20);
  // Uphill is slower than downhill on the same ramp.
  const ramp = grid(101, 11, 10, (x) => x * Math.tan((6 * Math.PI) / 180));
  const up = planPath(ramp, { r: 5, c: 5 }, { r: 5, c: 95 }, VIPER);
  const down = planPath(ramp, { r: 5, c: 95 }, { r: 5, c: 5 }, VIPER);
  assert.ok(up.time_s.at(-1) > 1.5 * down.time_s.at(-1));
  assert.ok(Math.abs(up.dist_m.at(-1) - down.dist_m.at(-1)) < 1e-6);
});

test("a start on a too-steep cell is moved to the nearest drivable cell", () => {
  // A 30 m spike in the cell east of the start makes the start cell 37° steep.
  const g = grid(61, 61, 10, (x, y) => (x === 10 && y === 0 ? 30 : 0));
  const f = slopeField(g, VIPER.max_slope_deg);
  assert.equal(f.passable[30 * 61 + 30], 0);
  const p = planPath(g, { r: 30, c: 30 }, { r: 30, c: 58 }, VIPER, { snapCells: 10, field: f });
  assert.ok(p.ok);
  assert.ok(p.snapped.start > 0);
  for (const id of pathFootprint(g, p.cells)) assert.equal(f.passable[id], 1);
});
