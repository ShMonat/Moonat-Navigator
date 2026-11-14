// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Touch gestures for the sky views: pinch to zoom. Pure helpers (tested in web/tests/gestures.test.mjs) and one DOM binder.

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
