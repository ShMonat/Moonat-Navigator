// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// Celestial objects of the sky view: stars, constellation lines, planets, the Sun and the Earth.
// Everything is placed on its true direction from the eye (the origin) at a nominal render distance; angular sizes
// are exact. Distances are ordered Earth < Sun < planets < stars so the depth test gives eclipses and occultations:
// the opaque Earth (drawn first, renderOrder -1) hides the part of the Sun's disk and glow behind it. During an eclipse
// an overlay at the Earth adds the refraction ring and the "diamond" (sky state sun.eclipse_frac, C6).

import * as THREE from 'three';
import { DEG, M_ZUP_TO_YUP, mat3Vec, lonLatToVec, enuToThree, yupRotationFromZup, earthBodyToEnu, bvToRgb } from './math.js';
import { STAR_VERT, STAR_FRAG, EARTH_VERT, EARTH_FRAG, SUN_VERT, SUN_FRAG, ECLIPSE_VERT, ECLIPSE_FRAG } from './shaders.js';

export const D_EARTH = 20000, D_SUN = 30000, D_PLANET = 40000, D_STAR = 50000;
const SUN_QUAD_RADII = 46;   // half-size of the Sun quad in solar radii (about 12 deg)

/**
 * Eclipse drawing parameters from a C6 sky state (pure; exported for tests).
 * Returns null without an eclipse, else { visible: visible share of the Sun's flux (0..1),
 * glowOffset: offset (in solar radii, toward the Sun's centre as seen from the Earth's centre) of the centroid of the
 * visible crescent, ring: 0..1 strength of the refraction ring, bead: 0..1 strength of the diamond's point-spread
 * function }. The centroid offset 1 − f^0.8 (f = uncovered share) is 0 for an uncovered Sun, 0.43 for a half-covered
 * one (straight-edge half disk: 4/3π = 0.42) and 1 (the limb) for a vanishing sliver.
 */
