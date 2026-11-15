// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// GLSL sources for the sky view. All lighting is computed in linear RGB in the three.js world frame
// (x = east, y = up, z = -north; eye at the origin; metres), then tone-mapped with a simple exposure curve.

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// Value noise with analytic derivatives: x = value 0..1, yz = d/dp.
vec3 noised(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*f*(f*(f*6.-15.)+10.), du = 30.*f*f*(f*(f-2.)+1.);
  float a = hash12(i), b = hash12(i+vec2(1,0)), c = hash12(i+vec2(0,1)), d = hash12(i+vec2(1,1));
  float k1 = b-a, k2 = c-a, k4 = a-b-c+d;
  return vec3(a + k1*u.x + k2*u.y + k4*u.x*u.y, du*(vec2(k1,k2) + k4*u.yx));
}
float fbm3(vec2 p){ return (noised(p).x + 0.5*noised(p*2.03+17.1).x + 0.25*noised(p*4.01+41.7).x) / 1.75; }
`;

// Shared lunar surface lighting. No atmosphere: direct sunlight, pitch-black shadows, a faint earthshine fill.
export const LUNAR_GLSL = /* glsl */ `
uniform vec3 uSunDir;        // unit, world, toward the Sun
uniform float uSunRad;       // angular radius of the Sun, rad
uniform float uSunVis;       // 0..1 visible fraction of the Sun's disk above the far horizon (beyond the patch)
uniform vec3 uEarthDir;      // unit, world, toward the Earth
uniform vec3 uEarthShine;    // linear RGB irradiance scale of earthshine (already includes phase and visibility)
uniform float uExposure;
uniform sampler2D uHeightTex; // C4 patch heights z_up (m), row 0 = north edge
uniform float uPatchHalf, uPatchN, uHasPatch, uEyeH, uStep0;

// Lunar regolith reflectance: Lommel-Seeliger / Lambert blend with a phase function and an opposition surge.
// n = normal, v = toward the viewer, l = toward the light; returns a radiance factor (1 = normal albedo, overhead).
float regolith(vec3 n, vec3 v, vec3 l){
  float mu0 = max(dot(n, l), 0.0), mu = max(dot(n, v), 0.0);
  float ls = 2.0 * mu0 / (mu0 + mu + 1e-3);
  float g = acos(clamp(dot(l, v), -1.0, 1.0));
  // Lunar phase function: steep fall-off with phase angle g plus a narrow opposition surge (shadow hiding), so the
  // ground is brightest looking down-Sun and dark looking up-Sun, as in Apollo surface photographs.
  float phase = 0.10 + 0.90 * exp(-1.25 * g) + 0.55 * exp(-g / 0.11);
  return mix(mu0, min(ls, 1.6), 0.6) * phase * smoothstep(0.0, 0.03, mu0);
}

float patchY(vec2 xz){
  vec2 uv = (xz + uPatchHalf) / (2.0 * uPatchHalf);
  uv = uv * (uPatchN - 1.0) / uPatchN + 0.5 / uPatchN;
  return texture2D(uHeightTex, uv).r - uEyeH;
}

// Fraction of the Sun's disk visible from world point P over the heightfield (soft penumbra of the true solar size).
float terrainShadow(vec3 P){
  if (uSunDir.y <= -uSunRad) return 0.0;
  if (uHasPatch < 0.5) return 1.0;
  vec2 dh = uSunDir.xz; float hl = length(dh);
  if (hl < 1e-4) return 1.0;
  dh /= hl; float slope = uSunDir.y / hl;
  float y0 = max(P.y, patchY(P.xz));
  float s = 1.0, t = uStep0;
  for (int i = 0; i < 44; i++) {
    vec2 q = P.xz + dh * t;
    if (abs(q.x) > uPatchHalf || abs(q.y) > uPatchHalf) break;
    float clearance = slope + (y0 - patchY(q)) / t;
    s = min(s, smoothstep(-uSunRad, uSunRad, clearance + 0.004));
    if (s <= 0.0) break;
    t *= 1.14;
  }
  return s;
}

