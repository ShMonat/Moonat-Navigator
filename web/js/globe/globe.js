// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Moon globe location picker: a three.js sphere with the LRO WAC mosaic (NASA Moon Trek) and LOLA hillshade polar caps,
// an orthographic camera, preset views, drag / wheel / pinch navigation, a lat/lon graticule, catalog-site markers,
// scenario pins (click, and drag for the draggable ones), route lines, fly-to and fit-to-points animations, and day and
// night at a given moment (a smooth-sphere terminator from the Sun's direction, daylight.js).
// Tapping or clicking the surface reports selenographic latitude and east longitude (MOON_ME).
// Geometry lives in geo.js (tested in web/tests/globe_geo.test.mjs and globe_routes.test.mjs). The scene uses MOON_ME
// coordinates directly.

import * as THREE from "three";
import { bindAxisLock } from "../app/gestures.js";
import {
  DEG, PRESETS, latLonToVec, vecToLatLon, pickPx, projectPx, dragView, rotateView, quatAxisAngle, viewRight,
  radiusPx, frustumHalf, northUp, fitPoints, norm, dot, angleDeg, greatCirclePath, visibleRuns, fitView, flightZoom,
  flightMs, padBox, MIN_ZOOM, MAX_ZOOM, FIT_MAX_ZOOM, R_MOON_KM, snapTarget,
} from "./geo.js";
import { LAYERS, LIT_THRESHOLDS, normalizeLayers, capSamples } from "./layers.js";
import { createConeLayer } from "./view_cone.js";
import { DAYLIGHT_UNIFORMS_GLSL, DAYLIGHT_FUNCS_GLSL, NIGHT_RGB, LAYER_NIGHT_SHARE } from "./daylight.js";

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
// Map layers (globe/layers.js, web/data/overlays/overlays.json): polar caps in the same projection as the relief caps.
// Red channel: permanent shadow (0/1); green: sunlight class (0; 0.5 lit >= 70 %; 1 lit >= 80 % of the time).
uniform sampler2D tLayN;
uniform sampler2D tLayS;
uniform sampler2D tLayI;
uniform vec3 uLayHas;       // north, south, south inner layer images loaded (0/1)
uniform vec3 rLay;          // tan(psi_max / 2) of each
uniform vec3 psiLay;        // psi_max (rad) of each: the layers are drawn inside this circle only
uniform vec2 fadeLay;       // psi (rad): south inner image fully shown below x, the south image above y
uniform vec2 uLayOn;        // permanent shadow, sunlight: 0..1
uniform vec3 cPsr;
uniform vec3 cLow;
uniform vec3 cHigh;
uniform vec3 aLay;          // blend weights of cPsr, cLow, cHigh
// Day and night at the selected moment (daylight.js).
${DAYLIGHT_UNIFORMS_GLSL}
varying vec3 vPos;
varying vec2 vUv;
varying float vNz;

const float PI = 3.14159265358979;
const float D2R = 0.017453292519943;

float capWeight(float psi, vec2 f) { return 1.0 - smoothstep(f.x, f.y, psi); }
// 1 inside the circle psi < pmax, 0 outside, anti-aliased over one screen pixel.
float inCap(float psi, float pmax) {
  float fw = max(fwidth(psi), 1e-7);
  return 1.0 - smoothstep(pmax - fw, pmax, psi);
}

// Coverage (0..1) of a line at angular distance d (rad) for an angular pixel size px (rad / device pixel).
float lineAA(float d, float px, float widthPx) {
  float w = d / max(px, 1e-12);
  return 1.0 - smoothstep(0.5 * widthPx - 0.6, 0.5 * widthPx + 0.6, w);
}
float nearestMultiple(float x, float step) { return abs(x - step * floor(x / step + 0.5)); }
${DAYLIGHT_FUNCS_GLSL}

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

  // Day and night, and the Earth's shadow in an eclipse: the ground dims on the night side; the layer colours dim
  // less, so they stay readable.
  float lit = daylight(u);
  lit *= 1.0 - earthShadow(u);
  vec3 shade = dayShade(lit);
  vec3 layShade = mix(vec3(1.0), shade, ${LAYER_NIGHT_SHARE.toFixed(3)});
  col *= shade;

  // Map layers, tinted by the ground's grey so the relief stays readable. All three images are sampled every time
  // (no texture reads in non-uniform branches: their mipmap level needs the neighbouring pixels).
  if (uLayOn.x + uLayOn.y > 0.0) {
    vec2 mN = texture2D(tLayN, 0.5 + vec2(kN * u.y, -kN * u.x) / (2.0 * rLay.x)).rg;
    vec2 mS = texture2D(tLayS, 0.5 + vec2(kS * u.y, kS * u.x) / (2.0 * rLay.y)).rg;
    vec2 mI = texture2D(tLayI, 0.5 + vec2(kS * u.y, kS * u.x) / (2.0 * rLay.z)).rg;
    mS = mix(mS, mI, uLayHas.z * capWeight(psiS, fadeLay));
    vec2 m = mN * (uLayHas.x * inCap(psiN, psiLay.x)) + mS * (uLayHas.y * inCap(psiS, psiLay.y));
    float psr = m.r * uLayOn.x;
    float lo = smoothstep(0.15, 0.4, m.g) * uLayOn.y;
    float hi = smoothstep(0.62, 0.88, m.g) * uLayOn.y;
    float relief = 0.55 + 0.45 * c;
    col = mix(col, cPsr * relief * layShade, aLay.x * psr);
    col = mix(col, cLow * relief * layShade, aLay.y * lo * (1.0 - hi));
    col = mix(col, cHigh * relief * layShade, aLay.z * hi);
  }

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

