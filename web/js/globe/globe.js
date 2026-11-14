// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Moon globe location picker: a three.js sphere with the LRO WAC mosaic (NASA Moon Trek) and LOLA hillshade polar caps,
// an orthographic camera, preset views, drag / wheel / pinch navigation, a lat/lon graticule, catalog-site markers and
// scenario pins. Tapping or clicking the surface reports selenographic latitude and east longitude (MOON_ME).
// Geometry lives in geo.js (tested in web/tests/globe_geo.test.mjs). The scene uses MOON_ME coordinates directly.

import * as THREE from "three";
import { bindAxisLock } from "../app/gestures.js";
import {
  DEG, PRESETS, latLonToVec, vecToLatLon, pickPx, projectPx, dragView, rotateView, quatAxisAngle, viewRight,
  radiusPx, frustumHalf, northUp, fitPoints, norm, dot,
} from "./geo.js";

const MIN_ZOOM = 0.9;
const MAX_ZOOM = 60;
const TAP_SLOP_PX = { mouse: 4, pen: 6, touch: 10 };

// ----- Shaders -----

const VERT = /* glsl */ `
varying vec3 vPos;
varying vec2 vUv;
varying float vNz;
void main() {
  vPos = position;
  vUv = uv;
  vNz = normalize(normalMatrix * normal).z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tBase;
uniform sampler2D tNorth;
uniform sampler2D tSouth;
uniform sampler2D tInner;
uniform vec4 uHas;          // north, south, inner caps loaded (0/1); w: base loaded
uniform float rOuter;       // tan(psi_max / 2) of the outer caps
uniform float rInner;       // same for the inner south cap
uniform vec2 fadeOuter;     // psi (rad): cap fully shown below x, base fully shown above y
uniform vec2 fadeInner;
uniform float uFine;        // 0..1 alpha of the fine polar graticule
uniform float uUltra;       // 0..1 alpha of the finest polar rings
uniform float uBoundary;    // 0..1 alpha of the near/far side boundary
uniform float uDpr;
varying vec3 vPos;
varying vec2 vUv;
varying float vNz;

const float PI = 3.14159265358979;
const float D2R = 0.017453292519943;

float capWeight(float psi, vec2 f) { return 1.0 - smoothstep(f.x, f.y, psi); }

// Coverage (0..1) of a line at angular distance d (rad) for an angular pixel size px (rad / device pixel).
float lineAA(float d, float px, float widthPx) {
  float w = d / max(px, 1e-12);
  return 1.0 - smoothstep(0.5 * widthPx - 0.6, 0.5 * widthPx + 0.6, w);
}
float nearestMultiple(float x, float step) { return abs(x - step * floor(x / step + 0.5)); }

void main() {
  vec3 u = normalize(vPos);
  float lat = asin(clamp(u.z, -1.0, 1.0));
  float psiN = 0.5 * PI - lat;
  float psiS = 0.5 * PI + lat;

  // Base map (equirectangular, geometry UVs) and polar caps (stereographic, from the position).
  float c = uHas.w > 0.5 ? texture2D(tBase, vUv).r : 0.42;
  float kN = 1.0 / max(1.0 + u.z, 0.02);
  float kS = 1.0 / max(1.0 - u.z, 0.02);
  float cN = texture2D(tNorth, 0.5 + vec2(kN * u.y, -kN * u.x) / (2.0 * rOuter)).r;
  float cS = texture2D(tSouth, 0.5 + vec2(kS * u.y, kS * u.x) / (2.0 * rOuter)).r;
  float cI = texture2D(tInner, 0.5 + vec2(kS * u.y, kS * u.x) / (2.0 * rInner)).r;
  c = mix(c, cN, uHas.x * capWeight(psiN, fadeOuter));
  c = mix(c, cS, uHas.y * capWeight(psiS, fadeOuter));
  c = mix(c, cI, uHas.z * capWeight(psiS, fadeInner));

  // Tone: a gentle contrast curve, and limb darkening for the sense of a sphere.
  c = clamp((pow(c, 0.9) - 0.4) * 1.18 + 0.44, 0.0, 1.0);
  vec3 col = vec3(c) * vec3(1.0, 0.985, 0.955);
  col *= mix(0.5, 1.0, pow(clamp(vNz, 0.0, 1.0), 0.45));

  // Graticule: angular distance to the nearest line, scaled by the screen size of one radian. Latitude from atan
  // (accurate near the poles, unlike asin), longitude rate from the analytic derivative (no jump at 180 deg).
  float h = length(u.xy);
  float latA = atan(u.z, h);
  float pxLat = length(vec2(dFdx(latA), dFdy(latA)));
  vec2 p = u.xy;
  float r2 = max(h * h, 1e-14);
  vec2 dx = dFdx(p);
  vec2 dy = dFdy(p);
  float pxLon = length(vec2(p.x * dx.y - p.y * dx.x, p.x * dy.y - p.y * dy.x)) / r2;
  float lon = atan(u.y, u.x);
  float aLat = abs(latA) / D2R;
  float w = 1.1 * uDpr;

  float g = 0.0;
  // Parallels every 30 deg plus the 80 deg rings; meridians every 30 deg.
  g = max(g, lineAA(nearestMultiple(latA, 30.0 * D2R), pxLat, w) * step(aLat, 75.0));
  g = max(g, lineAA(abs(aLat - 80.0) * D2R, pxLat, w));
  g = max(g, lineAA(nearestMultiple(lon, 30.0 * D2R), pxLon, w) * step(aLat, 89.995));
  float gl = g * 0.34;
  // Fine polar graticule: rings at 85 and 88 deg, meridians every 10 deg from 80 to 88.5 deg.
  float f = 0.0;
  f = max(f, lineAA(abs(aLat - 85.0) * D2R, pxLat, w));
  f = max(f, lineAA(abs(aLat - 88.0) * D2R, pxLat, w));
  f = max(f, lineAA(nearestMultiple(lon, 10.0 * D2R), pxLon, w) * smoothstep(79.6, 80.4, aLat) * (1.0 - smoothstep(88.3, 88.7, aLat)));
  gl = max(gl, f * 0.26 * uFine);
  // Finest rings at 89 and 89.5 deg.
  float q = max(lineAA(abs(aLat - 89.0) * D2R, pxLat, w), lineAA(abs(aLat - 89.5) * D2R, pxLat, w));
  gl = max(gl, q * 0.28 * uUltra);
  col = mix(col, vec3(1.0), gl);
  // Near side / far side boundary: the 90 E and 90 W meridians (the mean limb seen from Earth), fainter at the poles.
  float b = lineAA(abs(abs(lon) - 0.5 * PI), pxLon, 1.5 * uDpr) * (1.0 - 0.7 * smoothstep(55.0, 75.0, aLat));
  col = mix(col, vec3(0.45, 0.74, 1.0), b * 0.7 * uBoundary);

  gl_FragColor = vec4(col, 1.0);
}`;

