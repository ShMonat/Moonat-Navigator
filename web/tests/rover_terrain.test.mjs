// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Route terrain (web/js/rover/terrain.js): grid plan, the local stereographic plane, and the off-centre grid view
// used to ray-march horizons at points along a route. The horizons from a route grid must match the C9 way
// (site-centred grids, as terrainAt builds them) on the same analytic terrain.

import { test } from "node:test";
import assert from "node:assert/strict";
import { D2R, R_M, gridBilinear } from "../js/terrain/geom.js";
import { marchHorizon } from "../js/terrain/march.js";
import { planRouteGrid, makePlane, gridView, greatCircle, unitVec, RouteError } from "../js/rover/terrain.js";

const zeroFar = { height: () => 0, cells: [3790], smax: [Infinity], maxHeight: 0 };

/** Square grid of n² pixels in a plane, heights from hFn(unit vector). */
function sampleGrid(plane, half_m, n, hFn) {
  const cell = (2 * half_m) / n, data = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const ll = plane.toLatLon(-half_m + (c + 0.5) * cell, half_m - (r + 0.5) * cell);
    data[r * n + c] = hFn(unitVec(ll.lat_deg, ll.lon_deg));
  }
  let max = -Infinity;
  for (const v of data) if (v > max) max = v;
  return { half_m, cell_m: cell, n, data, max_m: max };
}

/** Gaussian hills on the sphere: [{lat, lon, h (m), sigma (m)}]. */
function hills(list) {
  const H = list.map((q) => ({ u: unitVec(q.lat, q.lon), h: q.h, s: q.sigma }));
  return (u) => H.reduce((a, q) => {
    const ang = Math.acos(Math.min(1, u[0] * q.u[0] + u[1] * q.u[1] + u[2] * q.u[2]));
    return a + q.h * Math.exp(-((ang * R_M) ** 2) / (2 * q.s * q.s));
  }, 0);
}

test("grid plan: 20 m near the south pole, 118 m at low latitude, ≤ 1001 px, too-long routes refused", () => {
  const p = planRouteGrid({ lat_deg: -89.4395, lon_deg: -137.1934 }, { lat_deg: -89.0056, lon_deg: -96.6455 });
  assert.equal(p.fine.key, "south20");
  assert.ok(p.fine.n <= 1001 && p.fine.n % 2 === 1);
  assert.ok(Math.abs(p.dist_m - 20475) < 50, `${p.dist_m}`);
  assert.ok(p.coarse.half_m >= 64000);
  const q = planRouteGrid({ lat_deg: 20.19, lon_deg: 30.77 }, { lat_deg: 20.25, lon_deg: 30.6 });
  assert.equal(q.fine.key, "global118");
  assert.ok(q.fine.cell_m <= 118.46 && q.fine.cell_m > 110, `${q.fine.cell_m}`);
  assert.equal(q.fine.n, 401); // at least the C9 near field: 401 px at 118 m
  // A 37 km polar route needs more than 1001 px at 20 m: the cells grow instead.
  const long = planRouteGrid({ lat_deg: -89, lon_deg: 0 }, { lat_deg: -89, lon_deg: 75 });
  assert.equal(long.fine.n, 1001);
  assert.ok(long.fine.cell_m > 20 && long.fine.cell_m < 120, `${long.fine.key} ${long.fine.cell_m}`);
  assert.throws(() => planRouteGrid({ lat_deg: 0, lon_deg: 0 }, { lat_deg: 0, lon_deg: 2.1 }), RouteError);
});

test("stereographic plane: lat/lon -> plane -> lat/lon round trip, and distances near the centre", () => {
  for (const [lat, lon] of [[0.67, 23.47], [-89.44, -137.19], [-90, 0], [89.9, 10], [-45, 177]]) {
    const pl = makePlane(lat, lon);
    for (const [x, y] of [[0, 0], [1000, -2000], [-35000, 41000], [60000, 5]]) {
      const ll = pl.toLatLon(x, y);
      const [x2, y2] = pl.toXY(ll.lat_deg, ll.lon_deg);
      assert.ok(Math.abs(x2 - x) < 1e-6 && Math.abs(y2 - y) < 1e-6, `${lat},${lon}: ${x},${y} -> ${x2},${y2}`);
    }
    // Ground distance from the centre: s = 2R atan(r / 2R).
    const ll = pl.toLatLon(30000, 40000);
    const s = greatCircle({ lat_deg: lat, lon_deg: lon }, ll).dist_m;
    assert.ok(Math.abs(s - 2 * R_M * Math.atan(50000 / (2 * R_M))) < 1e-3);
  }
});

test("grid view at the route centre is the grid itself", () => {
  const pl = makePlane(-89.3, -120);
  const g = sampleGrid(pl, 8000, 201, hills([{ lat: -89.25, lon: -115, h: 400, sigma: 2500 }]));
  const v = gridView(pl, g, -89.3, -120);
  for (const [x, y] of [[0, 0], [1234.5, -987.6], [-7000, 6500]]) {
    assert.ok(Math.abs(v.at(x, y) - gridBilinear({ ...g }, x, y)) < 1e-3);
  }
});

test("horizons from an off-centre route grid match site-centred grids (the terrainAt way) on the same terrain", () => {
  // Route near the south pole with hills of 0.3–2 km at 3–40 km; the sample point is 7 km from the route centre.
  const h = hills([
    { lat: -89.2, lon: -100, h: 1500, sigma: 4000 },
    { lat: -89.6, lon: -150, h: 800, sigma: 1500 },
    { lat: -88.6, lon: -60, h: 2000, sigma: 8000 },
    { lat: -89.45, lon: -125, h: 300, sigma: 600 },
  ]);
  const centre = { lat_deg: -89.25, lon_deg: -118 };
  const pl = makePlane(centre.lat_deg, centre.lon_deg);
  const fine = sampleGrid(pl, 14000, 701, h);
  const coarse = sampleGrid(pl, 64000, 401, h);
  const site = pl.toLatLon(-5000, 5000);
  const spl = makePlane(site.lat_deg, site.lon_deg);
  // Site-centred grids as terrainAt plans them near the pole: 20 m ±4 km, 80 m ±16 km, 320 m ±64 km (coarser here
  // to keep the test fast: 40 / 160 / 320 m).
  const own = [sampleGrid(spl, 4000, 201, h), sampleGrid(spl, 16000, 201, h), sampleGrid(spl, 64000, 401, h)];
  const args = { lat_deg: site.lat_deg, lon_deg: site.lon_deg, observer_height_m: 2, az_step_deg: 1, far: zeroFar };
  const a = marchHorizon({ ...args, grids: [gridView(pl, fine, site.lat_deg, site.lon_deg), gridView(pl, coarse, site.lat_deg, site.lon_deg)] });
  const b = marchHorizon({ ...args, grids: own });
  assert.ok(Math.abs(a.ground_elev_m - b.ground_elev_m) < 0.5, `${a.ground_elev_m} vs ${b.ground_elev_m}`);
  let ss = 0, mx = 0;
  for (let k = 0; k < a.el_deg.length; k++) {
    const d = a.el_deg[k] - b.el_deg[k];
    ss += d * d;
    mx = Math.max(mx, Math.abs(d));
  }
  const rms = Math.sqrt(ss / a.el_deg.length);
  assert.ok(rms < 0.03 && mx < 0.15, `rms ${rms.toFixed(4)}°, max ${mx.toFixed(4)}°`);
  // The terrain is not trivial: the horizon reaches a few degrees.
  assert.ok(Math.max(...b.el_deg) > 2);
  assert.ok(D2R > 0);
});