// Sunlit spots of the sunlight layer: a small sun symbol (a disc with eight rays) on each spot, or group of nearby
// spots, while it is smaller than a few screen pixels, so that it can be found; zoomed in, a thin ring around the spot
// instead, and the layer image fills the spot itself. In screen pixels; hidden on the far side of the Moon.
const SPOT_VERT = /* glsl */ `
attribute vec2 aSpot;       // spot radius on the ground (rad), class (0: lit >= 70 %, 1: >= 80 % of the time)
uniform float uPxPerRad;    // device px per radian (= per Moon radius)
uniform float uDpr;
uniform float uMaxPt;       // largest point size the GPU draws (device px)
varying float vR;           // ring radius, CSS px
varying float vSize;        // point size, CSS px
varying float vSym;         // 1: sun symbol, 0: ring
varying float vHi;
varying float vFade;
void main() {
  float nz = normalize(normalMatrix * position).z;
  vFade = smoothstep(0.03, 0.2, nz);
  gl_Position = nz > 0.0 ? projectionMatrix * modelViewMatrix * vec4(position, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  float rg = aSpot.x * uPxPerRad / uDpr;
  vSym = 1.0 - smoothstep(3.0, 6.0, rg);
  vR = rg + 3.0;
  vSize = 2.0 * max(10.0, vR + 2.5);
  vHi = aSpot.y;
  // A ring larger than the GPU's largest point (deep zoom) fades out; the layer image fills the spot by then.
  vFade *= 1.0 - smoothstep(0.85 * uMaxPt, uMaxPt, vSize * uDpr);
  gl_PointSize = min(vSize * uDpr, uMaxPt);
}`;

const SPOT_FRAG = /* glsl */ `
precision highp float;
uniform vec3 cLow;
uniform vec3 cHigh;
uniform float uAlpha;
varying float vR;
varying float vSize;
varying float vSym;
varying float vHi;
varying float vFade;
// Coverage of a band of half-width h around 0, anti-aliased (x and h in CSS px).
float band(float x, float h) { return 1.0 - smoothstep(h - 0.6, h + 0.6, abs(x)); }
// The sun symbol grown by g px: a disc of radius 3 and eight rays from 4.5 to 8.2 px, 1.5 px wide.
float sunSym(float d, float k, float g) {
  float core = 1.0 - smoothstep(3.0 + g - 0.6, 3.0 + g + 0.6, d);
  float along = smoothstep(4.5 - g - 0.6, 4.5 - g + 0.6, d) * (1.0 - smoothstep(8.2 + g - 0.6, 8.2 + g + 0.6, d));
  return max(core, along * band(k * d, 0.75 + g));
}
void main() {
  vec2 q = (gl_PointCoord - 0.5) * vSize;
  float d = length(q);
  float a = atan(q.y, q.x);
  float k = abs(fract(a / 0.785398 + 0.5) - 0.5) * 0.785398; // angle to the nearest of eight rays (rad)
  float fill = mix(band(d - vR, 0.9), sunSym(d, k, 0.0), vSym);
  float edge = mix(band(d - vR, 2.2), sunSym(d, k, 1.3), vSym);
  vec4 o = vec4(0.04, 0.04, 0.07, 0.85 * edge);
  o = mix(o, vec4(mix(cLow, cHigh, vHi), 1.0), fill);
  o.a *= uAlpha * vFade;
  if (o.a < 0.01) discard;
  gl_FragColor = o;
}`;

// ----- Small helpers -----

/** The largest point size (device px) the GPU draws, at least 64. */
function maxPointPx(renderer) {
  const gl = renderer.getContext();
  const r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  return Math.max(64, r?.[1] ?? 64);
}

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

/** House outline (24 x 24 box), for the home marker, the home pin and the Home button. */
export const HOUSE_PATH = "M4 11.2 12 4.5l8 6.7M6.5 9.4V19.5h4v-5h3v5h4V9.4";

/** Teardrop pin (tip at the bottom centre) with a white glyph for the kind of place inside the head. */
function pinSvg(glyph) {
  const g = {
    mission: '<circle class="pin-g" cx="12" cy="12.4" r="3.7"/>',
    candidate: '<rect class="pin-g" x="9.3" y="9.7" width="5.4" height="5.4" rx="0.8" transform="rotate(45 12 12.4)"/>',
    poi: '<rect class="pin-g" x="8.8" y="9.2" width="6.4" height="6.4" rx="1"/>',
    home: '<path class="pin-g pin-house" d="M7.2 12.6 12 8.4l4.8 4.2M8.7 11.5v4.6h6.6v-4.6"/>',
  }[glyph] ?? '<circle class="pin-g" cx="12" cy="12.4" r="3.7"/>';
  return '<svg viewBox="0 0 24 34" aria-hidden="true"><ellipse class="pin-shadow" cx="12" cy="32.6" rx="4.2" ry="1.4"/>' +
    '<path class="pin-body" d="M12 32c-1-4.6-9.6-11.2-9.6-18.6a9.6 9.6 0 0 1 19.2 0C21.6 20.8 13 27.4 12 32z"/>' + g + "</svg>";
}

