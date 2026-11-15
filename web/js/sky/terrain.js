// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// Terrain for the sky view, in the three.js world frame (x = east, y = up, z = -north; the eye is the origin, so
// the ground point under the observer is at y = -eyeH; metres).
//   near field  a polar mesh around the observer (fine near the eye) + the C4 patch grid beyond it + rocks
//   far field   a skirt whose top edge is exactly the C3 horizon profile (el_deg at dist_km per azimuth)
// Near-field vertices are clamped to stay below the C3 profile, so the rendered skyline is the profile itself:
// a body is hidden exactly when it is below the horizon profile.
// A new ground of the same patch grid (a rover moving along its route) updates the heights in place (setGround).
// A moving view (a drive) passes world-anchored detail (detail.js driveDetail): its bumps, craters and rocks stay at
// fixed places on the Moon, and setEye moves and turns the near field every frame so the eye is where the rover is.

import * as THREE from 'three';
import { DEG, R_MOON_M, rng, valueNoise, samplePatch, horizonElAt, vertexNormals } from './math.js';
import { TERRAIN_VERT, TERRAIN_FRAG, SKIRT_VERT, SKIRT_FRAG } from './shaders.js';
import { AZ_NEAR, RING_RATIO, R_FIRST, ROCK_STRIDE, NOISE_PERIOD } from './detail.js';

const HORIZON_MARGIN = 2e-4;  // rad: near terrain stays this far below the profile
const ROCK_CAP = 3000;        // rocks per shape in a moving view

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

// --- Fixed parts of the near field ---------------------------------------------------------------------------------
// The plan positions (x, z) of the polar mesh, of the patch grid and of the rocks, their triangles and the micro relief
// at the polar vertices and rocks depend only on the seed and on the patch grid's size and spacing, not on its heights
// or on the skyline. They are computed once per layout and kept (a few recent layouts), so a new ground of the same
// grid (a rover moving along its route) only recomputes heights.
const POLAR = new Map();   // `${seed}|${rSwitch}` -> polar mesh + rocks layout
const GRID = new Map();    // `${grid_n}|${half}|${spacing}|${rSwitch}` -> patch grid layout
const MAX_LAYOUTS = 2;

function lru(map, key, make) {
  let v = map.get(key);
  if (v) map.delete(key);
  else v = make();
  map.set(key, v);
  while (map.size > MAX_LAYOUTS) map.delete(map.keys().next().value);
  return v;
}

