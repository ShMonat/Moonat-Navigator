// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Rover traverse end to end, offline: route planning on synthetic route grids (computeRoute), the drive timeline with
// stops, and the Sun/Earth series along the route (routeSeries) with the real ephemeris. A zero-length route must
// give exactly the static-site series.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { R_M } from "../js/terrain/geom.js";
import { planRouteGrid, unitVec } from "../js/rover/terrain.js";
import { computeRoute, timeline, distanceAtTime, routePatch } from "../js/rover/route.js";
import { routeSeries, routeTrack } from "../js/rover/series.js";
import { loadEphem, makeSite, series } from "../js/physics/index.js";
import { fileFetch } from "./physics_helpers.mjs";

const ephemDir = fileURLToPath(new URL("../data/ephem", import.meta.url));
const zeroFar = { height: () => 0, cells: [3790], smax: [Infinity], maxHeight: 0, sources: [], bytes: 0 };
const HOUR = 3600e3;

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
/** Synthetic route terrain (coarser than Moon Trek's, to keep the test fast). */
function synthetic(start, end, hFn, n = 301) {
  const plan = planRouteGrid(start, end);
  return {
    grids: {
      fine: sampleGrid(plan.plane, { half_m: plan.fine.half_m, n }, hFn),
      coarse: sampleGrid(plan.plane, { half_m: plan.coarse.half_m, n: 201 }, hFn),
    },
    far: zeroFar,
  };
}

const A = { lat_deg: 20.19, lon_deg: 30.77 };
const B = { lat_deg: 20.19, lon_deg: 30.97 };
// A 900 m high, steep hill (σ = 1.2 km, flanks up to ~25°) on the straight line between A and B.
const HILL = hills([{ lat: 20.19, lon: 30.87, h: 900, sigma: 1200 }, { lat: 20.3, lon: 30.9, h: 1500, sigma: 6000 }]);

test("computeRoute on synthetic terrain: detours around a steep hill, samples every 100–250 m with horizons", async () => {
  const r = await computeRoute(A, B, { preset: "viper" }, { ...synthetic(A, B, HILL), az_step_deg: 2 });
  const L = r.stats.length_m;
  assert.ok(L > r.stats.straight_m, "longer than the straight line");
  // The hill's flanks are steeper than 15° from 0.4 to 1.8 σ: the path must stay outside that ring.
  const hc = unitVec(20.19, 30.87);
  const minKm = Math.min(...r.path.lat.map((la, i) => {
    const u = unitVec(la, r.path.lon[i]);
    return (Math.acos(Math.min(1, u[0] * hc[0] + u[1] * hc[1] + u[2] * hc[2])) * R_M) / 1000;
  }));
  assert.ok(minKm > 1.5, `passed ${minKm.toFixed(2)} km from the hill top`);
  assert.ok(r.stats.max_slope_deg <= 15 + 1e-6);
  const S = r.samples;
  assert.equal(S.horizons.length, S.dist_m.length);
  assert.equal(S.dist_m[0], 0);
  assert.ok(Math.abs(S.dist_m.at(-1) - L) < 1e-6);
  const step = S.dist_m[1] - S.dist_m[0];
  assert.ok(step >= 95 && step <= 255, `${step}`);
  for (const h of S.horizons) assert.equal(h.el_deg.length, 180);
  // The ground height of each horizon sample is the grid height there.
  for (const k of [0, Math.floor(S.dist_m.length / 2), S.dist_m.length - 1]) {
    assert.ok(Math.abs(S.horizons[k].ground_elev_m - S.elev_m[k]) < 5, `${S.horizons[k].ground_elev_m} vs ${S.elev_m[k]}`);
  }
  // Path starts and ends at the requested points (to within a grid cell).
  assert.ok(r.stats.snapped_start_m < r.meta.fine_cell_m && r.stats.snapped_end_m < r.meta.fine_cell_m);
  // Preview image and an in-memory sky patch around a route point.
  assert.equal(r.preview.rgba.length, r.preview.width * r.preview.height * 4);
  const p = routePatch(r, S.lat[3], S.lon[3], { half_extent_m: 3000, n: 65 });
  assert.equal(p.data.length, 65 * 65);
  assert.ok(Math.abs(p.data[32 * 65 + 32]) < 0.5, "patch centre is the ground point");
});