const ICONS = {
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
};
const SVG_NS = "http://www.w3.org/2000/svg";
/** Default padding (CSS px) of fitTo: clear of the search box at the top and the tools on the right. */
const FIT_PAD = { top: 64, right: 56, bottom: 36, left: 20 };

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
 * @param {(pin: any) => void} [opts.onPin] a tap or click on a scenario pin (receives the pin's `data`); without it the
 *   pin shows its tooltip
 * @param {(pin: any, lat: number, lon: number) => void} [opts.onPinDrag] a draggable pin was dropped at lat, lon (deg)
 * @param {string} [opts.ariaLabel]
 * @param {Promise} [opts.hiResAfter] the full-resolution textures load only after this settles (the preview first)
 * @param {string} [opts.overlayUrl] folder of overlays.json and the map layer images (default "data/overlays/")
 * @returns {Promise<object>} the globe API (setSites, setPins, showPoints, goTo, flyTo, fitTo, showRoute, clearRoute,
 *   setMarker, clearMarker, setViewCone, setLayers, getLayers, layerPoleInView, setSunDir,
 *   setPreset, addTool, slots, resize, getView, setView)
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
    "aria-label": opts.ariaLabel ?? "Moon globe. Drag to turn, scroll or pinch to zoom, click a pin to add or remove a place, click the surface to drop a pin. Arrow keys turn, plus and minus zoom.",
  });
  const canvas = el("canvas", "globe-canvas");
  const overlay = el("div", "globe-overlay", { "aria-hidden": "true" });
  const gridLayer = el("div", "globe-grid");
  const routeLayer = document.createElementNS(SVG_NS, "svg");
  routeLayer.setAttribute("class", "globe-routes");
  const siteLayer = el("div", "globe-sites");
  const pinLayer = el("div", "globe-pins");
  const markerLayer = el("div", "globe-markers");
  // View-direction wedges (view_cone.js), under the markers and pins; drawn with the overlay, or alone when only they change.
  const cones = createConeLayer({ getCtx: () => (W < 2 || H < 2 ? null : { proj, dir: view.dir, rpx: rpx() }) });
  overlay.append(gridLayer, routeLayer, cones.el, siteLayer, pinLayer, markerLayer);
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
  const btnIn = el("button", "globe-btn globe-zoom-in", { type: "button", "aria-label": "Zoom in", title: "Zoom in", html: ICONS.plus });
  const btnOut = el("button", "globe-btn globe-zoom-out", { type: "button", "aria-label": "Zoom out", title: "Zoom out", html: ICONS.minus });
  tools.append(btnExpand, btnIn, btnOut);
  const readout = el("div", "globe-readout", { "aria-live": "off" });
  readout.hidden = true;
  const credit = el("div", "globe-credit", {
    html:
      'Imagery: NASA/GSFC/ASU LRO WAC via <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noopener">NASA Moon Trek</a>' +
      " · Polar relief: NASA LRO LOLA" +
      '<span class="globe-credit-layers" hidden> · Layers: NASA LOLA / <a href="https://pgda.gsfc.nasa.gov/products/69" target="_blank" rel="noopener">PGDA</a></span>',
  });
  // Slots for the page's own controls: the top one (above the preset chips) holds the search box, the bottom one
  // (above the credit line) a place card.
  const top = el("div", "globe-top");
  const slotTop = el("div", "globe-slot-top");
  // A one-line caption under the chips (the page's day/night time line); the frame makes room for it.
  const slotCaption = el("div", "globe-slot-caption");
  top.append(slotTop, presets, slotCaption);
  const slotBottom = el("div", "globe-slot-bottom");
  root.append(stage, top, tools, readout, slotBottom, credit);
  // Touch: in the page, a vertical swipe scrolls the page and a horizontal drag turns the globe (globe.css: touch-action
  // pan-y); two fingers pan and zoom. The enlarged globe (touch-action none) takes every gesture, and so does a finger
  // that starts on a draggable pin (it moves the pin).
  bindAxisLock(root, {
    active: (e) => !expanded && /pan-y/.test(getComputedStyle(stage).touchAction) && !e?.target?.closest?.(".globe-pin.draggable"),
  });
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
  const noLayer = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  noLayer.needsUpdate = true;
  const layerInfo = Object.fromEntries(LAYERS.map((l) => [l.id, l]));
  const v3 = (a) => new THREE.Vector3(...a);
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
    tLayN: { value: noLayer },
    tLayS: { value: noLayer },
    tLayI: { value: noLayer },
    uLayHas: { value: new THREE.Vector3(0, 0, 0) },
    rLay: { value: new THREE.Vector3(1, 1, 1) },
    psiLay: { value: new THREE.Vector3(0, 0, 0) },
    fadeLay: { value: new THREE.Vector2(0, 0) },
    uLayOn: { value: new THREE.Vector2(0, 0) },
    cPsr: { value: v3(layerInfo.psr.rgb.psr) },
    cLow: { value: v3(layerInfo.sun.rgb.low) },
    cHigh: { value: v3(layerInfo.sun.rgb.high) },
    aLay: { value: v3([layerInfo.psr.alpha.psr, layerInfo.sun.alpha.low, layerInfo.sun.alpha.high]) },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uDayOn: { value: 0 },
    cNight: { value: v3(NIGHT_RGB) },
    uSunKm: { value: new THREE.Vector3(1.5e8, 0, 0) },
    uEarthKm: { value: new THREE.Vector3(-3.8e5, 0, 0) },
    uEclOn: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms });
  scene.add(new THREE.Mesh(geo, mat));

  // Rings around the sunlit spots (sunlight layer), drawn after the sphere, without depth (the vertex shader hides
  // the far side). Filled in when the layer data arrives.
  const spotUniforms = {
    uPxPerRad: { value: 1 },
    uDpr: { value: dpr() },
    uMaxPt: { value: maxPointPx(renderer) },
    uAlpha: { value: 0 },
    cLow: uniforms.cLow,
    cHigh: uniforms.cHigh,
  };
  const spotGeo = new THREE.BufferGeometry();
  const spotPoints = new THREE.Points(
    spotGeo,
    new THREE.ShaderMaterial({
      vertexShader: SPOT_VERT, fragmentShader: SPOT_FRAG, uniforms: spotUniforms, transparent: true, depthTest: false,
      depthWrite: false,
    }),
  );
  spotPoints.renderOrder = 1;
  spotPoints.frustumCulled = false;
  spotPoints.visible = false;
  scene.add(spotPoints);

  // ----- State -----
  let view = { dir: [...PRESETS.near.dir], up: [...PRESETS.near.up], zoom: 1 };
  let W = 1;
  let H = 1;
  let anim = null;
  let frame = 0;
  let sites = [];
  let pins = [];
  const routes = new Map(); // id -> { path: [[x, y, z]], g: SVGGElement, casing, line }
  const markers = new Map(); // id -> { v, ahead, el, dir, shown }: moving dots such as a rover on its route
  let markerScale = 0;
  const labels = buildLabels().map((l) => {
    const e = el("div", `globe-label ${l.kind}`, { text: l.text });
    if (l.align) e.dataset.align = l.align;
    e.style.display = "none";
    gridLayer.append(e);
    return { ...l, v: latLonToVec(l.lat, l.lon), el: e, shown: false };
  });

  // overlay = false: only the sphere's shading changed (the Sun moved), so the next frame redraws the sphere and leaves
  // the HTML overlay (labels, markers, pins, routes, wedges) where it is.
  let overlayDue = true;
  function requestRender(overlay = true) {
    if (overlay) overlayDue = true;
    if (!frame) frame = requestAnimationFrame(render);
  }

  // The map frame: the part of the canvas below the top bar (search box, preset chips) and above the credit line.
  // The view is centred in it and zoom 1 fits the whole disc in it, so the controls never cover the Moon at rest, as a
  // web map pads its view for its own panels. FT, FB: its top and bottom insets in CSS px.
  let FT = 0;
  let FB = 0;
  const FH = () => Math.max(1, H - FT - FB);
  /** Surface point under a canvas position (CSS px), or null off the disc. */
  const pick = (x, y) => pickPx(view, x, y - FT, W, FH());
  /** Canvas position (CSS px) and depth of a point. */
  const proj = (v) => {
    const p = projectPx(view, v, W, FH());
    p.y += FT;
    return p;
  };
  /** Moon radius on screen, CSS px. */
  const rpx = () => radiusPx(view.zoom, W, FH());

  function measureFrame() {
    const sr = stage.getBoundingClientRect();
    if (!sr.height) return false;
    const tb = top.getBoundingClientRect();
    const cr = credit.getBoundingClientRect();
    const ft = tb.height ? Math.max(0, Math.round(tb.bottom - sr.top) + 4) : 0;
    const fb = cr.height ? Math.max(0, Math.round(sr.bottom - cr.top) + 2) : 0;
    // A very short map keeps at least 60 % of its height for the Moon.
    const scale = Math.min(1, (0.4 * sr.height) / Math.max(1, ft + fb));
    const nt = Math.round(ft * scale);
    const nb = Math.round(fb * scale);
    const changed = nt !== FT || nb !== FB;
    FT = nt;
    FB = nb;
    return changed;
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
      spotUniforms.uDpr.value = dpr();
      renderer.setSize(W, H, false);
    }
    measureFrame();
    root.classList.toggle("globe-short", H < 560); // a short map: compact overlays (globe.css)
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
      view = { dir: dir.toArray(), up: up.toArray(), zoom: flightZoom(anim.z0, anim.z1, anim.turn, e) };
      if (t >= 1) anim = null;
      else requestRender();
    }
    if (W < 2 || H < 2) return;
    // The frame's view volume (frustumHalf of the frame), extended to the whole canvas: same scale, centre in the frame.
    const fh = FH();
    const { halfW } = frustumHalf(view.zoom, W / fh);
    const s = W / (2 * halfW); // CSS px per Moon radius
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = (FT + fh / 2) / s;
    camera.bottom = -(H - FT - fh / 2) / s;
    camera.position.set(view.dir[0] * 5, view.dir[1] * 5, view.dir[2] * 5);
    camera.up.set(view.up[0], view.up[1], view.up[2]);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    uniforms.uFine.value = smooth(2.2, 3.2, view.zoom);
    uniforms.uUltra.value = smooth(7, 10, view.zoom);
    uniforms.uBoundary.value = 1 - smooth(4, 8, view.zoom);
    if (spotPoints.visible) {
      spotUniforms.uPxPerRad.value = s * renderer.getPixelRatio();
      spotUniforms.uAlpha.value = smooth(1.4, 2.4, view.zoom);
      if (Math.abs(Math.log(view.zoom / clusterZoom)) > 0.08) clusterSpots(s, view.zoom);
    }
    renderer.render(scene, camera);
    if (!overlayDue) return;
    overlayDue = false;
    placeOverlay();
    syncPresetButtons();
  }

  function place(item, minDepth) {
    const p = proj(item.v);
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
    // Markers grow a little as the view zooms in (CSS: --zs scales their size).
    const zs = Math.round(Math.min(1.45, 1 + 0.13 * Math.log2(Math.max(1, view.zoom))) * 20) / 20;
    if (zs !== markerScale) {
      markerScale = zs;
      overlay.style.setProperty("--zs", String(zs));
    }
    drawRoutes();
    cones.draw();
    for (const s of sites) if (!s.hidden) place(s, 0.03);
    for (const p of pins) if (p !== dragPin) place(p, 0.0);
    for (const m of markers.values()) placeMarker(m);
    if (tipFor && tipFor.shown) positionTip(tipFor);
    else if (tipFor) hideTip();
  }

  /** Route lines: the visible runs of each route's great-circle path, as SVG polylines in CSS px. */
  function drawRoutes() {
    if (!routes.size) return;
    routeLayer.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const r = viewRight(view);
    const s = rpx(); // CSS px per Moon radius
    const cy = FT + FH() / 2;
    for (const rt of routes.values()) {
      let d = "";
      for (const [a, b] of visibleRuns(view, rt.path)) {
        for (let i = a; i <= b; i++) {
          const v = rt.path[i];
          const x = W / 2 + dot(v, r) * s;
          const y = cy - dot(v, view.up) * s;
          d += `${i === a ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
        }
        if (a === b) d += "l0.01 0"; // a single visible vertex still draws a dot
      }
      rt.casing.setAttribute("d", d);
      rt.line.setAttribute("d", d);
    }
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

  /**
   * Animate to a view {dir, up, zoom}. The zoom follows a fly-to path (geo.js flightZoom): a long hop between two
   * close-ups zooms out half-way. dur "auto" scales with the turn and the zoom change (geo.js flightMs).
   */
  function animateTo(target, dur = 700) {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const zoom = clamp(target.zoom, MIN_ZOOM, MAX_ZOOM);
    const turn = angleDeg(view.dir, norm(target.dir)) * DEG;
    if (dur === "auto") dur = flightMs(turn, view.zoom, zoom);
    if (reduce || dur <= 0) {
      anim = null;
      view = { dir: norm(target.dir), up: norm(target.up), zoom };
      requestRender();
      return;
    }
    anim = { q0: quatOf(view), q1: quatOf(target), z0: view.zoom, z1: zoom, turn, t0: performance.now(), dur };
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

  /**
   * Fly to a latitude / east longitude (deg): a smooth turn (north up; top-down near the poles) and zoom, zooming out
   * on the way for a long hop. zoom: 1 = the whole disc (default: keep the zoom, at least 1). avoidControls: land the
   * place in the middle of the area the tools and an open place card leave free, instead of the frame's centre.
   */
  function flyTo(lat, lon, zoom, { duration = "auto", avoidControls = false } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const z = clamp(Number.isFinite(zoom) ? zoom : Math.max(1, view.zoom), MIN_ZOOM, MAX_ZOOM);
    const v = latLonToVec(lat, lon);
    if (avoidControls) {
      const f = fitView([v], { width: W, height: FH(), minZoom: z, maxZoom: z, padding: framePad(controlsPad()) });
      if (f) {
        animateTo(f, duration);
        return;
      }
    }
    animateTo({ dir: v, up: northUp(v), zoom: z }, duration);
  }

  /** Canvas padding (CSS px) as padding of the map frame, at most a quarter of each side. */
  function framePad(padding) {
    const pad = padBox(padding);
    const fh = FH();
    return {
      top: clamp(pad.top - FT, 0, fh / 4), bottom: clamp(pad.bottom - FB, 0, fh / 4),
      left: Math.min(pad.left, W / 4), right: Math.min(pad.right, W / 4),
    };
  }

  /**
   * Turn and zoom smoothly so that every point [{lat_deg, lon_deg}] is in view, inside `padding` (CSS px: a number or
   * {top, right, bottom, left}; default clear of the search box and the tools), like a web map's "fit bounds".
   * One point: fly to it at min(maxZoom, max(current zoom, 4)). maxZoom default FIT_MAX_ZOOM (60: about 60 km across).
   */
  function fitTo(points, { padding = null, maxZoom = FIT_MAX_ZOOM, duration = "auto" } = {}) {
    const ok = (points ?? []).filter((p) => Number.isFinite(p?.lat_deg) && Number.isFinite(p?.lon_deg));
    if (!ok.length) return;
    if (ok.length === 1) {
      flyTo(ok[0].lat_deg, ok[0].lon_deg, Math.min(maxZoom, Math.max(view.zoom, 4)), { duration });
      return;
    }
    // The padding is measured on the canvas; the view is centred in the map frame (below the top bar), so convert.
    // A small map keeps at least half of each side for the points.
    const f = fitView(ok.map((p) => latLonToVec(p.lat_deg, p.lon_deg)), {
      width: W, height: FH(), minZoom: 1, maxZoom: clamp(maxZoom, 1, MAX_ZOOM), padding: framePad(padding ?? controlsPad()),
    });
    if (f) animateTo(f, duration);
  }

  /** Padding (CSS px) that keeps fitted points clear of the controls: the top bar, the tools, the place card. */
  function controlsPad() {
    const rr = root.getBoundingClientRect();
    if (!rr.height) return FIT_PAD;
    const topEdge = top.getBoundingClientRect().bottom - rr.top;
    const card = slotBottom.getBoundingClientRect();
    const bottomEdge = card.height > 4 ? rr.bottom - card.top : 30;
    const t = tools.getBoundingClientRect();
    const right = t.width && t.height > t.width * 1.5 ? rr.right - t.left : 16; // a tool column (not the phone's tool row)
    return { top: Math.max(topEdge + 10, 24), bottom: bottomEdge + 10, right: right + 6, left: 18 };
  }

  /**
   * Draw (or replace) route `id`: a line along the great circles through points [{lat_deg, lon_deg}], just above
   * the surface, hidden where it passes behind the Moon. color: any CSS colour (default the theme accent).
   */
  function showRoute(id, points, { color = null, width = 4 } = {}) {
    const vs = (points ?? []).filter((p) => Number.isFinite(p?.lat_deg) && Number.isFinite(p?.lon_deg)).map((p) => latLonToVec(p.lat_deg, p.lon_deg));
    if (!vs.length) {
      clearRoute(id);
      return;
    }
    let rt = routes.get(String(id));
    if (!rt) {
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("class", "globe-route");
      g.dataset.route = String(id);
      const casing = document.createElementNS(SVG_NS, "path");
      casing.setAttribute("class", "route-casing");
      const line = document.createElementNS(SVG_NS, "path");
      line.setAttribute("class", "route-line");
      g.append(casing, line);
      routeLayer.append(g);
      rt = { g, casing, line, path: [] };
      routes.set(String(id), rt);
    }
    rt.path = greatCirclePath(vs, { maxStepDeg: 0.5, lift: 1.001 });
    rt.g.style.setProperty("--route-c", color || "var(--accent, #8fb4ff)");
    rt.g.style.setProperty("--route-w", `${width}px`);
    requestRender();
  }

  /** Remove route `id` (no-op when there is none). */
  function clearRoute(id) {
    const rt = routes.get(String(id));
    if (!rt) return;
    rt.g.remove();
    routes.delete(String(id));
    requestRender();
  }

  /**
   * Show (or move) dot `id`, e.g. a rover on its route: { lat, lon (deg), color (CSS), label, ahead: {lat, lon} | null,
   * text }. With `ahead` (a point further along), a small arrow on the dot points that way on screen; `text` (one or
   * two characters, e.g. a trip's stop letter) is written in a slightly larger dot. The dot does not take clicks.
   * lat_deg / lon_deg are accepted too.
   */
  function setMarker(id, m = {}) {
    const lat = m.lat ?? m.lat_deg;
    const lon = m.lon ?? m.lon_deg;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      clearMarker(id);
      return;
    }
    let mk = markers.get(String(id));
    if (!mk) {
      const e = el("div", "globe-marker", { "data-marker": String(id) });
      const dir = el("div", "globe-marker-dir");
      e.append(dir);
      markerLayer.append(e);
      mk = { el: e, dir, shown: true };
      markers.set(String(id), mk);
    }
    const a = m.ahead;
    mk.v = latLonToVec(lat, lon);
    mk.ahead = a && Number.isFinite(a.lat ?? a.lat_deg) && Number.isFinite(a.lon ?? a.lon_deg) ? latLonToVec(a.lat ?? a.lat_deg, a.lon ?? a.lon_deg) : null;
    mk.el.style.setProperty("--c", m.color || "var(--accent, #8fb4ff)");
    if (m.label) mk.el.title = m.label;
    // `text`: a short label in the dot (a trip's stop letter).
    const text = m.text ? String(m.text).slice(0, 2) : "";
    mk.el.classList.toggle("has-text", !!text);
    if (text) mk.el.dataset.text = text;
    else delete mk.el.dataset.text;
    requestRender();
  }

  /** Remove dot `id` (no-op when there is none). */
  function clearMarker(id) {
    const mk = markers.get(String(id));
    if (!mk) return;
    mk.el.remove();
    markers.delete(String(id));
    requestRender();
  }

  function placeMarker(mk) {
    const p = place(mk, 0.0);
    if (!mk.shown) return;
    let on = false;
    if (mk.ahead) {
      const q = proj(mk.ahead);
      if (Math.hypot(q.x - p.x, q.y - p.y) > 0.01) {
        on = true;
        mk.dir.style.transform = `rotate(${((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI).toFixed(1)}deg)`;
      }
    }
    mk.el.classList.toggle("has-dir", on);
  }

  /** True when a point is on the visible side and inside the map frame (not under the top bar), with a margin. */
  function isVisible(v, margin = 0.08) {
    const p = proj(v);
    const m = margin * Math.min(W, FH());
    return p.depth > 0.12 && p.x > m && p.x < W - m && p.y > FT + m && p.y < FT + FH() - m;
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
    const before = pick(px, py);
    view = { ...view, zoom: clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM) };
    const after = before && pick(px, py);
    if (before && after) view = dragView(view, before, after);
    requestRender();
  }

  /** Free rotation by a screen-space drag (px) when the grab point is off the disc. */
  function trackball(dxPx, dyPx) {
    const R = rpx();
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
  let gesture = null; // {x0, y0, px, py, grabbed, moved, target, type, multi, pin: {item, dx, dy, v0, lat, lon} | null}
  let dragPin = null; // the pin being dragged (placeOverlay leaves it where the pointer puts it)

  function localXY(e) {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** The draggable pin item under a pointerdown target, with the offset from the pointer to the pin's tip. */
  function pinGrab(target, x, y) {
    if (target?.dataset?.pin === undefined) return null;
    const item = pins[Number(target.dataset.pin)];
    if (!item || !item.draggable) return null;
    const p = proj(item.v);
    return { item, dx: p.x - x, dy: p.y - y, v0: item.v, lat: item.lat, lon: item.lon };
  }

  /** Put a dragged pin back where it was (a second finger turned the drag into a pinch, or the drag was cancelled). */
  function revertPinDrag(g) {
    if (!g?.pin) return;
    g.pin.item.v = g.pin.v0;
    g.pin.item.el.classList.remove("dragging");
    g.pin = null;
    dragPin = null;
    requestRender();
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
      const target = e.target.closest?.("[data-site], [data-pin]") ?? null;
      gesture = {
        x0: x, y0: y, px: x, py: y, grabbed: pick(x, y), moved: false,
        target, type: e.pointerType, multi: false, pin: pinGrab(target, x, y),
      };
      stage.classList.add("dragging");
    } else if (pointers.size === 2 && gesture) {
      revertPinDrag(gesture);
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
      const before = pick(gesture.mid[0], gesture.mid[1]);
      const now = pick(mid[0], mid[1]);
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
    if (gesture.moved && gesture.pin) {
      // Drag a pin: its tip follows the pointer (keeping the grab offset); off the disc it stays where it was.
      const g = gesture.pin;
      if (!dragPin) {
        dragPin = g.item;
        g.item.el.classList.add("dragging");
      }
      // Near a sunlit-spot marker the pin snaps onto the spot.
      const spot = spotAt(x + g.dx, y + g.dy);
      const hit = spot ? spot.v : pick(x + g.dx, y + g.dy);
      if (hit) {
        const ll = spot ? { lat: spot.lat, lon: spot.lon } : vecToLatLon(hit);
        g.item.v = hit;
        g.lat = ll.lat;
        g.lon = ll.lon;
        g.spot = spot ? spotInfo(spot) : null;
        const at = spot ? proj(spot.v) : { x: x + g.dx, y: y + g.dy };
        g.item.el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
        readout.textContent = fmtLatLon(ll.lat, ll.lon, readoutDigits());
        readout.hidden = false;
      }
      gesture.px = x;
      gesture.py = y;
      return;
    }
    if (gesture.moved) {
      const now = pick(x, y);
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
      gesture = { ...gesture, x0: p.x, y0: p.y, px: p.x, py: p.y, grabbed: pick(p.x, p.y), moved: true };
      return;
    }
    if (pointers.size > 0) return;
    const g = gesture;
    gesture = null;
    stage.classList.remove("dragging");
    if (g.pin && g.moved && !g.multi) {
      // A pin drop: the pin stays at its new place until the page redraws the pins (setPins).
      const { item, lat, lon, spot } = g.pin;
      item.el.classList.remove("dragging");
      dragPin = null;
      if (g.type !== "mouse") readout.hidden = true; // the mouse readout follows the pointer; a finger has none
      if (cancelled) revertPinDrag(g);
      else if (opts.onPinDrag) opts.onPinDrag(item.data, lat, lon, spot ?? null);
      requestRender();
      return;
    }
    if (cancelled || g.moved || g.multi) return;
    if (g.target?.dataset.site !== undefined) {
      const s = sites[Number(g.target.dataset.site)];
      if (s && opts.onSite) opts.onSite(s.data);
      return;
    }
    if (g.target?.dataset.pin !== undefined) {
      const p = pins[Number(g.target.dataset.pin)];
      if (p && opts.onPin) opts.onPin(p.data);
      else if (p) showTip(p);
      return;
    }
    // A tap on a sunlit-spot marker picks the spot itself (its own coordinates), not the pixel under the pointer.
    const spot = opts.onSpot ? spotAt(x, y) : null;
    if (spot) {
      opts.onSpot(spotInfo(spot));
      return;
    }
    const hit = pick(x, y);
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
    if (k === "+" || k === "=") zoomAbout(W / 2, FT + FH() / 2, 1.4);
    else if (k === "-" || k === "_") zoomAbout(W / 2, FT + FH() / 2, 1 / 1.4);
    else if (k.startsWith("Arrow")) {
      stopAnim();
      const R = rpx();
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

  /** Decimals of the coordinate readout: about one screen pixel or finer (0.0001 deg is 3 m). */
  const readoutDigits = () => (view.zoom > 300 ? 4 : view.zoom > 8 ? 3 : 2);

  function updateReadout(x, y) {
    const hit = pick(x, y);
    if (!hit) {
      readout.hidden = true;
      return;
    }
    const { lat, lon } = vecToLatLon(hit);
    const spot = spotAt(x, y);
    readout.textContent = fmtLatLon(lat, lon, readoutDigits()) + (spot ? ` · sunlit spot: lit up to ${spot.lit.toFixed(0)} % of the time` : "");
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
    const p = proj(item.v);
    const off = item.kind === "pin" ? item.el.offsetHeight + 4 : 12; // above the pin's head, or the marker
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

  /**
   * Catalog sites: [{lat, lon, name, sub, kind, flag, data, hidden}]. `data` is passed back to onSite. kind ("mission",
   * "candidate", "poi", "home") sets the marker's colour and shape; a hidden site has no marker (a pin stands there).
   * flag (optional, missions): { src, aspect } of an image drawn inside the marker at its own aspect ratio (width /
   * height), framed in the kind colour. The home marker is drawn on top.
   */
  function setSites(list) {
    siteLayer.replaceChildren();
    const nodes = [];
    sites = list.map((s, i) => {
      const e = el("div", `globe-site${s.kind ? ` k-${s.kind}` : ""}${s.flag ? " has-flag" : ""}`, { "data-site": String(i) });
      if (s.kind === "home") e.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${HOUSE_PATH}"/></svg>`;
      else if (s.flag) {
        e.style.setProperty("--fa", String(s.flag.aspect));
        e.append(el("img", "site-flag", { src: s.flag.src, alt: "", draggable: "false", decoding: "async" }));
      }
      // Drawn in reverse list order, so where two markers overlap the one listed first is on top (Apollo 12 over
      // Surveyor 3, 180 m apart); the home marker above all.
      if (s.hidden) e.style.display = "none";
      else nodes.push([s.kind === "home" ? 1e6 : -i, e]);
      const tipHtml = `<strong>${esc(s.name)}</strong>${s.sub ? `<br><small>${esc(s.sub)}</small>` : ""}`;
      return { ...s, siteKind: s.kind, kind: "site", v: latLonToVec(s.lat, s.lon), el: e, shown: !s.hidden, tipHtml };
    });
    siteLayer.append(...nodes.sort((a, b) => a[0] - b[0]).map((n) => n[1]));
    hideTip();
    requestRender();
  }

  /**
   * Scenario pins: [{lat, lon, color, label, sub, active, draggable, glyph, data}]. glyph: the kind of place drawn in
   * the pin's head ("mission", "candidate", "poi", "home"; default a dot). `data` is passed back to onPin / onPinDrag.
   * The active pin is larger and drawn on top.
   */
  function setPins(list) {
    pinLayer.replaceChildren();
    if (dragPin) dragPin = null;
    pins = list.map((p, i) => {
      const cls = `globe-pin${p.active ? " active" : ""}${p.draggable ? " draggable" : ""}`;
      const e = el("div", cls, { "data-pin": String(i), html: pinSvg(p.glyph) });
      e.style.setProperty("--c", p.color);
      pinLayer.append(e);
      const sub = [fmtLatLon(p.lat, p.lon), p.sub].filter(Boolean).join(" · ");
      const tipHtml = `<strong>${esc(p.label)}</strong><br><small>${esc(sub)}</small>`;
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

  const drawnSun = new THREE.Vector3(1, 0, 0);
  /**
   * Day and night (daylight.js): dir = unit vector toward the Sun from the Moon's centre in MOON_ME, or null for the
   * whole Moon lit. shadow (optional): { sunKm, earthKm } (apparent positions from the Moon's centre, km, MOON_ME)
   * while the Earth's shadow can touch the Moon (an eclipse), else null. Cheap to call every frame: it redraws the
   * sphere only (not the HTML overlay), and only once the terminator has moved by a screen pixel (at the whole-disc
   * zoom, about every 35 min of Moon time: twice a second at 1 h/s); the Earth's shadow, which crosses the Moon in
   * about an hour, is redrawn at every call.
   */
  function setSunDir(dir, shadow = null) {
    const on = Array.isArray(dir) && dir.every(Number.isFinite) ? 1 : 0;
    const ecl = on && shadow ? 1 : 0;
    // The uniforms always hold the true moment (any redraw, e.g. a zoom, shows it); drawnSun is the last one asked for.
    if (on) uniforms.uSunDir.value.set(dir[0], dir[1], dir[2]).normalize();
    const moved = on ? Math.acos(Math.min(1, drawnSun.dot(uniforms.uSunDir.value))) : 0;
    const visible = on !== uniforms.uDayOn.value || ecl || uniforms.uEclOn.value || moved * rpx() > 1;
    uniforms.uDayOn.value = on;
    uniforms.uEclOn.value = ecl;
    if (ecl) {
      uniforms.uSunKm.value.set(...shadow.sunKm);
      uniforms.uEarthKm.value.set(...shadow.earthKm);
    }
    root.dataset.daylight = on ? (ecl ? "shadow" : "on") : "off"; // for screenshots and tests ("shadow": the Earth's too)
    if (!visible) return;
    drawnSun.copy(uniforms.uSunDir.value);
    requestRender(false);
  }

  // The top bar grows when the page puts its search box in (and with the font); the frame follows it.
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  ro.observe(top);
  resize();

  // ----- Map layers (permanent shadow, most sunlit ground) -----
  // Loaded on first use: overlays.json, then the three layer images (about 270 kB) and the sunlit spots.
  const overlayUrl = opts.overlayUrl ?? "data/overlays/";
  let layerIds = [];
  let layerLoad = null;
  let spots = []; // [{ v, r (rad), hi (0/1), lit (%) }], brightest first
  let clusters = []; // spots grouped for the current zoom: { v, r, hi, lit }
  let clusterZoom = 0;

  /** A layer image: two channels on the GPU where WebGL2 allows it (red: shadow, green: sunlight class). */
  function loadLayerTex(url) {
    return loadTex(url).then((t) => {
      t.format = oneChannel ? THREE.RGFormat : THREE.RGBAFormat;
      return t;
    });
  }

  function setSpots(table) {
    const f = table?.fields ?? [];
    const [iLat, iLon, iArea, iLit] = ["lat_deg", "lon_deg", "area_km2", "max_lit_pct"].map((k) => f.indexOf(k));
    const hiPct = 100 * LIT_THRESHOLDS[1];
    spots = (table?.rows ?? [])
      .map((r) => ({ v: latLonToVec(r[iLat], r[iLon]), lat: r[iLat], lon: r[iLon], r: Math.sqrt(r[iArea] / Math.PI) / R_MOON_KM, lit: r[iLit], hi: r[iLit] >= hiPct ? 1 : 0 }))
      .sort((a, b) => b.lit - a.lit);
    const n = spots.length;
    spotGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    spotGeo.setAttribute("aSpot", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    clusterZoom = 0;
  }

  /**
   * Group the spots that would sit within 18 CSS px of a brighter one at this scale (px: CSS px per Moon radius) under
   * the brighter one's symbol, as a web map clusters its markers (the group takes the best class of its spots).
   */
  function clusterSpots(px, zoom) {
    clusterZoom = zoom;
    const join = 18 / px;
    clusters = [];
    for (const s of spots) {
      const c = clusters.find((k) => Math.hypot(k.v[0] - s.v[0], k.v[1] - s.v[1], k.v[2] - s.v[2]) < join);
      if (c) c.hi = Math.max(c.hi, s.hi);
      else clusters.push({ ...s });
    }
    const pos = spotGeo.getAttribute("position");
    const att = spotGeo.getAttribute("aSpot");
    clusters.forEach((c, i) => {
      pos.setXYZ(i, c.v[0] * 1.0004, c.v[1] * 1.0004, c.v[2] * 1.0004);
      att.setXY(i, c.r, c.hi);
    });
    pos.needsUpdate = true;
    att.needsUpdate = true;
    spotGeo.setDrawRange(0, clusters.length);
  }

  /**
   * The sunlit-spot marker (a spot or a group, as drawn) that a pointer at a canvas position (CSS px) snaps to, while
   * the sunlight layer shows its markers; else null. Reach: geo.js snapTarget (12 px around a sun symbol).
   */
  function spotAt(x, y) {
    if (!spotPoints.visible || spotUniforms.uAlpha.value < 0.5) return null;
    const s = rpx();
    const items = clusters.map((c) => ({ ...proj(c.v), rPx: c.r * s, c }));
    return snapTarget(items, x, y)?.c ?? null;
  }
  /** What a snap reports: the spot's own coordinates (deg, from the spot table) and its share of time in sunlight (%). */
  const spotInfo = (c) => ({ lat: c.lat, lon: c.lon, lit: c.lit });

  function loadLayers() {
    if (layerLoad) return layerLoad;
    layerLoad = fetch(`${overlayUrl}overlays.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`overlays.json: HTTP ${r.status}`);
        return r.json();
      })
      .then((m) => {
        const tiers = Object.fromEntries((m.tiers ?? []).map((t) => [t.id, t]));
        const slots = { north: ["tLayN", "x"], south: ["tLayS", "y"], south_inner: ["tLayI", "z"] };
        for (const [id, [, k]] of Object.entries(slots)) {
          const t = tiers[id];
          if (!t) continue;
          uniforms.rLay.value[k] = Math.tan((t.psi_max_deg * DEG) / 2);
          uniforms.psiLay.value[k] = t.psi_max_deg * DEG;
        }
        const f = tiers.south_inner?.fade_psi_deg ?? [0, 0];
        uniforms.fadeLay.value.set(Math.min(...f) * DEG, Math.max(...f) * DEG);
        setSpots(m.sun_spots);
        syncLayerUniforms();
        return Promise.all(
          Object.entries(slots)
            .filter(([id]) => tiers[id])
            .map(([id, [u, k]]) =>
              loadLayerTex(`${overlayUrl}${tiers[id].url}`).then((t) => {
                uniforms[u].value = t;
                uniforms.uLayHas.value[k] = 1;
                requestRender();
              }),
            ),
        );
      })
      .then(() => {
        root.dataset.layersLoaded = "true"; // for screenshots and tests
      });
    layerLoad.catch((err) => {
      console.warn("[moonat] map layers failed to load", err);
      layerLoad = null; // the next setLayers tries again
    });
    return layerLoad;
  }

  function syncLayerUniforms() {
    uniforms.uLayOn.value.set(layerIds.includes("psr") ? 1 : 0, layerIds.includes("sun") ? 1 : 0);
    spotPoints.visible = layerIds.includes("sun") && spots.length > 0;
    clusterZoom = 0;
    credit.querySelector(".globe-credit-layers").hidden = !layerIds.length;
    requestRender();
  }

  /**
   * Show exactly the map layers in `list` ("psr": permanently shadowed regions, "sun": the most sunlit ground; others
   * off). The data loads on first use; the promise resolves with the layers shown once it has arrived.
   */
  function setLayers(list) {
    layerIds = normalizeLayers(list);
    root.dataset.layers = layerIds.join(" ");
    syncLayerUniforms();
    return layerIds.length ? loadLayers().then(() => layerIds.slice()) : Promise.resolve([]);
  }

  /**
   * The pole ("south" or "north") whose layer area (poleward of 80°) is in view, facing the camera, or null (e.g. a
   * near-side or far-side view): then the layers have nothing to show.
   */
  function layerPoleInView() {
    for (const pole of ["south", "north"]) {
      for (const p of capSamples(pole)) {
        const q = proj(latLonToVec(p.lat, p.lon));
        if (q.depth > 0.35 && q.x > 0 && q.x < W && q.y > FT && q.y < FT + FH()) return pole;
      }
    }
    return null;
  }

  /**
   * Add a round button to the tool column (above the zoom buttons): { html, label, title, onClick, className }.
   * Returns the button.
   */
  function addTool({ html, label, title, onClick, className = "" }) {
    const b = el("button", `globe-btn ${className}`.trim(), { type: "button", "aria-label": label, title: title ?? label, html });
    b.addEventListener("click", () => onClick?.());
    tools.insertBefore(b, btnIn);
    return b;
  }

  return {
    setSites,
    setPins,
    showPoints,
    goTo,
    flyTo,
    fitTo,
    showRoute,
    clearRoute,
    setMarker,
    clearMarker,
    /** View-direction wedge `id`: { lat, lon, az_deg, hfov_deg, color } or null (view_cone.js; C8b). */
    setViewCone: cones.set,
    addTool,
    setLayers,
    getLayers: () => layerIds.slice(),
    layerPoleInView,
    slots: { top: slotTop, bottom: slotBottom, caption: slotCaption },
    setSunDir,
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
