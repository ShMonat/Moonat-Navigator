// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// Terrain for the sky view, in the three.js world frame (x = east, y = up, z = -north; the eye is the origin, so
// the ground point under the observer is at y = -eyeH; metres).
//   near field  a polar mesh around the observer (fine near the eye) + the C4 patch grid beyond it + rocks
//   far field   a skirt whose top edge is exactly the C3 horizon profile (el_deg at dist_km per azimuth)
// Near-field vertices are clamped to stay below the C3 profile, so the rendered skyline is the profile itself:
// a body is hidden exactly when it is below the horizon profile.

import * as THREE from 'three';
import { DEG, R_MOON_M, rng, valueNoise, samplePatch, horizonElAt } from './math.js';
import { TERRAIN_VERT, TERRAIN_FRAG, SKIRT_VERT, SKIRT_FRAG } from './shaders.js';

const AZ_NEAR = 720;          // azimuth divisions of the polar near mesh
const RING_RATIO = 1.035;     // radial growth per ring
const R_FIRST = 0.35;         // m, first ring radius
const HORIZON_MARGIN = 2e-4;  // rad: near terrain stays this far below the profile

/** Small-scale relief that the DEM cannot resolve: gentle undulation plus small craters. Deterministic. */
function makeMicroRelief(seed, rFade) {
  const rand = rng(seed), craters = [];
  for (let i = 0; i < 220; i++) {
    const R = Math.min(22, 0.45 * Math.pow(1 - rand(), -1 / 1.9));     // power-law radii, 0.45 m and up
    const dist = 5 + R * 1.5 + 420 * Math.pow(rand(), 1.6), az = rand() * 2 * Math.PI;
    craters.push({ x: dist * Math.sin(az), y: dist * Math.cos(az), R, depth: (0.12 + 0.1 * rand()) * 2 * R * 0.5 });
  }
  const f = (x, y) => {
    let z = 0.55 * (valueNoise(x / 34, y / 34, seed + 1) - 0.5) + 0.22 * (valueNoise(x / 9, y / 9, seed + 2) - 0.5)
      + 0.07 * (valueNoise(x / 2.3, y / 2.3, seed + 3) - 0.5) + 0.02 * (valueNoise(x / 0.6, y / 0.6, seed + 4) - 0.5);
    for (const c of craters) {
      const dx = x - c.x, dy = y - c.y, R = c.R;
      if (Math.abs(dx) > 2.2 * R || Math.abs(dy) > 2.2 * R) continue;
      const q = Math.hypot(dx, dy) / R;
      if (q < 1) z += -c.depth * (1 - q * q) + 0.22 * c.depth * q * q * q;
      else if (q < 2.2) z += 0.22 * c.depth * Math.exp(-(q - 1) / 0.28);
    }
    return z;
  };
  const z0 = f(0, 0);
  return (x, y) => {
    const r = Math.hypot(x, y);
    if (r >= rFade) return 0;
    const k = r < 0.5 * rFade ? 1 : 1 - (r - 0.5 * rFade) / (0.5 * rFade);
    return (f(x, y) - z0 * Math.exp(-r / 3)) * k;
  };
}

function fixWinding(pos, idx) {
  // Make every triangle face up (+y), whatever order it was pushed in.
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ny = (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]) - (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]);
    if (ny < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
}

function makeRockGeometry(seed, detail = 2) {
  const g = new THREE.IcosahedronGeometry(0.5, detail), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // Direction-based noise, so duplicated vertices of the non-indexed geometry stay welded.
    const k = 0.72 + 0.5 * valueNoise(x * 3.1 + 5, y * 3.1 + z * 2.3, seed) + 0.22 * valueNoise(x * 9 + z * 7, y * 9 - z * 5, seed + 9);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();   // non-indexed: flat facets, which reads as fractured rock
  return g;
}

/**
 * Build all terrain objects.
 * @param patch    { meta, data: Float32Array } (C4) or null
 * @param horizon  C3-shaped profile (never null here; the caller supplies a flat or patch-derived one)
 * @param eyeH     observer eye height above the ground, m
 */
