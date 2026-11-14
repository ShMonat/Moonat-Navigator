// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// Camera tracking for the sky view (C8 extra `setTrack`): the maths of following a moving target smoothly while a
// timelapse plays. Pure functions (no three.js, no DOM), tested in web/tests/sky_track.test.mjs.
//
// A camera is { az, el, hfov } in degrees: azimuth clockwise from north, pitch above the local horizontal plane, and
// horizontal field of view. A target is the camera the framing rule wants now (C8 lookAtBody for a body, or the
// direction the app asks for). Each new target is followed in two parts:
//   1. feed-forward: the part of the target's change that the tracked body's own motion explains is applied at once,
//      so a fast body (the Sun circling the pole at 1 month per second) is never left behind;
//   2. easing: whatever is left (a new body, a new direction, a switch of framing regime, a zoom) decays
//      exponentially with time constant tau, so nothing jumps.

import { fitPhotoView, fitBodyView } from './math.js';

/** Easing time constant (ms): after tau, 63 % of a framing change is done; after 3 tau (about 1 s), 95 %. */
export const TRACK_TAU_MS = 350;

/** Below these offsets (deg; relative for the field of view) the camera counts as on target and stops re-rendering. */
const SETTLE_DEG = 0.01, SETTLE_FOV = 1e-4;

/** Signed shortest turn (deg) from azimuth a to azimuth b, in (−180, 180]. */
export function azDelta(a, b) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** Azimuth wrapped to [0, 360) deg. */
export function wrapAz(a) {
  return ((a % 360) + 360) % 360;
}

/**
 * Share of the remaining offset removed in a step of dtMs: 1 − exp(−dt / tau). Exponential decay is independent of
 * the frame rate: two steps of dt remove as much as one step of 2·dt. 0 for dt ≤ 0; 1 (jump) for tau ≤ 0.
 */
export function easeFactor(dtMs, tauMs = TRACK_TAU_MS) {
  if (!(dtMs > 0)) return 0;
  if (!(tauMs > 0)) return 1;
  return 1 - Math.exp(-dtMs / tauMs);
}

/**
 * Feed-forward of a new target. prev, target: the previous and the new target cameras ({ az, el, hfov }, deg);
 * bodyMove: the tracked body's own motion between them ({ az, el }, deg; az as a signed shortest turn), or null (then
 * nothing is fed forward and the whole change eases). A direction target passes { az: 0, el: 0 }: a direction that
 * turns by up to 0.5° per update is followed without lag, and a sharper turn (a waypoint) eases.
 * Each part of the target's change that the body's motion explains is added to the camera at once:
 *   azimuth   if |Δaz| ≤ 1.5 |body Δaz| + 0.5°,
 *   pitch     if |Δel| ≤ 1.5 |body Δel| + 0.5°,
 *   FOV       if |Δhfov| ≤ 2 |body Δel| + 0.5°  (the framing rule widens the field as a high body climbs).
 * A larger change is a change of framing (a new frame shape, the body setting behind the skyline) and is left to the
 * easing. Returns the new camera; inputs are not changed.
 */
export function feedForward(view, prev, target, bodyMove) {
  const out = { ...view };
  if (!prev || !target || !bodyMove) return out;
  const dAz = azDelta(prev.az, target.az), dEl = target.el - prev.el, dFov = target.hfov - prev.hfov;
  if (Math.abs(dAz) <= 1.5 * Math.abs(bodyMove.az) + 0.5) out.az = wrapAz(out.az + dAz);
  if (Math.abs(dEl) <= 1.5 * Math.abs(bodyMove.el) + 0.5) out.el += dEl;
  if (Math.abs(dFov) <= 2 * Math.abs(bodyMove.el) + 0.5) out.hfov += dFov;
  return out;
}

/**
 * One easing step of dtMs toward the target: azimuth along the shortest turn, pitch linearly, field of view on a log
 * scale (so zooming in and out feel the same). Returns { az, el, hfov, settled }: settled when every offset is below
 * 0.01° (FOV within 0.01 %), and then the camera sits exactly on the target.
 */
export function easeToward(view, target, dtMs, tauMs = TRACK_TAU_MS) {
  const k = easeFactor(dtMs, tauMs);
  const dAz = azDelta(view.az, target.az), dEl = target.el - view.el, rFov = Math.log(target.hfov / view.hfov);
  const out = {
    az: wrapAz(view.az + k * dAz),
    el: view.el + k * dEl,
    hfov: view.hfov * Math.exp(k * rFov),
    settled: false,
  };
  const left = (1 - k);
  if (Math.abs(dAz) * left < SETTLE_DEG && Math.abs(dEl) * left < SETTLE_DEG && Math.abs(rFov) * left < SETTLE_FOV) {
    return { az: wrapAz(target.az), el: target.el, hfov: target.hfov, settled: true };
  }
  return out;
}

/**
 * Pitch (deg) of a camera that keeps a field of view the user chose (by zooming) while it follows a body: the C8 photo
 * rule at that field (horizon 20 % of the frame height above the bottom edge), or, for a body too high for it, the C8
 * body rule with no widening (the body stays in the frame and the horizon may leave it). A body below the skyline:
 * horizon one third of the height above the bottom edge (the dashed outline or the edge arrow shows where it is).
 * Inputs (deg): body centre elevation and angular radius, skyline elevation at the body's azimuth, the field of view;
 * aspect = frame width / height.
 */
export function aimAtFov({ bodyElDeg, bodyRadiusDeg = 0, horizonElDeg = 0, aspect = 16 / 9, hfovDeg = 70 }) {
  const args = { bodyElDeg, bodyRadiusDeg, horizonElDeg, aspect };
  const p = fitPhotoView({ ...args, hfovDeg, maxHfovDeg: hfovDeg });
  if (p.body_in_frame || bodyElDeg + bodyRadiusDeg <= horizonElDeg) return p.el_deg;
  return fitBodyView({ ...args, defaultHfovDeg: hfovDeg, maxHfovDeg: hfovDeg }).el_deg;
}

/**
 * Parse a setTrack() argument: "sun" | "earth" → { kind: "body", body }; { az_deg, el_deg } (finite numbers, deg) →
 * { kind: "dir", az, el }; anything else (null, "off") → null (tracking off).
 */
export function parseTrackTarget(t) {
  if (t === 'sun' || t === 'earth') return { kind: 'body', body: t };
  if (t && typeof t === 'object' && Number.isFinite(t.az_deg) && Number.isFinite(t.el_deg)) {
    return { kind: 'dir', az: wrapAz(t.az_deg), el: t.el_deg };
  }
  return null;
}