/** Polar near mesh and rocks around the eye, out to rSwitch (m): plan positions, micro relief, triangles. */
function polarLayout(seed, rSwitch) {
  return lru(POLAR, `${seed}|${rSwitch}`, () => {
    const micro = makeMicroRelief(seed, Math.min(rSwitch, 900));
    const radii = [];
    for (let r = R_FIRST; r < rSwitch; r *= RING_RATIO) radii.push(r);
    radii.push(rSwitch);
    const J = radii.length, nv = 1 + J * AZ_NEAR;
    const xz = new Float32Array(nv * 3), east = new Float64Array(nv), north = new Float64Array(nv), lift = new Float64Array(nv);
    lift[0] = micro(0, 0);
    let v = 1;
    for (let j = 0; j < J; j++) {
      for (let i = 0; i < AZ_NEAR; i++, v++) {
        const a = ((i + 0.5 * (j & 1)) / AZ_NEAR) * 2 * Math.PI, e = radii[j] * Math.sin(a), n = radii[j] * Math.cos(a);
        east[v] = e; north[v] = n; lift[v] = micro(e, n);
        xz[3 * v] = e; xz[3 * v + 2] = -n;
      }
    }
    const idx = new Uint32Array((AZ_NEAR + (J - 1) * AZ_NEAR * 2) * 3);
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
    fixWinding(xz, idx);   // the facing test uses x and z only, so it holds for any heights
    // True azimuth (deg) of each vertex column: even rings at i / AZ_NEAR of a turn, odd rings half a cell further.
    const az = new Float64Array(2 * AZ_NEAR);
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < AZ_NEAR; i++) {
        const a = ((i + 0.5 * p) / AZ_NEAR) * 2 * Math.PI;
        az[p * AZ_NEAR + i] = Math.atan2(Math.sin(a), Math.cos(a)) / DEG;
      }
    }

    // Rocks: instanced, deterministic, power-law sizes, denser near the camera. Each keeps its plan position, its
    // micro relief and its height above the ground; the matrix gets its height (element 13) per ground.
    const rand = rng(seed + 77), COUNT = 2600, dummy = new THREE.Object3D(), rocks = [];
    for (let i = 0; i < COUNT; i++) {
      const r = Math.exp(Math.log(2.2) + rand() * (Math.log(Math.min(380, rSwitch)) - Math.log(2.2))), az = rand() * 2 * Math.PI;
      const sMin = Math.max(0.035, 0.003 * r), sMax = r < 5 ? 0.3 : r < 12 ? 0.7 : 1.5;
      const s = Math.min(sMax, sMin * Math.pow(1 - rand(), -1 / 2.3));
      const e = r * Math.sin(az), n = r * Math.cos(az), sy = s * (0.5 + 0.35 * rand());
      dummy.position.set(e, 0, -n);
      dummy.rotation.set((rand() - 0.5) * 0.7, rand() * 6.283, (rand() - 0.5) * 0.7);
      dummy.scale.set(s * (0.75 + 0.5 * rand()), sy, s * (0.75 + 0.5 * rand()));
      dummy.updateMatrix();
      rocks.push({ apparent: s / r, matrix: dummy.matrix.clone(), tint: 0.78 + 0.42 * rand(), e, n, lift: micro(e, n), sy });
    }
    // Level of detail: the rocks that look largest get the detailed shapes; the many small ones a coarse shape.
    rocks.sort((a, b) => b.apparent - a.apparent);
    const groups = [{ detail: 2, n: 250 }, { detail: 2, n: 250 }, { detail: 1, n: 1050 }, { detail: 1, n: 1050 }];
    let start = 0;
    for (const grp of groups) {
      grp.list = rocks.slice(start, start + grp.n);
      start += grp.n;
    }
    return { radii, xz, east, north, lift, idx, az, groups };
  });
}

/**
 * The C4 patch grid as a mesh beyond the polar mesh: plan positions, distance and azimuth of each vertex, triangles;
 * and where each polar vertex samples the patch (samplePatch's cell and weights). The polar plan positions depend on
 * rSwitch only (not on the seed), so P of any seed gives the same samples.
 */
function gridLayout(N, h, d, rSwitch, P) {
  return lru(GRID, `${N}|${h}|${d}|${rSwitch}`, () => {
    const nv = P.east.length, cell = new Int32Array(nv), wc = new Float64Array(nv), wr = new Float64Array(nv);
    for (let v = 0; v < nv; v++) {
      // As samplePatch: the nearest edge outside the patch.
      let c = (P.east[v] + h) / d, r = (h - P.north[v]) / d;
      c = Math.min(N - 1, Math.max(0, c));
      r = Math.min(N - 1, Math.max(0, r));
      const c0 = Math.min(N - 2, Math.floor(c)), r0 = Math.min(N - 2, Math.floor(r));
      cell[v] = r0 * N + c0; wc[v] = c - c0; wr[v] = r - r0;
    }
    const polarSample = { cell, wc, wr };
    const xz = new Float32Array(N * N * 3), dist = new Float64Array(N * N), az = new Float64Array(N * N), idx = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const x = -h + c * d, z = -(h - r * d), k = r * N + c;
        xz[3 * k] = x; xz[3 * k + 2] = z;
        dist[k] = Math.hypot(x, z);
        az[k] = Math.atan2(x, -z) / DEG;
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
    fixWinding(xz, index);
    return { xz, dist, az, idx: index, polarSample };
  });
}

