// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The globe's view-direction wedge (web/js/globe/view_cone.js) and its wiring from the sky views
// (web/js/app/view_cone_link.js, web/js/app/globe_api.js setViewCone).
// Run: node --test web/tests/globe_view_cone.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { coneBasis, bearingDir, bearingPoint, coneScreen, createConeLayer, CONE_PX } from "../js/globe/view_cone.js";
import { PRESETS, viewAt, projectPx, radiusPx, vecToLatLon, latLonToVec } from "../js/globe/geo.js";
import { siteFrame, matVec, enuToAzEl } from "../js/physics/frames.js";
import { enuBasis } from "../js/terrain/geom.js";
import { attachGlobe, setViewCone } from "../js/app/globe_api.js";
import { linkViewCone, syncViewCone, pruneViewCones } from "../js/app/view_cone_link.js";

const DEG = Math.PI / 180;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b} (tol ${tol})`);
const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/**
 * Initial great-circle bearing (deg, clockwise from north) from (lat1, lon1) to (lat2, lon2), the standard spherical
 * formula, independent of the ENU code: atan2(sin dlon cos lat2, cos lat1 sin lat2 - sin lat1 cos lat2 cos dlon).
 */
function initialBearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

const SITES = [
  { name: "equator (Apollo 11)", lat: 0.67416, lon: 23.47314 },
  { name: "mid latitude north", lat: 45, lon: -30 },
  { name: "mid latitude south", lat: -40, lon: 170 },
  { name: "near the south pole (Shackleton rim)", lat: -89.67, lon: 129.78 },
  { name: "0.01 deg from the south pole", lat: -89.99, lon: -60 },
];

test("bearing math: azimuth 0/90/180/270 leaves toward north/east/south/west on the sphere", () => {
  const rho = 0.00005; // rad, about 90 m: short of the pole (0.01 deg = 300 m) for every site
  for (const s of SITES) {
    const b = coneBasis(s.lat, s.lon);
    for (const az of [0, 90, 180, 270]) {
      const q = vecToLatLon(bearingPoint(b, az, rho));
      const dLat = q.lat - s.lat;
      const dLon = ((q.lon - s.lon + 540) % 360) - 180;
      // The independent spherical formula gives back the azimuth.
      assert.ok(angDiff(initialBearing(s.lat, s.lon, q.lat, q.lon), az) < 1e-4, `${s.name} az ${az}`);
      // And the plain-words directions: north raises the latitude, east the longitude.
      if (az === 0) assert.ok(dLat > 0 && Math.abs(dLon * Math.cos(s.lat * DEG)) < 1e-3 * dLat, `${s.name}: north`);
      if (az === 180) assert.ok(dLat < 0 && Math.abs(dLon * Math.cos(s.lat * DEG)) < 1e-3 * -dLat, `${s.name}: south`);
      if (az === 90) assert.ok(dLon > 0, `${s.name}: east`);
      if (az === 270) assert.ok(dLon < 0, `${s.name}: west`);
    }
  }
});

test("bearing math: at the exact pole, north is the 0 deg meridian (docs/CONTRACTS.md §0)", () => {
  // South pole: north = +X (toward lon 0), east = north x up = +Y (90 E), whatever the nominal longitude.
  for (const lon of [0, 77, -150]) {
    const b = coneBasis(-90, lon);
    const want = { 0: 0, 90: 90, 180: 180, 270: -90 };
    for (const az of [0, 90, 180, 270]) {
      const q = vecToLatLon(bearingPoint(b, az, 0.001));
      assert.ok(q.lat > -90 && q.lat < -89.9, `south pole az ${az}: moves off the pole`);
      assert.ok(angDiff(q.lon, want[az]) < 1e-6, `south pole (lon ${lon}) az ${az}: lon ${q.lon}`);
    }
  }
  // North pole: north = +X (lon 0), east = north x up = -Y (90 W).
  const n = coneBasis(90, 0);
  close(vecToLatLon(bearingPoint(n, 0, 0.001)).lon, 0, 1e-6, "north pole az 0");
  close(vecToLatLon(bearingPoint(n, 90, 0.001)).lon, -90, 1e-6, "north pole az 90");
});

test("the wedge's frame is the sky view's frame (physics siteFrame) and the rover's (terrain enuBasis)", () => {
  for (const s of [...SITES, { name: "south pole", lat: -90, lon: 0 }]) {
    const R = siteFrame(s.lat, s.lon).r_me_to_enu;
    const g = enuBasis(s.lat, s.lon);
    const b = coneBasis(s.lat, s.lon);
    for (const az of [0, 37.5, 90, 180, 270, 333]) {
      // The sky view's azimuth of the wedge's direction is the wedge's azimuth.
      const a = enuToAzEl(matVec(R, bearingDir(b, az)));
      assert.ok(angDiff(a.az_deg, az) < 1e-9 && Math.abs(a.el_deg) < 1e-9, `${s.name} az ${az}`);
      // The rover's heading frame (web/js/rover/sky_ride.js) measures the same azimuth.
      const t = bearingDir(b, az);
      const ve = t[0] * g.east[0] + t[1] * g.east[1] + t[2] * g.east[2];
      const vn = t[0] * g.north[0] + t[1] * g.north[1] + t[2] * g.north[2];
      assert.ok(angDiff(Math.atan2(ve, vn) / DEG, az) < 1e-6, `${s.name} az ${az} (enuBasis)`);
    }
  }
});

/** The coneScreen ctx of a globe view on an 800 x 800 px canvas (no top bar). */
function ctxOf(view, W = 800, H = 800) {
  return { proj: (v) => projectPx(view, v, W, H), dir: view.dir, rpx: radiusPx(view.zoom, W, H) };
}
const cone = (lat, lon, az, hfov = 60) => ({ basis: coneBasis(lat, lon), az_deg: az, hfov_deg: hfov });
const screenAz = (axis) => ((Math.atan2(axis[0], -axis[1]) / DEG) + 360) % 360; // clockwise from screen up

test("on screen: north up, east right in north-up views; the polar view follows the pole convention", () => {
  const cases = [
    { name: "near side, lat 0 lon 0", view: { ...PRESETS.near, zoom: 1 }, lat: 0, lon: 0 },
    { name: "Apollo 11 close up", view: viewAt(0.67416, 23.47314, 20), lat: 0.67416, lon: 23.47314 },
    { name: "mid latitude", view: viewAt(45, -30, 3), lat: 45, lon: -30 },
    { name: "south pole, polar view", view: { ...PRESETS.south, zoom: 6 }, lat: -90, lon: 0 },
  ];
  for (const c of cases) {
    for (const az of [0, 90, 180, 270]) {
      const s = coneScreen(cone(c.lat, c.lon, az), ctxOf(c.view));
      assert.ok(s && s.axis, `${c.name} az ${az}: drawn`);
      assert.ok(angDiff(screenAz(s.axis), az) < 0.05, `${c.name} az ${az}: on screen ${screenAz(s.axis)}`);
    }
  }
  // Shackleton rim in the south polar view (lon 0 up, 90 E right): local north points away from the pole along
  // lon 129.78, local east 90 deg clockwise from it.
  const v = { ...PRESETS.south, zoom: 8 };
  const lon = 129.78;
  const outward = lon; // screen bearing (clockwise from up) of meridian `lon` leaving the pole: lon 0 up, lon 90 right
  for (const az of [0, 90, 180, 270]) {
    const s = coneScreen(cone(-89.67, lon, az), ctxOf(v));
    assert.ok(angDiff(screenAz(s.axis), (outward + az) % 360) < 0.2, `Shackleton rim az ${az}: ${screenAz(s.axis)}`);
  }
});

test("on screen: about CONE_PX long at every zoom, opening = field of view, gone on the far side", () => {
  for (const zoom of [1, 4, 20, 60]) {
    const view = viewAt(-20, 40, zoom);
    const s = coneScreen(cone(-20, 40, 123, 70), ctxOf(view));
    close(s.r, CONE_PX, 1, `zoom ${zoom}`);
    // The arc's ends are hfov apart as seen from the apex (the place faces the camera, so no foreshortening).
    const [ax, ay] = s.apex;
    const a0 = Math.atan2(s.pts[0][1] - ay, s.pts[0][0] - ax);
    const a1 = Math.atan2(s.pts.at(-1)[1] - ay, s.pts.at(-1)[0] - ax);
    close(angDiff(a1 / DEG, a0 / DEG), 70, 0.1, `opening at zoom ${zoom}`);
    assert.equal(s.alpha, 1);
  }
  const near = { ...PRESETS.near, zoom: 1 };
  assert.equal(coneScreen(cone(0, 180, 0), ctxOf(near)), null, "far side");
  assert.equal(coneScreen(cone(0, 95, 0), ctxOf(near)), null, "just past the limb");
  const limb = coneScreen(cone(0, 88, 90), ctxOf(near));
  assert.ok(limb && limb.alpha < 0.5, "fades out at the limb");
  // Points past the limb are moved onto it, never drawn inside the disc.
  const R = radiusPx(1, 800, 800);
  for (const [x, y] of limb.pts) assert.ok(Math.hypot(x - 400, y - 400) <= R + 0.5);
});

/** A minimal DOM for the layer: elements with attributes, style, dataset and children. */
function fakeDoc() {
  const mk = (tag) => ({
    tag, attrs: {}, style: {}, dataset: {}, children: [], parent: null,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    append(...cs) { for (const c of cs) { c.parent = this; this.children.push(c); } },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
  });
  return { createElementNS: (_ns, tag) => mk(tag) };
}
/** Fake animation frames: requests are queued; flush() runs them. */
function fakeFrames() {
  let q = new Map(), n = 0;
  return {
    raf: (f) => { q.set(++n, f); return n; },
    caf: (h) => q.delete(h),
    pending: () => q.size,
    flush() { const fs = [...q.values()]; q = new Map(); for (const f of fs) f(performance.now()); },
  };
}

test("layer: changes are drawn once per animation frame; unchanged wedges cost nothing", () => {
  const frames = fakeFrames();
  let draws = 0;
  const view = viewAt(0, 20, 2);
  const layer = createConeLayer({ getCtx: () => (draws++, ctxOf(view)), raf: frames.raf, caf: frames.caf, doc: fakeDoc() });
  for (let k = 0; k < 6; k++) layer.set(`p${k}`, { lat: 0, lon: 10 + 4 * k, az_deg: 30 * k, hfov_deg: 60, color: "#e33" });
  assert.equal(frames.pending(), 1, "six new wedges: one frame requested");
  assert.equal(draws, 0, "nothing drawn before the frame");
  frames.flush();
  assert.equal(draws, 1);
  assert.equal(layer.el.children.length, 6);
  const path = layer.el.children[0].children[1];
  assert.match(path.attrs.d, /^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+)+Z$/);
  // The same values again (or within 0.01 deg): no frame, no draw.
  for (let k = 0; k < 6; k++) layer.set(`p${k}`, { lat: 0, lon: 10 + 4 * k, az_deg: 30 * k + 0.001, hfov_deg: 60, color: "#e33" });
  assert.equal(frames.pending(), 0);
  // Many changes within one frame: one draw.
  for (let i = 0; i < 50; i++) layer.set("p0", { lat: 0, lon: 10, az_deg: i, hfov_deg: 60, color: "#e33" });
  assert.equal(frames.pending(), 1);
  frames.flush();
  assert.equal(draws, 2);
  // The globe's own render draws at once and replaces the scheduled frame.
  layer.set("p1", { lat: 0, lon: 14, az_deg: 200, hfov_deg: 40, color: "#e33" });
  layer.draw();
  assert.equal(draws, 3);
  assert.equal(frames.pending(), 0);
  // null removes a wedge; an unknown id does nothing.
  layer.set("p5", null);
  assert.equal(layer.size(), 5);
  assert.equal(layer.el.children.length, 5);
  layer.set("nope", null);
  frames.flush();
  assert.equal(draws, 4);
  // A wedge on the far side is hidden, not removed.
  layer.set("p2", { lat: 0, lon: 200, az_deg: 0, hfov_deg: 60, color: "#e33" });
  frames.flush();
  assert.equal(layer.el.children.find((g) => g.dataset.cone === "p2").style.display, "none");
});

test("wiring: each sky view's camera drives its scenario's wedge; a rover's wedge rides with the rover", () => {
  const calls = [];
  // Before the globe exists, wedges are kept and applied when it arrives (globe_api.js).
  setViewCone("early", { lat: 1, lon: 2, az_deg: 3, hfov_deg: 40 });
  const frames = fakeFrames();
  let draws = 0;
  const gview = viewAt(0, 20, 2);
  const layer = createConeLayer({ getCtx: () => (draws++, ctxOf(gview)), raf: frames.raf, caf: frames.caf, doc: fakeDoc() });
  attachGlobe({
    setViewCone: (id, c) => { calls.push([id, c]); layer.set(id, c); },
    showRoute() {}, setMarker() {},
  });
  assert.deepEqual(calls.map((c) => c[0]), ["early"]);
  setViewCone("early", null);

  const fakeView = () => {
    const cbs = new Set();
    return { cbs, onViewChange: (cb) => (cbs.add(cb), () => cbs.delete(cb)), emit: (v) => { for (const cb of cbs) cb(v); } };
  };
  const recs = ["a11", "a12", "a14", "a15", "a16", "a17"].map((id, k) => ({
    it: { s: { id }, site: { lat_deg: k - 3, lon_deg: 10 + 3 * k }, color: `#00${k}` }, view: fakeView(),
  }));
  for (const r of recs) linkViewCone(r);
  calls.length = 0;
  frames.flush();
  const before = draws;
  // Six views, each re-rendered several times in one frame: every change reaches the globe, one draw.
  for (let i = 0; i < 5; i++) recs.forEach((r, k) => r.view.emit({ az_deg: 90 * k + i, el_deg: 20, hfov_deg: 70 }));
  assert.equal(calls.length, 30);
  assert.deepEqual(calls.at(-1), ["a17", { lat: 2, lon: 25, az_deg: 454, hfov_deg: 70, color: "#005" }]);
  assert.equal(frames.pending(), 1);
  frames.flush();
  assert.equal(draws - before, 1);
  // A view rebuilt for the same card: the old listener is dropped.
  const old = recs[0].view;
  recs[0].view = fakeView();
  linkViewCone(recs[0]);
  assert.equal(old.cbs.size, 0, "the old view's listener is dropped");
  recs[0].view.emit({ az_deg: 270, el_deg: 59, hfov_deg: 80 });
  assert.deepEqual(calls.at(-1), ["a11", { lat: -3, lon: 10, az_deg: 270, hfov_deg: 80, color: "#000" }]);
  linkViewCone(recs[0]);
  assert.equal(recs[0].view.cbs.size, 1, "linking again replaces the listener");

  // Rover trip: the wedge is at the rover (rec.rideSite), not at the start pin, and moves with it.
  const trip = { it: { s: { id: "trip" }, route: {}, site: { lat_deg: -90, lon_deg: 0 }, color: "#0a0" }, view: fakeView() };
  trip.rideSite = { lat_deg: -89.95, lon_deg: -120 };
  linkViewCone(trip);
  trip.view.emit({ az_deg: 145, el_deg: 2, hfov_deg: 70 });
  assert.deepEqual(calls.at(-1), ["trip", { lat: -89.95, lon: -120, az_deg: 145, hfov_deg: 70, color: "#0a0" }]);
  trip.rideSite = { lat_deg: -89.9, lon_deg: -125 };
  syncViewCone(trip);
  assert.deepEqual(calls.at(-1)[1], { lat: -89.9, lon: -125, az_deg: 145, hfov_deg: 70, color: "#0a0" });

  // Scenarios no longer shown lose their wedges.
  calls.length = 0;
  pruneViewCones([...recs.slice(1), trip].map((r) => r.it));
  assert.deepEqual(calls, [["a11", null]]);
  assert.equal(layer.size(), 6);
});

test("a wedge at a pin points the way the sky view looks: Apollo 11 west then east (screen left, then right)", () => {
  const view = viewAt(0.67416, 23.47314, 8);
  const west = coneScreen(cone(0.67416, 23.47314, 270, 70), ctxOf(view));
  const east = coneScreen(cone(0.67416, 23.47314, 90, 70), ctxOf(view));
  assert.ok(west.axis[0] < -0.999 && east.axis[0] > 0.999);
  // The apex is the pin's point (the place's projection).
  const p = projectPx(view, latLonToVec(0.67416, 23.47314), 800, 800);
  close(west.apex[0], p.x, 1e-6);
  close(west.apex[1], p.y, 1e-6);
});
