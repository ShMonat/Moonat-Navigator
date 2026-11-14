// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The globe's route, fit-to-points and flight geometry (web/js/globe/geo.js; API in docs/CONTRACTS.md C8b).
// Run: node --test web/tests/globe_routes.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  latLonToVec, vecToLatLon, slerpVec, greatCirclePath, visibleRuns, fitView, flightZoom, flightMs, projectPx, angleDeg,
  northUp, PRESETS, FIT_MARGIN, padBox, dot,
} from "../js/globe/geo.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b} (tol ${tol})`);
const ll = (lat, lon) => latLonToVec(lat, lon);

test("slerpVec: the midpoint of the equator from 0 to 90 E is 45 E; a 1/3 step is 30 E; antipodes stay on the sphere", () => {
  const m = vecToLatLon(slerpVec(ll(0, 0), ll(0, 90), 0.5));
  close(m.lat, 0, 1e-12);
  close(m.lon, 45, 1e-12);
  close(vecToLatLon(slerpVec(ll(0, 0), ll(0, 90), 1 / 3)).lon, 30, 1e-12);
  // Meridian through the pole: from 80 N 0 E to 80 N 180 E the arc passes over the north pole.
  close(vecToLatLon(slerpVec(ll(80, 0), ll(80, 180), 0.5)).lat, 90, 1e-9);
  const anti = slerpVec(ll(0, 0), ll(0, 180), 0.5);
  close(Math.hypot(...anti), 1, 1e-12, "antipodal midpoint on the unit sphere");
  close(angleDeg(anti, ll(0, 0)), 90, 1e-9, "a quarter turn from each end");
});

test("greatCirclePath: vertices at the lift radius, steps no longer than maxStepDeg, through every input point", () => {
  const pts = [ll(0, 0), ll(0, 10), ll(20, 10)];
  const path = greatCirclePath(pts, { maxStepDeg: 0.5, lift: 1.001 });
  for (const v of path) close(Math.hypot(...v), 1.001, 1e-12, "radius");
  for (let i = 1; i < path.length; i++) assert.ok(angleDeg(path[i - 1], path[i]) <= 0.5 + 1e-9, `step ${i}`);
  assert.equal(path.length, 1 + 20 + 40); // 10 deg in 0.5 deg steps, then 20 deg
  close(angleDeg(path[0], pts[0]), 0, 1e-9);
  close(angleDeg(path[20], pts[1]), 0, 1e-9);
  close(angleDeg(path.at(-1), pts[2]), 0, 1e-9);
  // A short polar rover drive (19 km, 0.63 deg): one segment, no extra vertices; one point gives one vertex.
  assert.equal(greatCirclePath([ll(-90, 0), ll(-89.4395, -137.1934)]).length, 3);
  assert.equal(greatCirclePath([ll(-89.5, 10)]).length, 1);
  assert.equal(greatCirclePath([]).length, 0);
});

test("greatCirclePath follows the great circle, not the parallel: 60 N 0 E to 60 N 90 E bulges toward the pole", () => {
  const path = greatCirclePath([ll(60, 0), ll(60, 90)], { maxStepDeg: 1 });
  const mid = vecToLatLon(path[Math.floor(path.length / 2)]);
  close(mid.lon, 45, 1.5);
  assert.ok(mid.lat > 67 && mid.lat < 68, `mid latitude ${mid.lat}`); // atan(tan 60 / cos 45) = 67.8 deg
});

test("visibleRuns: the far half of an equatorial ring is hidden from the near side; the polar view sees all of an 80 S ring", () => {
  const ring = [];
  for (let lon = -180; lon <= 180; lon += 5) ring.push(ll(0, lon));
  const path = greatCirclePath(ring, { maxStepDeg: 5.001, lift: 1.001 });
  const near = { ...PRESETS.near, zoom: 1 };
  const runs = visibleRuns(near, path);
  for (const [a, b] of runs) {
    for (let i = a; i <= b; i++) assert.ok(dot(path[i], near.dir) >= -0.05, `vertex ${i} visible from the near side`);
  }
  const shown = runs.reduce((n, [a, b]) => n + b - a + 1, 0);
  assert.equal(path.length, 73);
  assert.equal(shown, 37, "90 W to 90 E in 5 deg steps");
  const south = { ...PRESETS.south, zoom: 1 };
  const polar = [];
  for (let lon = -180; lon <= 180; lon += 10) polar.push(ll(-80, lon));
  const p2 = greatCirclePath(polar, { maxStepDeg: 2 });
  assert.deepEqual(visibleRuns(south, p2), [[0, p2.length - 1]]);
  // A vertex lifted above the limb stays visible just behind it (outside the disc), unlike one on the surface.
  const limb = [[-0.0001, 0, 1.001]];
  assert.equal(visibleRuns(near, limb).length, 1);
  assert.equal(visibleRuns(near, [[-0.05, 0, 0.99875]]).length, 0);
});

/** Screen positions of points for a fitView result. */
function screen(fit, pts, W, H) {
  return pts.map((p) => projectPx({ dir: fit.dir, up: fit.up, zoom: fit.zoom }, p, W, H));
}

