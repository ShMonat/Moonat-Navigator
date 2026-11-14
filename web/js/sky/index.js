// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// Contract C8 `sky-view`: a first-person view of the lunar sky from an observer standing on the surface.
//
//   const view = await createSkyView(container, { site, terrainPatchUrl, starsUrl, constellationsUrl,
//                                                 earthTextureUrl, fovDeg });
//   view.update(skyState)   // C6 sky state; re-positions everything and renders once
//   view.lookAt(az_deg, el_deg); view.setFov(deg); view.resize(); view.dispose();
//
// Geometry: the eye is the origin of the three.js frame (x = east, y = up, z = -north), observer_height_m above
// the ground point. The view never computes physics; every direction and size comes from the sky state.
// Rendering is on demand (no animation loop), in three passes: sky -> far-field skirt -> near terrain.
// All views on a page share one WebGL context (see getShared), so any number of views can coexist.

import * as THREE from 'three';
import {
  DEG, enuToThree, azElToEnu, verticalFovDeg, flatHorizon, horizonFromPatch, horizonElAt, horizonDistKmAt, fitBodyView, fitPhotoView, signed1,
} from './math.js';
import { buildTerrain } from './terrain.js';
import { buildSky } from './sky.js';
import { createHud } from './hud.js';

const FOV_MIN = 15, FOV_MAX = 100, EL_MIN = -60, EL_MAX = 90;
// Photo framing: the widest "comfortable" horizontal FOV (deg), and the narrowest tall frame (width / height).
const COMFORT_HFOV = 80, TALL_MIN_ASPECT = 0.75;
// Two shadow cascades (near 16 m, far 130 m half-extent) in two resolution tiers: "hi" for large views, "lo" for small
// ones (grid views of several sites), where the 4096² far map would cost much fill time for no visible gain.
const SHADOW_TIERS = {
  hi: [{ ext: 16, size: 2048, normalBias: 0.02 }, { ext: 130, size: 4096, normalBias: 0.12 }],
  lo: [{ ext: 16, size: 1024, normalBias: 0.035 }, { ext: 130, size: 2048, normalBias: 0.2 }],
};
/** Views narrower than this (drawing-buffer pixels) use the "lo" shadow tier and fewer small rocks. */
const SMALL_VIEW_PX = 900;

async function fetchJson(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function fetchPatch(baseUrl) {
  if (!baseUrl) return null;
  try {
    const [m, b] = await Promise.all([fetch(`${baseUrl}.json`), fetch(`${baseUrl}.bin`)]);
    if (!m.ok || !b.ok) return null;
    const meta = await m.json(), data = new Float32Array(await b.arrayBuffer());
    return data.length === meta.grid_n * meta.grid_n ? { meta, data } : null;
  } catch { return null; }
}

// Textures are cached per URL and shared by all views (they live in the one shared WebGL context).
const textureCache = new Map();
function fetchTexture(url) {
  if (!url) return Promise.resolve(null);
  if (!textureCache.has(url)) {
    textureCache.set(url, new THREE.TextureLoader().loadAsync(url).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    }).catch(() => { textureCache.delete(url); return null; }));
  }
  return textureCache.get(url);
}

// One WebGL context for every sky view on the page. Browsers allow only about 8-16 live contexts, and a comparison
// page can show many views. Each view owns a 2-D canvas; a render draws into the shared off-screen WebGL canvas and
// copies the result. The Sun's shadow lights (and their shadow maps) are shared too and move to the view being drawn.
let shared = null;
function getShared() {
  if (shared) return shared;
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const makeLights = (cascades) => cascades.map((c) => {
    const l = new THREE.DirectionalLight(0xffffff, 1);
    l.castShadow = true;
    l.shadow.mapSize.set(c.size, c.size);
    Object.assign(l.shadow.camera, { left: -c.ext, right: c.ext, top: c.ext, bottom: -c.ext, near: 1, far: 1600 });
    l.shadow.bias = -0.0004; l.shadow.normalBias = c.normalBias; l.shadow.radius = 1.5;
    return l;
  });
  // Each tier's lights live in the scene of the view that drew with them last (lastView).
  shared = {
    renderer, views: 0,
    lights: { hi: makeLights(SHADOW_TIERS.hi), lo: makeLights(SHADOW_TIERS.lo) },
    lastView: { hi: null, lo: null },
  };
  return shared;
}

