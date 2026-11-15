// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// Contract C8 `sky-view`: a first-person view of the lunar sky from an observer standing on the surface.
//
//   const view = await createSkyView(container, { site, terrainPatchUrl, starsUrl, constellationsUrl,
//                                                 earthTextureUrl, fovDeg });
//   view.update(skyState)   // C6 sky state; re-positions everything and renders once
//   view.lookAt(az_deg, el_deg); view.setFov(deg); view.resize(); view.dispose();
//   view.setTerrain({ horizon, patch })   // extra: swap in new terrain (e.g. live terrain of a custom point)
//   view.setHudLevel('minimal' | 'full'); view.setOption(name, value); view.getOptions()   // extras for a page menu
//   view.setTrack('sun' | 'earth' | { az_deg, el_deg } | null)   // extra: follow a body or a direction as time runs
//   view.onViewChange(({ az_deg, el_deg, hfov_deg }) => ...)     // extra: the camera moved (e.g. the globe's wedge)
// The C4 patch can also be passed in memory: createSkyView(container, { site, terrainPatch: { meta, data } }).
// Body markers (math.js bodyMarker): a hidden Sun or Earth in the frame gets a dashed outline, one out of the frame an edge arrow.
//
// Geometry: the eye is the origin of the three.js frame (x = east, y = up, z = -north), observer_height_m above
// the ground point. The view never computes physics; every direction and size comes from the sky state.
// Rendering is on demand (no animation loop), in three passes: sky -> far-field skirt -> near terrain.
// All views on a page share one WebGL context (see getShared), so any number of views can coexist.