/**
 * Build all terrain objects.
 * @param patch    { meta, data: Float32Array } (C4) or null
 * @param horizon  C3-shaped profile (never null here; the caller supplies a flat or patch-derived one)
 * @param eyeH     observer eye height above the ground, m
 * @param detail   moving views only: detail.js driveDetail(...) plus its `anchor`; null = the eye-centred detail
 * The result's setGround({ patch, horizon, detail }) gives the same objects a new ground in place (new heights, normals
 * and skyline, no new meshes or materials) when the new patch has the same grid (size, spacing, extent), the skyline
 * the same number of azimuths and the detail the same kind; it returns false otherwise (then build a new terrain).
 */
export function buildTerrain({ patch, horizon, eyeH, seed = 1969, floatLinear = true, detail = null }) {
  const world = !!detail;
  const h = patch ? patch.meta.half_extent_m : 0, d = patch ? patch.meta.spacing_m : 0;
  // The polar mesh hands over to the patch grid where its cells reach about the grid spacing (detail.js nearSwitch).
  const rSwitch = patch ? Math.max(300, Math.min(0.5 * h, 60 * d)) : 2500;
  const P = polarLayout(seed, rSwitch);
  const G = patch ? gridLayout(patch.meta.grid_n, h, d, rSwitch, P) : null;

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
  if (world) {
    const v2 = (n) => Array.from({ length: n }, () => new THREE.Vector2());
    Object.assign(shared, {
      uNearPos: { value: new THREE.Vector3() }, uNearRot: { value: new THREE.Vector2(1, 0) },
      uMapAx: { value: new THREE.Vector2(1, 0) }, uMapAz: { value: new THREE.Vector2(0, -1) },
      uOct: { value: v2(9) }, uMot: { value: v2(3) }, uRockOff: { value: new THREE.Vector2() }, uRockOff2: { value: new THREE.Vector2() },
    });
  }
  const litMaterial = (defines = {}) => new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights), ...shared },
    vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, lights: true, defines: world ? { ...defines, WORLD_DETAIL: '' } : defines,
  });

  const near = new THREE.Group();
  const disposables = [heightTex];
  const meshGeometry = (xz, idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(xz.slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(xz.length), 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  };

  // --- Polar near mesh -------------------------------------------------------------------------------------------
  const polarGeom = meshGeometry(P.xz, P.idx);
  {
    const m = new THREE.Mesh(polarGeom, litMaterial());
    m.receiveShadow = true; m.castShadow = true; m.frustumCulled = false;
    near.add(m); disposables.push(polarGeom, m.material);
  }

  // --- Patch grid beyond the polar mesh --------------------------------------------------------------------------
  const gridGeom = G ? meshGeometry(G.xz, G.idx) : null;
  if (G) {
    const m = new THREE.Mesh(gridGeom, litMaterial());
    m.receiveShadow = true; m.frustumCulled = false;
    m.position.y = -0.15;   // tuck the coarse grid just under the fine mesh where they overlap
    near.add(m); disposables.push(gridGeom, m.material);
  }

  // --- Rocks (layout in polarLayout) ---------------------------------------------------------------------------------
  const smallRocks = [];   // the coarse-shape groups, sorted largest first, so drawing a prefix drops the smallest
  const rockMeshes = [];   // [{ mesh, list }]
  const worldRocks = [];   // moving view: [{ mesh, tint, keys, n, small }], one per rock shape
  if (world) {
    const rockMat = litMaterial({ ROCK: '' });
    disposables.push(rockMat);
    P.groups.forEach((grp, vI) => {
      const g = makeRockGeometry(seed + vI * 13, grp.detail), tint = new Float32Array(ROCK_CAP);
      const mesh = new THREE.InstancedMesh(g, rockMat, ROCK_CAP);
      g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.count = 0;
      near.add(mesh); disposables.push(g, mesh);
      worldRocks.push({ mesh, tint, keys: new Float32Array(ROCK_CAP), n: 0, small: grp.detail === 1 });
    });
  } else {
    const rockMat = litMaterial({ ROCK: '' });
    disposables.push(rockMat);
    P.groups.forEach((grp, vI) => {
      const list = grp.list;
      const g = makeRockGeometry(seed + vI * 13, grp.detail), tint = new Float32Array(list.length);
      const mesh = new THREE.InstancedMesh(g, rockMat, list.length);
      list.forEach((rk, i) => { mesh.setMatrixAt(i, rk.matrix); tint[i] = rk.tint; });
      g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      near.add(mesh); disposables.push(g, mesh);   // the mesh holds the GPU buffer of its instance matrices
      rockMeshes.push({ mesh, list });
      if (grp.detail === 1) smallRocks.push({ mesh, n: list.length });
    });
  }

  // --- Far-field skirt: top edge = the C3 profile ----------------------------------------------------------------
  const n = horizon.el_deg.length;
  const rIn = patch ? 0.9 * h : rSwitch;
  const skirtPos = new Float32Array(((n + 1) * 2 + 1) * 3), aT = new Float32Array((n + 1) * 2 + 1), idx = new Uint32Array(n * 9);
  for (let k = 0; k <= n; k++) aT[k * 2] = 1;
  const nadir = (n + 1) * 2;
  for (let k = 0; k < n; k++) {
    const t0 = 2 * k, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
    idx.set([t0, b0, t1, t1, b0, b1, b0, nadir, b1], k * 9);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(skirtPos, 3));
  sg.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  sg.setIndex(new THREE.BufferAttribute(idx, 1));
  const skirtMat = new THREE.ShaderMaterial({
    uniforms: shared, vertexShader: SKIRT_VERT, fragmentShader: SKIRT_FRAG, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
  });
  const skirt = new THREE.Mesh(sg, skirtMat);
  skirt.frustumCulled = false;
  disposables.push(sg, skirtMat);

  /**
   * Heights (three.js y, m) of the polar mesh, the grid, the rocks and the skirt for a patch and a skyline, and the
   * normals of the two meshes. Near-field vertices stay below the C3 profile (HORIZON_MARGIN), so the rendered
   * skyline is the profile itself.
   */
  function place(pt, hz, det = null) {
    const baseZ = pt ? (e, n) => samplePatch(pt, e, n) : (e, n) => -(e * e + n * n) / (2 * R_MOON_M);
    // Polar mesh: ground (patch + micro relief) at each vertex, clamped below the profile beyond 1 m from the eye.
    const pos = polarGeom.attributes.position.array, { radii, east, north } = P, lift = det ? det.lift : P.lift;
    const tanEl = new Float64Array(2 * AZ_NEAR);
    for (let k = 0; k < tanEl.length; k++) tanEl[k] = Math.tan(horizonElAt(hz, P.az[k]) * DEG - HORIZON_MARGIN);
    // With a patch, samplePatch with the cell and weights kept in the grid layout (same arithmetic).
    const S = pt ? G.polarSample : null, z = pt?.data, N = pt?.meta.grid_n;
    const ground = S
      ? (v) => {
        const k = S.cell[v], fc = S.wc[v], fr = S.wr[v];
        return (z[k] * (1 - fc) + z[k + 1] * fc) * (1 - fr) + (z[k + N] * (1 - fc) + z[k + N + 1] * fc) * fr;
      }
      : (v) => baseZ(east[v], north[v]);
    pos[1] = ground(0) + lift[0] - eyeH;
    let v = 1;
    for (let j = 0; j < radii.length; j++) {
      const r = radii[j], off = (j & 1) * AZ_NEAR, clamp = r >= 1;
      for (let i = 0; i < AZ_NEAR; i++, v++) {
        const y = ground(v) + lift[v] - eyeH;
        pos[3 * v + 1] = clamp ? Math.min(y, r * tanEl[off + i]) : y;
      }
    }
    vertexNormals(pos, P.idx, polarGeom.attributes.normal.array);
    // Patch grid: the patch values themselves.
    if (G) {
      const gp = gridGeom.attributes.position.array, data = pt.data;
      for (let k = 0, nk = G.dist.length; k < nk; k++) {
        const y = data[k] - eyeH, r = G.dist[k];
        gp[3 * k + 1] = r < 1 ? y : Math.min(y, r * Math.tan(horizonElAt(hz, G.az[k]) * DEG - HORIZON_MARGIN));
      }
      vertexNormals(gp, G.idx, gridGeom.attributes.normal.array);
    }
    // Rocks: on the ground, a little sunk in.
    if (det) placeWorldRocks(baseZ, det);
    for (const { mesh, list } of rockMeshes) {
      const m = mesh.instanceMatrix.array;
      for (let i = 0; i < list.length; i++) {
        const rk = list[i];
        m[16 * i + 13] = baseZ(rk.e, rk.n) + rk.lift - eyeH + 0.12 * rk.sy;
      }
    }
    // Skirt: top vertex on the skyline, placed at the distance of the terrain that sets it (capped inside the far
    // plane: only the direction matters); bottom vertex under the near field.
    const step = hz.az_step_deg;
    for (let k = 0; k <= n; k++) {
      const a = (k % n) * step * DEG, el = hz.el_deg[k % n] * DEG, sa = Math.sin(a), ca = Math.cos(a);
      const Dg = Math.max(50, (hz.dist_km?.[k % n] || 0) * 1000), D = Dg * Math.min(1, (60000 * Math.cos(el)) / Dg);
      const yNat = baseZ(rIn * sa, rIn * ca) - eyeH;
      const yB = Math.min(yNat, rIn * Math.tan(el - 1.5 * DEG));
      skirtPos.set([D * sa, D * Math.tan(el), -D * ca], k * 6);
      skirtPos.set([rIn * sa, yB, -rIn * ca], k * 6 + 3);
    }
    skirtPos.set([0, -5000, 0], nadir * 3);
  }

  // --- Moving view: world-anchored rocks, the map frame of the shader detail, the eye --------------------------------
  const dummy = new THREE.Object3D();
  let rockShare = 1;   // setRockDetail: share of the small rocks drawn (by their stable key, so none flickers)
  function placeWorldRocks(baseZ, det) {
    const R = det.rocks, lists = worldRocks.map(() => []);
    for (let k = 0; k < det.nRocks; k++) lists[R[k * ROCK_STRIDE + 10]].push(k * ROCK_STRIDE);
    lists.forEach((list, vI) => {
      const wr = worldRocks[vI];
      list.sort((a, b) => R[a + 11] - R[b + 11]);
      wr.n = Math.min(list.length, ROCK_CAP);
      for (let i = 0; i < wr.n; i++) {
        const o = list[i], e = R[o], nn = R[o + 1];
        dummy.position.set(e, baseZ(e, nn) + R[o + 2] - eyeH + 0.12 * R[o + 7], -nn);
        dummy.rotation.set(R[o + 3], R[o + 4], R[o + 5]);
        dummy.scale.set(R[o + 6], R[o + 7], R[o + 8]);
        dummy.updateMatrix();
        wr.mesh.setMatrixAt(i, dummy.matrix);
        wr.tint[i] = R[o + 9];
        wr.keys[i] = R[o + 11];
      }
      wr.mesh.instanceMatrix.needsUpdate = true;
      wr.mesh.geometry.attributes.aTint.needsUpdate = true;
    });
    applyRockShare();
  }
  function applyRockShare() {
    for (const wr of worldRocks) {
      let c = wr.n;
      if (wr.small && rockShare < 1) {
        let lo = 0, hi = wr.n;   // keys ascending: count those below the share
        while (lo < hi) { const mid = (lo + hi) >> 1; if (wr.keys[mid] < rockShare) lo = mid + 1; else hi = mid; }
        c = lo;
      }
      wr.mesh.count = c;
      wr.mesh.visible = c > 0;
    }
  }
  /** The shader's map frame (shaders.js WORLD_GLSL) at the ground point of a drive's detail. */
  function setMapFrame(anchor) {
    const md = (x) => ((x % NOISE_PERIOD) + NOISE_PERIOD) % NOISE_PERIOD;
    shared.uMapAx.value.set(anchor.ax[0], anchor.ax[1]);
    shared.uMapAz.value.set(-anchor.an[0], -anchor.an[1]);   // the near field's z axis points south
    let lam = Math.fround(0.035);   // the shader's octave wavelengths, in its float precision
    for (let i = 0; i < 9; i++) {
      shared.uOct.value[i].set(md(anchor.x0 / lam + 19.7 * i), md(anchor.y0 / lam + 19.7 * i));
      lam = Math.fround(lam * Math.fround(3.1));
    }
    [[1, 0], [2.03, 17.1], [4.01, 41.7]].forEach(([k, o], i) => shared.uMot.value[i].set(md((anchor.x0 / 900) * k + o), md((anchor.y0 / 900) * k + o)));
    shared.uRockOff.value.set(md(anchor.x0 * 9), md(anchor.y0 * 9));
    shared.uRockOff2.value.set(md(anchor.x0 * 9 * 4.3), md(anchor.y0 * 9 * 4.3));
  }

  place(patch, horizon, detail);
  if (world) setMapFrame(detail.anchor);

  /** New ground of the same grid, in place (see above); false when it needs a new terrain. */
  function setGround({ patch: pt, horizon: hz, detail: det = null }) {
    const m = pt?.meta;
    if (!patch || !m || m.grid_n !== patch.meta.grid_n || m.spacing_m !== d || m.half_extent_m !== h || hz?.el_deg?.length !== n) return false;
    if (world !== !!det) return false;
    place(pt, hz, det);
    if (det) setMapFrame(det.anchor);
    heightTex.image.data = pt.data;
    heightTex.needsUpdate = true;
    for (const g of [polarGeom, gridGeom]) {
      g.attributes.position.needsUpdate = true;
      g.attributes.normal.needsUpdate = true;
    }
    for (const { mesh } of rockMeshes) mesh.instanceMatrix.needsUpdate = true;
    sg.attributes.position.needsUpdate = true;
    patch = pt;
    return true;
  }

  /**
   * Moving view: put the eye at local (east, north) m from the ground point the near field was built at, on the
   * ground there (patch height + eye height), and turn the near field and the skyline by turn_deg (the change of
   * azimuth of a fixed direction from the ground point's frame to the eye's: az_eye = az_ground + turn_deg).
   */
  function setEye({ east = 0, north = 0, turn_deg = 0 } = {}) {
    if (!world) return;
    const ez = patch ? samplePatch(patch, east, north) : -(east * east + north * north) / (2 * R_MOON_M);
    const phi = -turn_deg * DEG, c = Math.cos(phi), s = Math.sin(phi);
    near.rotation.set(0, phi, 0);
    near.position.set(-(c * east - s * north), -ez, -(-s * east - c * north));   // −R(φ)·(east, ez, −north)
    skirt.rotation.set(0, phi, 0);
    shared.uNearPos.value.copy(near.position);
    shared.uNearRot.value.set(c, s);
  }

  /** Draw only this fraction (0..1) of the small rocks (the apparently smallest ones are left out first). */
  const setRockDetail = (f) => {
    if (world) {
      rockShare = Math.min(1, Math.max(0, f));
      return applyRockShare();
    }
    let keep = Math.round(smallRocks.reduce((s, r) => s + r.n, 0) * Math.min(1, Math.max(0, f)));
    for (const r of smallRocks) {
      r.mesh.count = Math.min(r.n, keep);
      r.mesh.visible = r.mesh.count > 0;
      keep -= r.mesh.count;
    }
  };
  return { near, skirt, uniforms: shared, rSwitch, setRockDetail, setGround, setEye, world, dispose: () => disposables.forEach((x) => x.dispose()) };
}
