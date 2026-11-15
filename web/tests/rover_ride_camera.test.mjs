// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The rover's camera while the timelapse plays (sky_ride.js rideCamera): near the pole the local horizon frame turns
// quickly as the rover moves, and the camera must keep the same physical direction in every camera mode (free look,
// Follow, Driver's view), turning with the frame (view.turnFrame) instead of jumping and easing back. The 2D fallback
// (no turnFrame) is turned with lookAt in free look only.
// Run: node --test web/tests/rover_ride_camera.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { rideCamera, frameTurnDeg } from "../js/rover/sky_ride.js";

/** A 3D view stand-in: a camera azimuth (deg) that turnFrame turns; lookAt must not be used. */
function fakeView() {
  const v = { az: 30, el: 5, turns: [], lookAts: 0 };
  v.turnFrame = (d) => {
    v.turns.push(d);
    v.az = (((v.az + d) % 360) + 360) % 360;
  };
  v.lookAt = () => v.lookAts++;
  v.getView = () => ({ az_deg: v.az, el_deg: v.el, fov_deg: 70 });
  return v;
}

/** Ride points along a straight line leaving the south pole region (lat, lon in deg). */
function ridePoints() {
  const pts = [];
  for (let k = 0; k <= 40; k++) pts.push({ site: { lat_deg: -89.98 + k * 0.004, lon_deg: -120 + k * 4 } });
  return pts;
}

const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

for (const ahead of [false, true]) {
  test(`rideCamera keeps the physical direction as the local frame turns (${ahead ? "driver's view" : "free look and Follow"})`, () => {
    const view = fakeView();
    const rec = { view, it: {} };
    const pts = ridePoints();
    const ref = { lat_deg: -89, lon_deg: 0 };
    rec.rideSite = pts[0].site;
    // The camera's azimuth in one fixed frame: az_ref = az_local − frameTurnDeg(ref, site).
    const fixed0 = view.az - frameTurnDeg(ref, pts[0].site);
    let total = 0;
    for (const p of pts.slice(1)) {
      rideCamera(rec, p, { ahead });
      total += Math.abs(view.turns.at(-1));
      // Within 0.01 deg: the frame turns compose up to the sphere's tiny holonomy (about 0.002 deg on this path).
      assert.ok(Math.abs(wrap180(view.az - frameTurnDeg(ref, p.site) - fixed0)) < 0.01, `held at ${p.site.lat_deg}`);
      assert.equal(rec.rideSite, p.site);
    }
    assert.equal(view.lookAts, 0, "no lookAt: it would reframe on a body and drop the tracking feed-forward");
    assert.equal(view.turns.length, pts.length - 1, "turned at every frame, small turns included");
    assert.ok(total > 30, `the frame turned a lot along this path (${total.toFixed(1)} deg)`);
  });
}

test("rideCamera on the 2D fallback: lookAt in free look, nothing in the driver's view", () => {
  const pts = ridePoints();
  for (const ahead of [false, true]) {
    let looks = 0;
    const view = { lookAt: () => looks++, getView: () => ({ az_deg: 10, el_deg: 5, fov_deg: 70 }) };
    const rec = { view, it: {}, rideSite: pts[0].site };
    rideCamera(rec, pts[5], { ahead });
    assert.equal(looks, ahead ? 0 : 1);
  }
});
