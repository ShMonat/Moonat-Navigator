// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The view-direction wedge on the Moon globe, like the heading cone a web map shows for a street-level view: a sector
// on the surface at a place, whose axis is the sky view's true azimuth and whose opening is the view's horizontal field
// of view, fading outward in the place's colour. Contract C8b `setViewCone` (docs/CONTRACTS.md).
//
// Frame: the sky view's own local frame, from the same function the physics uses (web/js/physics/frames.js siteFrame,
// docs/CONTRACTS.md §0): ENU at the site, up = the radial unit vector, azimuth clockwise from local north (the
// projection of ME +Z on the horizontal plane); exactly at a pole (|lat| > 89.9999 deg) north is the direction toward
// the 0 deg meridian. Bearing az leaves the site along the great circle with initial direction
// t = cos(az) north + sin(az) east; the point at angular distance rho is cos(rho) up + sin(rho) t (unit sphere, MOON_ME).
//
// Drawing: the sector is sampled on the unit sphere and projected with the globe's own projection (orthographic), so
// near the limb it foreshortens as the ground does. Its angular radius follows the zoom so that it stays CONE_PX CSS px
// long on screen. Points past the limb are moved onto the limb, and the wedge fades out as its place nears the limb.
// Redraws are coalesced to one per animation frame, and a cone that did not change costs nothing.

import { siteFrame } from "../physics/frames.js";

