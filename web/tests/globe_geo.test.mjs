// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Run: node --test web/tests/globe_geo.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  latLonToVec, vecToLatLon, wrapLon, pickOrtho, projectOrtho, pickPx, projectPx, PRESETS, viewAt, dragView, northUp,
  quatBetween, quatApply, fitPoints, capUv, angleDeg, frustumHalf, FIT_MARGIN, viewRight, dot,
} from "../js/globe/geo.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b} (tol ${tol})`);
const closeVec = (a, b, tol, msg) => a.forEach((x, i) => close(x, b[i], tol, `${msg ?? ""}[${i}]`));
const view = (name, zoom = 1) => ({ dir: PRESETS[name].dir, up: PRESETS[name].up, zoom });

test("lat/lon -> vector: known axes of MOON_ME", () => {
  closeVec(latLonToVec(0, 0), [1, 0, 0], 1e-15, "sub-Earth point");
  closeVec(latLonToVec(0, 90), [0, 1, 0], 1e-15, "90 E");
  closeVec(latLonToVec(0, -90), [0, -1, 0], 1e-15, "90 W");
  closeVec(latLonToVec(90, 0), [0, 0, 1], 1e-15, "north pole");
  closeVec(latLonToVec(-90, 123), [0, 0, -1], 1e-15, "south pole (any longitude)");
});

test("round trip lat/lon -> vector -> lat/lon over the sphere", () => {
  for (let lat = -89.5; lat <= 89.5; lat += 7.25) {
    for (let lon = -179.5; lon <= 179.5; lon += 11.5) {
      const ll = vecToLatLon(latLonToVec(lat, lon));
      close(ll.lat, lat, 1e-9, "lat");
      close(ll.lon, lon, 1e-9, "lon");
    }
  }
  // Shackleton rim, close to the pole.
  const ll = vecToLatLon(latLonToVec(-89.67, 129.78));
  close(ll.lat, -89.67, 1e-9);
  close(ll.lon, 129.78, 1e-7);
});

test("poles: latitude +-90 and longitude 0 at the exact pole", () => {
  assert.deepEqual(vecToLatLon([0, 0, 1]), { lat: 90, lon: 0 });
  assert.deepEqual(vecToLatLon([0, 0, -2]), { lat: -90, lon: 0 });
});

test("antimeridian: +180 and -180 are one point; longitudes stay in -180..180", () => {
  closeVec(latLonToVec(10, 180), latLonToVec(10, -180), 1e-15);
  close(Math.abs(vecToLatLon([-1, 0, 0]).lon), 180, 1e-12, "lon at (-1, 0, 0)");
  close(vecToLatLon(latLonToVec(0, 179.999)).lon, 179.999, 1e-9, "just east of the antimeridian");
  close(vecToLatLon(latLonToVec(0, -179.999)).lon, -179.999, 1e-9, "just west of it");
  assert.equal(wrapLon(190), -170);
  assert.equal(wrapLon(-190), 170);
  assert.equal(wrapLon(540), 180 - 360);
  assert.equal(wrapLon(180), 180);
  assert.equal(wrapLon(-180), -180);
});

test("presets: centre of the screen hits the expected point; east is on the right", () => {
  const c = (name) => vecToLatLon(pickOrtho(view(name), 0, 0, 1));
  assert.deepEqual(c("near"), { lat: 0, lon: 0 });
  const far = c("far");
  close(far.lat, 0, 1e-12);
  close(Math.abs(far.lon), 180, 1e-12);
  close(c("north").lat, 90, 1e-12);
  close(c("south").lat, -90, 1e-12);
  // Near side: right of centre is east, above is north.
  const r = vecToLatLon(pickOrtho(view("near"), 0.5, 0, 1));
  assert.ok(r.lon > 0 && Math.abs(r.lat) < 1e-9, "near side: right is east");
  assert.ok(vecToLatLon(pickOrtho(view("near"), 0, 0.5, 1)).lat > 0, "near side: up is north");
  // Far side: right of centre is still east (longitude just above -180).
  const fr = vecToLatLon(pickOrtho(view("far"), 0.3, 0, 1));
  assert.ok(fr.lon < 0 && fr.lon > -180, `far side: right is east of 180, got ${fr.lon}`);
  // South pole top-down: longitude 0 at the top, 90 E on the right.
  close(vecToLatLon(pickOrtho(view("south"), 0, 0.5, 1)).lon, 0, 1e-9, "south: top");
  close(vecToLatLon(pickOrtho(view("south"), 0.5, 0, 1)).lon, 90, 1e-9, "south: right");
  // North pole top-down: longitude 180 at the top, 90 E on the right.
  close(Math.abs(vecToLatLon(pickOrtho(view("north"), 0, 0.5, 1)).lon), 180, 1e-9, "north: top");
  close(vecToLatLon(pickOrtho(view("north"), 0.5, 0, 1)).lon, 90, 1e-9, "north: right");
});

test("raycast hit -> lat/lon: a known off-centre point on the near side", () => {
  // Screen point at NDC (x, y) on a square canvas with zoom 1 hits p = (x, y) * FIT_MARGIN in the (east, north) plane.
  const x = 0.4;
  const y = -0.3;
  const hit = pickOrtho(view("near"), x, y, 1);
  const e = x * FIT_MARGIN;
  const n = y * FIT_MARGIN;
  closeVec(hit, [Math.sqrt(1 - e * e - n * n), e, n], 1e-12);
  const ll = vecToLatLon(hit);
  close(ll.lat, Math.asin(n) / (Math.PI / 180), 1e-9, "lat");
  close(ll.lon, Math.atan2(e, Math.sqrt(1 - e * e - n * n)) / (Math.PI / 180), 1e-9, "lon");
  assert.equal(pickOrtho(view("near"), 0.99, 0.99, 1), null, "corner is off the disc");
});

