// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Touch gestures for the sky views and the globe: pinch to zoom, and an axis lock so a vertical swipe scrolls the page.
// Pure helpers (tested in web/tests/app_gestures.test.mjs) and DOM binders.

/**
 * Axis of a one-finger touch drag after it has moved (dx, dy) CSS px from where it started: null while it is shorter
 * than `slop`, then "y" when it is mostly vertical (|dy| > |dx|) and "x" otherwise.
 */
export function touchAxis(dx, dy, slop = 10) {
  if (!(Math.hypot(dx, dy) >= slop)) return null;
  return Math.abs(dy) > Math.abs(dx) ? "y" : "x";
}

/**
 * Axis lock for one-finger touch drags on an element whose CSS says `touch-action: pan-y`: the first `slop` px of motion
 * decide. A clearly vertical swipe belongs to the browser, which scrolls the page (and then sends pointercancel); a
 * horizontal drag belongs to the view, which turns and may then also move vertically. Two fingers (a pinch) and mouse or
 * pen input pass through. Listens in the capture phase on `el`, so bind it on an ANCESTOR of the elements whose own
 * pointer handlers turn the view: stopPropagation keeps the moves of an undecided or vertical swipe from reaching them.
 * `active(event)` says whether the lock applies to a touch that starts with this pointerdown (e.g. not in a full-window
 * mode, where the CSS says `touch-action: none`, or not on an element that takes every drag itself).
 */
export function bindAxisLock(el, { slop = 10, active = () => /pan-y/.test(getComputedStyle(el).touchAction) } = {}) {
  const pts = new Map(); // pointerId -> { x0, y0, axis: null (undecided) | "x" (the view's) | "y" (the page's) }
  el.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch") return;
      const first = pts.size === 0;
      pts.set(e.pointerId, { x0: e.clientX, y0: e.clientY, axis: first && active(e) ? null : "x" });
      if (!first) for (const p of pts.values()) if (p.axis === null) p.axis = "x"; // a second finger: a pinch
    },
    true,
  );
  el.addEventListener(
    "pointermove",
    (e) => {
      const p = pts.get(e.pointerId);
      if (!p || p.axis === "x") return;
      if (p.axis === null) {
        p.axis = touchAxis(e.clientX - p.x0, e.clientY - p.y0, slop);
        // A vertical swipe: end the view's gesture now (so it never becomes a tap), and leave the swipe to the page.
        if (p.axis === "y" && typeof PointerEvent === "function") {
          e.target.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId, pointerType: "touch", bubbles: true }));
        }
      }
      if (p.axis !== "x") e.stopPropagation();
    },
    true,
  );
  const end = (e) => pts.delete(e.pointerId);
  el.addEventListener("pointerup", end, true);
  el.addEventListener("pointercancel", end, true);
}

/**
 * Field of view after a pinch.
 * @param {number} fov0 horizontal field of view when the pinch started, degrees
 * @param {number} d0 distance between the two fingers when the pinch started (any unit, > 0)
 * @param {number} d1 distance between the two fingers now (same unit)
 * @returns {number} the new field of view in degrees: fingers apart (d1 > d0) narrow the field (zoom in); the caller clamps it
 */
export function pinchFov(fov0, d0, d1) {
  if (!(d0 > 0) || !(d1 > 0)) return fov0;
  return fov0 * (d0 / d1);
}

/**
 * Let two fingers on `el` zoom the sky view, and keep the view's one-finger drag from jumping while they do.
 * `getView()` returns the view (or null) with getView() and setFov(deg). Touch pointers only; mouse and pen are untouched.
 * Listens in the capture phase, so the view's own pointer handlers never see the events of a two-finger gesture.
 */
export function bindPinchZoom(el, getView) {
  const pts = new Map();
  let start = null;
  const dist = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  el.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch") return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const v = getView()?.getView?.();
        start = v ? { d: dist(), fov: v.fov_deg } : null;
      }
      if (pts.size >= 2) e.stopPropagation();
    },
    true,
  );
  el.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "touch" || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size < 2) return;
      e.stopPropagation();
      const view = getView();
      if (start && view && pts.size === 2) view.setFov(pinchFov(start.fov, start.d, dist()));
    },
    true,
  );
  const end = (e) => {
    if (e.pointerType !== "touch") return;
    pts.delete(e.pointerId);
    if (pts.size < 2) start = null;
  };
  el.addEventListener("pointerup", end, true);
  el.addEventListener("pointercancel", end, true);
}
