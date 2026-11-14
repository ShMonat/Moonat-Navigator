// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Multi-stop rover trips (contract C10): the stops in the scenario and the share link (old 2-point links unchanged),
// the planning request, legs joined into one route with cumulative distance and time (trip.js joinLegs, on synthetic
// terrain), planTrip leg by leg, and the ride's skyline between two horizon samples (sky_ride.js horizonAlong).

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { R_M } from "../js/terrain/geom.js";
import { makeScenario, encodeHash, decodeHash, physicsKey } from "../js/app/state.js";
import { routeRequest, tripWaypoints, isTrip, newRouteFields } from "../js/rover/app.js";
import { planRouteGrid, unitVec, greatCircle } from "../js/rover/terrain.js";
import { computeRoute, routePatch } from "../js/rover/route.js";
import { joinLegs, tripCentre, legAtDistance } from "../js/rover/trip.js";
import { planTrip, tripKey, tripProblems, onRouteProgress, routeKey, RouteError } from "../js/rover/index.js";
import { routeSeries, routeTrack } from "../js/rover/series.js";
import { horizonAlong, frameTurnDeg } from "../js/rover/sky_ride.js";
import { loadEphem } from "../js/physics/index.js";
import { fileFetch } from "./physics_helpers.mjs";

const ROUTE = { end_lat_deg: -89.4395, end_lon_deg: -137.1934, preset: "viper", speed_mps: 0.2, max_slope_deg: 15, max_cross_deg: 15, stop_every_km: 0, stop_h: 0 };
const VIA = [{ lat_deg: -89.7, lon_deg: -60 }, { lat_deg: -89.55, lon_deg: -100 }];