export function eclipseLook(s) {
  const ecl = s?.sun?.eclipse_frac ?? 0;
  if (!(ecl > 0)) return null;
  const f = 1 - ecl;
  return {
    visible: Math.max(0, Math.min(1, s.sun.vis_frac ?? 1)) * f,
    glowOffset: 1 - Math.pow(f, 0.8),
    ring: ecl,
    // A sliver below ~5 % of the flux reads as a point: fade the bead in as the crescent thins, out at totality.
    bead: f > 0 ? Math.min(1, f * 400) * (1 - smoothstep(0.02, 0.12, f)) : 0,
  };
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const PLANET_STYLE = {
  mercury: { color: [0.75, 0.72, 0.68], mag: 0.0 }, venus: { color: [1.0, 0.97, 0.85], mag: -4.2 },
  mars: { color: [1.0, 0.55, 0.35], mag: -0.5 }, jupiter: { color: [1.0, 0.93, 0.8], mag: -2.3 },
  saturn: { color: [0.95, 0.87, 0.65], mag: 0.4 },
};

function setRotation(obj, m) {   // m: row-major 3×3 rotation in the three.js frame
  obj.matrixAutoUpdate = false;
  obj.matrix.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
  obj.matrixWorldNeedsUpdate = true;
}

/** Accepts { stars: [...] } with rows as objects {ra_deg, dec_deg, vmag, bv} or arrays ordered by `fields`. */
export function parseStars(json) {
  if (!json) return [];
  const rows = Array.isArray(json) ? json : json.stars || [];
  const f = json.fields || ['ra_deg', 'dec_deg', 'vmag', 'bv'];
  const ix = { ra: f.indexOf('ra_deg'), dec: f.indexOf('dec_deg'), v: f.indexOf('vmag'), bv: f.indexOf('bv') };
  return rows.map((s) => (Array.isArray(s)
    ? { ra_deg: s[ix.ra], dec_deg: s[ix.dec], vmag: s[ix.v], bv: s[ix.bv] }
    : s)).filter((s) => Number.isFinite(s.ra_deg) && Number.isFinite(s.dec_deg) && Number.isFinite(s.vmag));
}

/** Collects every polyline of [ra_deg, dec_deg] points found anywhere in the constellation JSON. */
export function parseConstellationLines(json) {
  const out = [];
  const isPt = (p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number';
  const walk = (x) => {
    if (Array.isArray(x)) {
      if (x.length >= 2 && x.every(isPt)) out.push(x);
      else x.forEach(walk);
    } else if (x && typeof x === 'object') {
      for (const k of Object.keys(x)) if (k !== 'stars') walk(x[k]);
    }
  };
  walk(json);
  return out;
}

export function buildSky({ starsJson, constellationsJson, earthTexture, nightTexture }) {
  const group = new THREE.Group();        // rotates with the celestial sphere (ICRS -> three)
  const fixed = new THREE.Group();        // objects positioned directly in the three.js frame
  const disposables = [];

  // --- Stars -----------------------------------------------------------------------------------------------------
  const stars = parseStars(starsJson);
  const starUniforms = { uPx: { value: 1 }, uDim: { value: 1 }, uMagRef: { value: 2.6 } };
  const pointsMaterial = () => new THREE.ShaderMaterial({
    uniforms: starUniforms, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  if (stars.length) {
    const pos = new Float32Array(stars.length * 3), mag = new Float32Array(stars.length), col = new Float32Array(stars.length * 3);
    stars.forEach((s, i) => {
      const v = mat3Vec(M_ZUP_TO_YUP, lonLatToVec(s.ra_deg, s.dec_deg));
      pos.set([v[0] * D_STAR, v[1] * D_STAR, v[2] * D_STAR], i * 3);
      mag[i] = s.vmag;
      col.set(bvToRgb(s.bv), i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const m = pointsMaterial(), p = new THREE.Points(g, m);
    p.frustumCulled = false;
    group.add(p); disposables.push(g, m);
  }

  // --- Constellation lines ---------------------------------------------------------------------------------------
  let constellations = null;
  const lines = parseConstellationLines(constellationsJson);
  if (lines.length) {
    const seg = [];
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        for (const pt of [line[i], line[i + 1]]) {
          const v = mat3Vec(M_ZUP_TO_YUP, lonLatToVec(pt[0], pt[1]));
          seg.push(v[0] * D_STAR, v[1] * D_STAR, v[2] * D_STAR);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    const m = new THREE.LineBasicMaterial({ color: 0x5b84c4, transparent: true, opacity: 0.3, depthWrite: false });
    constellations = new THREE.LineSegments(g, m);
    constellations.frustumCulled = false;
    group.add(constellations); disposables.push(g, m);
  }

  // --- Planets (up to 8 points, positions set on update) ---------------------------------------------------------
  const MAXP = 8, pPos = new Float32Array(MAXP * 3), pMag = new Float32Array(MAXP).fill(99), pCol = new Float32Array(MAXP * 3);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pg.setAttribute('aMag', new THREE.BufferAttribute(pMag, 1));
  pg.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3));
  const pm = pointsMaterial(), planetPoints = new THREE.Points(pg, pm);
  planetPoints.frustumCulled = false;
  fixed.add(planetPoints); disposables.push(pg, pm);

  // --- Earth -----------------------------------------------------------------------------------------------------
  const earthUniforms = {
    uDay: { value: earthTexture }, uNight: { value: nightTexture }, uHasDay: { value: earthTexture ? 1 : 0 },
    uHasNight: { value: nightTexture ? 1 : 0 }, uSunDirE: { value: new THREE.Vector3(1, 0, 0) }, uExposure: { value: 1.5 },
    uNightGain: { value: 1 },
  };
  const eg = new THREE.SphereGeometry(1, 96, 48);
  const em = new THREE.ShaderMaterial({ uniforms: earthUniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG });
  const earth = new THREE.Mesh(eg, em);
  earth.frustumCulled = false; earth.renderOrder = -1;
  fixed.add(earth); disposables.push(eg, em);

  // --- Sun -------------------------------------------------------------------------------------------------------
  const sunUniforms = {
    uDist: { value: D_SUN }, uRad: { value: 0.0046 }, uPixAng: { value: 0.0008 }, uVis: { value: 1 }, uHalf: { value: 1 },
    uGlowOff: { value: new THREE.Vector2(0, 0) },
  };
  const sg = new THREE.PlaneGeometry(2, 2);
  const sm = new THREE.ShaderMaterial({
    uniforms: sunUniforms, vertexShader: SUN_VERT, fragmentShader: SUN_FRAG,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const sun = new THREE.Mesh(sg, sm);
  sun.frustumCulled = false; sun.renderOrder = 5;
  fixed.add(sun); disposables.push(sg, sm);

  // --- Eclipse overlay (refraction ring and diamond), drawn over the Earth without a depth test ------------------
  const eclUniforms = {
    uDist: { value: D_EARTH }, uHalf: { value: 1 }, uRadE: { value: 0.016 }, uRadS: { value: 0.0046 }, uPixAng: { value: 0.0008 },
    uRing: { value: 0 }, uBead: { value: 0 }, uSunP: { value: new THREE.Vector2() }, uBeadP: { value: new THREE.Vector2() },
  };
  const xg = new THREE.PlaneGeometry(2, 2);
  const xm = new THREE.ShaderMaterial({
    uniforms: eclUniforms, vertexShader: ECLIPSE_VERT, fragmentShader: ECLIPSE_FRAG,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false,
  });
  const eclipse = new THREE.Mesh(xg, xm);
  eclipse.frustumCulled = false; eclipse.renderOrder = 6; eclipse.visible = false;
  fixed.add(eclipse); disposables.push(xg, xm);
  const ax = new THREE.Vector3(), ay = new THREE.Vector3(), dv = new THREE.Vector3();
  // Offset (rad) of unit direction `to` from unit direction `from`, in the plane of a camera-facing quad.
  const planeOffset = (quad, from, to, out) => {
    ax.set(1, 0, 0).applyQuaternion(quad.quaternion);
    ay.set(0, 1, 0).applyQuaternion(quad.quaternion);
    dv.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    return out.set(dv.dot(ax), dv.dot(ay));
  };

  // Exposure: "eye" keeps the stars (dimmed) while the Sun is up, for orientation; "camera" is exposed for the sunlit
  // ground, so stars vanish whenever any of the Sun is visible, as in Apollo photographs.
  let exposureMode = 'eye', sunVis = 0;
  const applyExposure = () => {
    const dim = 1 - (exposureMode === 'camera' ? 1 : 0.7) * Math.min(1, sunVis * 4);
    starUniforms.uDim.value = dim;
    if (constellations) constellations.material.opacity = 0.3 * dim;
  };

  function update(s) {
    setRotation(group, yupRotationFromZup(s.r_icrs_to_enu));

    // Earth: unit sphere scaled to its true angular radius at the render distance; body frame = R·Rz(era).
    const rot = yupRotationFromZup(earthBodyToEnu(s.r_icrs_to_enu, s.earth.era_deg));
    const R = D_EARTH * Math.sin(s.earth.ang_radius_deg * DEG), c = enuToThree(s.earth.enu);
    earth.matrixAutoUpdate = false;
    earth.matrix.set(
      rot[0] * R, rot[1] * R, rot[2] * R, c[0] * D_EARTH,
      rot[3] * R, rot[4] * R, rot[5] * R, c[1] * D_EARTH,
      rot[6] * R, rot[7] * R, rot[8] * R, c[2] * D_EARTH,
      0, 0, 0, 1);
    earth.matrixWorldNeedsUpdate = true;
    earthUniforms.uSunDirE.value.fromArray(enuToThree(s.earth.sun_dir_enu)).normalize();

    // Sun quad: faces the eye, sized to hold the glow.
    const sd = enuToThree(s.sun.enu), rad = s.sun.ang_radius_deg * DEG, half = D_SUN * Math.tan(rad * SUN_QUAD_RADII);
    sun.position.set(sd[0] * D_SUN, sd[1] * D_SUN, sd[2] * D_SUN);
    sun.scale.set(half, half, 1);
    sun.lookAt(0, 0, 0);
    sunUniforms.uRad.value = rad; sunUniforms.uHalf.value = half;
    sunUniforms.uVis.value = s.sun.vis_frac ?? 1;
    sunUniforms.uGlowOff.value.set(0, 0);
    earthUniforms.uNightGain.value = 1;

    // Eclipse: glare follows the visible flux and centres on the visible crescent; ring and diamond at the Earth.
    const look = eclipseLook(s);
    eclipse.visible = !!look;
    if (look) {
      const ed = enuToThree(s.earth.enu), rE = s.earth.ang_radius_deg * DEG;
      sunUniforms.uVis.value = look.visible;
      const toward = planeOffset(sun, ed, sd, new THREE.Vector2());   // Earth centre -> Sun centre (rad)
      const sep = toward.length();
      if (sep > 1e-9) sunUniforms.uGlowOff.value.copy(toward).multiplyScalar((look.glowOffset * rad * D_SUN) / sep);
      eclipse.position.set(ed[0] * D_EARTH, ed[1] * D_EARTH, ed[2] * D_EARTH);
      const halfE = D_EARTH * Math.tan(rE + 14 * rad);
      eclipse.scale.set(halfE, halfE, 1);
      eclipse.lookAt(0, 0, 0);
      eclipse.updateMatrixWorld();
      const sunP = planeOffset(eclipse, ed, sd, eclUniforms.uSunP.value);
      const n = sunP.length() || 1;
      eclUniforms.uBeadP.value.copy(sunP).multiplyScalar((n + look.glowOffset * rad) / n);
      eclUniforms.uHalf.value = halfE; eclUniforms.uRadE.value = rE; eclUniforms.uRadS.value = rad;
      eclUniforms.uRing.value = look.ring; eclUniforms.uBead.value = look.bead * Math.min(1, s.sun.vis_frac ?? 1);
      // City lights on the night side: lost in the glare during the partial phases, faint near totality.
      earthUniforms.uNightGain.value = 0.15 * Math.pow(look.ring, 8) * (1 - 0.8 * look.bead);
    }

    // Planets.
    pMag.fill(99);
    (s.planets || []).slice(0, MAXP).forEach((p, i) => {
      const v = enuToThree(p.enu), st = PLANET_STYLE[p.name] || { color: [1, 1, 1], mag: 1 };
      pPos.set([v[0] * D_PLANET, v[1] * D_PLANET, v[2] * D_PLANET], i * 3);
      pMag[i] = st.mag; pCol.set(st.color, i * 3);
    });
    pg.attributes.position.needsUpdate = pg.attributes.aMag.needsUpdate = pg.attributes.aColor.needsUpdate = true;

    // With the Sun up, the eye and any camera are stopped down: dim the stars (they stay visible for orientation).
    // During an eclipse this follows the visible flux, so the stars come out as totality nears.
    sunVis = look ? look.visible : Math.min(1, s.sun.vis_frac ?? 0);
    applyExposure();
  }

  return {
    group, fixed, update, starCount: stars.length, hasConstellations: !!constellations,
    setConstellations: (on) => { if (constellations) constellations.visible = on; },
    setExposureMode: (mode) => { exposureMode = mode === 'camera' ? 'camera' : 'eye'; applyExposure(); },
    setPixelScale: (pxRatio, pixAngRad) => {
      starUniforms.uPx.value = pxRatio; sunUniforms.uPixAng.value = pixAngRad; eclUniforms.uPixAng.value = pixAngRad;
    },
    dispose: () => disposables.forEach((x) => x.dispose()),
  };
}