/** Length of the wedge on screen (CSS px) for a place near the centre of the disc. */
export const CONE_PX = 66;
/** Largest angular radius of the wedge (rad), for a very small globe. */
const MAX_RHO = 0.5;
/** Arc sample spacing (deg of azimuth). */
const STEP_DEG = 5;
const SVG_NS = "http://www.w3.org/2000/svg";

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Local frame of a place as unit vectors in MOON_ME: { up, east, north }, the rows of siteFrame's MOON_ME -> ENU matrix
 * (the frame the sky view's azimuths are measured in). lat, lon: selenographic, east-positive (deg).
 */
export function coneBasis(lat, lon) {
  const R = siteFrame(lat, lon).r_me_to_enu;
  return { east: [R[0], R[1], R[2]], north: [R[3], R[4], R[5]], up: [R[6], R[7], R[8]] };
}

/** Unit tangent vector (MOON_ME) of true azimuth az (deg) at a place: cos(az) north + sin(az) east. */
export function bearingDir(basis, azDeg) {
  const a = (azDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const { north: n, east: e } = basis;
  return [c * n[0] + s * e[0], c * n[1] + s * e[1], c * n[2] + s * e[2]];
}

/**
 * Point (unit vector, MOON_ME) at angular distance rho (rad) from a place along the great circle that leaves it at
 * true azimuth az (deg).
 */
export function bearingPoint(basis, azDeg, rho) {
  const t = bearingDir(basis, azDeg);
  const c = Math.cos(rho);
  const s = Math.sin(rho);
  const u = basis.up;
  return [c * u[0] + s * t[0], c * u[1] + s * t[1], c * u[2] + s * t[2]];
}

/** v moved onto the limb when it is on the far hemisphere of view direction `dir` (orthographic). */
function onDisc(v, dir) {
  const d = v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2];
  if (d >= 0) return v;
  const w = [v[0] - d * dir[0], v[1] - d * dir[1], v[2] - d * dir[2]];
  const n = Math.hypot(w[0], w[1], w[2]) || 1;
  return [w[0] / n, w[1] / n, w[2] / n];
}

/**
 * Screen shape of a cone { basis, az_deg, hfov_deg } for the globe's current view.
 * ctx: { proj(v) -> { x, y (CSS px, y down), depth (v . dir) }, dir (unit view direction, centre -> camera),
 *   rpx (Moon radius on screen, CSS px), px (wedge length, CSS px; default CONE_PX) }.
 * Returns null when the place is on the far side, else { apex: [x, y], pts: [[x, y], ...] (the arc, from az - hfov/2
 * to az + hfov/2), r (CSS px: the farthest arc point from the apex), axis: [dx, dy] (unit screen direction of the
 * azimuth line, y down) | null, alpha (0..1: fades out near the limb), rho (rad) }.
 */
export function coneScreen(cone, ctx) {
  const b = cone.basis;
  const ap = ctx.proj(b.up);
  if (!(ap.depth > 0)) return null;
  const rho = Math.min(MAX_RHO, Math.asin(Math.min(1, (ctx.px ?? CONE_PX) / Math.max(1e-6, ctx.rpx))));
  const half = clamp(cone.hfov_deg, 1, 179) / 2;
  const n = Math.max(2, Math.ceil((2 * half) / STEP_DEG));
  const pts = [];
  let r = 0;
  for (let i = 0; i <= n; i++) {
    const p = ctx.proj(onDisc(bearingPoint(b, cone.az_deg - half + (2 * half * i) / n, rho), ctx.dir));
    pts.push([p.x, p.y]);
    r = Math.max(r, Math.hypot(p.x - ap.x, p.y - ap.y));
  }
  const q = ctx.proj(onDisc(bearingPoint(b, cone.az_deg, rho / 4), ctx.dir));
  const len = Math.hypot(q.x - ap.x, q.y - ap.y);
  const axis = len > 1e-6 ? [(q.x - ap.x) / len, (q.y - ap.y) / len] : null;
  return { apex: [ap.x, ap.y], pts, r, axis, alpha: smooth(0, 0.1, ap.depth), rho };
}

/** Same values within drawing precision (a wedge that did not move is not redrawn). */
function sameCone(a, b) {
  return a.color === b.color && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7 &&
    Math.abs(a.az_deg - b.az_deg) < 0.01 && Math.abs(a.hfov_deg - b.hfov_deg) < 0.01;
}

let gradSeq = 0;

/**
 * The globe's wedge layer: an SVG element to put in the overlay (above the route lines, under the markers and pins)
 * and its cones.
 * opts.getCtx() -> the coneScreen ctx for the globe's current view, or null while the globe has no size.
 * opts.raf / opts.caf / opts.doc: requestAnimationFrame, cancelAnimationFrame and document (for tests).
 * Returns { el, set(id, cone | null), draw(), size() }:
 * - set: cone = { lat, lon (deg), az_deg (true azimuth), hfov_deg (opening), color (CSS; default the theme accent) };
 *   null (or a cone without finite numbers) removes it. A change schedules one redraw in the next animation frame,
 *   shared by all the cones; an unchanged cone schedules nothing.
 * - draw: redraw now (the globe calls it from its own render, for a new view), replacing a scheduled redraw.
 */
export function createConeLayer({
  getCtx,
  raf = (f) => requestAnimationFrame(f),
  caf = (h) => cancelAnimationFrame(h),
  doc = document,
} = {}) {
  const el = doc.createElementNS(SVG_NS, "svg");
  el.setAttribute("class", "globe-cones");
  el.setAttribute("aria-hidden", "true");
  // Layout here rather than in globe.css, so the layer is one self-contained module.
  el.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none";
  const cones = new Map(); // id -> { lat, lon, az_deg, hfov_deg, color, basis, g, grad, stops, path }
  let frame = 0;

  function schedule() {
    if (!frame) frame = raf(() => {
      frame = 0;
      draw();
    });
  }

  function build(id) {
    const g = doc.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "globe-cone");
    g.dataset.cone = id;
    const defs = doc.createElementNS(SVG_NS, "defs");
    const grad = doc.createElementNS(SVG_NS, "radialGradient");
    const gid = `globe-cone-g${++gradSeq}`;
    grad.setAttribute("id", gid);
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    // Strong near the place, fading to nothing at the arc.
    const stops = [[0, 0.72], [0.6, 0.48], [1, 0.05]].map(([o, a]) => {
      const s = doc.createElementNS(SVG_NS, "stop");
      s.setAttribute("offset", String(o));
      s.style.stopOpacity = String(a);
      grad.append(s);
      return s;
    });
    defs.append(grad);
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", `url(#${gid})`);
    path.setAttribute("stroke", `url(#${gid})`);
    path.setAttribute("stroke-width", "1.4");
    path.setAttribute("stroke-linejoin", "round");
    g.append(defs, path);
    el.append(g);
    return { g, grad, stops, path };
  }

  function set(id, cone) {
    const key = String(id);
    const ok = cone && [cone.lat, cone.lon, cone.az_deg, cone.hfov_deg].every(Number.isFinite);
    const prev = cones.get(key);
    if (!ok) {
      if (prev) {
        prev.g.remove();
        cones.delete(key);
        schedule();
      }
      return;
    }
    const next = { lat: cone.lat, lon: cone.lon, az_deg: cone.az_deg, hfov_deg: cone.hfov_deg, color: cone.color || "var(--accent, #8fb4ff)" };
    if (prev && sameCone(prev, next)) return;
    const c = prev ?? { ...build(key) };
    if (!prev || prev.lat !== next.lat || prev.lon !== next.lon) c.basis = coneBasis(next.lat, next.lon);
    if (!prev || prev.color !== next.color) for (const s of c.stops) s.style.stopColor = next.color;
    Object.assign(c, next);
    cones.set(key, c);
    schedule();
  }

  function draw() {
    if (frame) {
      caf(frame);
      frame = 0;
    }
    if (!cones.size) return;
    const ctx = getCtx();
    if (!ctx) return;
    for (const c of cones.values()) {
      const s = coneScreen(c, ctx);
      if (!s || s.alpha <= 0.01) {
        c.g.style.display = "none";
        continue;
      }
      c.g.style.display = "";
      c.g.style.opacity = s.alpha.toFixed(3);
      const [ax, ay] = s.apex;
      c.grad.setAttribute("cx", ax.toFixed(1));
      c.grad.setAttribute("cy", ay.toFixed(1));
      c.grad.setAttribute("r", Math.max(1, s.r).toFixed(1));
      let d = `M${ax.toFixed(1)} ${ay.toFixed(1)}`;
      for (const [x, y] of s.pts) d += `L${x.toFixed(1)} ${y.toFixed(1)}`;
      c.path.setAttribute("d", `${d}Z`);
    }
  }

  return { el, set, draw, size: () => cones.size };
}