test("share link: the stops round-trip as a 9th element; 2-point trips and old links are unchanged", () => {
  const s = makeScenario({ label: "Pole tour", lat_deg: -90, lon_deg: 0, t_start_utc: "2027-10-15T00:00:00Z", route: { ...ROUTE, via: VIA } });
  const back = decodeHash(encodeHash({ scenarios: [s] })).scenarios[0];
  assert.deepEqual(back.route.via, VIA);
  assert.equal(back.route.end_lat_deg, ROUTE.end_lat_deg);
  // A trip without stops writes exactly the 8-element row of the older links (the quick start's link is unchanged).
  const two = makeScenario({ lat_deg: -90, lon_deg: 0, route: ROUTE });
  const rows = JSON.parse(Buffer.from(new URLSearchParams(encodeHash({ scenarios: [two] }).slice(1)).get("s").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  assert.equal(rows[0][7].length, 8);
  assert.equal("via" in decodeHash(encodeHash({ scenarios: [two] })).scenarios[0].route, false);
  // Bad stops in a link are dropped, not trusted.
  const bad = { ...s, route: { ...ROUTE, via: [{ lat_deg: 95, lon_deg: 0 }, { lat_deg: -89.6, lon_deg: 10 }] } };
  assert.deepEqual(decodeHash(encodeHash({ scenarios: [bad] })).scenarios[0].route.via, [{ lat_deg: -89.6, lon_deg: 10 }]);
  // The stops are physics inputs.
  assert.notEqual(physicsKey(s), physicsKey(two));
  // A copied scenario does not share its stops with the original.
  const copy = makeScenario(s);
  copy.route.via[0].lat_deg = 0;
  assert.equal(s.route.via[0].lat_deg, -89.7);
});

test("planning request: waypoints in order (start, stops, end); a trip without its end is not a drive yet", () => {
  const s = makeScenario({ lat_deg: -90, lon_deg: 0, route: { ...ROUTE, via: VIA } });
  const req = routeRequest(s);
  assert.deepEqual(req.waypoints, [{ lat_deg: -90, lon_deg: 0 }, ...VIA, { lat_deg: ROUTE.end_lat_deg, lon_deg: ROUTE.end_lon_deg }]);
  assert.equal(req.complete, true);
  assert.equal(isTrip(s), true);
  const open = makeScenario({ lat_deg: -90, lon_deg: 0, route: newRouteFields() });
  assert.deepEqual(tripWaypoints(open), [{ lat_deg: -90, lon_deg: 0 }, null]);
  assert.equal(isTrip(open), false);
  assert.equal(isTrip(makeScenario({ lat_deg: 1, lon_deg: 2 })), false);
  // The 2-point trip's key is its leg's (the cache of the quick start's route is shared).
  const a = { lat_deg: -90, lon_deg: 0 }, b = { lat_deg: -89.44, lon_deg: -137.19 };
  assert.equal(tripKey([a, b], { preset: "viper" }), routeKey(a, b, { preset: "viper" }));
});

test("trip problems name the leg that is too long; a missing point is named by its letter", () => {
  const A = { lat_deg: 26.13, lon_deg: 3.63 }, B = { lat_deg: 26.0, lon_deg: 3.7 }, C = { lat_deg: 28.5, lon_deg: 3.7 };
  assert.deepEqual(tripProblems([A, B]), []);
  const p = tripProblems([A, B, C]);
  assert.equal(p.length, 1);
  assert.match(p[0], /^B → C is \d+\.\d km in a straight line/);
  assert.match(tripProblems([A, null])[0], /point B/);
});

// ---- synthetic terrain (as in rover_route.test.mjs)
const zeroFar = { height: () => 0, cells: [3790], smax: [Infinity], maxHeight: 0, sources: [], bytes: 0 };
function hills(list) {
  const H = list.map((q) => ({ u: unitVec(q.lat, q.lon), h: q.h, s: q.sigma }));
  return (u) => H.reduce((a, q) => {
    const ang = Math.acos(Math.min(1, u[0] * q.u[0] + u[1] * q.u[1] + u[2] * q.u[2]));
    return a + q.h * Math.exp(-((ang * R_M) ** 2) / (2 * q.s * q.s));
  }, 0);
}
function sampleGrid(plane, lv, hFn) {
  const { half_m, n } = lv, cell = (2 * half_m) / n, data = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const ll = plane.toLatLon(-half_m + (c + 0.5) * cell, half_m - (r + 0.5) * cell);
    data[r * n + c] = hFn(unitVec(ll.lat_deg, ll.lon_deg));
  }
  return { layer: "synthetic", half_m, cell_m: cell, n, data, bytes: 0 };
}
function synthetic(start, end, hFn, n = 201) {
  const plan = planRouteGrid(start, end);
  return { grids: { fine: sampleGrid(plan.plane, { half_m: plan.fine.half_m, n }, hFn), coarse: sampleGrid(plan.plane, { half_m: plan.coarse.half_m, n: 101 }, hFn) }, far: zeroFar };
}
const HILLS = hills([{ lat: 20.25, lon: 30.9, h: 700, sigma: 2500 }]);
const A = { lat_deg: 20.19, lon_deg: 30.77 }, B = { lat_deg: 20.19, lon_deg: 30.93 }, C = { lat_deg: 20.31, lon_deg: 31.0 };
const legOf = (p, q) => computeRoute(p, q, { preset: "lrv" }, { ...synthetic(p, q, HILLS), az_step_deg: 4 });

let legsPromise = null;
const legs = () => (legsPromise ||= Promise.all([legOf(A, B), legOf(B, C)]));

test("joinLegs: one path A → B → C with cumulative distance and time, samples of both legs, summed stats", async () => {
  const [ab, bc] = await legs();
  const t = joinLegs([ab, bc]);
  const P = t.path, S = t.samples;
  assert.equal(P.lat.length, ab.path.lat.length + bc.path.lat.length);
  assert.equal(S.dist_m.length, ab.samples.dist_m.length + bc.samples.dist_m.length);
  for (let i = 1; i < P.dist_m.length; i++) {
    assert.ok(P.dist_m[i] >= P.dist_m[i - 1] && P.time_s[i] >= P.time_s[i - 1], `monotonic at ${i}`);
  }
  for (let k = 1; k < S.dist_m.length; k++) assert.ok(S.dist_m[k] >= S.dist_m[k - 1]);
  // The joint at B: leg 2 starts where leg 1 ends, plus the short link between their snapped ends (< one grid cell).
  const gap = t.leg_info[1].dist0_m - ab.stats.length_m;
  assert.ok(gap >= 0 && gap < 2 * ab.meta.fine_cell_m, `gap ${gap}`);
  assert.ok(Math.abs(t.stats.length_m - (ab.stats.length_m + bc.stats.length_m + gap)) < 1e-6);
  assert.ok(Math.abs(t.stats.drive_s - (ab.stats.drive_s + bc.stats.drive_s + gap / 2.5)) < 1e-6);
  assert.ok(Math.abs(t.stats.straight_m - (ab.stats.straight_m + bc.stats.straight_m)) < 1e-6);
  assert.equal(t.stats.max_slope_deg, Math.max(ab.stats.max_slope_deg, bc.stats.max_slope_deg));
  assert.deepEqual(t.waypoints.map((p) => [p.lat_deg, p.lon_deg]), [A, B, C].map((p) => [p.lat_deg, p.lon_deg]));
  assert.deepEqual([...new Set(S.leg)], [0, 1]);
  assert.equal(legAtDistance(t, 10), 0);
  assert.equal(legAtDistance(t, t.stats.length_m - 1), 1);
  // The trip plane is tangent at the waypoints' centroid; its x, y give back the vertices' positions.
  const c = tripCentre([A, B, C]);
  assert.deepEqual(t.centre, c);
  const track = routeTrack(t);
  for (const i of [0, Math.floor(P.lat.length / 2), P.lat.length - 1]) {
    const q = track.positionAt(P.dist_m[i]);
    assert.ok(greatCircle(q, { lat_deg: P.lat[i], lon_deg: P.lon[i] }).dist_m < 0.5, `vertex ${i}`);
  }
  // Half way through the trip time the rover is past B on leg 2 or before it, never off the path.
  const mid = track.positionAt(t.leg_info[1].dist0_m);
  assert.ok(greatCircle(mid, B).dist_m < 2 * ab.meta.fine_cell_m);
  // A ground patch anywhere on the trip comes from the leg that holds it.
  const k = S.dist_m.length - 2;
  const patch = routePatch(t, S.lat[k], S.lon[k], { half_extent_m: 2000, n: 33 });
  assert.ok(Math.abs(patch.data[16 * 33 + 16]) < 0.5, "patch centre is the ground point");
  // One leg is returned as it is.
  assert.equal(joinLegs([ab]), ab);
});

test("routeSeries along a 2-leg trip: the distance grows to the trip's length, through B", async () => {
  await loadEphem(fileURLToPath(new URL("../data/ephem", import.meta.url)), { fetch: fileFetch });
  const t = joinLegs(await legs());
  const t0 = Date.UTC(2027, 0, 20);
  const track = routeTrack(t);
  const s = await routeSeries(t, t0, t0 + track.arrival_ms + 3600e3, 120e3, { track });
  assert.equal(s.distance_km[0], 0);
  assert.ok(Math.abs(s.distance_km.at(-1) - t.stats.length_m / 1000) < 1e-9);
  for (let i = 1; i < s.distance_km.length; i++) assert.ok(s.distance_km[i] >= s.distance_km[i - 1] - 1e-12);
  assert.ok(s.sample_index.some((k) => t.samples.leg[k] === 1), "the sky follows the rover onto leg 2");
});

test("planTrip: leg by leg with progress per leg; a leg that fails is named", async () => {
  const pts = [A, B, C];
  const seen = [];
  const calls = [];
  const planLeg = async (p, q) => {
    calls.push([p, q]);
    return p === A ? legs().then((l) => l[0]) : legs().then((l) => l[1]);
  };
  const off = onRouteProgress(tripKey(pts, { preset: "lrv" }), (stage, frac, leg, n) => seen.push([stage, leg, n]));
  const t = await planTrip(pts, { preset: "lrv" }, { planLeg });
  off();
  assert.equal(calls.length, 2);
  assert.equal(t.leg_info.length, 2);
  assert.deepEqual(seen.at(-1), ["horizons", 1, 2]);
  const fail = async (p, q) => {
    if (p === B) throw new RouteError("blocked", "No drivable route between these points.");
    return (await legs())[0];
  };
  await assert.rejects(planTrip(pts, { preset: "lrv" }, { planLeg: fail }), (err) => err.code === "blocked" && /^B → C: No drivable route/.test(err.message));
  await assert.rejects(planTrip([A], {}), (err) => err.code === "incomplete");
});

test("ride skyline: a sample's profile at the sample; turned into the local frame near the pole; a blend in between", () => {
  const step = 2, n = 180;
  const flat = (v) => ({ az_step_deg: step, el_deg: new Array(n).fill(v), dist_km: new Array(n).fill(5), ground_elev_m: 100, observer_height_m: 2 });
  // A bump 4° high, 8° wide, at azimuth 90° (east) of sample 0's frame.
  const bumpy = flat(0);
  for (let i = 43; i <= 47; i++) bumpy.el_deg[i] = 4;
  const P0 = { lat_deg: -89.9, lon_deg: 0 }, P1 = { lat_deg: -89.9, lon_deg: 90 };
  const route = { samples: { dist_m: [0, 100], lat: [P0.lat_deg, P1.lat_deg], lon: [P0.lon_deg, P1.lon_deg], horizons: [bumpy, flat(1)] } };
  const at0 = horizonAlong(route, 0, P0);
  assert.equal(at0.el_deg[45], 4);
  assert.equal(at0.el_deg[40], 0);
  // Seen from a point 90° of longitude away near the pole, the same physical direction has another azimuth.
  const p = { lat_deg: -89.9, lon_deg: 45 };
  const turn = frameTurnDeg(p, P0); // az in P0's frame = az in p's frame + turn
  assert.ok(Math.abs(turn) > 30, `the frame turns ${turn.toFixed(1)}°`);
  const mid = horizonAlong(route, 50, p);
  const k = Math.round((((90 - turn) % 360) + 360) % 360 / step) % n;
  assert.ok(Math.abs(mid.el_deg[k] - (0.5 * 4 + 0.5 * 1)) < 1e-9, `bump at its physical direction: ${mid.el_deg[k]}`);
  assert.ok(Math.abs(mid.el_deg[(k + 45) % n] - 0.5) < 1e-9, "elsewhere the mean of 0 and 1");
  // Without the turn (index for index) the bump would sit at 90° here, which is the wrong direction.
  assert.ok(Math.abs(mid.el_deg[45] - 0.5) < 1e-9);
  assert.equal(mid.ground_elev_m, 100);
});