vec3 toneMap(vec3 c){ return vec3(1.0) - exp(-c * uExposure); }
`;

// World-anchored detail for a moving view (terrain.js with a drive's detail, define WORLD_DETAIL): the near field is
// built around a ground point and moved and turned every frame so the eye is at the rover; the fine ground texture and
// the rock texture are taken in the trip's map frame, and the heightfield shadows in the near field's own frame.
// The map origin enters per octave reduced modulo the hash period, so the inputs stay small (float precision).
export const WORLD_GLSL = /* glsl */ `
uniform vec3 uNearPos;            // position of the near field in the world (eye at the origin)
uniform vec2 uNearRot;            // (cos, sin) of its turn about the vertical
uniform vec2 uMapAx, uMapAz;      // map metres per metre along the near field's x and z axes
uniform vec2 uOct[9];             // per detail octave: map origin / wavelength + offset, modulo the hash period
uniform vec2 uMot[3];             // the same for the three octaves of the large albedo mottling
uniform vec2 uRockOff, uRockOff2; // the same for the two rock texture octaves
float hashW(vec2 p){ return hash12(mod(p, 4096.0)); }
vec3 noisedW(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*f*(f*(f*6.-15.)+10.), du = 30.*f*f*(f*(f-2.)+1.);
  float a = hashW(i), b = hashW(i+vec2(1,0)), c = hashW(i+vec2(0,1)), d = hashW(i+vec2(1,1));
  float k1 = b-a, k2 = c-a, k4 = a-b-c+d;
  return vec3(a + k1*u.x + k2*u.y + k4*u.x*u.y, du*(vec2(k1,k2) + k4*u.yx));
}
vec3 nearLocal(vec3 w){ vec3 d = w - uNearPos; return vec3(uNearRot.x*d.x - uNearRot.y*d.z, d.y, uNearRot.y*d.x + uNearRot.x*d.z); }
vec2 nearToWorld(vec2 l){ return vec2(uNearRot.x*l.x + uNearRot.y*l.y, -uNearRot.y*l.x + uNearRot.x*l.y); }
// A gradient taken in map coordinates, as a world (x, z) gradient.
vec2 mapGradToWorld(vec2 g){ return nearToWorld(vec2(dot(g, uMapAx), dot(g, uMapAz))); }
// terrainShadow in the near field's frame: P and the Sun's direction sd both in that frame.
float terrainShadowNear(vec3 P, vec3 sd){
  if (sd.y <= -uSunRad) return 0.0;
  if (uHasPatch < 0.5) return 1.0;
  vec2 dh = sd.xz; float hl = length(dh);
  if (hl < 1e-4) return 1.0;
  dh /= hl; float slope = sd.y / hl;
  float y0 = max(P.y, patchY(P.xz));
  float s = 1.0, t = uStep0;
  for (int i = 0; i < 44; i++) {
    vec2 q = P.xz + dh * t;
    if (abs(q.x) > uPatchHalf || abs(q.y) > uPatchHalf) break;
    float clearance = slope + (y0 - patchY(q)) / t;
    s = min(s, smoothstep(-uSunRad, uSunRad, clearance + 0.004));
    if (s <= 0.0) break;
    t *= 1.14;
  }
  return s;
}
`;

export const TERRAIN_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
#ifdef ROCK
attribute float aTint;
varying float vTint;
#endif
#if defined(ROCK) && defined(WORLD_DETAIL)
varying float vRockY;
#endif
varying vec3 vWorld;
varying vec3 vNormalW;
void main(){
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vWorld = wp.xyz;
  vNormalW = inverseTransformDirection(transformedNormal, viewMatrix);
  #ifdef ROCK
  vTint = aTint;
  #endif
  #if defined(ROCK) && defined(WORLD_DETAIL)
  vRockY = (instanceMatrix * vec4(transformed, 0.0)).y;   // height above the rock's centre (m)
  #endif
}
`;