test("timeline: stops park the rover, distance is monotonic, arrival = driving + stops", () => {
  const path = { dist_m: [0, 1000, 2500, 4000], time_s: [0, 5000, 12000, 20000] };
  const t0 = timeline(path);
  assert.equal(t0.arrival_s, 20000);
  assert.equal(t0.stops, 0);
  const t1 = timeline(path, { stop_every_km: 1.5, stop_h: 2 });
  assert.equal(t1.stops, 2);
  assert.equal(t1.arrival_s, 20000 + 2 * 7200);
  // At 1.5 km (t = 5000 + 0.5/1.5·7000 s) the rover parks for 2 h.
  const tStop = 5000 + (500 / 1500) * 7000;
  assert.ok(Math.abs(distanceAtTime(t1, tStop + 3600) - 1500) < 1e-9);
  let prev = -1;
  for (let t = 0; t <= t1.arrival_s + 100; t += 250) {
    const d = distanceAtTime(t1, t);
    assert.ok(d >= prev - 1e-9);
    prev = d;
  }
  assert.equal(distanceAtTime(t1, 1e9), 4000);
});

test("routeSeries: a zero-length route gives exactly the static-site series", async () => {
  await loadEphem(ephemDir, { fetch: fileFetch });
  const P = { lat_deg: -89.2, lon_deg: -110 };
  const r = await computeRoute(P, P, { preset: "lrv" }, { ...synthetic(P, P, hills([{ lat: -89.1, lon: -95, h: 1200, sigma: 3000 }]), 201), az_step_deg: 1 });
  assert.equal(r.samples.dist_m.length, 1);
  const t0 = Date.UTC(2027, 0, 20), t1 = t0 + 48 * HOUR, step = 20 * 60e3;
  const a = await routeSeries(r, t0, t1, step);
  const site = makeSite({ lat_deg: r.samples.lat[0], lon_deg: r.samples.lon[0], ground_elev_m: r.samples.horizons[0].ground_elev_m, horizon: r.samples.horizons[0] });
  const b = await series(site, t0, t1, step);
  for (const k of ["t_ms", "sun_el", "sun_az", "sun_vis", "flux_horiz_wm2", "flux_normal_wm2", "earth_el", "earth_az", "earth_vis", "earth_phase", "earth_ang_diam_deg", "sun_eclipse", "sun_flux_frac"]) {
    assert.deepEqual(a[k], b[k], k);
  }
  assert.deepEqual(a.summary.sun_vis_pct, b.summary.sun_vis_pct);
  assert.ok(a.distance_km.every((d) => d === 0));
  assert.ok(Math.abs(a.position[0].lat - P.lat_deg) < 0.01);
});

test("routeSeries along a moving route: distance grows to the route length, the horizon follows the rover", async () => {
  await loadEphem(ephemDir, { fetch: fileFetch });
  const r = await computeRoute(A, B, { preset: "lrv" }, { ...synthetic(A, B, HILL), az_step_deg: 2 });
  const track = routeTrack(r, { stop_every_km: 5, stop_h: 0.5 });
  const t0 = Date.UTC(2027, 5, 1, 12), step = 5 * 60e3;
  const t1 = t0 + track.arrival_ms + HOUR;
  const s = await routeSeries(r, t0, t1, step, { track });
  const n = s.t_ms.length;
  assert.equal(s.distance_km.length, n);
  assert.equal(s.position.length, n);
  assert.equal(s.distance_km[0], 0);
  assert.ok(Math.abs(s.distance_km[n - 1] - r.stats.length_m / 1000) < 1e-9);
  for (let i = 1; i < n; i++) {
    assert.ok(s.distance_km[i] >= s.distance_km[i - 1] - 1e-12);
    assert.ok(s.sample_index[i] >= s.sample_index[i - 1]);
  }
  assert.equal(s.route.stops, Math.ceil(r.stats.length_m / 5000) - 1);
  assert.ok(Math.abs(s.route.arrival_ms - (t0 + track.arrival_ms)) < 1e-6);
  // Each step uses the horizon of the sample at the rover's position.
  const i = Math.floor(n / 2), k = s.sample_index[i];
  const site = track.siteOf(k);
  const one = await series(site, s.t_ms[i], s.t_ms[i], step);
  assert.equal(one.sun_vis[0], s.sun_vis[i]);
  assert.equal(one.earth_el[0], s.earth_el[i]);
  // The rover's first and last positions are the end points.
  assert.ok(Math.abs(s.position[0].lat - A.lat_deg) < 0.005 && Math.abs(s.position[0].lon - A.lon_deg) < 0.005);
  assert.ok(Math.abs(s.position[n - 1].lat - B.lat_deg) < 0.005 && Math.abs(s.position[n - 1].lon - B.lon_deg) < 0.005);
});