export function buildTerrain({ patch, horizon, eyeH, seed = 1969, floatLinear = true }) {
  const h = patch ? patch.meta.half_extent_m : 0, d = patch ? patch.meta.spacing_m : 0;
  // The polar mesh hands over to the patch grid where its cells reach about the grid spacing.
  const rSwitch = patch ? Math.max(300, Math.min(0.5 * h, 60 * d)) : 2500;
  const micro = makeMicroRelief(seed, Math.min(rSwitch, 900));
  const baseZ = patch ? (e, n) => samplePatch(patch, e, n) : (e, n) => -(e * e + n * n) / (2 * R_MOON_M);
  const groundZ = (e, n) => baseZ(e, n) + micro(e, n);            // z_up relative to the ground point
  const clampY = (x, y, z) => {                                    // keep a world vertex below the C3 profile
    const r = Math.hypot(x, z);
    if (r < 1) return y;
    const az = Math.atan2(x, -z) / DEG;
    return Math.min(y, r * Math.tan(horizonElAt(horizon, az) * DEG - HORIZON_MARGIN));
  };

  // Shared uniforms (same objects in every terrain material).
  const heightTex = patch
    ? new THREE.DataTexture(patch.data, patch.meta.grid_n, patch.meta.grid_n, THREE.RedFormat, THREE.FloatType)
    : new THREE.DataTexture(new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType);
  heightTex.minFilter = heightTex.magFilter = floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
  heightTex.needsUpdate = true;
  const shared = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunRad: { value: 0.0046 }, uSunVis: { value: 1 },
    uEarthDir: { value: new THREE.Vector3(0, 1, 0) }, uEarthShine: { value: new THREE.Vector3() },
    uExposure: { value: 1.05 }, uHeightTex: { value: heightTex }, uPatchHalf: { value: h || 1 },
    uPatchN: { value: patch ? patch.meta.grid_n : 1 }, uHasPatch: { value: patch ? 1 : 0 }, uEyeH: { value: eyeH },
    uStep0: { value: Math.max(1, 0.75 * d) }, uSunUp: { value: 1 },
  };
  const litMaterial = (defines = {}) => new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights), ...shared },
    vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, lights: true, defines,
  });

  const near = new THREE.Group();
  const disposables = [heightTex];

  // --- Polar near mesh -------------------------------------------------------------------------------------------
  const radii = [];
  for (let r = R_FIRST; r < rSwitch; r *= RING_RATIO) radii.push(r);
  radii.push(rSwitch);
  {
    const J = radii.length, pos = new Float32Array((1 + J * AZ_NEAR) * 3), idx = new Uint32Array((AZ_NEAR + (J - 1) * AZ_NEAR * 2) * 3);
    pos[1] = groundZ(0, 0) - eyeH;
    let v = 3;
    for (let j = 0; j < J; j++) {
      for (let i = 0; i < AZ_NEAR; i++) {
        const a = ((i + 0.5 * (j & 1)) / AZ_NEAR) * 2 * Math.PI, e = radii[j] * Math.sin(a), n = radii[j] * Math.cos(a);
        pos[v] = e; pos[v + 2] = -n; pos[v + 1] = clampY(e, groundZ(e, n) - eyeH, -n); v += 3;
      }
    }
    let k = 0;
    const vi = (j, i) => 1 + j * AZ_NEAR + (i % AZ_NEAR);
    for (let i = 0; i < AZ_NEAR; i++) { idx[k++] = 0; idx[k++] = vi(0, i); idx[k++] = vi(0, i + 1); }
    for (let j = 0; j < J - 1; j++) {
      for (let i = 0; i < AZ_NEAR; i++) {
        // Rings are staggered by half a cell, so split each quad into two near-equilateral triangles.
        const a = vi(j, i), b = vi(j, i + 1), c = vi(j + 1, i), e = vi(j + 1, i + 1);
        if (j & 1) { idx[k++] = a; idx[k++] = b; idx[k++] = e; idx[k++] = a; idx[k++] = e; idx[k++] = c; }
        else { idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = e; idx[k++] = c; }
      }
    }
    fixWinding(pos, idx);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, litMaterial());
    m.receiveShadow = true; m.castShadow = true; m.frustumCulled = false;
    near.add(m); disposables.push(g, m.material);
  }

  // --- Patch grid beyond the polar mesh --------------------------------------------------------------------------
  if (patch) {
    const N = patch.meta.grid_n, pos = new Float32Array(N * N * 3), idx = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const x = -h + c * d, z = -(h - r * d), o = (r * N + c) * 3;
        pos[o] = x; pos[o + 2] = z; pos[o + 1] = clampY(x, patch.data[r * N + c] - eyeH, z);
      }
    }
    const keep = 0.93 * rSwitch;
    for (let r = 0; r < N - 1; r++) {
      for (let c = 0; c < N - 1; c++) {
        const x0 = -h + c * d, z0 = -(h - r * d);
        const far = Math.max(Math.hypot(x0, z0), Math.hypot(x0 + d, z0), Math.hypot(x0, z0 + d), Math.hypot(x0 + d, z0 + d));
        if (far < keep) continue;
        const a = r * N + c;
        idx.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
      }
    }
    const index = new Uint32Array(idx);
    fixWinding(pos, index);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, litMaterial());
    m.receiveShadow = true; m.frustumCulled = false;
    m.position.y = -0.15;   // tuck the coarse grid just under the fine mesh where they overlap
    near.add(m); disposables.push(g, m.material);
  }

  // --- Rocks: instanced, deterministic, power-law sizes, denser near the camera ----------------------------------
  const smallRocks = [];   // the coarse-shape groups, sorted largest first, so drawing a prefix drops the smallest
  {
    const rand = rng(seed + 77), COUNT = 2600, dummy = new THREE.Object3D(), rocks = [];
    const rockMat = litMaterial({ ROCK: '' });
    disposables.push(rockMat);
    for (let i = 0; i < COUNT; i++) {
      const r = Math.exp(Math.log(2.2) + rand() * (Math.log(Math.min(380, rSwitch)) - Math.log(2.2))), az = rand() * 2 * Math.PI;
      const sMin = Math.max(0.035, 0.003 * r), sMax = r < 5 ? 0.3 : r < 12 ? 0.7 : 1.5;
      const s = Math.min(sMax, sMin * Math.pow(1 - rand(), -1 / 2.3));
      const e = r * Math.sin(az), n = r * Math.cos(az), sy = s * (0.5 + 0.35 * rand());
      dummy.position.set(e, groundZ(e, n) - eyeH + 0.12 * sy, -n);
      dummy.rotation.set((rand() - 0.5) * 0.7, rand() * 6.283, (rand() - 0.5) * 0.7);
      dummy.scale.set(s * (0.75 + 0.5 * rand()), sy, s * (0.75 + 0.5 * rand()));
      dummy.updateMatrix();
      rocks.push({ apparent: s / r, matrix: dummy.matrix.clone(), tint: 0.78 + 0.42 * rand() });
    }
    // Level of detail: the rocks that look largest get the detailed shapes; the many small ones a coarse shape.
    rocks.sort((a, b) => b.apparent - a.apparent);
    const groups = [{ detail: 2, n: 250 }, { detail: 2, n: 250 }, { detail: 1, n: 1050 }, { detail: 1, n: 1050 }];
    let start = 0;
    groups.forEach((grp, vI) => {
      const list = rocks.slice(start, start + grp.n);
      start += grp.n;
      const g = makeRockGeometry(seed + vI * 13, grp.detail), tint = new Float32Array(list.length);
      const mesh = new THREE.InstancedMesh(g, rockMat, list.length);
      list.forEach((rk, i) => { mesh.setMatrixAt(i, rk.matrix); tint[i] = rk.tint; });
      g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      near.add(mesh); disposables.push(g);
      if (grp.detail === 1) smallRocks.push({ mesh, n: list.length });
    });
  }

  // --- Far-field skirt: top edge = the C3 profile ----------------------------------------------------------------
  const n = horizon.el_deg.length, step = horizon.az_step_deg;
  const rIn = patch ? 0.9 * h : rSwitch;
  const pos = new Float32Array(((n + 1) * 2 + 1) * 3), aT = new Float32Array((n + 1) * 2 + 1), idx = new Uint32Array(n * 9);
  for (let k = 0; k <= n; k++) {
    const a = (k % n) * step * DEG, el = horizon.el_deg[k % n] * DEG, sa = Math.sin(a), ca = Math.cos(a);
    // Placed at the distance of the terrain that sets the skyline (capped inside the far plane: only the direction matters).
    const Dg = Math.max(50, (horizon.dist_km?.[k % n] || 0) * 1000), D = Dg * Math.min(1, (60000 * Math.cos(el)) / Dg);
    const yNat = baseZ(rIn * sa, rIn * ca) - eyeH;
    const yB = Math.min(yNat, rIn * Math.tan(el - 1.5 * DEG));
    pos.set([D * sa, D * Math.tan(el), -D * ca], k * 6);            // top: on the skyline
    pos.set([rIn * sa, yB, -rIn * ca], k * 6 + 3);                    // bottom: under the near field
    aT[k * 2] = 1;
  }
  const nadir = (n + 1) * 2;
  pos.set([0, -5000, 0], nadir * 3);
  for (let k = 0; k < n; k++) {
    const t0 = 2 * k, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
    idx.set([t0, b0, t1, t1, b0, b1, b0, nadir, b1], k * 9);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  sg.setIndex(new THREE.BufferAttribute(idx, 1));
  const skirtMat = new THREE.ShaderMaterial({
    uniforms: shared, vertexShader: SKIRT_VERT, fragmentShader: SKIRT_FRAG, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
  });
  const skirt = new THREE.Mesh(sg, skirtMat);
  skirt.frustumCulled = false;
  disposables.push(sg, skirtMat);

  /** Draw only this fraction (0..1) of the small rocks (the apparently smallest ones are left out first). */
  const setRockDetail = (f) => {
    let keep = Math.round(smallRocks.reduce((s, r) => s + r.n, 0) * Math.min(1, Math.max(0, f)));
    for (const r of smallRocks) {
      r.mesh.count = Math.min(r.n, keep);
      r.mesh.visible = r.mesh.count > 0;
      keep -= r.mesh.count;
    }
  };
  return { near, skirt, uniforms: shared, rSwitch, setRockDetail, dispose: () => disposables.forEach((x) => x.dispose()) };
}