test("fitView: points around the south pole centre on the pole, top-down, and fill the padded box", () => {
  const W = 440;
  const H = 484;
  const pts = [ll(-89, 0), ll(-89, 180), ll(-89, 90), ll(-88.5, -60)];
  const f = fitView(pts, { width: W, height: H, padding: 40, maxZoom: 60 });
  assert.ok(vecToLatLon(f.dir).lat < -89.6, `centre ${JSON.stringify(vecToLatLon(f.dir))}`);
  // Top-down polar orientation (as northUp): screen up is the 0 deg meridian over the south pole.
  close(dot(f.up, northUp(f.dir)), 1, 1e-9);
  const px = screen(f, pts, W, H);
  for (const p of px) {
    assert.ok(p.x >= 40 - 1e-6 && p.x <= W - 40 + 1e-6 && p.y >= 40 - 1e-6 && p.y <= H - 40 + 1e-6, JSON.stringify(p));
    assert.ok(p.depth > 0.99);
  }
  // The zoom is as large as it can be: some point touches the padded box.
  const slack = Math.min(...px.flatMap((p) => [p.x - 40, W - 40 - p.x, p.y - 40, H - 40 - p.y]));
  close(slack, 0, 0.5, "slack");
  assert.ok(f.zoom > 20 && f.zoom < 60, `zoom ${f.zoom}`);
});

test("fitView: a rover drive from the pole to the Shackleton ridge fits with the padding, below maxZoom", () => {
  const W = 390;
  const H = 420;
  const pts = [ll(-90, 0), ll(-89.7, -60), ll(-89.4395, -137.1934)];
  const f = fitView(pts, { width: W, height: H, padding: { top: 70, right: 50, bottom: 110, left: 16 }, maxZoom: 200 });
  const px = screen(f, pts, W, H);
  for (const p of px) assert.ok(p.x >= 16 - 1e-6 && p.x <= W - 50 + 1e-6 && p.y >= 70 - 1e-6 && p.y <= H - 110 + 1e-6, JSON.stringify(p));
  // Centred in the padded box: equal slack on both sides of the binding axis (within a pixel).
  const xs = px.map((p) => p.x);
  const ys = px.map((p) => p.y);
  const sx = [Math.min(...xs) - 16, W - 50 - Math.max(...xs)];
  const sy = [Math.min(...ys) - 70, H - 110 - Math.max(...ys)];
  const binding = Math.min(...sx, ...sy);
  close(binding, 0, 0.5);
  const pair = sx.includes(Math.min(...sx)) && Math.min(...sx) <= Math.min(...sy) ? sx : sy;
  close(pair[0], pair[1], 1.5, "centred on the binding axis");
  const capped = fitView(pts, { width: W, height: H, padding: 40, maxZoom: 30 });
  assert.equal(capped.zoom, 30);
});

test("fitView: across the 180 deg meridian the centre is at 180, not at 0", () => {
  const pts = [ll(10, 179), ll(-10, -179), ll(0, 175)];
  const f = fitView(pts, { width: 500, height: 500, padding: 20, maxZoom: 20 });
  const c = vecToLatLon(f.dir);
  assert.ok(Math.abs(Math.abs(c.lon) - 178) < 2, `centre lon ${c.lon}`);
  close(c.lat, 0, 0.5);
  for (const p of screen(f, pts, 500, 500)) assert.ok(p.x >= 20 - 1e-6 && p.x <= 480 + 1e-6 && p.y >= 20 - 1e-6 && p.y <= 480 + 1e-6);
});

test("fitView: points on opposite sides of the Moon give the whole disc; one point gives maxZoom on it; none gives null", () => {
  const f = fitView([ll(0, 0), ll(0, 120), ll(0, -120)], { width: 400, height: 400, maxZoom: 10 });
  assert.equal(f.zoom, 1);
  const one = fitView([ll(-45.4446, 177.5991)], { width: 400, height: 400, maxZoom: 6 });
  assert.equal(one.zoom, 6);
  close(angleDeg(one.dir, ll(-45.4446, 177.5991)), 0, 1e-9);
  assert.equal(fitView([], { width: 400, height: 400 }), null);
  // The six Apollo sites from a wide, short canvas: all inside, zoomed in beyond the whole disc.
  const apollo = [[0.674, 23.473], [-3.012, -23.422], [-3.645, -17.471], [26.132, 3.634], [-8.973, 15.5], [20.191, 30.772]].map(([a, b]) => ll(a, b));
  const fa = fitView(apollo, { width: 800, height: 400, padding: 30, maxZoom: 20 });
  assert.ok(fa.zoom > 1.5, `zoom ${fa.zoom}`);
  for (const p of screen(fa, apollo, 800, 400)) assert.ok(p.x >= 30 - 1e-6 && p.x <= 770 + 1e-6 && p.y >= 30 - 1e-6 && p.y <= 370 + 1e-6);
  assert.deepEqual(padBox(5), { top: 5, right: 5, bottom: 5, left: 5 });
  assert.deepEqual(padBox({ top: 9 }), { top: 9, right: 0, bottom: 0, left: 0 });
});

test("flightZoom: ends at both zooms; a long hop between two close-ups zooms out half-way; a short one does not", () => {
  close(flightZoom(2, 8, 0.3, 0), 2, 1e-12);
  close(flightZoom(2, 8, 0.3, 1), 8, 1e-12);
  // Apollo 11 to the south pole (about 90 deg) at zoom 6 both ends: half-way it shows both (zoom about 1.2).
  const mid = flightZoom(6, 6, Math.PI / 2, 0.5);
  close(mid, (FIT_MARGIN * 0.8) / Math.sin(Math.PI / 4), 1e-9);
  assert.ok(flightZoom(6, 6, Math.PI / 2, 0.25) < 6 && flightZoom(6, 6, Math.PI / 2, 0.25) > mid);
  // A 1 deg hop at zoom 4: no dip (both places are already in one view), plain log interpolation.
  close(flightZoom(4, 4, Math.PI / 180, 0.5), 4, 1e-12);
  close(flightZoom(1, 4, Math.PI, 0.5), 2, 1e-12);
  assert.equal(flightMs(0, 1, 1), 450);
  assert.ok(flightMs(Math.PI, 1, 8) <= 1600 && flightMs(Math.PI / 2, 1, 4) > flightMs(0.1, 1, 4));
});
