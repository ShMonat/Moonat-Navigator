// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The rover's 3D ground while the timelapse plays: the parts of a route sent to the ground worker are enough for
// routePatch (same patch as inline, also after a structured copy, for one leg and for a joined trip), and rideTerrain
// asks for one ground at a time per view, takes the latest point, waits REBUILD_MS between builds, and drops a ground
// that arrives after the card changed trip.
// Run: node --test web/tests/rover_ground.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { routePatch } from "../js/rover/route.js";
import { groundPatch, patchSource } from "../js/rover/ground.js";
import { rideTerrain, REBUILD_MS } from "../js/rover/sky_ride.js";

/** A leg's terrain as route.js keeps it: fine and coarse grids in the plane tangent at `centre`, smooth hills. */
function leg(centre, seed) {
  const grid = (half_m, n) => {
    const cell_m = (2 * half_m) / n, data = new Float32Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = -half_m + (c + 0.5) * cell_m, y = half_m - (r + 0.5) * cell_m;
        data[r * n + c] = 300 * Math.sin(x / 2100 + seed) * Math.cos(y / 1700 - seed) + 0.01 * x;
      }
    }
    return { layer: "synthetic", half_m, cell_m, n, data, max_m: 400 };
  };
  return { centre, terrain: { fine: grid(6000, 201), coarse: grid(20000, 101) }, meta: { sources: ["synthetic"] } };
}

const C1 = { lat_deg: -89.5, lon_deg: -60 }, C2 = { lat_deg: -89.45, lon_deg: -120 };
const OPTS = { half_extent_m: 3000, n: 65 };

test("ground worker input: patchSource holds what routePatch reads (one leg, and a joined trip)", async () => {
  const one = leg(C1, 0.3);
  const ref = routePatch(one, -89.51, -58, OPTS);
  assert.ok(ref.data.some((v) => v !== 0));
  for (const src of [patchSource(one), structuredClone(patchSource(one))]) {
    assert.deepEqual(routePatch(src, -89.51, -58, OPTS), ref);
  }
  assert.deepEqual(Object.keys(patchSource(one)).sort(), ["centre", "meta", "terrain"]);
  // Without Web Workers (Node) groundPatch computes it inline: the same patch.
  assert.deepEqual(await groundPatch(one, -89.51, -58, OPTS), ref);

  // A joined trip: each leg keeps its own grids; the leg is given, or found from the nearest horizon sample.
  const trip = {
    legs: [leg(C1, 0.3), leg(C2, 1.2)],
    samples: { lat: [-89.5, -89.47, -89.45], lon: [-60, -90, -120], leg: [0, 0, 1], horizons: [] },
    meta: { sources: ["synthetic"] },
  };
  const src = structuredClone(patchSource(trip));
  for (const [lat, lon, opts] of [[-89.45, -118, { ...OPTS, leg: 1 }], [-89.45, -118, OPTS], [-89.5, -61, { ...OPTS, leg: 0 }]]) {
    assert.deepEqual(routePatch(src, lat, lon, opts), routePatch(trip, lat, lon, opts));
  }
});

const flush = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("rideTerrain: one ground at a time per view, the latest point next, REBUILD_MS apart; a stale trip is dropped", async () => {
  const shown = [];
  const asked = []; // [{ index, resolve }]
  const ground = (it, ride) => new Promise((resolve) => asked.push({ index: ride.ground.index, resolve: () => resolve({ patch: { index: ride.ground.index }, horizon: null }) }));
  const it = { key: "trip" };
  const rec = { it, view: { setTerrain: ({ patch }) => shown.push(patch.index) } };
  const ride = (index) => ({ ground: { index } });

  rideTerrain(rec, it, ride(1), { ground }); // nothing built yet: asks at once
  rideTerrain(rec, it, ride(2), { ground }); // one is on its way: these only replace the pending point
  rideTerrain(rec, it, ride(3), { ground });
  assert.deepEqual(asked.map((a) => a.index), [1]);
  asked[0].resolve();
  await flush();
  assert.deepEqual(shown, [1]);
  assert.equal(rec.rideGroundKey, "trip|1");
  // The latest pending point (3, not 2) is asked for REBUILD_MS after the first build started.
  assert.equal(asked.length, 1);
  await sleep(REBUILD_MS + 40);
  assert.deepEqual(asked.map((a) => a.index), [1, 3]);
  // The card shows another trip when point 3 arrives: not shown.
  rec.it = { key: "other" };
  asked[1].resolve();
  await flush();
  assert.deepEqual(shown, [1]);
  // Back on the trip: the point on show asks for nothing; a new one is built after the wait.
  rec.it = it;
  rideTerrain(rec, it, ride(1), { ground });
  await sleep(REBUILD_MS + 40);
  assert.equal(asked.length, 2);
  rideTerrain(rec, it, ride(4), { ground });
  assert.deepEqual(asked.map((a) => a.index), [1, 3, 4]);
  asked[2].resolve();
  await flush();
  assert.deepEqual(shown, [1, 4]);
  // A view without setTerrain (the 2D fallback) is left alone.
  rideTerrain({ it, view: {} }, it, ride(5), { ground });
  assert.equal(asked.length, 3);
});