export const TERRAIN_FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
${NOISE_GLSL}
${LUNAR_GLSL}
#ifdef WORLD_DETAIL
${WORLD_GLSL}
#endif
#ifdef ROCK
varying float vTint;
#endif
#if defined(ROCK) && defined(WORLD_DETAIL)
varying float vRockY;
#endif
varying vec3 vWorld;
varying vec3 vNormalW;
void main(){
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(-vWorld);
  vec2 p = vWorld.xz;
  float alb = 0.0;
  #ifdef WORLD_DETAIL
  vec3 L = nearLocal(vWorld);
  vec2 m = uMapAx * L.x + uMapAz * L.z;   // map metres from the near field's ground point
  #endif
  #if defined(ROCK) && defined(WORLD_DETAIL)
    vec2 pr = m * 9.0 + vRockY * 5.0;
    vec3 nz = noisedW(pr + uRockOff);
    alb = (nz.x - 0.5) * 0.35 + (noisedW(pr * 4.3 + uRockOff2).x - 0.5) * 0.2;
    vec2 gw = mapGradToWorld(nz.yz);
    n = normalize(n + 0.18 * vec3(gw.x, 0.0, gw.y));
    vec3 base = vec3(0.40, 0.39, 0.375) * vTint;
  #elif defined(ROCK)
    vec2 pr = p * 9.0 + vWorld.y * 5.0;
    vec3 nz = noised(pr);
    alb = (nz.x - 0.5) * 0.35 + (noised(pr * 4.3).x - 0.5) * 0.2;
    n = normalize(n + 0.18 * vec3(nz.y, 0.0, nz.z));
    vec3 base = vec3(0.40, 0.39, 0.375) * vTint;
  #elif defined(WORLD_DETAIL)
    float fp = max(length(dFdx(m)), length(dFdy(m)));
    vec2 grad = vec2(0.0);
    float lam = 0.035;
    for (int i = 0; i < 9; i++) {
      float w = 1.0 - smoothstep(0.3 * lam, 0.8 * lam, fp);
      if (w > 0.0) {
        vec3 nz = noisedW(m / lam + uOct[i]);
        float rough = i < 5 ? 0.075 : 0.04;
        grad += w * rough * nz.yz;
        alb += w * (nz.x - 0.5) * (i < 3 ? 0.10 : 0.07);
      }
      lam *= 3.1;
    }
    vec2 gw = mapGradToWorld(grad);
    n = normalize(vec3(n.x - gw.x, n.y, n.z - gw.y));
    vec2 mm = m / 900.0;
    alb += ((noisedW(mm + uMot[0]).x + 0.5 * noisedW(mm * 2.03 + uMot[1]).x + 0.25 * noisedW(mm * 4.01 + uMot[2]).x) / 1.75 - 0.5) * 0.22;
    vec3 base = vec3(0.40, 0.385, 0.36);
  #else
    // Band-limited fractal detail: each octave fades out as the pixel footprint approaches its wavelength.
    float fp = max(length(dFdx(p)), length(dFdy(p)));
    vec2 grad = vec2(0.0);
    float lam = 0.035;
    for (int i = 0; i < 9; i++) {
      float w = 1.0 - smoothstep(0.3 * lam, 0.8 * lam, fp);
      if (w > 0.0) {
        vec3 nz = noised(p / lam + float(i) * 19.7);
        float rough = i < 5 ? 0.075 : 0.04;   // fine regolith grain is rough; long waves are gentle (the mesh carries them)
        grad += w * rough * nz.yz;
        alb += w * (nz.x - 0.5) * (i < 3 ? 0.10 : 0.07);
      }
      lam *= 3.1;
    }
    n = normalize(vec3(n.x - grad.x, n.y, n.z - grad.y));
    // Large-scale albedo mottling (never filtered out).
    alb += (fbm3(p / 900.0) - 0.5) * 0.22;
    vec3 base = vec3(0.40, 0.385, 0.36);
  #endif
  vec3 albedo = base * (1.0 + alb);
  #ifdef WORLD_DETAIL
  vec3 sunL = vec3(uNearRot.x * uSunDir.x - uNearRot.y * uSunDir.z, uSunDir.y, uNearRot.y * uSunDir.x + uNearRot.x * uSunDir.z);
  float shadow = getShadowMask() * terrainShadowNear(L, sunL) * uSunVis;
  #else
  float shadow = getShadowMask() * terrainShadow(vWorld) * uSunVis;
  #endif
  vec3 col = albedo * vec3(1.0, 0.985, 0.96) * 1.3 * regolith(n, v, uSunDir) * shadow;
  col += albedo * uEarthShine * max(dot(n, uEarthDir), 0.0);
  gl_FragColor = vec4(toneMap(col), 1.0);
  #include <colorspace_fragment>
}
`;

// Far field: a skirt from below the horizon up to the C3 skyline. Only the skyline shape is data; the shading is a
// plausible stand-in (slopes facing the observer) lit consistently with the near field.
export const SKIRT_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aT;
varying float vT;
varying vec3 vDir;
void main(){
  vT = aT;
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const SKIRT_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
${LUNAR_GLSL}
uniform float uSunUp;   // 0..1: the Sun is above the mean horizon, so distant high ground is lit
varying float vT;
varying vec3 vDir;
void main(){
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDir);
  vec2 hd = normalize(d.xz + 1e-6);
  float t = clamp(vT, 0.0, 1.0);
  // Seam-free noise coordinates on the azimuth circle; elevation stretches features into ridge lines.
  vec2 q = hd * 23.0 + vec2(0.0, d.y * 160.0);
  float n1 = fbm3(q), n2 = fbm3(q * 3.7 + 9.0), n3 = fbm3(hd * 9.0 + vec2(5.0, d.y * 40.0));
  // Distant hills: slopes of 5-28 deg whose downhill direction swings widely around "toward the observer", so the
  // Sun's direction decides which flanks are bright and which are in shade.
  float slope = radians(mix(5.0, 28.0, clamp(t * 0.6 + 0.6 * n1, 0.0, 1.0)));
  float swing = (n3 - 0.5) * 4.4 + (n2 - 0.5) * 1.2;
  vec3 toward = vec3(-hd.x, 0.0, -hd.y);
  vec3 side = vec3(-toward.z, 0.0, toward.x);
  vec3 n = normalize(vec3(0.0, cos(slope), 0.0) + (toward * cos(swing) + side * sin(swing)) * sin(slope));
  vec3 albedo = vec3(0.40, 0.385, 0.36) * (0.85 + 0.35 * (n2 - 0.5));
  // With a low Sun, flanks tilted away from it fall into shadow.
  float lit = smoothstep(-0.03, 0.05, dot(n, uSunDir) - (n1 - 0.45) * 0.10);
  vec3 col = albedo * vec3(1.0, 0.985, 0.96) * 1.3 * regolith(n, -d, uSunDir) * lit * uSunUp;
  col += albedo * uEarthShine * max(dot(n, uEarthDir), 0.0);
  gl_FragColor = vec4(toneMap(col), 1.0);
  #include <colorspace_fragment>
}
`;

