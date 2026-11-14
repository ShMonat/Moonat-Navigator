// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Tests for the pinch-zoom helper of the sky views.

import test from "node:test";
import assert from "node:assert/strict";
import { pinchFov, bindPinchZoom } from "../js/app/gestures.js";

test("pinchFov: fingers apart zoom in, together zoom out, no change for equal distance", () => {
  assert.equal(pinchFov(60, 100, 200), 30);
  assert.equal(pinchFov(60, 200, 100), 120);
  assert.equal(pinchFov(60, 100, 100), 60);
  assert.equal(pinchFov(60, 0, 100), 60);
  assert.equal(pinchFov(60, 100, NaN), 60);
});

/** A minimal element that records capture-phase listeners. */
function fakeEl() {
  const h = {};
  return {
    addEventListener: (t, f) => (h[t] = f),
    fire: (t, id, x, y, type = "touch") => {
      const ev = { pointerType: type, pointerId: id, clientX: x, clientY: y, stopped: false, stopPropagation() { this.stopped = true; } };
      h[t](ev);
      return ev;
    },
  };
}

test("bindPinchZoom: two touches set the field of view, one touch and the mouse are left alone", () => {
  const el = fakeEl();
  const calls = [];
  const view = { getView: () => ({ fov_deg: 60 }), setFov: (f) => calls.push(f) };
  bindPinchZoom(el, () => view);
  assert.equal(el.fire("pointerdown", 1, 0, 0).stopped, false); // first finger: the view's drag handles it
  assert.equal(el.fire("pointermove", 1, 5, 0).stopped, false);
  assert.equal(el.fire("pointerdown", 2, 100, 0, "mouse").stopped, false);
  assert.equal(el.fire("pointerdown", 2, 100, 0).stopped, true); // second finger: a pinch starts
  assert.equal(el.fire("pointermove", 2, 200, 0).stopped, true);
  assert.ok(Math.abs(calls.at(-1) - 60 * (95 / 195)) < 1e-9);
  el.fire("pointerup", 2, 200, 0);
  assert.equal(el.fire("pointermove", 1, 8, 0).stopped, false); // back to one finger
});

test("touchAxis: undecided inside the slop, then the dominant axis", async () => {
  const { touchAxis } = await import("../js/app/gestures.js");
  assert.equal(touchAxis(3, 6), null);
  assert.equal(touchAxis(2, 12), "y");
  assert.equal(touchAxis(-12, 4), "x");
  assert.equal(touchAxis(8, -8), "x"); // a 45° drag turns the view
});

test("bindAxisLock: a vertical swipe never reaches the view, a horizontal drag does, a second finger passes", async () => {
  const { bindAxisLock } = await import("../js/app/gestures.js");
  const el = fakeEl();
  bindAxisLock(el, { active: () => true });
  el.fire("pointerdown", 1, 100, 100);
  assert.equal(el.fire("pointermove", 1, 101, 104).stopped, true); // undecided: held back
  assert.equal(el.fire("pointermove", 1, 102, 115).stopped, true); // vertical: the page scrolls
  assert.equal(el.fire("pointermove", 1, 140, 115).stopped, true); // stays the page's
  el.fire("pointerup", 1, 140, 115);
  el.fire("pointerdown", 2, 100, 100);
  assert.equal(el.fire("pointermove", 2, 112, 103).stopped, false); // horizontal: the view turns
  assert.equal(el.fire("pointermove", 2, 112, 160).stopped, false); // and may then move vertically
  el.fire("pointerup", 2, 112, 160);
  el.fire("pointerdown", 3, 100, 100);
  el.fire("pointerdown", 4, 200, 100); // second finger before the first decided: a pinch
  assert.equal(el.fire("pointermove", 3, 100, 130).stopped, false);
  assert.equal(el.fire("pointerdown", 5, 0, 0, "mouse").stopped, false);
  const off = fakeEl();
  bindAxisLock(off, { active: () => false }); // focus mode: no lock
  off.fire("pointerdown", 1, 0, 0);
  assert.equal(off.fire("pointermove", 1, 0, 30).stopped, false);
});