test("pick and project are inverse on the visible hemisphere (any view, aspect, zoom)", () => {
  const views = [view("near", 1), view("far", 2.5), view("south", 30), viewAt(-89.7, 130, 12), viewAt(42, -170, 3)];
  for (const v of views) {
    for (const aspect of [0.6, 1, 1.8]) {
      for (const [x, y] of [[0, 0], [0.1, -0.05], [-0.04, 0.07]]) {
        const hit = pickOrtho(v, x, y, aspect);
        if (!hit) continue;
        const p = projectOrtho(v, hit, aspect);
        close(p.x, x, 1e-9);
        close(p.y, y, 1e-9);
        assert.ok(p.depth >= 0);
      }
    }
  }
  // Pixel helpers: y grows downwards.
  const v = view("near");
  const hit = pickPx(v, 300, 100, 400, 400);
  const p = projectPx(v, hit, 400, 400);
  close(p.x, 300, 1e-9);
  close(p.y, 100, 1e-9);
  assert.ok(vecToLatLon(hit).lat > 0, "upper half of the screen is north on the near side");
});

test("frustum: the smaller side shows FIT_MARGIN / zoom radii", () => {
  assert.deepEqual(frustumHalf(1, 2), { halfW: 2 * FIT_MARGIN, halfH: FIT_MARGIN });
  assert.deepEqual(frustumHalf(2, 0.5), { halfW: FIT_MARGIN / 2, halfH: FIT_MARGIN });
});

test("grab drag: the grabbed point ends under the cursor; screen basis stays orthonormal", () => {
  let v = viewAt(-80, 40, 2);
  const grabbed = pickOrtho(v, 0.2, 0.1, 1.3);
  const current = pickOrtho(v, -0.3, 0.25, 1.3);
  v = dragView(v, grabbed, current);
  const now = pickOrtho(v, -0.3, 0.25, 1.3);
  closeVec(now, grabbed, 1e-12);
  close(dot(v.dir, v.up), 0, 1e-12);
  close(Math.hypot(...v.up), 1, 1e-12);
  close(Math.hypot(...viewRight(v)), 1, 1e-12);
});

test("quaternions: between, apply, antiparallel", () => {
  const a = latLonToVec(10, 20);
  const b = latLonToVec(-50, 160);
  closeVec(quatApply(quatBetween(a, b), a), b, 1e-12);
  closeVec(quatApply(quatBetween([1, 0, 0], [-1, 0, 0]), [1, 0, 0]), [-1, 0, 0], 1e-12);
});

test("northUp: north at the top away from the poles; standard top-down orientation at the poles", () => {
  closeVec(northUp([1, 0, 0]), [0, 0, 1], 1e-15);
  const d = latLonToVec(45, 30);
  const u = northUp(d);
  close(dot(u, d), 0, 1e-12);
  assert.ok(u[2] > 0);
  assert.deepEqual(northUp([0, 0, -1]), PRESETS.south.up);
  assert.deepEqual(northUp([0, 0, 1]), PRESETS.north.up);
});

test("fitPoints: centre between the points, zoom that keeps them on screen", () => {
  const pts = [latLonToVec(-89.7, 130), latLonToVec(-85, 0)];
  const f = fitPoints(pts);
  assert.ok(f.zoom > 1);
  for (const p of pts) {
    const pr = projectOrtho({ dir: f.dir, up: northUp(f.dir), zoom: f.zoom }, p, 1);
    assert.ok(Math.abs(pr.x) <= 0.81 && Math.abs(pr.y) <= 0.81, `inside: ${pr.x}, ${pr.y}`);
  }
  // Points on opposite sides: whole disc.
  assert.equal(fitPoints([latLonToVec(0, 0), latLonToVec(0, 180)]).zoom, 1);
  assert.equal(fitPoints([latLonToVec(0, 0)], { maxZoom: 5 }).zoom, 5);
});

test("polar cap texture coordinates match the Python projection (south: lon 0 at the top)", () => {
  // Pole -> image centre.
  closeVec(capUv([0, 0, -1], -1, 22), [0.5, 0.5], 1e-15);
  closeVec(capUv([0, 0, 1], 1, 22), [0.5, 0.5], 1e-15);
  // The cap edge (22 deg from the pole) on longitude 0 is the top centre of the south cap ...
  closeVec(capUv(latLonToVec(-68, 0), -1, 22), [0.5, 1], 1e-12);
  // ... and longitude 90 E is the right edge; for the north cap, longitude 180 is the top.
  closeVec(capUv(latLonToVec(-68, 90), -1, 22), [1, 0.5], 1e-12);
  closeVec(capUv(latLonToVec(68, 180), 1, 22), [0.5, 1], 1e-12);
  closeVec(capUv(latLonToVec(68, 90), 1, 22), [1, 0.5], 1e-12);
});

test("angleDeg", () => {
  close(angleDeg(latLonToVec(0, 0), latLonToVec(0, 90)), 90, 1e-12);
  close(angleDeg(latLonToVec(-89.7, 0), latLonToVec(-90, 0)), 0.3, 1e-9);
});