export const STAR_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aMag;
attribute vec3 aColor;
uniform float uPx, uDim, uMagRef;
varying vec3 vColor;
varying float vAlpha;
void main(){
  float b = pow(10.0, -0.4 * (aMag - uMagRef) * 0.62);
  gl_PointSize = uPx * (1.6 + 1.25 * sqrt(min(b, 12.0)));
  vAlpha = clamp(b * 1.15, 0.06, 1.0) * uDim;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const STAR_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
varying float vAlpha;
void main(){
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - 0.5;
  float a = exp(-dot(c, c) * 14.0) * vAlpha;
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <colorspace_fragment>
}
`;

export const EARTH_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
void main(){
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

export const EARTH_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform sampler2D uDay, uNight;
uniform float uHasDay, uHasNight, uExposure, uNightGain;
uniform vec3 uSunDirE;   // unit, world, from the Earth toward the Sun
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
void main(){
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormalW), v = normalize(-vWorld);
  float mu0 = dot(n, uSunDirE), mu = max(dot(n, v), 0.0);
  vec3 albedo;
  float ocean;
  if (uHasDay > 0.5) {
    albedo = texture2D(uDay, vUv).rgb;
    ocean = smoothstep(0.02, 0.10, albedo.b - max(albedo.r, albedo.g) * 0.92) * (1.0 - smoothstep(0.25, 0.5, albedo.r));
  } else {
    // No texture: a blue-white shaded sphere (oceans and cloud bands from noise).
    float cl = smoothstep(0.45, 0.75, fbm3(vUv * vec2(16.0, 8.0)) + 0.25 * abs(vUv.y - 0.5));
    albedo = mix(vec3(0.05, 0.16, 0.42), vec3(0.92), cl);
    ocean = 1.0 - cl;
  }
  float day = smoothstep(-0.06, 0.14, mu0);
  float lit = pow(max(mu0, 0.0), 0.8);
  vec3 col = albedo * lit * 3.0;
  // Sun glint on the oceans.
  vec3 hv = normalize(uSunDirE + v);
  col += vec3(1.0, 0.95, 0.85) * ocean * pow(max(dot(n, hv), 0.0), 90.0) * 0.9 * day;
  // Atmosphere: blue Rayleigh haze over the sunlit side, stronger toward the limb.
  float rim = pow(1.0 - mu, 3.0);
  col += vec3(0.07, 0.14, 0.30) * lit * (1.0 + 3.0 * rim);
  if (uHasNight > 0.5) col += texture2D(uNight, vUv).rgb * vec3(1.0, 0.85, 0.6) * 0.16 * uNightGain * (1.0 - day);
  gl_FragColor = vec4(vec3(1.0) - exp(-col * uExposure), 1.0);
  #include <colorspace_fragment>
}
`;

// The Sun: a camera-facing quad. The disk has its true angular radius (limb-darkened); the glow is an
// instrument/eye effect and scales with the visible flux (terrain and, during an eclipse, the Earth). While the Earth
// covers part of the disk, the glow is centred on the visible crescent (uGlowOff, quad-plane units).
export const SUN_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uHalf;
varying vec2 vP;
void main(){
  vP = position.xy * uHalf;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const SUN_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uDist, uRad, uPixAng, uVis, uHalf;
uniform vec2 uGlowOff;
varying vec2 vP;
void main(){
  #include <logdepthbuf_fragment>
  float th = atan(length(vP) / uDist);
  float disk = 1.0 - smoothstep(uRad - uPixAng, uRad + uPixAng, th);
  float m = sqrt(max(1.0 - (th * th) / (uRad * uRad), 0.0));
  vec3 col = vec3(1.0, 0.985, 0.95) * disk * (1.0 - 0.6 * (1.0 - m)) * 6.0;
  vec2 g = vP - uGlowOff;
  float x = atan(length(g) / uDist) / uRad;
  float glow = 1.4 * exp(-x * 0.9) + 0.22 / (1.0 + x * x * 0.08) * exp(-x * 0.05);
  // Faint diffraction spikes for a camera-like look.
  vec2 u = g / uDist / uRad;
  float spikes = 0.16 * (exp(-abs(u.x) * 3.0) * exp(-abs(u.y) * 0.22) + exp(-abs(u.y) * 3.0) * exp(-abs(u.x) * 0.22));
  float edge = 1.0 - smoothstep(0.75, 1.0, length(vP) / uHalf);
  col += vec3(1.0, 0.96, 0.9) * (glow + spikes) * uVis * edge * (1.0 - disk);
  gl_FragColor = vec4(vec3(1.0) - exp(-col), 1.0);
  #include <colorspace_fragment>
}
`;

// Eclipse overlay, centred on the Earth (a camera-facing quad drawn over the Earth without a depth test), shown only
// while the Earth covers part of the Sun:
// - the refraction ring: sunlight bent into the Earth's shadow by the lower atmosphere (the ring in the Surveyor 3 and
//   Blue Ghost pictures). A ray grazing limb point L reaches the eye if the atmosphere deviates it by delta = the
//   angle from L to the nearest point of the solar disk; the largest deviation is about 1.2 deg (twice the
//   horizontal refraction), for rays through the densest, reddest air. So the ring is bright and orange near the Sun,
//   dimmer and redder further round the limb (brightness (1 − delta/1.2°)^1.5 · exp(−delta/0.5°), a stand-in for the
//   extinction and defocusing of low rays), and absent where delta > 1.2 deg. Its true width is a few arcsec
//   (the refracting layer is ~10-20 km thick); it is drawn about one pixel wide, with a faint optical halo.
// - the "diamond": the last sliver of the Sun at second or third contact, drawn as the point-spread function of a
//   saturating point source (a few pixels, with short spikes), so it spills over the dark limb as in a photograph.
// All angles in rad; vP in quad-plane units at distance uDist (small angles: angle = vP / uDist).
export const ECLIPSE_VERT = SUN_VERT;

export const ECLIPSE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uDist, uRadE, uRadS, uPixAng, uRing, uBead, uHalf;
uniform vec2 uSunP;    // Sun centre relative to the Earth centre (rad, quad plane)
uniform vec2 uBeadP;   // centroid of the visible crescent (rad, quad plane)
varying vec2 vP;
void main(){
  #include <logdepthbuf_fragment>
  vec2 a = vP / uDist;
  float th = length(a);
  vec3 col = vec3(0.0);
  if (uRing > 0.0) {
    // Radial profile: starts at the limb (anti-aliased like the sphere's edge), about one pixel wide, plus a faint
    // halo a few pixels wide.
    float w = max(uRadE * 0.0025, 1.5 * uPixAng);
    float out_ = th - uRadE;
    float edge = smoothstep(-0.5 * uPixAng, 0.5 * uPixAng, out_);
    float line = exp(-pow(max(out_, 0.0) / w, 2.0));
    float halo = exp(-max(out_, 0.0) / (4.0 * uPixAng));
    // Along the limb: deviation needed from the nearest point of the solar disk.
    vec2 limb = a / max(th, 1e-9) * uRadE;
    float delta = max(length(limb - uSunP) - uRadS, 0.0);
    float dmax = radians(1.2);
    float k = clamp(delta / dmax, 0.0, 1.0);
    float bright = pow(1.0 - k, 1.5) * exp(-delta / radians(0.5));
    vec3 tint = mix(vec3(1.0, 0.62, 0.30), vec3(0.85, 0.16, 0.04), smoothstep(0.0, 0.6, k));
    col += tint * bright * uRing * edge * (2.4 * line + 0.16 * halo);
  }
  if (uBead > 0.0) {
    // Point-spread function of the bright crescent: a saturated core, a halo and two faint diffraction spikes
    // (aligned with the Sun's own spikes).
    vec2 d = (a - uBeadP) / uPixAng;
    float r = length(d);
    float psf = 3.0 * exp(-r * r / 3.2) + 0.55 * exp(-r / 5.0) + 0.12 * exp(-r / 22.0);
    float spikes = 0.35 * (exp(-abs(d.x) * 0.9) * exp(-abs(d.y) * 0.05) + exp(-abs(d.y) * 0.9) * exp(-abs(d.x) * 0.05));
    col += vec3(1.0, 0.97, 0.9) * (psf + spikes) * uBead * (1.0 - smoothstep(0.6, 1.0, length(vP) / uHalf));
  }
  gl_FragColor = vec4(vec3(1.0) - exp(-col), 1.0);
  #include <colorspace_fragment>
}
`;
