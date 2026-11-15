// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// World-anchored detail of a moving view (web/js/sky/detail.js): the same point on the Moon gets the same bumps,
// craters and rocks whichever ground point the near field is built around (two patch centres, turned frames), the
// map/local conversion round-trips, and no rock lies on the rover's lane.
// Run: node --test web/tests/sky_detail.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { driveDetail, groundDetail, toMap, toLocal, microAt, polarPoints, nearSwitch, laneSegments, ROCK_STRIDE } from "../js/sky/detail.js";

// Two ground points 60 m apart in map metres, their local frames turned by 0.3 and 0.35 rad (as near the pole) and
// scaled by the stereographic factor.
const turn = (x0, y0, a, k = 1.0000004) => ({ x0, y0, ax: [k * Math.cos(a), -k * Math.sin(a)], an: [k * Math.sin(a), k * Math.cos(a)] });
const A = turn(-2241.3, 3281.9, 0.3), B = turn(-2190.1, 3313.2, 0.35);

test("toMap and toLocal are inverse", () => {
  for (const [e, n] of [[0, 0], [12.5, -3.25], [-300, 410]]) {
    const [x, y] = toMap(A, e, n), [e2, n2] = toLocal(A, x, y);
    assert.ok(Math.abs(e2 - e) < 1e-9 && Math.abs(n2 - n) < 1e-9, `${e2} ${n2}`);
  }
});

test("the same world point gets the same bumps and craters from two patch centres", () => {
  const world = [[-2230.4, 3290.7], [-2200.0, 3300.0], [-2215.55, 3305.05], [-2260.2, 3270.1]];
  const pts = (anchor) => {
    const east = new Float64Array(world.length), north = new Float64Array(world.length);
    world.forEach(([x, y], i) => ([east[i], north[i]] = toLocal(anchor, x, y)));
    return { east, north };
  };
  const a = driveDetail({ anchor: A, points: pts(A) }), b = driveDetail({ anchor: B, points: pts(B) });
  for (let i = 0; i < world.length; i++) {
    assert.ok(Math.abs(a.lift[i] - b.lift[i]) < 1e-6, `point ${i}: ${a.lift[i]} vs ${b.lift[i]}`);
    assert.ok(Math.abs(a.lift[i] - Math.fround(microAt(...world[i], 1969))) < 1e-6);
  }
  assert.ok(new Set(a.lift).size > 1, "the detail varies");
});

test("the same rocks at the same world places from two patch centres", () => {
  const points = polarPoints(nearSwitch({ half_extent_m: 8000, spacing_m: 62.5 }));
  const a = driveDetail({ anchor: A, points }), b = driveDetail({ anchor: B, points });
  const atMap = (det, anchor) => {
    const m = new Map();
    for (let i = 0; i < det.nRocks; i++) {
      const o = i * ROCK_STRIDE, [x, y] = toMap(anchor, det.rocks[o], det.rocks[o + 1]);
      m.set(`${x.toFixed(3)},${y.toFixed(3)}`, det.rocks.slice(o, o + ROCK_STRIDE));
    }
    return m;
  };
  const ma = atMap(a, A), mb = atMap(b, B);
  let common = 0;
  for (const [key, ra] of ma) {
    const rb = mb.get(key);
    if (!rb) continue;
    common++;
    // Turn, tint, shape and key belong to the rock; only the distance fade of its size may differ.
    for (const j of [3, 4, 5, 9, 10, 11]) assert.equal(ra[j], rb[j], `rock ${key}, field ${j}`);
    assert.ok(Math.abs(ra[6] / ra[7] - rb[6] / rb[7]) < 1e-5, `rock ${key}: same shape ratio`);
  }
  assert.ok(common > 300, `${common} rocks seen from both`);
  assert.ok(a.nRocks > 1000 && a.nRocks < 3000, `${a.nRocks} rocks`);
});

test("no rock on the rover's lane; groundDetail carries the anchor", () => {
  const path = { x: [-2300, -2241.3, -2150], y: [3250, 3281.9, 3340] };
  const lane = laneSegments(path, A.x0, A.y0, 600);
  assert.equal(lane.length, 8);
  const det = groundDetail({ half_extent_m: 8000, spacing_m: 62.5 }, { anchor: A, lane });
  assert.equal(det.anchor, A);
  for (let i = 0; i < det.nRocks; i++) {
    const o = i * ROCK_STRIDE, [x, y] = toMap(A, det.rocks[o], det.rocks[o + 1]);
    for (let k = 0; k < lane.length; k += 4) {
      const [ax, ay, bx, by] = lane.slice(k, k + 4), dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      assert.ok(Math.hypot(x - ax - t * dx, y - ay - t * dy) >= 1.6, `rock ${i} on the lane`);
    }
  }
});