import * as THREE from 'three';
import {
  DEG, enuToThree, azElToEnu, verticalFovDeg, flatHorizon, horizonFromPatch, horizonElAt, horizonDistKmAt, fitBodyView, fitPhotoView, bodyFitAspect, signed1, bodyMarker,
} from './math.js';
import { buildTerrain } from './terrain.js';
import { buildSky, eclipseLook } from './sky.js';
import { createHud } from './hud.js';
import { hiddenReason, hiddenPhrase, degText, earthNeverRises, eclipsePctText, EARTH_DEEP_BELOW_DEG, RING_NOTE } from './words.js';
import { azDelta, wrapAz, feedForward, easeToward, aimAtFov, parseTrackTarget } from './track.js';

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
  terrainDetail = null,          // a moving view (drive): world-anchored detail (detail.js driveDetail + anchor); see setEye
  stars = null,                  // in-memory star JSON instead of starsUrl
  exposure: initialExposure = 'eye',   // "eye": stars stay visible in daylight; "camera": exposed for the sunlit ground
  onNotes = null,                // (notes: [{ id, text }]) => void, called when the HUD notes change (e.g. to show them elsewhere)
  hudLevel: initialHudLevel = 'full',   // "full" readout, or "minimal": the time and at most one status line
  buttons: initialButtons = true,       // the HUD's own option buttons (exposure, close-up, constellations)
  onOptions = null,              // (options) => void, called when a view option changes (HUD button or setOption)
  onTrack = null,                // ({ mode, body, paused }) => void, called when tracking starts, stops or is paused by a drag
} = {}) {
  const eyeH = site?.observer_height_m ?? 2;
  const [starsJson, constellationsJson, earthTexture, nightTexture, patch0] = await Promise.all([
    stars ?? fetchJson(starsUrl), fetchJson(constellationsUrl), fetchTexture(earthTextureUrl),
    fetchTexture(earthNightTextureUrl), terrainPatch ?? fetchPatch(terrainPatchUrl),
  ]);
  let patch = patch0;   // replaced by setTerrain()
  let detail = terrainDetail;   // replaced by setTerrain()
  // Skyline: the site's C3 profile; without one, the patch's own skyline; without both, a smooth horizon.
  let horizon = site?.horizon ?? (patch ? horizonFromPatch(patch, eyeH) : flatHorizon(eyeH));

  container.classList.add('moonat-sky');
  if (!container.clientHeight) container.style.aspectRatio = '16 / 9';
  const gl = getShared(), renderer = gl.renderer, self = {};
  let tier = 'hi';   // shadow tier this view drew with last
  gl.views++;
  // The frame holds the canvas and the HUD. It fills the container, except for a "tall frame" (see setTallFrames):
  // then it is a centred, narrower box, like a square Apollo Hasselblad photo, with black bars at the sides.
  const frameEl = document.createElement('div');
  frameEl.className = 'moonat-sky-frame';
  // Behind a tall frame: the same view, stretched to the full width, small, blurred and dimmed (CSS), so the side bands
  // continue the sky and the ground instead of being black bars.
  const bandsEl = document.createElement('canvas'), bandsCtx = bandsEl.getContext('2d');
  bandsEl.className = 'moonat-sky-bands';
  bandsEl.setAttribute('aria-hidden', 'true');
  container.appendChild(bandsEl);
  container.appendChild(frameEl);
  const canvas = document.createElement('canvas'), ctx2d = canvas.getContext('2d');
  frameEl.appendChild(canvas);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 80000);
  camera.rotation.order = 'YXZ';
  const insetCamera = new THREE.PerspectiveCamera(8, 1, 0.05, 80000);   // close-up inset: same eye, narrow field
  let closeUpOn = !!initialCloseUp;

  const sky = buildSky({ starsJson, constellationsJson, earthTexture, nightTexture });
  sky.setConstellations(showConstellations);
  let constellationsOn = !!showConstellations && sky.hasConstellations, lastNotesKey = null;
  const floatLinear = renderer.capabilities.isWebGL2 && renderer.extensions.has('OES_texture_float_linear');
  let terrain = buildTerrain({ patch, horizon, eyeH, floatLinear, detail });
  const skyScene = new THREE.Scene(), farScene = new THREE.Scene(), nearScene = new THREE.Scene();
  skyScene.add(sky.group, sky.fixed);
  farScene.add(terrain.skirt);
  nearScene.add(terrain.near);
  const sunDir = new THREE.Vector3(0, 1, 0);
  let horizonMaxEl = Math.max(...horizon.el_deg);
  let sunFrac = 1;
  let earthDeep = false;   // the Earth is far below the horizontal plane: a text message replaces its close-up
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
  const clampEl = (e) => Math.min(EL_MAX, Math.max(EL_MIN, e));
  const clampFov = (f) => Math.min(FOV_MAX, Math.max(FOV_MIN, f));
  // Tracking (setTrack): null (off), or { kind: "body", body } | { kind: "dir", az, el } with paused (a manual turn
  // stops it until setTrack is called again), zoomHfov (a field of view the user chose while following a body), target
  // (the camera the rule wants now, track.js) and lastStep (time of the last easing step; 0 when settled).
  let track = null;
  // onViewChange listeners (C8 extra), told { az_deg, el_deg, hfov_deg } after a render that moved the camera; the
  // camera they were last told.
  const viewListeners = new Set();
  let toldAz = NaN, toldEl = NaN, toldHfov = NaN;

  function project(enu) {
    const v = new THREE.Vector3(...enuToThree(enu)).multiplyScalar(1000).project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height, visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
      above: v.z < 1 && v.y > 1 && Math.abs(v.x) <= 1,   // in front of the camera, above the top edge
    };
  }
  const belowHorizon = (b) => b.el_deg < horizonElAt(horizon, b.az_deg);

  let hudLevel = initialHudLevel === 'minimal' ? 'minimal' : 'full', buttonsOn = !!initialButtons;
  const hud = createHud(frameEl, {
    // A click on a body's edge arrow: the tracked body resumes tracking; the other body pauses it and turns there.
    onLookAt: (name) => {
      if (track?.kind === 'body' && track.body === name) return resumeTrack();
      pauseTrack();
      lookAtBody(name);
    },
    hasConstellations: sky.hasConstellations, constellationsOn,
    onToggleConstellations: (on) => setOption('constellations', on),
    closeUpOn, onToggleCloseUp: (on) => setOption('closeUp', on),
    exposureMode, onExposureMode: (mode) => setOption('exposure', mode),
    skylineAt: (az) => horizonElAt(horizon, az),
    level: hudLevel, buttons: buttonsOn,
  });

  /**
   * View options, for a page that offers them in its own menu (C8 extras):
   *   exposure: "eye" | "camera"; constellations, closeUp, buttons: boolean; hudLevel: "full" | "minimal".
   */
  function getOptions() {
    return { exposure: exposureMode, constellations: constellationsOn, closeUp: closeUpOn, hudLevel, buttons: buttonsOn };
  }
  function setOption(name, value) {
    const before = JSON.stringify(getOptions());
    if (name === 'exposure') {
      exposureMode = value === 'camera' ? 'camera' : 'eye';
      sky.setExposureMode(exposureMode);
      hud.setExposureMode(exposureMode);
    } else if (name === 'constellations') {
      constellationsOn = !!value && sky.hasConstellations;
      sky.setConstellations(constellationsOn);
      hud.setConstellations(constellationsOn);
    } else if (name === 'closeUp') {
      closeUpOn = !!value;
      hud.setCloseUp(closeUpOn);
    } else if (name === 'hudLevel') {
      hudLevel = value === 'minimal' ? 'minimal' : 'full';
      hud.setLevel(hudLevel);
    } else if (name === 'buttons') {
      buttonsOn = !!value;
      hud.setButtons(buttonsOn);
    } else {
      console.warn(`[moonat] sky view: unknown option "${name}"`);
    }
    const now = getOptions();
    if (JSON.stringify(now) !== before) {
      requestRender();
      if (onOptions) onOptions(now);
    }
    return now;
  }

  /** Why a body is out of sight: null, "terrain" or "below" (words.js rule; the skyline when C6 gives no vis_frac). */
  function hiddenKind(b) {
    const hidden = b.vis_frac != null ? b.vis_frac <= 0.001 : belowHorizon(b);
    return hidden ? (b.el_deg + b.ang_radius_deg < 0 ? 'below' : 'terrain') : null;
  }
  /** Markers of the Sun and the Earth for the current frame (math.js bodyMarker), with the HUD's click target and tooltip. */
  function bodyMarkers() {
    return [['sun', 'Sun'], ['earth', 'Earth']].map(([key, name]) => {
      const b = state[key], hidden = hiddenKind(b);
      const why = hidden ? hiddenPhrase({ ...b, vis_frac: 0 }, horizonElAt(horizon, b.az_deg)) : '';
      const title = `${name}: height ${degText(b.el_deg)}, azimuth ${(((b.az_deg % 360) + 360) % 360).toFixed(1)}°${why ? `, ${why}` : ''}. Click to turn the view to it.`;
      return { ...bodyMarker({ name, body: b, view, width, height, hidden }), body: key, hidden, title };
    });
  }
  /** A hidden body in the frame: a thin dashed outline at its true place and size (under the close-up insets). */
  function drawGhost(m, pr) {
    ctx2d.save();
    ctx2d.setLineDash([4 * pr, 3.5 * pr]);
    ctx2d.beginPath();
    ctx2d.arc(m.x * pr, m.y * pr, Math.max(4, m.r) * pr, 0, 2 * Math.PI);
    ctx2d.lineWidth = 3 * pr;
    ctx2d.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx2d.stroke();
    ctx2d.lineWidth = Math.max(1, 1.2 * pr);
    ctx2d.strokeStyle = 'rgba(175, 208, 255, 0.85)';
    ctx2d.stroke();
    ctx2d.restore();
  }

  function renderNow() {
    if (frame) cancelAnimationFrame(frame);   // a direct call replaces the frame already requested
    frame = 0;
    if (disposed) return;
    // Tracking: one easing step toward the target (track.js), and another frame until the camera is there.
    let gliding = false;
    if (track && !track.paused && track.target) {
      const now = performance.now();
      const r = easeToward(view, track.target, track.lastStep ? Math.min(200, now - track.lastStep) : 16);
      view.az = r.az;
      view.el = clampEl(r.el);
      view.hfov = clampFov(r.hfov);
      track.lastStep = r.settled ? 0 : now;
      gliding = !r.settled;
    }
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
    if (frameEl.classList.contains('tall')) {
      // Stretched sideways only, so the horizon continues at the same height into the bands.
      bandsCtx.drawImage(src, 0, 0, src.width, src.height, 0, 0, bandsEl.width, bandsEl.height);
    }
    // An Earth far below the horizontal plane (the far side, or the limb at the wrong libration) gets a text message
    // instead of a close-up of the ground above it.
    const e = state?.earth;
    earthDeep = !!(e && hiddenReason(e) && e.el_deg + e.ang_radius_deg < EARTH_DEEP_BELOW_DEG);
    const badgeHtml = !earthDeep ? ''
      : earthNeverRises(site?.lat_deg, site?.lon_deg)
        ? `<b>Earth is below your feet</b> (height ${degText(e.el_deg)})<br>It never rises here: this is the Moon's far side, which always faces away from Earth.`
        : `<b>Earth is ${Math.round(-e.el_deg)}° below the horizon</b> (height ${degText(e.el_deg)})`;
    // Where the Sun and the Earth are when the frame does not show them (math.js bodyMarker): a dashed outline for a hidden body
    // in the frame (drawn here, under the insets), an arrow on the edge for one out of the frame (HUD).
    const bodies = state ? bodyMarkers() : [];
    for (const b of bodies) if (b.kind === 'ghost') drawGhost(b, pr);
    const insetRects = drawInsets(pr);
    // A planet within 3.5 deg of a visible Sun sits in its glare: its label is left out.
    const inGlare = (p) => state.sun.vis_frac > 0 && (state.sun.eclipse_frac ?? 0) < 1 && angleDeg(p.enu, state.sun.enu) < 3.5;
    const earthMark = bodies[1];
    const marks = state ? [
      { name: 'Earth', enu: state.earth.enu, hidden: earthMark.kind !== 'in' || view.hfov < 25, dx: earthMark.r + 6, must: true },
      ...(state.planets || []).map((p) => ({ name: p.name[0].toUpperCase() + p.name.slice(1), enu: p.enu, hidden: belowHorizon(p) || inGlare(p) })),
      ...constellationMarks(),
    ] : [];
    // Notes explain a frame that could look empty: no terrain data, night, or a camera pointed above the ground. One
    // line, most useful first; the HUD shows the first two. "Below the horizon" only for a disk entirely below the local
    // horizontal plane; above it, terrain hides the body (words.js).
    const notes = [];
    if (view.el - camera.fov / 2 > horizonMaxEl) notes.push({ id: 'look-up', text: 'Looking up: drag down to see the ground' });
    if (state && (state.sun.eclipse_frac ?? 0) >= 1 && sunFrac > 0) notes.push({ id: 'eclipse', text: "Total eclipse: only the red ring of Earth's atmosphere lights the ground" });
    if (state && sunFrac <= 0) {
      notes.push({ id: 'sun', text: state.sun.el_deg + state.sun.ang_radius_deg < 0 ? 'Night: the Sun is below the horizon' : 'In shadow: terrain hides the Sun' });
    }
    if (state && !earthDeep && state.earth.el_deg + state.earth.ang_radius_deg < horizonElAt(horizon, state.earth.az_deg)) {
      notes.push({ id: 'earth', text: state.earth.el_deg + state.earth.ang_radius_deg < 0 ? 'Earth is below the horizon' : 'Earth is hidden behind terrain' });
    }
    if (horizon.smooth) notes.push({ id: 'smooth', text: 'Terrain not included: smooth horizon' });
    hud.update(state, view, project, marks, notes.length ? [notes.slice(0, 2).map((n) => n.text).join(' · ')] : [], insetRects, badgeHtml, bodies);
    const key = notes.map((n) => n.id).join('|');
    if (onNotes && key !== lastNotesKey) { lastNotesKey = key; onNotes(notes); }
    notifyView();
    if (gliding) requestRender();
  }

  /** Tell the onViewChange listeners about a camera that moved (none before the first update(): no real camera yet). */
  function notifyView() {
    if (!viewListeners.size || !state || (view.az === toldAz && view.el === toldEl && view.hfov === toldHfov)) return;
    toldAz = view.az; toldEl = view.el; toldHfov = view.hfov;
    const v = { az_deg: view.az, el_deg: view.el, hfov_deg: view.hfov };
    for (const cb of viewListeners) {
      try { cb(v); } catch (err) { console.error('[moonat] sky view: onViewChange listener failed', err); }
    }
  }

  /**
   * Names of a few well-known constellations at the centre of their lines, while the lines are shown and the stars are
   * not washed out (camera exposure in daylight). Left out in small views and below the skyline.
   */
  function constellationMarks() {
    if (!constellationsOn || !sky.constellationLabels.length || width < 360 || sky.starDim() < 0.15) return [];
    const R = state.r_icrs_to_enu, out = [];
    for (const c of sky.constellationLabels) {
      const v = c.icrs, enu = [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
      const el = Math.asin(Math.max(-1, Math.min(1, enu[2]))) / DEG, az = Math.atan2(enu[0], enu[1]) / DEG;
      if (el > horizonElAt(horizon, az) + 3) out.push({ name: c.name, enu, faint: true });
    }
    return out;
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
      const ecl = s.eclipse_frac ?? 0;
      const sunUp = s.vis_frac == null || s.vis_frac > 0.001;
      const eItem = {
        body: e, fov: 5 * e.ang_radius_deg, hidden: eHidden,
        // During an eclipse the overlay draws the red refraction ring round the Earth's limb: an illustration, not a
        // computation, so the caption says so (Shay's decision).
        note: ecl > 0 && !eHidden,
        // Below the flat horizon the Moon itself hides the Earth; above it, a ridge or crater rim does.
        text: (mag) => (eHidden ? `${e.el_deg + e.ang_radius_deg < 0 ? 'Earth below the horizon' : 'Earth hidden behind terrain'} (${signed1(e.el_deg)}°)`
          : ecl > 0 && sunUp ? `Earth, ${mag}× zoom · ${ecl >= 1 ? 'hiding the Sun' : 'eclipsing'}`
            : `Earth, ${mag}× zoom · ${ePart ? Math.round(e.vis_frac * 100) + '% visible' : Math.round((e.phase_frac ?? 0) * 100) + '% lit'}`),
      };
      if (eHidden) {
        // Wide enough to hold the skyline and the hidden Earth (up to 30 deg); the skyline sits in the upper part.
        const sky0 = horizonElAt(horizon, e.az_deg), depth = Math.max(0, sky0 - e.el_deg);
        eItem.fov = Math.min(30, Math.max(5 * e.ang_radius_deg, 2.6 * depth + 4 * e.ang_radius_deg));
        eItem.aim = azElToEnu(e.az_deg, Math.max(sky0 - 0.3 * eItem.fov, (sky0 + e.el_deg) / 2));
      }
      if (!earthDeep) list.push(eItem);
      if (ecl > 0 && ecl < 1 && sunUp) {
        // Partial eclipse: the Sun's loupe shows the Earth's limb crossing the disk (and the diamond at the end).
        list.push({ body: s, fov: 8 * s.ang_radius_deg, text: (mag) => `Sun, ${mag}× zoom · ${eclipsePctText(ecl)}% covered` });
      } else if (s.vis_frac != null && s.vis_frac > 0.001 && s.vis_frac < 0.999) {
        list.push({ body: s, fov: 8 * s.ang_radius_deg, text: (mag) => `Sun, ${mag}× zoom · ${Math.round(s.vis_frac * 100)}% visible` });
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
        // Centred under the loupe and never wider than the room to the frame edge, nor than the loupe's own column when
        // there are two (it wraps instead). The box labels keep off covers the estimated lines of the caption.
        const text = it.text(mag);
        const maxW = Math.max(60, Math.min(2 * Math.min(cx, width - cx) - 8, list.length > 1 ? sizeCss + gap - 4 : Infinity));
        caps.push({ x: cx, y: cy + r + 4, text, maxW, note: it.note ? { text: 'ring illustrative', title: RING_NOTE } : null });
        const lines = Math.max(2, Math.ceil((6.2 * text.length) / maxW)) + (it.note ? 1 : 0);
        rects.push({ x0: cx - Math.max(r, maxW / 2), y0: cy - r, x1: cx + Math.max(r, maxW / 2), y1: cy + r + 4 + 14 * lines });
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
    bandsEl.classList.toggle('on', tall);
    if (tall) {
      bandsEl.width = Math.max(32, Math.round(cw / 6));
      bandsEl.height = Math.max(18, Math.round(ch / 6));
    }
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
    if (track && !track.paused && state && width >= 50 && height >= 50) {
      // Tracking: a view that was never framed (hidden container) starts on the target; a framed one glides to it.
      if (pendingFit) { pendingFit = null; snapToTrack(); } else retarget();
    } else {
      const fit = pendingFit || autoFit;
      if (fit && width >= 50 && height >= 50) lookAtBody(fit.name, fit.mode);
    }
    if (state) renderNow(); else requestRender();
  }

  /**
   * Frame a body ("earth" or "sun") together with the horizon: yaw to its azimuth, then pitch and FOV.
   * Both modes first try the "photo" framing (fitPhotoView: horizon 20% above the bottom edge, a comfortable FOV).
   *   mode "photo": if the body is too high for that, it stays above the frame (an edge marker points to it, and the
   *     close-up inset shows it);
   *   mode "body" (the opening view, "Look at Earth / Sun"): the body must be in frame, so the wider fitBodyView rule
   *     takes over.
   * With tall frames on, mode "body" keeps the full width whenever the body rule fits the horizon and the body there;
   * only a body too high for that (e.g. the Earth at 59° in a 2:1 window, or at 77° in a 16:9 grid view) gets a
   * centred, taller frame, as wide as the rule allows at the widest FOV (bodyFitAspect), with blurred side bands.
   * Mode "photo" with tall frames: the frame narrows until the photo rule fits.
   */
  function lookAtBody(name, mode = 'body') {
    if (!state?.[name]) return;
    if (width < 50 || height < 50) {   // no real size yet (hidden container): fit when it gets one
      pendingFit = { name, mode };
      return;
    }
    pendingFit = null;
    const f = framing(name, mode);
    setFrameAspect(f.aspect);
    view.az = f.az;
    view.el = f.el;
    view.hfov = f.hfov;
    autoFit = { name, mode };
    if (track) track.target = null;   // a tracking camera eases on from here, with nothing fed forward
    requestRender();
  }

  /**
   * The lookAtBody framing of a body for the current container, without moving the camera: { az, el, hfov (deg),
   * aspect (width / height of a tall frame, or null for the full container) }, or null without a sky state.
   */
  function framing(name, mode = 'body') {
    const b = state?.[name];
    if (!b) return null;
    const args = { bodyElDeg: b.el_deg, bodyRadiusDeg: b.ang_radius_deg, horizonElDeg: horizonElAt(horizon, b.az_deg) };
    const photo = (aspect) => fitPhotoView({ ...args, aspect, hfovDeg: defaultHfov, maxHfovDeg: COMFORT_HFOV });
    const body = (aspect) => fitBodyView({ ...args, aspect, defaultHfovDeg: defaultHfov, maxHfovDeg: FOV_MAX });
    const cw = Math.max(1, container.clientWidth), ch = Math.max(1, container.clientHeight), full = cw / ch;
    const frameOf = (a) => Math.min(cw, Math.max(1, Math.floor(ch * a))) / ch;   // as layout() sizes a tall frame
    let fit = photo(full), aspect = null;
    const tooHigh = !fit.body_in_frame && args.bodyElDeg + args.bodyRadiusDeg > args.horizonElDeg;
    if (tallFrames && tooHigh && mode === 'body') {
      const wide = body(full);
      const a = wide.both_fit ? null : Math.max(TALL_MIN_ASPECT, bodyFitAspect({ ...args, maxHfovDeg: FOV_MAX }));
      aspect = a !== null && a < full ? a : null;
      fit = aspect ? body(frameOf(aspect)) : wide;
    } else {
      aspect = tallFrames && tooHigh && fit.aspect_max < full ? Math.max(TALL_MIN_ASPECT, fit.aspect_max) : null;
      if (aspect) fit = photo(frameOf(aspect));
      if (!fit.body_in_frame && mode === 'body') fit = body(aspect ? frameOf(aspect) : full);
    }
    return { az: wrapAz(b.az_deg), el: clampEl(fit.el_deg), hfov: clampFov(fit.hfov_deg), aspect };
  }

  // --- Tracking (C8 extra setTrack): the camera follows a body or a direction while the time changes -------------
  function trackInfo() {
    if (!track) return { mode: null, body: null, paused: false };
    return { mode: track.kind === 'body' ? 'body' : 'direction', body: track.kind === 'body' ? track.body : null, paused: track.paused };
  }
  function notifyTrack() {
    if (onTrack) onTrack(trackInfo());
  }

  /** The camera the tracking rule wants now ({ az, el, hfov, aspect }), or null (no sky state or no size yet). */
  function trackTarget() {
    if (!track || width < 50 || height < 50) return null;
    if (track.kind === 'dir') return { az: track.az, el: clampEl(track.el), hfov: view.hfov, aspect: frameAspect };
    const b = state?.[track.body];
    if (!b) return null;
    if (!track.zoomHfov) return framing(track.body, 'body');
    // The user zoomed while tracking: keep that field and aim with the same rules (track.js aimAtFov).
    const el = aimAtFov({
      bodyElDeg: b.el_deg, bodyRadiusDeg: b.ang_radius_deg, horizonElDeg: horizonElAt(horizon, b.az_deg),
      aspect: width / height, hfovDeg: track.zoomHfov,
    });
    return { az: wrapAz(b.az_deg), el: clampEl(el), hfov: track.zoomHfov, aspect: frameAspect };
  }

  /**
   * A new target for the tracking camera. bodyMove ({ az, el }, deg): the tracked body's own motion since the previous
   * target, fed forward at once (track.js feedForward); the rest eases in renderNow.
   */
  function retarget(bodyMove = null) {
    if (!track || track.paused) return;
    const t = trackTarget();
    if (!t) return;
    // A new frame shape only for a clear change: a tall frame that narrows a little at each step would re-layout often.
    const a = t.aspect ?? null;
    if ((a === null) !== (frameAspect === null) || (a !== null && Math.abs(a / frameAspect - 1) > 0.03)) setFrameAspect(a);
    if (bodyMove && track.target) {
      const v = feedForward(view, track.target, t, bodyMove);
      view.az = v.az;
      view.el = clampEl(v.el);
      view.hfov = clampFov(v.hfov);
    }
    track.target = t;
    autoFit = null;
    requestRender();
  }

  /** Put the camera on the tracking target at once (a view that opens while tracking is on). */
  function snapToTrack() {
    const t = trackTarget();
    if (!t) return false;
    setFrameAspect(t.aspect ?? null);
    view.az = t.az;
    view.el = t.el;
    view.hfov = t.hfov;
    track.target = t;
    track.lastStep = 0;
    autoFit = null;
    requestRender();
    return true;
  }

  /** A manual turn (drag, arrow keys, the other body's edge arrow) pauses tracking until setTrack is called again. */
  function pauseTrack() {
    if (!track || track.paused) return;
    track.paused = true;
    track.target = null;
    track.lastStep = 0;
    notifyTrack();
  }
  function resumeTrack() {
    if (!track) return;
    const was = track.paused;
    track.paused = false;
    track.zoomHfov = null;
    track.target = null;
    retarget();
    if (was) notifyTrack();
  }

  /**
   * Follow a body or a direction as the time changes (C8 extra; docs/CONTRACTS.md):
   *   "sun" | "earth": every update() frames that body by the lookAtBody rule, easing there (track.js); the user can
   *     still zoom (the field is then kept, and the aim follows the same rules at that field);
   *   { az_deg, el_deg } (deg, local horizon frame of the view's site): the camera centre eases toward that direction
   *     and keeps its field of view; the app may call it every frame with a new direction;
   *   null: tracking off (the camera stays where it is).
   * A manual drag or arrow key pauses tracking (onTrack reports it) until setTrack is called again. A direction updated
   * every frame keeps a pause; pass { resume: true } to end it. Returns { mode: "body" | "direction" | null, body, paused }.
   */
  function setTrack(target, { resume = false } = {}) {
    const t = parseTrackTarget(target);
    const before = JSON.stringify(trackInfo());
    let move = null;
    if (!t) track = null;
    else if (t.kind === 'dir' && track?.kind === 'dir') {
      track.az = t.az;
      track.el = t.el;
      if (resume && track.paused) { track.paused = false; track.target = null; }
      // A direction that turns a little at each update (≤ 0.5°) is followed without lag; a sharp turn eases.
      move = { az: 0, el: 0 };
    } else {
      track = { ...t, paused: false, zoomHfov: null, target: null, lastStep: 0 };
    }
    if (track && !track.paused && state) retarget(move);
    if (JSON.stringify(trackInfo()) !== before) notifyTrack();
    return trackInfo();
  }

  function lookAt(azDeg, elDeg) {
    if (track) track.target = null;   // the app turned the camera (e.g. a rover's new local frame): no feed-forward next
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
  /**
   * Turn the camera with its local frame: add dAzDeg (deg) to the camera's azimuth and to the tracking target, so a view
   * whose local horizon frame turns (a rover near the pole: the same physical direction gets a new azimuth) keeps
   * looking the same way. No framing rule, no easing, no pause; feed-forward of the next update still works.
   */
  function turnFrame(dAzDeg) {
    if (!Number.isFinite(dAzDeg) || dAzDeg === 0) return;
    view.az = wrapAz(view.az + dAzDeg);
    if (track) {
      if (track.target) track.target = { ...track.target, az: wrapAz(track.target.az + dAzDeg) };
      if (track.kind === 'dir') track.az = wrapAz(track.az + dAzDeg);
    }
    requestRender();
  }
  function setFov(deg) {
    view.hfov = clampFov(deg);
    autoFit = null;
    // Zooming while a body is tracked keeps tracking, at the new field of view.
    if (track?.kind === 'body' && !track.paused) {
      track.zoomHfov = view.hfov;
      retarget();
    }
    requestRender();
  }

  function update(s, { render = true } = {}) {
    const prev = state;
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
    // During an eclipse the direct sunlight is scaled by the share of the disk the Earth leaves uncovered.
    const look = eclipseLook(s), uncovered = look ? 1 - s.sun.eclipse_frac : 1;
    u.uSunVis.value = (beyondPatch ? frac : 1) * uncovered;
    sunFrac = frac;
    u.uSunUp.value = Math.min(1, Math.max(0, (s.sun.el_deg + 0.6) / 0.9)) * uncovered;
    // Earthshine: faint, bluish, scaled by the Earth's phase and visibility.
    const ev = (s.earth.vis_frac ?? 1) * (s.earth.phase_frac ?? 0.5) * 0.02;
    u.uEarthDir.value.set(...enuToThree(s.earth.enu)).normalize();
    u.uEarthShine.value.set(0.62 * ev, 0.8 * ev, 1.0 * ev);
    // Near totality the ground is lit by the Earth's red ring instead (the light that turns the eclipsed Moon red;
    // of the same order as full earthshine, so drawn at that scale).
    if (look) {
      const red = (s.earth.vis_frac ?? 1) * Math.pow(s.sun.eclipse_frac, 4) * 0.014;
      u.uEarthShine.value.x += 0.85 * red; u.uEarthShine.value.y += 0.26 * red; u.uEarthShine.value.z += 0.08 * red;
    }
    shadowDirty = true;
    if (firstUpdate) {
      firstUpdate = false;
      // The opening view always shows the Earth and the horizon (C8), unless tracking already asks for a body.
      if (!(track && !track.paused && snapToTrack())) lookAtBody('earth', 'body');
    } else if (track && !track.paused) {
      const name = track.kind === 'body' ? track.body : null;
      const a = name && prev?.[name], b = name && s[name];
      retarget(a && b ? { az: azDelta(a.az_deg, b.az_deg), el: b.el_deg - a.el_deg } : null);
    }
    if (render) renderNow(); else requestRender();
  }

  // --- Interaction: drag to look around (the sky follows the pointer), wheel to zoom ----------------------------
  const el = canvas;
  let drag = null;
  const onDown = (e) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); container.classList.add('dragging'); };
  const onMove = (e) => {
    if (!drag) return;
    const k = view.hfov / width;
    if (e.clientX === drag.x && e.clientY === drag.y) return;
    pauseTrack();
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
  // Keyboard: the view takes focus; the arrow keys turn it (a step of 1/12 of the field), + and - zoom.
  if (!container.hasAttribute('tabindex')) container.tabIndex = 0;
  const onKey = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== container) return;
    const step = Math.max(0.5, view.hfov / 12), k = e.key;
    if (k.startsWith('Arrow')) pauseTrack();
    if (k === 'ArrowLeft' || k === 'ArrowRight') turnTo(view.az + ((k === 'ArrowRight' ? 1 : -1) * step) / Math.max(0.3, Math.cos(view.el * DEG)), view.el);
    else if (k === 'ArrowUp' || k === 'ArrowDown') turnTo(view.az, view.el + (k === 'ArrowUp' ? step : -step));
    else if (k === '+' || k === '=') setFov(view.hfov / 1.25);
    else if (k === '-' || k === '_') setFov(view.hfov * 1.25);
    else return;
    e.preventDefault();
  };
  container.addEventListener('keydown', onKey);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(container);
  resize();

  function dispose() {
    disposed = true;
    track = null;
    viewListeners.clear();
    if (frame) cancelAnimationFrame(frame);
    ro?.disconnect();
    container.removeEventListener('keydown', onKey);
    hud.dispose();
    sky.dispose();
    terrain.dispose();
    for (const k of ['hi', 'lo']) {
      if (gl.lastView[k] === self) { for (const l of gl.lights[k]) nearScene.remove(l, l.target); gl.lastView[k] = null; }
    }
    gl.views--;
    frameEl.remove();
    bandsEl.remove();
    container.classList.remove('moonat-sky', 'dragging');
  }

  const info = {
    stars: sky.starCount, hasPatch: !!patch, hasEarthTexture: !!earthTexture, horizonSource: site?.horizon ? 'site' : patch ? 'patch' : 'smooth',
    hasConstellations: sky.hasConstellations,   // whether a "constellations" option is worth offering
  };

  /**
   * Replace the terrain without rebuilding the view: a new C3 skyline and/or C4 patch, e.g. when the real terrain of a
   * custom point arrives after the view opened on the coarse tiles horizon. The camera, sky and textures stay; only
   * the terrain meshes are rebuilt (tens of ms), or only their heights when the new patch has the same grid (a rover
   * moving along its route: a few ms). `horizon`: C3 object, or null for the patch's own skyline (or a smooth one);
   * `patch`: { meta, data: Float32Array } (C4) or null. An omitted key keeps its current value. A moving view also
   * passes `detail` (world-anchored detail of the new ground point) and `eye` (setEye for that ground point), so the
   * first frame on the new ground already has the eye where the rover is.
   */
  function setTerrain({ horizon: newHorizon, patch: newPatch, detail: newDetail, eye = null } = {}) {
    if (disposed) return;
    if (newPatch !== undefined) patch = newPatch;
    if (newHorizon !== undefined) horizon = newHorizon ?? (patch ? horizonFromPatch(patch, eyeH) : flatHorizon(eyeH));
    if (newDetail !== undefined) detail = newDetail;
    if (!terrain.setGround({ patch, horizon, detail })) {
      farScene.remove(terrain.skirt);
      nearScene.remove(terrain.near);
      terrain.dispose();
      terrain = buildTerrain({ patch, horizon, eyeH, floatLinear, detail });
      farScene.add(terrain.skirt);
      nearScene.add(terrain.near);
    }
    if (eye) terrain.setEye(eye);
    horizonMaxEl = Math.max(...horizon.el_deg);
    info.hasPatch = !!patch;
    info.horizonSource = newHorizon ? 'site' : patch ? 'patch' : horizon.smooth ? 'smooth' : info.horizonSource;
    shadowDirty = true;
    if (state) {
      // Terrain uniforms (Sun, earthshine), the Sun's share above the new skyline and a new track target; drawn at the
      // next animation frame (which a playing timelapse draws anyway), not twice in one frame.
      update(state, { render: false });
      // A static view keeps its framing of a body on the new terrain; a moving view (eye) keeps its camera.
      if (autoFit && !eye && !(track && !track.paused)) lookAtBody(autoFit.name, autoFit.mode);
    } else requestRender();
  }

  return {
    update, lookAt, lookAtBody, setFov, resize, dispose, setTerrain, turnFrame,
    /**
     * Moving view (built with terrainDetail): the eye at { east, north } m from the ground point of the terrain on
     * show, turn_deg = the change of azimuth from that point's frame to the eye's (sky_ride.js eyeOffset). Takes effect
     * at the next render (update). No effect on other views.
     */
    setEye: (eye) => { if (!disposed) terrain.setEye(eye); },
    /** Follow "sun" | "earth" | { az_deg, el_deg } as the time changes, or null (see setTrack above; C8 extras). */
    setTrack,
    getTrack: trackInfo,
    // Extras beyond C8, for the app and for debugging:
    /** "full" (the default readout) or "minimal": the time and at most one status line; the sky's labels stay. */
    setHudLevel: (level) => setOption('hudLevel', level),
    /** View options for a page menu: exposure, constellations, closeUp, hudLevel, buttons (see getOptions). */
    setOption, getOptions,
    setConstellations: (on) => setOption('constellations', on),
    setCloseUp: (on) => setOption('closeUp', on),
    setExposure: (mode) => setOption('exposure', mode),
    getView: () => ({ az_deg: view.az, el_deg: view.el, fov_deg: view.hfov }),
    /**
     * Call cb({ az_deg, el_deg, hfov_deg }) after each render that moved the camera (a drag, a zoom, lookAt or
     * lookAtBody, tracking, a resize that reframes): at most once per render, so at most about once per animation
     * frame, and never before the first update(). az_deg: true azimuth of the frame centre, clockwise from local north;
     * el_deg: its elevation; both in the ENU frame of the view's site (docs/CONTRACTS.md §0); hfov_deg: the frame's
     * horizontal field of view. The next render tells a new listener the current camera. Returns an unsubscribe.
     */
    onViewChange: (cb) => {
      viewListeners.add(cb);
      toldAz = NaN;
      if (state) requestRender();
      return () => viewListeners.delete(cb);
    },
    /** Drawing-buffer budget in device pixels (null = default); the pixel ratio never exceeds 2. */
    setPixelBudget: (px) => { pixelBudget = px > 0 ? px : DEFAULT_PIXELS; requestRender(); },
    /**
     * Allow a taller frame than the container (focus mode): when the framed body is too high to fit with the horizon
     * at a comfortable FOV, the view becomes a centred box narrow enough for both. Off: the frame fills the container.
     */
    setTallFrames: (on) => {
      tallFrames = !!on;
      if (!tallFrames) setFrameAspect(null);
      if (track && !track.paused) retarget();
      else if (autoFit) lookAtBody(autoFit.name, autoFit.mode);
      requestRender();
    },
    info,
  };
}