export async function createSkyView(container, {
  site = null,
  terrainPatchUrl = null,
  starsUrl = 'data/stars/stars.json',
  constellationsUrl = 'data/stars/constellations.json',
  earthTextureUrl = 'assets/earth_daymap.jpg',
  fovDeg = 70,
  // Optional extras (not required by C8):
  earthNightTextureUrl = null,   // equirectangular night-lights map, same layout as the day map
  showConstellations = true,
  closeUp: initialCloseUp = true,   // magnified inset of the Earth (and of the Sun while terrain partly hides it)
  terrainPatch = null,           // an in-memory C4 patch { meta, data: Float32Array } instead of terrainPatchUrl
  stars = null,                  // in-memory star JSON instead of starsUrl
  exposure: initialExposure = 'eye',   // "eye": stars stay visible in daylight; "camera": exposed for the sunlit ground
} = {}) {
  const eyeH = site?.observer_height_m ?? 2;
  const [starsJson, constellationsJson, earthTexture, nightTexture, patch] = await Promise.all([
    stars ?? fetchJson(starsUrl), fetchJson(constellationsUrl), fetchTexture(earthTextureUrl),
    fetchTexture(earthNightTextureUrl), terrainPatch ?? fetchPatch(terrainPatchUrl),
  ]);
  // Skyline: the site's C3 profile; without one, the patch's own skyline; without both, a smooth horizon.
  const horizon = site?.horizon ?? (patch ? horizonFromPatch(patch, eyeH) : flatHorizon(eyeH));

  container.classList.add('moonat-sky');
  if (!container.clientHeight) container.style.aspectRatio = '16 / 9';
  const gl = getShared(), renderer = gl.renderer, self = {};
  let tier = 'hi';   // shadow tier this view drew with last
  gl.views++;
  // The frame holds the canvas and the HUD. It fills the container, except for a "tall frame" (see setTallFrames):
  // then it is a centred, narrower box, like a square Apollo Hasselblad photo, with black bars at the sides.
  const frameEl = document.createElement('div');
  frameEl.className = 'moonat-sky-frame';
  container.appendChild(frameEl);
  const canvas = document.createElement('canvas'), ctx2d = canvas.getContext('2d');
  frameEl.appendChild(canvas);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 80000);
  camera.rotation.order = 'YXZ';
  const insetCamera = new THREE.PerspectiveCamera(8, 1, 0.05, 80000);   // close-up inset: same eye, narrow field
  let closeUpOn = !!initialCloseUp;

  const sky = buildSky({ starsJson, constellationsJson, earthTexture, nightTexture });
  sky.setConstellations(showConstellations);
  const terrain = buildTerrain({
    patch, horizon, eyeH, floatLinear: renderer.capabilities.isWebGL2 && renderer.extensions.has('OES_texture_float_linear'),
  });
  const skyScene = new THREE.Scene(), farScene = new THREE.Scene(), nearScene = new THREE.Scene();
  skyScene.add(sky.group, sky.fixed);
  farScene.add(terrain.skirt);
  nearScene.add(terrain.near);
  const sunDir = new THREE.Vector3(0, 1, 0), horizonMaxEl = Math.max(...horizon.el_deg);
  let sunFrac = 1;
  let shadowDirty = true, exposureMode = initialExposure === 'camera' ? 'camera' : 'eye';
  sky.setExposureMode(exposureMode);

  const defaultHfov = Math.min(FOV_MAX, Math.max(FOV_MIN, fovDeg));
  const view = { az: 0, el: 10, hfov: defaultHfov };
  let state = null, firstUpdate = true, disposed = false, frame = 0, width = 1, height = 1, pendingFit = null;
  // The body framed by the last lookAtBody ({ name, mode }), while the user has not turned or zoomed since: a resize
  // (focus mode, a new grid layout) frames it again for the new aspect ratio.
  let autoFit = null;
  const DEFAULT_PIXELS = 2.2e6;
  let pixelBudget = DEFAULT_PIXELS;
  let tallFrames = false, frameAspect = null;

  function project(enu) {
    const v = new THREE.Vector3(...enuToThree(enu)).multiplyScalar(1000).project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height, visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
      above: v.z < 1 && v.y > 1 && Math.abs(v.x) <= 1,   // in front of the camera, above the top edge
    };
  }
  const belowHorizon = (b) => b.el_deg < horizonElAt(horizon, b.az_deg);

  const hud = createHud(frameEl, {
    onLookAt: (name) => lookAtBody(name),
    hasConstellations: sky.hasConstellations, constellationsOn: showConstellations,
    onToggleConstellations: (on) => { sky.setConstellations(on); requestRender(); },
    closeUpOn, onToggleCloseUp: (on) => { closeUpOn = on; requestRender(); },
    exposureMode, onExposureMode: (mode) => { exposureMode = mode; sky.setExposureMode(mode); requestRender(); },
  });

  function renderNow() {
    frame = 0;
    if (disposed) return;
    camera.aspect = width / height;
    camera.fov = verticalFovDeg(view.hfov, camera.aspect);
    camera.rotation.set(view.el * DEG, -view.az * DEG, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // Cap the drawing buffer (about 2.2 megapixels by default, more for a focused full-window view) so integrated
    // GPUs keep a low frame time on high-DPI screens; never above a device pixel ratio of 2.
    const pr = Math.min(window.devicePixelRatio || 1, 2, Math.max(1, Math.sqrt(pixelBudget / (width * height))));
    const size = renderer.getSize(new THREE.Vector2());
    if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
    if (size.x !== width || size.y !== height) renderer.setSize(width, height, false);
    sky.setPixelScale(pr * Math.max(0.75, Math.min(1.6, height / 620)), (view.hfov * DEG) / (width * pr));
    // Small views: the low-resolution shadow tier and about a third of the smallest rocks (sub-pixel there anyway).
    const small = width * pr < SMALL_VIEW_PX;
    const t = small ? 'lo' : 'hi';
    terrain.setRockDetail(small ? Math.max(0.3, (width * pr) / SMALL_VIEW_PX) : 1);
    if (t !== tier) {   // changing tier: hand back the other tier's lights, so the scene always holds exactly two
      if (gl.lastView[tier] === self) { for (const l of gl.lights[tier]) nearScene.remove(l, l.target); gl.lastView[tier] = null; }
      tier = t;
    }
    // Bring the shared shadow lights to this view; their maps are redrawn when the Sun moved or another view drew last.
    const lights = gl.lights[tier];
    if (gl.lastView[tier] !== self) {
      for (const l of lights) { l.target.position.set(0, -eyeH, 0); nearScene.add(l, l.target); }
      gl.lastView[tier] = self;
      shadowDirty = true;
    }
    if (shadowDirty) {
      for (const l of lights) { l.position.copy(sunDir).multiplyScalar(700).add(l.target.position); l.target.updateMatrixWorld(); }
      renderer.shadowMap.needsUpdate = true;
      shadowDirty = false;
    }
    renderer.clear();
    renderer.render(skyScene, camera);
    renderer.render(farScene, camera);
    renderer.clearDepth();
    renderer.render(nearScene, camera);
    const src = renderer.domElement;
    if (canvas.width !== src.width || canvas.height !== src.height) { canvas.width = src.width; canvas.height = src.height; }
    ctx2d.drawImage(src, 0, 0);
    const insetRects = drawInsets(pr);
    // A planet within 3.5 deg of a visible Sun sits in its glare: its label is left out.
    const inGlare = (p) => state.sun.vis_frac > 0 && angleDeg(p.enu, state.sun.enu) < 3.5;
    const marks = state ? [
      { name: 'Earth', enu: state.earth.enu, hidden: belowHorizon(state.earth) || view.hfov < 25, dx: (state.earth.ang_radius_deg / view.hfov) * width + 6,
        body: 'earth', edgeText: `▲ Earth ${signed1(state.earth.el_deg)}°` },
      ...(state.planets || []).map((p) => ({ name: p.name[0].toUpperCase() + p.name.slice(1), enu: p.enu, hidden: belowHorizon(p) || inGlare(p) })),
    ] : [];
    // Notes explain a frame that could look empty: no terrain data, night, or a camera pointed above the ground.
    const notes = [];
    if (horizon.smooth) notes.push('Terrain not included: smooth horizon');
    if (state && sunFrac <= 0) notes.push('Night: the Sun is below the horizon, so the ground is dark');
    if (view.el - camera.fov / 2 > horizonMaxEl) notes.push('Looking up: drag down to see the ground');
    if (state && state.earth.el_deg + state.earth.ang_radius_deg < horizonElAt(horizon, state.earth.az_deg)) notes.push('Earth is below the horizon');
    hud.update(state, view, project, marks, notes, insetRects);
  }
  /**
   * Close-up insets (circular loupes, top right). Each one is the same scene seen from the same eye through a
   * narrow second camera aimed at the body, so phase, orientation, night lights and any terrain in front are real.
   * The inset is drawn into a corner of the shared WebGL canvas (scissored) and copied into this view's canvas.
   * An Earth hidden by the terrain: the loupe shows the skyline above it, the ground faintly lit from the eye's side
   * so the silhouette reads, and a dashed outline where the Earth is (or an arrow when it is further down).
   * Returns the loupes' bounding boxes (CSS px) so the HUD can keep labels off them.
   */
  function drawInsets(pr) {
    const caps = [], rects = [];
    if (closeUpOn && state && width >= 200) {
      const sizeCss = Math.round(Math.min(0.22 * width, 0.5 * height, 320)), r = sizeCss / 2, top = 40, gap = 10;
      const list = [];
      const e = state.earth, s = state.sun;
      const eHidden = e.vis_frac != null ? e.vis_frac <= 0.001 : belowHorizon(e);
      const ePart = e.vis_frac != null && e.vis_frac < 0.999 && !eHidden;
      const eItem = {
        body: e, fov: 5 * e.ang_radius_deg, hidden: eHidden,
        // Below the flat horizon the Moon itself hides the Earth; above it, a ridge or crater rim does.
        text: (mag) => (eHidden ? `${e.el_deg + e.ang_radius_deg < 0 ? 'Earth below the horizon' : 'Earth hidden behind terrain'} (${signed1(e.el_deg)}°)`
          : `Earth ×${mag} · ${ePart ? Math.round(e.vis_frac * 100) + '% visible' : Math.round((e.phase_frac ?? 0) * 100) + '% lit'}`),
      };
      if (eHidden) {
        // Wide enough to hold the skyline and the hidden Earth (up to 30 deg); the skyline sits in the upper part.
        const sky0 = horizonElAt(horizon, e.az_deg), depth = Math.max(0, sky0 - e.el_deg);
        eItem.fov = Math.min(30, Math.max(5 * e.ang_radius_deg, 2.6 * depth + 4 * e.ang_radius_deg));
        eItem.aim = azElToEnu(e.az_deg, Math.max(sky0 - 0.3 * eItem.fov, (sky0 + e.el_deg) / 2));
      }
      list.push(eItem);
      if (s.vis_frac != null && s.vis_frac > 0.001 && s.vis_frac < 0.999) {
        list.push({ body: s, fov: 8 * s.ang_radius_deg, text: (mag) => `Sun ×${mag} · ${Math.round(s.vis_frac * 100)}% visible` });
      }
      const fMain = width / 2 / Math.tan((view.hfov * DEG) / 2);
      const u = terrain.uniforms;
      list.forEach((it, i) => {
        const cx = width - 12 - r - i * (sizeCss + gap), cy = top + r;
        const d = enuToThree(it.aim ?? it.body.enu);
        insetCamera.fov = it.fov;
        insetCamera.position.set(0, 0, 0);
        insetCamera.up.set(0, 1, 0);
        insetCamera.lookAt(d[0] * 1000, d[1] * 1000, d[2] * 1000);
        insetCamera.updateProjectionMatrix();
        insetCamera.updateMatrixWorld();
        sky.setPixelScale(pr, (it.fov * DEG) / (sizeCss * pr));
        // A hidden Earth: light the terrain faintly from the eye's side (the earthshine term, pointed back at the eye).
        let saved = null;
        if (it.hidden) {
          saved = [u.uEarthDir.value.clone(), u.uEarthShine.value.clone()];
          u.uEarthDir.value.set(-d[0], -d[1], -d[2]).normalize();
          u.uEarthShine.value.set(0.09, 0.1, 0.12);
        }
        renderer.setViewport(0, 0, sizeCss, sizeCss);
        renderer.setScissor(0, 0, sizeCss, sizeCss);
        renderer.setScissorTest(true);
        renderer.clear();
        renderer.render(skyScene, insetCamera);
        renderer.render(farScene, insetCamera);
        renderer.clearDepth();
        renderer.render(nearScene, insetCamera);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, width, height);
        if (saved) { u.uEarthDir.value.copy(saved[0]); u.uEarthShine.value.copy(saved[1]); }
        const src = renderer.domElement, S = Math.round(sizeCss * pr);
        ctx2d.save();
        ctx2d.beginPath();
        ctx2d.arc(cx * pr, cy * pr, r * pr, 0, 2 * Math.PI);
        ctx2d.clip();
        ctx2d.drawImage(src, 0, src.height - S, S, S, (cx - r) * pr, (cy - r) * pr, S, S);
        if (it.hidden) drawHiddenBody(it.body, cx, cy, r, it.fov, pr);
        ctx2d.restore();
        ctx2d.beginPath();
        ctx2d.arc(cx * pr, cy * pr, r * pr, 0, 2 * Math.PI);
        ctx2d.lineWidth = Math.max(1, 1.5 * pr);
        ctx2d.strokeStyle = 'rgba(200, 215, 240, 0.75)';
        ctx2d.stroke();
        const mag = Math.round((sizeCss / 2 / Math.tan((it.fov * DEG) / 2)) / fMain);
        caps.push({ x: cx, y: cy + r + 4, text: it.text(mag) });
        rects.push({ x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r + 32 });
      });
    }
    hud.setCaptions(caps);
    return rects;
  }

  /** Inside a loupe (clipped): a dashed outline where a hidden body is, or an arrow at the rim pointing to it. */
  function drawHiddenBody(body, cx, cy, r, fovDeg, pr) {
    const v = new THREE.Vector3(...enuToThree(body.enu)).multiplyScalar(1000).project(insetCamera);
    const px = cx + v.x * r, py = cy - v.y * r;
    const rad = (Math.tan(body.ang_radius_deg * DEG) / Math.tan((fovDeg * DEG) / 2)) * r;
    ctx2d.save();
    ctx2d.strokeStyle = 'rgba(140, 190, 255, 0.85)';
    ctx2d.fillStyle = 'rgba(140, 190, 255, 0.85)';
    ctx2d.lineWidth = Math.max(1, 1.4 * pr);
    if (v.z < 1 && Math.hypot(px - cx, py - cy) < r - rad) {
      ctx2d.setLineDash([4 * pr, 3 * pr]);
      ctx2d.beginPath();
      ctx2d.arc(px * pr, py * pr, Math.max(3, rad) * pr, 0, 2 * Math.PI);
      ctx2d.stroke();
    } else {
      // Arrow at the loupe's rim, pointing toward the body (usually straight down: far below the skyline).
      const a = Math.atan2(py - cy, px - cx), ax = cx + Math.cos(a) * (r - 12), ay = cy + Math.sin(a) * (r - 12), k = 7;
      ctx2d.beginPath();
      ctx2d.moveTo((ax + Math.cos(a) * k) * pr, (ay + Math.sin(a) * k) * pr);
      ctx2d.lineTo((ax + Math.cos(a + 2.5) * k) * pr, (ay + Math.sin(a + 2.5) * k) * pr);
      ctx2d.lineTo((ax + Math.cos(a - 2.5) * k) * pr, (ay + Math.sin(a - 2.5) * k) * pr);
      ctx2d.closePath();
      ctx2d.fill();
    }
    ctx2d.restore();
  }

  /** Angle (deg) between two direction vectors. */
  function angleDeg(a, b) {
    const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(a[0], a[1], a[2]) * Math.hypot(b[0], b[1], b[2]) || 1);
    return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
  }

  function requestRender() {
    if (!frame && !disposed) frame = requestAnimationFrame(renderNow);
  }

  /** Size the frame inside the container: the full container, or a centred box of aspect `frameAspect`. */
  function layout() {
    const cw = Math.max(1, container.clientWidth), ch = Math.max(1, container.clientHeight);
    const fw = frameAspect ? Math.min(cw, Math.max(1, Math.floor(ch * frameAspect))) : cw;
    const tall = fw < cw;
    frameEl.style.left = tall ? `${Math.floor((cw - fw) / 2)}px` : '0px';
    frameEl.style.width = tall ? `${fw}px` : '100%';
    frameEl.classList.toggle('tall', tall);
    width = fw;
    height = ch;
  }

  function setFrameAspect(a) {
    if (a === frameAspect) return;
    frameAspect = a;
    layout();
  }

  function resize() {
    layout();
    const fit = pendingFit || autoFit;
    if (fit && width >= 50 && height >= 50) lookAtBody(fit.name, fit.mode);
    if (state) renderNow(); else requestRender();
  }

  /**
   * Frame a body ("earth" or "sun") together with the horizon: yaw to its azimuth, then pitch and FOV.
   * Both modes first try the "photo" framing (fitPhotoView: horizon 20% above the bottom edge, a comfortable FOV).
   *   mode "photo": if the body is too high for that, it stays above the frame (an edge marker points to it, and the
   *     close-up inset shows it);
   *   mode "body" (the opening view, "Look at Earth / Sun"): the body must be in frame, so the wider fitBodyView rule
   *     takes over.
   * With tall frames on (focus mode), a body too high for the window's aspect gets a narrower, taller frame instead.
   */
  function lookAtBody(name, mode = 'body') {
    const b = state?.[name];
    if (!b) return;
    if (width < 50 || height < 50) {   // no real size yet (hidden container): fit when it gets one
      pendingFit = { name, mode };
      return;
    }
    pendingFit = null;
    const args = { bodyElDeg: b.el_deg, bodyRadiusDeg: b.ang_radius_deg, horizonElDeg: horizonElAt(horizon, b.az_deg) };
    const photo = (aspect) => fitPhotoView({ ...args, aspect, hfovDeg: defaultHfov, maxHfovDeg: COMFORT_HFOV });
    const full = Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight);
    let fit = photo(full);
    const tooHigh = !fit.body_in_frame && args.bodyElDeg + args.bodyRadiusDeg > args.horizonElDeg;
    setFrameAspect(tallFrames && tooHigh && fit.aspect_max < full ? Math.max(TALL_MIN_ASPECT, fit.aspect_max) : null);
    if (frameAspect) fit = photo(width / height);
    if (!fit.body_in_frame && mode === 'body') {
      fit = fitBodyView({ ...args, aspect: width / height, defaultHfovDeg: defaultHfov, maxHfovDeg: FOV_MAX });
    }
    view.az = ((b.az_deg % 360) + 360) % 360;
    view.el = Math.min(EL_MAX, Math.max(EL_MIN, fit.el_deg));
    view.hfov = Math.min(FOV_MAX, Math.max(FOV_MIN, fit.hfov_deg));
    autoFit = { name, mode };
    requestRender();
  }

  function lookAt(azDeg, elDeg) {
    // A request that aims at the Earth or the Sun (as the app's "Look at ..." buttons do) gets the framing rule.
    for (const name of ['earth', 'sun']) {
      const b = state?.[name];
      if (!b) continue;
      const dAz = Math.abs(((azDeg - b.az_deg + 540) % 360) - 180) * Math.cos(b.el_deg * DEG);
      if (dAz < 0.5 && (Math.abs(elDeg - b.el_deg) < 0.5 || (b.el_deg < 5 && Math.abs(elDeg - 5) < 0.5))) return lookAtBody(name);
    }
    turnTo(azDeg, elDeg);
  }
  /** Turn the camera without any framing rule (dragging, or a lookAt away from the Sun and the Earth). */
  function turnTo(azDeg, elDeg) {
    view.az = ((azDeg % 360) + 360) % 360;
    view.el = Math.min(EL_MAX, Math.max(EL_MIN, elDeg));
    autoFit = null;
    requestRender();
  }
  function setFov(deg) {
    view.hfov = Math.min(FOV_MAX, Math.max(FOV_MIN, deg));
    autoFit = null;
    requestRender();
  }

  function update(s) {
    state = s;
    sky.update(s);
    const u = terrain.uniforms;
    sunDir.set(...enuToThree(s.sun.enu)).normalize();
    u.uSunDir.value.copy(sunDir);
    u.uSunRad.value = s.sun.ang_radius_deg * DEG;
    // Terrain inside the patch shadows the ground through the heightfield ray-march. Terrain beyond it can only
    // act through the C3 profile, so apply the disk fraction above the profile when its setter is outside the patch.
    const horEl = horizonElAt(horizon, s.sun.az_deg), setterKm = horizon.dist_km ? horizonDistKmAt(horizon, s.sun.az_deg) : Infinity;
    const frac = Math.min(1, Math.max(0, (s.sun.el_deg - horEl) / (2 * s.sun.ang_radius_deg) + 0.5));
    const beyondPatch = !patch || setterKm * 1000 > 0.9 * patch.meta.half_extent_m;
    u.uSunVis.value = beyondPatch ? frac : 1;
    sunFrac = frac;
    u.uSunUp.value = Math.min(1, Math.max(0, (s.sun.el_deg + 0.6) / 0.9));
    // Earthshine: faint, bluish, scaled by the Earth's phase and visibility.
    const ev = (s.earth.vis_frac ?? 1) * (s.earth.phase_frac ?? 0.5) * 0.02;
    u.uEarthDir.value.set(...enuToThree(s.earth.enu)).normalize();
    u.uEarthShine.value.set(0.62 * ev, 0.8 * ev, 1.0 * ev);
    shadowDirty = true;
    if (firstUpdate) {
      firstUpdate = false;
      lookAtBody('earth', 'body');   // the opening view always shows the Earth and the horizon (C8)
    }
    renderNow();
  }

  // --- Interaction: drag to look around (the sky follows the pointer), wheel to zoom ----------------------------
  const el = canvas;
  let drag = null;
  const onDown = (e) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); container.classList.add('dragging'); };
  const onMove = (e) => {
    if (!drag) return;
    const k = view.hfov / width;
    if (e.clientX === drag.x && e.clientY === drag.y) return;
    turnTo(view.az - (e.clientX - drag.x) * k / Math.max(0.3, Math.cos(view.el * DEG)), view.el + (e.clientY - drag.y) * k);
    drag = { x: e.clientX, y: e.clientY };
  };
  const onUp = () => { drag = null; container.classList.remove('dragging'); };
  const onWheel = (e) => { e.preventDefault(); setFov(view.hfov * Math.exp(e.deltaY * 0.0012)); };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(container);
  resize();

  function dispose() {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    ro?.disconnect();
    hud.dispose();
    sky.dispose();
    terrain.dispose();
    for (const k of ['hi', 'lo']) {
      if (gl.lastView[k] === self) { for (const l of gl.lights[k]) nearScene.remove(l, l.target); gl.lastView[k] = null; }
    }
    gl.views--;
    frameEl.remove();
    container.classList.remove('moonat-sky', 'dragging');
  }

  return {
    update, lookAt, lookAtBody, setFov, resize, dispose,
    // Extras beyond C8, for the app and for debugging:
    setConstellations: (on) => { sky.setConstellations(on); requestRender(); },
    setCloseUp: (on) => { closeUpOn = !!on; hud.setCloseUp(closeUpOn); requestRender(); },
    setExposure: (mode) => {
      exposureMode = mode === 'camera' ? 'camera' : 'eye';
      sky.setExposureMode(exposureMode);
      hud.setExposureMode(exposureMode);
      requestRender();
    },
    getView: () => ({ az_deg: view.az, el_deg: view.el, fov_deg: view.hfov }),
    /** Drawing-buffer budget in device pixels (null = default); the pixel ratio never exceeds 2. */
    setPixelBudget: (px) => { pixelBudget = px > 0 ? px : DEFAULT_PIXELS; requestRender(); },
    /**
     * Allow a taller frame than the container (focus mode): when the framed body is too high to fit with the horizon
     * at a comfortable FOV, the view becomes a centred box narrow enough for both. Off: the frame fills the container.
     */
    setTallFrames: (on) => {
      tallFrames = !!on;
      if (!tallFrames) setFrameAspect(null);
      if (autoFit) lookAtBody(autoFit.name, autoFit.mode);
      requestRender();
    },
    info: { stars: sky.starCount, hasPatch: !!patch, hasEarthTexture: !!earthTexture, horizonSource: site?.horizon ? 'site' : patch ? 'patch' : 'smooth' },
  };
}