// ----- Small helpers -----

function el(tag, cls, attrs = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  return e;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function fmtLatLon(lat, lon, d = 2) {
  const la = `${Math.abs(lat).toFixed(d)}° ${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(lon).toFixed(d)}° ${lon >= 0 ? "E" : "W"}`;
  return `${la}, ${lo}`;
}
function latText(lat) {
  if (lat === 0) return "0°";
  return `${Math.abs(lat)}°${lat > 0 ? "N" : "S"}`;
}
function lonText(lon) {
  if (lon === 0) return "0°";
  if (Math.abs(lon) === 180) return "180°";
  return `${Math.abs(lon)}°${lon > 0 ? "E" : "W"}`;
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const PIN_SVG =
  '<svg viewBox="0 0 24 32" aria-hidden="true"><path d="M12 31c-1-4.4-9.5-11-9.5-18.2a9.5 9.5 0 0 1 19 0C21.5 20 13 26.6 12 31z"/><circle cx="12" cy="12.6" r="3.6"/></svg>';

const ICONS = {
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
};

/**
 * Graticule labels: [lat, lon, text, kind, level, when(view)].
 * level 0 shows below zoom 3, 1 from 3 to 10, 2 from 10; "all" at every zoom. `when` limits polar labels to views
 * near that pole.
 */
function buildLabels() {
  const out = [];
  const nearPole = (s) => (v) => s * v.dir[2] > 0.55;
  const notPolar = (v) => Math.abs(v.dir[2]) < 0.8;
  const lowLat = (v) => Math.abs(v.dir[2]) < 0.5;
  // Parallels (the equator is left to the longitude labels, which sit on it).
  for (const lat of [-80, -60, -30, 30, 60, 80]) {
    for (const lon of [0, 180]) out.push({ lat, lon, text: latText(lat), kind: "lat", level: "all" });
  }
  for (const s of [1, -1]) {
    for (const lat of [85, 88]) {
      for (const lon of [0, 180]) out.push({ lat: s * lat, lon, text: latText(s * lat), kind: "lat", level: 1 });
    }
    for (const lat of [88, 89, 89.5]) {
      for (const lon of [0, 180]) out.push({ lat: s * lat, lon, text: latText(s * lat), kind: "lat", level: 2 });
    }
  }
  // Meridians every 30 deg: on the equator, and on a ring near the pole that the view looks at.
  for (let lon = -150; lon <= 180; lon += 30) {
    out.push({ lat: 0, lon, text: lonText(lon), kind: "lon", level: "all", when: notPolar });
    for (const s of [1, -1]) {
      out.push({ lat: s * 70, lon, text: lonText(lon), kind: "lon", level: 0, when: nearPole(s) });
      out.push({ lat: s * 86.5, lon, text: lonText(lon), kind: "lon", level: 1, when: nearPole(s) });
      out.push({ lat: s * 89.25, lon, text: lonText(lon), kind: "lon", level: 2, when: nearPole(s) });
    }
  }
  // Near side / far side, on each side of the 90 E and 90 W meridians: beside the line in low-latitude views, and
  // above / below it in the polar views (where the line crosses the disc).
  for (const lon of [90, -90]) {
    const toward = lon > 0 ? 1 : -1;
    out.push({ lat: 14, lon: lon - toward * 2.5, text: "near side", kind: "side near", level: 0, align: toward > 0 ? "end" : "start", when: lowLat, minDepth: 0.3 });
    out.push({ lat: 14, lon: lon + toward * 2.5, text: "far side", kind: "side far", level: 0, align: toward > 0 ? "start" : "end", when: lowLat, minDepth: 0.3 });
    for (const s of [1, -1]) {
      const polar = (v) => s * v.dir[2] > 0.8;
      out.push({ lat: s * 45, lon: lon - toward * 7, text: "near side", kind: "side near", level: 0, align: "center", when: polar });
      out.push({ lat: s * 45, lon: lon + toward * 7, text: "far side", kind: "side far", level: 0, align: "center", when: polar });
    }
  }
  return out;
}

function levelOf(zoom) {
  return zoom < 3 ? 0 : zoom < 10 ? 1 : 2;
}

/**
 * Create the globe inside `container`.
 * @param {HTMLElement} container element to fill (it gets the class "globe-host")
 * @param {object} opts
 * @param {string} [opts.dataUrl] folder of moonmap.json and the textures (default "data/moonmap/")
 * @param {(lat: number, lon: number) => void} [opts.onPick] a tap or click on the surface: latitude, east longitude (deg)
 * @param {(site: any) => void} [opts.onSite] a tap or click on a catalog-site marker (receives the item's `data`)
 * @param {string} [opts.ariaLabel]
 * @param {Promise} [opts.hiResAfter] the full-resolution textures load only after this settles (the preview first)
 * @returns {Promise<object>} the globe API (setSites, setPins, showPoints, goTo, setPreset, resize, getView)
 */
export async function createGlobe(container, opts = {}) {
  const dataUrl = opts.dataUrl ?? "data/moonmap/";
  container.classList.add("globe-host");
  container.replaceChildren();

  // ----- DOM -----
  const root = el("div", "globe");
  const stage = el("div", "globe-stage", {
    tabindex: "0",
    role: "application",
    "aria-label": opts.ariaLabel ?? "Moon globe. Drag to turn, scroll or pinch to zoom, click to place the selected scenario. Arrow keys turn, plus and minus zoom.",
  });
  const canvas = el("canvas", "globe-canvas");
  const overlay = el("div", "globe-overlay", { "aria-hidden": "true" });
  const gridLayer = el("div", "globe-grid");
  const siteLayer = el("div", "globe-sites");
  const pinLayer = el("div", "globe-pins");
  overlay.append(gridLayer, siteLayer, pinLayer);
  const tip = el("div", "globe-tip", { role: "tooltip" });
  tip.hidden = true;
  const loading = el("div", "globe-loading", { text: "Loading the Moon…" });
  stage.append(canvas, overlay, tip, loading);

  const presets = el("div", "globe-presets", { role: "group", "aria-label": "Preset views" });
  const presetBtns = {};
  for (const [key, p] of Object.entries(PRESETS)) {
    const b = el("button", "globe-preset", { type: "button", "data-preset": key, text: p.label, "aria-pressed": "false" });
    b.addEventListener("click", () => setPreset(key));
    presets.append(b);
    presetBtns[key] = b;
  }
  const tools = el("div", "globe-tools");
  const btnExpand = el("button", "globe-btn globe-expand", { type: "button", "aria-label": "Enlarge the map", title: "Enlarge the map (Esc to close)", html: ICONS.expand });
  const btnIn = el("button", "globe-btn", { type: "button", "aria-label": "Zoom in", title: "Zoom in", html: ICONS.plus });
  const btnOut = el("button", "globe-btn", { type: "button", "aria-label": "Zoom out", title: "Zoom out", html: ICONS.minus });
  tools.append(btnExpand, btnIn, btnOut);
  const readout = el("div", "globe-readout", { "aria-live": "off" });
  readout.hidden = true;
  const credit = el("div", "globe-credit", {
    html:
      'Imagery: NASA/GSFC/ASU LRO WAC via <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noopener">NASA Moon Trek</a>' +
      " · Polar relief: NASA LRO LOLA",
  });
  root.append(stage, presets, tools, readout, credit);
  // Touch: in the page, a vertical swipe scrolls the page and a horizontal drag turns the globe (globe.css: touch-action
  // pan-y); two fingers pan and zoom. The enlarged globe (touch-action none) takes every gesture.
  bindAxisLock(root, { active: () => !expanded && /pan-y/.test(getComputedStyle(stage).touchAction) });
  container.append(root);

  // ----- three.js -----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr());
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);

  const geo = new THREE.SphereGeometry(1, 256, 128);
  // three.js sphere: y is the pole and u = 0.5 faces +x. Map (x, y, z) -> (x, -z, y) so that the scene is MOON_ME
  // (+z north, +x at longitude 0, +y at 90 E) and the equirectangular image (column 0 = longitude -180) lines up.
  geo.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  const blank = new THREE.DataTexture(new Uint8Array([107, 107, 107, 255]), 1, 1);
  blank.needsUpdate = true;
  const uniforms = {
    tBase: { value: blank },
    tNorth: { value: blank },
    tSouth: { value: blank },
    tInner: { value: blank },
    uHas: { value: new THREE.Vector4(0, 0, 0, 0) },
    rOuter: { value: Math.tan((22 * DEG) / 2) },
    rInner: { value: Math.tan((6.5 * DEG) / 2) },
    fadeOuter: { value: new THREE.Vector2(16 * DEG, 20 * DEG) },
    fadeInner: { value: new THREE.Vector2(5 * DEG, 6 * DEG) },
    uFine: { value: 0 },
    uUltra: { value: 0 },
    uBoundary: { value: 1 },
    uDpr: { value: dpr() },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms });
  scene.add(new THREE.Mesh(geo, mat));

  // ----- State -----
  let view = { dir: [...PRESETS.near.dir], up: [...PRESETS.near.up], zoom: 1 };
  let W = 1;
  let H = 1;
  let anim = null;
  let frame = 0;
  let sites = [];
  let pins = [];
  const labels = buildLabels().map((l) => {
    const e = el("div", `globe-label ${l.kind}`, { text: l.text });
    if (l.align) e.dataset.align = l.align;
    e.style.display = "none";
    gridLayer.append(e);
    return { ...l, v: latLonToVec(l.lat, l.lon), el: e, shown: false };
  });

  function requestRender() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w !== W || h !== H || renderer.getPixelRatio() !== dpr()) {
      W = w;
      H = h;
      renderer.setPixelRatio(dpr());
      uniforms.uDpr.value = dpr();
      renderer.setSize(W, H, false);
    }
    requestRender();
  }

  function render(now) {
    frame = 0;
    if (anim) {
      const t = clamp(((now ?? performance.now()) - anim.t0) / anim.dur, 0, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const q = anim.q0.clone().slerp(anim.q1, e);
      const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
      const up = new THREE.Vector3().setFromMatrixColumn(m, 1);
      const dir = new THREE.Vector3().setFromMatrixColumn(m, 2);
      view = { dir: dir.toArray(), up: up.toArray(), zoom: Math.exp(Math.log(anim.z0) + (Math.log(anim.z1) - Math.log(anim.z0)) * e) };
      if (t >= 1) anim = null;
      else requestRender();
    }
    if (W < 2 || H < 2) return;
    const { halfW, halfH } = frustumHalf(view.zoom, W / H);
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.position.set(view.dir[0] * 5, view.dir[1] * 5, view.dir[2] * 5);
    camera.up.set(view.up[0], view.up[1], view.up[2]);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    uniforms.uFine.value = smooth(2.2, 3.2, view.zoom);
    uniforms.uUltra.value = smooth(7, 10, view.zoom);
    uniforms.uBoundary.value = 1 - smooth(4, 8, view.zoom);
    renderer.render(scene, camera);
    placeOverlay();
    syncPresetButtons();
  }

  function place(item, minDepth) {
    const p = projectPx(view, item.v, W, H);
    const show = p.depth > minDepth && p.x > -20 && p.x < W + 20 && p.y > -20 && p.y < H + 20;
    if (show !== item.shown) {
      item.el.style.display = show ? "" : "none";
      item.shown = show;
    }
    if (show) item.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    return p;
  }

  function placeOverlay() {
    const lvl = levelOf(view.zoom);
    for (const l of labels) {
      const on = (l.level === "all" || l.level === lvl) && (!l.when || l.when(view));
      if (!on) {
        if (l.shown) {
          l.el.style.display = "none";
          l.shown = false;
        }
        continue;
      }
      const d0 = l.minDepth ?? 0.1;
      const p = place(l, d0);
      if (l.shown) l.el.style.opacity = String(smooth(d0, d0 + 0.22, p.depth));
    }
    for (const s of sites) place(s, 0.03);
    for (const p of pins) place(p, 0.0);
    if (tipFor && tipFor.shown) positionTip(tipFor);
    else if (tipFor) hideTip();
  }

  function syncPresetButtons() {
    for (const [key, p] of Object.entries(PRESETS)) {
      const on = !anim && view.zoom < 1.15 && dot(view.dir, p.dir) > 0.9995 && dot(view.up, p.up) > 0.999;
      presetBtns[key].setAttribute("aria-pressed", String(on));
    }
  }

  // ----- Navigation -----

  function stopAnim() {
    anim = null;
  }

  function quatOf(v) {
    const r = viewRight(v);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...r), new THREE.Vector3(...v.up), new THREE.Vector3(...v.dir));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  /** Animate to a view {dir, up, zoom}. */
  function animateTo(target, dur = 700) {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || dur <= 0) {
      anim = null;
      view = { dir: norm(target.dir), up: norm(target.up), zoom: target.zoom };
      requestRender();
      return;
    }
    anim = { q0: quatOf(view), q1: quatOf(target), z0: view.zoom, z1: target.zoom, t0: performance.now(), dur };
    requestRender();
  }

  function setPreset(key) {
    const p = PRESETS[key];
    if (p) animateTo({ dir: p.dir, up: p.up, zoom: 1 });
  }

  /** Centre the view on a latitude / longitude (deg), at `zoom` (default: keep the zoom, at least 1). */
  function goTo(lat, lon, zoom) {
    const dir = latLonToVec(lat, lon);
    animateTo({ dir, up: northUp(dir), zoom: zoom ?? Math.max(1, view.zoom) });
  }

  function isVisible(v, margin = 0.08) {
    const p = projectPx(view, v, W, H);
    const m = margin * Math.min(W, H);
    return p.depth > 0.12 && p.x > m && p.x < W - m && p.y > m && p.y < H - m;
  }

  /** Bring points [{lat, lon}] into view if any is hidden: centre on them, zooming out if needed. */
  function showPoints(points) {
    const vs = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map((p) => latLonToVec(p.lat, p.lon));
    if (!vs.length || vs.every((v) => isVisible(v))) return;
    if (vs.length === 1) {
      const dir = vs[0];
      animateTo({ dir, up: northUp(dir), zoom: Math.max(1, Math.min(view.zoom, 6)) });
      return;
    }
    const f = fitPoints(vs, { fill: 0.75, maxZoom: 6 });
    animateTo({ dir: f.dir, up: northUp(f.dir), zoom: Math.min(f.zoom, Math.max(1, view.zoom)) });
  }

  function zoomAbout(px, py, factor) {
    stopAnim();
    const before = pickPx(view, px, py, W, H);
    view = { ...view, zoom: clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM) };
    const after = before && pickPx(view, px, py, W, H);
    if (before && after) view = dragView(view, before, after);
    requestRender();
  }

  /** Free rotation by a screen-space drag (px) when the grab point is off the disc. */
  function trackball(dxPx, dyPx) {
    const R = radiusPx(view.zoom, W, H);
    const a = dxPx / R;
    const b = -dyPx / R; // screen y grows downwards
    const r = viewRight(view);
    const axis = [-view.up[0] * a + r[0] * b, -view.up[1] * a + r[1] * b, -view.up[2] * a + r[2] * b];
    const ang = Math.hypot(...axis);
    if (ang < 1e-9) return;
    view = rotateView(view, quatAxisAngle(norm(axis), ang));
  }

  // ----- Pointer input -----
  const pointers = new Map();
  let gesture = null; // {x0, y0, px, py, grabbed, moved, target, type, multi}

  function localXY(e) {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stopAnim();
    const [x, y] = localXY(e);
    pointers.set(e.pointerId, { x, y });
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    hideTip();
    if (pointers.size === 1) {
      gesture = {
        x0: x, y0: y, px: x, py: y, grabbed: pickPx(view, x, y, W, H), moved: false,
        target: e.target.closest?.("[data-site], [data-pin]") ?? null, type: e.pointerType, multi: false,
      };
      stage.classList.add("dragging");
    } else if (pointers.size === 2 && gesture) {
      gesture.multi = true;
      gesture.moved = true;
      const [a, b] = [...pointers.values()];
      gesture.mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      gesture.dist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    e.preventDefault();
  });

  stage.addEventListener("pointermove", (e) => {
    const [x, y] = localXY(e);
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === "mouse") updateReadout(x, y);
      return;
    }
    pointers.set(e.pointerId, { x, y });
    if (!gesture) return;
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      // Pan: the point under the previous midpoint follows the fingers; then zoom about the new midpoint.
      const before = pickPx(view, gesture.mid[0], gesture.mid[1], W, H);
      const now = pickPx(view, mid[0], mid[1], W, H);
      if (before && now) view = dragView(view, before, now);
      else trackball(mid[0] - gesture.mid[0], mid[1] - gesture.mid[1]);
      if (gesture.dist > 0 && dist > 0) zoomAbout(mid[0], mid[1], dist / gesture.dist);
      gesture.mid = mid;
      gesture.dist = dist;
      requestRender();
      return;
    }
    const slop = TAP_SLOP_PX[gesture.type] ?? 5;
    if (!gesture.moved && Math.hypot(x - gesture.x0, y - gesture.y0) > slop) gesture.moved = true;
    if (gesture.moved) {
      const now = pickPx(view, x, y, W, H);
      if (gesture.grabbed && now) view = dragView(view, gesture.grabbed, now);
      else {
        trackball(x - gesture.px, y - gesture.py);
        gesture.grabbed = null;
      }
      requestRender();
    }
    gesture.px = x;
    gesture.py = y;
    if (e.pointerType === "mouse") updateReadout(x, y);
  });

  function endPointer(e, cancelled) {
    if (!pointers.has(e.pointerId)) return;
    const [x, y] = localXY(e);
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (pointers.size === 1) {
      // Two fingers -> one: continue as a drag from the remaining finger, never as a tap.
      const [p] = [...pointers.values()];
      gesture = { ...gesture, x0: p.x, y0: p.y, px: p.x, py: p.y, grabbed: pickPx(view, p.x, p.y, W, H), moved: true };
      return;
    }
    if (pointers.size > 0) return;
    const g = gesture;
    gesture = null;
    stage.classList.remove("dragging");
    if (cancelled || g.moved || g.multi) return;
    if (g.target?.dataset.site !== undefined) {
      const s = sites[Number(g.target.dataset.site)];
      if (s && opts.onSite) opts.onSite(s.data);
      return;
    }
    if (g.target?.dataset.pin !== undefined) {
      const p = pins[Number(g.target.dataset.pin)];
      if (p) showTip(p);
      return;
    }
    const hit = pickPx(view, x, y, W, H);
    if (hit && opts.onPick) {
      const { lat, lon } = vecToLatLon(hit);
      opts.onPick(lat, lon);
    }
  }
  stage.addEventListener("pointerup", (e) => endPointer(e, false));
  stage.addEventListener("pointercancel", (e) => endPointer(e, true));
  stage.addEventListener("lostpointercapture", (e) => endPointer(e, true));
  stage.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && !pointers.size) readout.hidden = true;
  });

  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const [x, y] = localXY(e);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      zoomAbout(x, y, Math.exp(-clamp(dy, -300, 300) * 0.0018));
      updateReadout(x, y);
    },
    { passive: false },
  );

  stage.addEventListener("keydown", (e) => {
    const step = 6 / Math.max(1, view.zoom);
    const k = e.key;
    if (k === "+" || k === "=") zoomAbout(W / 2, H / 2, 1.4);
    else if (k === "-" || k === "_") zoomAbout(W / 2, H / 2, 1 / 1.4);
    else if (k.startsWith("Arrow")) {
      stopAnim();
      const R = radiusPx(view.zoom, W, H);
      const d = R * step * DEG;
      if (k === "ArrowLeft") trackball(d, 0);
      if (k === "ArrowRight") trackball(-d, 0);
      if (k === "ArrowUp") trackball(0, d);
      if (k === "ArrowDown") trackball(0, -d);
      requestRender();
    } else return;
    e.preventDefault();
  });

  btnIn.addEventListener("click", () => animateTo({ ...view, zoom: clamp(view.zoom * 2, MIN_ZOOM, MAX_ZOOM) }, 350));
  btnOut.addEventListener("click", () => animateTo({ ...view, zoom: clamp(view.zoom / 2, MIN_ZOOM, MAX_ZOOM) }, 350));

  // ----- Readout and tooltips -----

  function updateReadout(x, y) {
    const hit = pickPx(view, x, y, W, H);
    if (!hit) {
      readout.hidden = true;
      return;
    }
    const { lat, lon } = vecToLatLon(hit);
    readout.textContent = fmtLatLon(lat, lon, view.zoom > 8 ? 3 : 2);
    readout.hidden = false;
  }

  let tipFor = null;
  function showTip(item) {
    tipFor = item;
    tip.innerHTML = item.tipHtml;
    tip.hidden = false;
    positionTip(item);
  }
  function hideTip() {
    tipFor = null;
    tip.hidden = true;
  }
  function positionTip(item) {
    const p = projectPx(view, item.v, W, H);
    const off = item.kind === "pin" ? 30 : 10;
    const tw = tip.offsetWidth;
    const x = clamp(p.x - tw / 2, 4, Math.max(4, W - tw - 4));
    const below = p.y - off - tip.offsetHeight < 4;
    const y = below ? p.y + 12 : p.y - off - tip.offsetHeight;
    tip.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }
  overlay.addEventListener("pointerover", (e) => {
    if (pointers.size) return;
    const t = e.target.closest?.("[data-site], [data-pin]");
    if (!t) return;
    const item = t.dataset.site !== undefined ? sites[Number(t.dataset.site)] : pins[Number(t.dataset.pin)];
    if (item) showTip(item);
  });
  overlay.addEventListener("pointerout", (e) => {
    const t = e.target.closest?.("[data-site], [data-pin]");
    if (t && !t.contains(e.relatedTarget)) hideTip();
  });

  // ----- Markers -----

  /** Catalog sites: [{lat, lon, name, sub, kind, data}]. `data` is passed back to onSite. */
  function setSites(list) {
    siteLayer.replaceChildren();
    sites = list.map((s, i) => {
      const e = el("div", `globe-site${s.kind ? ` k-${s.kind}` : ""}`, { "data-site": String(i) });
      siteLayer.append(e);
      const tipHtml = `<strong>${esc(s.name)}</strong>${s.sub ? `<br><small>${esc(s.sub)}</small>` : ""}`;
      return { ...s, kind: "site", v: latLonToVec(s.lat, s.lon), el: e, shown: true, tipHtml };
    });
    hideTip();
    requestRender();
  }

  /** Scenario pins: [{lat, lon, color, label, active}]. */
  function setPins(list) {
    pinLayer.replaceChildren();
    pins = list.map((p, i) => {
      const e = el("div", `globe-pin${p.active ? " active" : ""}`, { "data-pin": String(i), html: PIN_SVG });
      e.style.setProperty("--c", p.color);
      pinLayer.append(e);
      const tipHtml = `<strong>${esc(p.label)}</strong><br><small>${esc(fmtLatLon(p.lat, p.lon))}</small>`;
      return { ...p, kind: "pin", v: latLonToVec(p.lat, p.lon), el: e, shown: true, tipHtml };
    });
    // Active pin on top.
    for (const p of pins) if (p.active) pinLayer.append(p.el);
    if (tipFor && tipFor.kind === "pin") hideTip();
    requestRender();
  }

  // ----- Expand to the whole window -----
  let expanded = false;
  const home = { parent: container };
  function setExpanded(on) {
    if (on === expanded) return;
    expanded = on;
    if (on) {
      document.body.append(root);
      root.classList.add("globe-full");
      document.documentElement.classList.add("globe-locked");
    } else {
      root.classList.remove("globe-full");
      home.parent.append(root);
      document.documentElement.classList.remove("globe-locked");
    }
    btnExpand.innerHTML = on ? ICONS.collapse : ICONS.expand;
    btnExpand.setAttribute("aria-label", on ? "Close the large map" : "Enlarge the map");
    btnExpand.title = on ? "Close the large map (Esc)" : "Enlarge the map (Esc to close)";
    btnExpand.setAttribute("aria-pressed", String(on));
    stage.focus({ preventScroll: true });
    resize();
  }
  btnExpand.addEventListener("click", () => setExpanded(!expanded));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && expanded) setExpanded(false);
  });

  // ----- Textures -----
  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  // The images are greyscale: on WebGL2 keep one 8-bit channel on the GPU (a quarter of the RGBA memory).
  const oneChannel = renderer.capabilities.isWebGL2;
  function loadTex(url) {
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (t) => {
          if (oneChannel) t.format = THREE.RedFormat;
          t.anisotropy = Math.min(8, maxAniso);
          t.minFilter = THREE.LinearMipmapLinearFilter;
          t.magFilter = THREE.LinearFilter;
          t.wrapS = THREE.ClampToEdgeWrapping;
          t.wrapT = THREE.ClampToEdgeWrapping;
          resolve(t);
        },
        undefined,
        reject,
      );
    });
  }

  let manifest = null;
  try {
    const r = await fetch(`${dataUrl}moonmap.json`);
    if (r.ok) manifest = await r.json();
  } catch {
    /* defaults below */
  }
  const caps = Object.fromEntries((manifest?.caps ?? []).map((c) => [c.id, c]));
  const capOf = (id, file) => caps[id] ?? { url: file, psi_max_deg: id === "south_inner" ? 6.5 : 22, fade_psi_deg: id === "south_inner" ? [6, 5] : [20, 16] };
  const north = capOf("north", "cap_north.jpg");
  const south = capOf("south", "cap_south.jpg");
  const inner = capOf("south_inner", "cap_south_inner.jpg");
  uniforms.rOuter.value = Math.tan((south.psi_max_deg * DEG) / 2);
  uniforms.rInner.value = Math.tan((inner.psi_max_deg * DEG) / 2);
  uniforms.fadeOuter.value.set(Math.min(...south.fade_psi_deg) * DEG, Math.max(...south.fade_psi_deg) * DEG);
  uniforms.fadeInner.value.set(Math.min(...inner.fade_psi_deg) * DEG, Math.max(...inner.fade_psi_deg) * DEG);

  // Base map: a small preview first (fast first paint on slow connections), then the full image, then the polar caps
  // one at a time: the 4 MB of detail never competes with the preview (or with the rest of the page) for bandwidth.
  // opts.hiResAfter (a promise) holds the detail back further, e.g. until the app's first results are drawn.
  let fullBase = false;
  const showBase = (t) => {
    const old = uniforms.tBase.value;
    uniforms.tBase.value = t;
    uniforms.uHas.value.w = 1;
    loading.hidden = true;
    if (old !== blank) old.dispose();
    requestRender();
  };
  const previewUrl = manifest?.base?.preview_url;
  const preview = previewUrl
    ? loadTex(`${dataUrl}${previewUrl}`)
        .then((t) => (fullBase ? t.dispose() : showBase(t)))
        .catch(() => {})
    : Promise.resolve();
  const hiResGate = Promise.all([preview, Promise.resolve(opts.hiResAfter).catch(() => {})]);
  const ready = hiResGate
    .then(() => loadTex(`${dataUrl}${manifest?.base?.url ?? "wac_global.jpg"}`))
    .then((t) => {
      fullBase = true;
      showBase(t);
    });
  ready.catch((err) => {
    console.error("[moonat] globe base texture failed", err);
    if (uniforms.uHas.value.w < 0.5) loading.textContent = "The Moon map image could not load.";
  });
  // The south caps first (the polar candidate sites), then the north cap.
  const capLoads = [
    [south, "tSouth", "y"],
    [inner, "tInner", "z"],
    [north, "tNorth", "x"],
  ].reduce(
    (prev, [c, u, flag]) =>
      prev.then(() =>
        loadTex(`${dataUrl}${c.url}`)
          .then((t) => {
            uniforms[u].value = t;
            uniforms.uHas.value[flag] = 1;
            requestRender();
          })
          .catch((err) => console.warn("[moonat] globe cap texture failed", c.url, err)),
      ),
    ready.catch(() => {}),
  );
  const allLoaded = Promise.allSettled([preview, ready, capLoads]).then((r) => {
    root.dataset.loaded = "true"; // for screenshots and tests
    return r;
  });

  new ResizeObserver(resize).observe(stage);
  resize();

  return {
    setSites,
    setPins,
    showPoints,
    goTo,
    setPreset,
    resize,
    getView: () => ({ ...view }),
    setView: (v) => {
      stopAnim();
      view = { dir: norm(v.dir), up: norm(v.up), zoom: v.zoom ?? 1 };
      requestRender();
    },
    ready: allLoaded,
    element: root,
  };
}
