// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Run: node --test web/tests/sky*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEG, M_ZUP_TO_YUP, mat3Mul, mat3Vec, mat3Transpose, rotZ, enuToThree, azElToEnu, enuToAzEl, yupRotationFromZup,
  earthBodyToEnu, lonLatToVec, sphereGeomDirFromUv, equirectUv, verticalFovDeg, horizonElAt, flatHorizon,
  horizonFromPatch, samplePatch, bvToRgb, fitBodyView, fitPhotoView, bodyFitAspect, constellationCentroid,
} from '../js/sky/math.js';
import { makeSite, skyStateSync } from '../js/sky/placeholder_physics.js';

// Screen height (-1 = bottom edge, +1 = top edge) of elevation `el` on the camera's azimuth, for a fitted view.
function frameY(fit, el, aspect) {
  const T = Math.tan((fit.hfov_deg * DEG) / 2) / aspect;
  return Math.tan((el - fit.el_deg) * DEG) / T;
}

test('opening view (C8 framing rule): horizon 10% above the bottom, body 10% below the top', () => {
  const aspect = 16 / 9;
  // Mid-height Earth: both margins exact, FOV widened beyond the default.
  let f = fitBodyView({ bodyElDeg: 35, bodyRadiusDeg: 0.95, horizonElDeg: 0.5, aspect });
  close(frameY(f, 0.5, aspect), -0.8, 1e-9);
  close(frameY(f, 35.95, aspect), 0.8, 1e-9);
  assert.ok(f.hfov_deg > 60 && f.hfov_deg < 100);
  // Low Earth (south pole): default FOV, horizon at 10%, Earth inside the frame.
  f = fitBodyView({ bodyElDeg: 3, bodyRadiusDeg: 0.95, horizonElDeg: -1, aspect });
  close(f.hfov_deg, 60, 1e-9);
  close(frameY(f, -1, aspect), -0.8, 1e-9);
  assert.ok(frameY(f, 3.95, aspect) < 0.8 && frameY(f, 3.95, aspect) > -0.8);
  // Apollo 11 (Earth at 59.2 deg): FOV capped at 100 deg, the horizon and the whole Earth are both still in frame.
  f = fitBodyView({ bodyElDeg: 59.2, bodyRadiusDeg: 0.94, horizonElDeg: 0.3, aspect });
  close(f.hfov_deg, 100, 1e-9);
  assert.ok(frameY(f, 0.3, aspect) > -1 && frameY(f, 60.14, aspect) < 1, JSON.stringify(f));
  // Earth near the zenith: cannot fit both, the Earth stays in frame.
  f = fitBodyView({ bodyElDeg: 85, bodyRadiusDeg: 0.95, horizonElDeg: 0, aspect });
  close(frameY(f, 85.95, aspect), 0.8, 1e-9);
  // Earth below the horizon: default FOV, horizon one third of the height above the bottom edge.
  f = fitBodyView({ bodyElDeg: -4, bodyRadiusDeg: 0.95, horizonElDeg: 0.2, aspect });
  close(f.hfov_deg, 60, 1e-9);
  close(frameY(f, 0.2, aspect), -1 / 3, 1e-9);
});

test('tall frames: both_fit says when the body rule fits; bodyFitAspect is the widest frame that fits both', () => {
  // Apollo 17 (Earth at 45 deg) in a 16:9 view: fits with the margins. Apollo 11 (59.2 deg): only with the horizon
  // sliding toward the bottom edge, so not with the margins.
  assert.equal(fitBodyView({ bodyElDeg: 45, bodyRadiusDeg: 0.94, horizonElDeg: 0.3, aspect: 16 / 9 }).both_fit, true);
  assert.equal(fitBodyView({ bodyElDeg: 59.2, bodyRadiusDeg: 0.94, horizonElDeg: 0.3, aspect: 16 / 9 }).both_fit, false);
  // The same Earth in a focused 2.16:1 window, and Apollo 16 (77 deg) in 16:9: the body wins, so a taller frame is needed.
  assert.equal(fitBodyView({ bodyElDeg: 59.2, bodyRadiusDeg: 0.94, horizonElDeg: 0.3, aspect: 2.16 }).both_fit, false);
  assert.equal(fitBodyView({ bodyElDeg: 77, bodyRadiusDeg: 0.95, horizonElDeg: 0.5, aspect: 16 / 9 }).both_fit, false);
  for (const [el, h] of [[59.2, 0.3], [77, 0.5]]) {
    const a = bodyFitAspect({ bodyElDeg: el, bodyRadiusDeg: 0.95, horizonElDeg: h });
    const f = fitBodyView({ bodyElDeg: el, bodyRadiusDeg: 0.95, horizonElDeg: h, aspect: a });
    close(f.hfov_deg, 100, 1e-6);
    close(frameY(f, h, a), -0.8, 1e-6); // horizon 10% above the bottom edge
    close(frameY(f, el + 0.95, a), 0.8, 1e-6); // top of the disk 10% below the top edge
  }
  close(bodyFitAspect({ bodyElDeg: 59.2, bodyRadiusDeg: 0.94, horizonElDeg: 0.3 }), Math.tan(50 * DEG) / (Math.tan(29.92 * DEG) / 0.8), 1e-12);
  assert.equal(bodyFitAspect({ bodyElDeg: -4, bodyRadiusDeg: 0.95, horizonElDeg: 0.2 }), Infinity);
});

test('opening "photo" framing: horizon 20% above the bottom, a comfortable FOV, taller frames for a high body', () => {
  const aspect = 16 / 9;
  // Low Earth (south pole): 70 deg FOV, horizon at 20% of the height, the whole Earth inside the frame.
  let f = fitPhotoView({ bodyElDeg: 3, bodyRadiusDeg: 0.95, horizonElDeg: -1, aspect });
  close(f.hfov_deg, 70, 1e-9);
  close(frameY(f, -1, aspect), -0.6, 1e-9);
  assert.ok(f.body_in_frame && frameY(f, 3.95, aspect) < 0.84 && frameY(f, 2.05, aspect) > -0.6);
  // Earth at 30 deg: the FOV widens (still under 80 deg) until the top of the Earth is 8% below the top edge.
  f = fitPhotoView({ bodyElDeg: 30, bodyRadiusDeg: 0.95, horizonElDeg: 0, aspect: 2.0 });
  assert.ok(f.body_in_frame && f.hfov_deg > 70 && f.hfov_deg <= 80, JSON.stringify(f));
  close(frameY(f, 0, 2.0), -0.6, 1e-9);
  close(frameY(f, 30.95, 2.0), 0.84, 1e-9);
  // Apollo 11 (Earth at 59.2 deg) in a 16:9 card: impossible at 80 deg, so the comfortable 70 deg frame with the
  // horizon at 20% is kept and the Earth is above the frame.
  const a11 = { bodyElDeg: 59.2, bodyRadiusDeg: 0.94, horizonElDeg: 0.3 };
  f = fitPhotoView({ ...a11, aspect });
  assert.equal(f.body_in_frame, false);
  close(f.hfov_deg, 70, 1e-9);
  close(frameY(f, 0.3, aspect), -0.6, 1e-9);
  assert.ok(frameY(f, 59.2, aspect) > 1);
  // ... and a frame of aspect_max (about square, like the Apollo Hasselblad photos) holds both at 80 deg.
  assert.ok(f.aspect_max > 0.8 && f.aspect_max < 1.2, `aspect_max ${f.aspect_max}`);
  const g = fitPhotoView({ ...a11, aspect: f.aspect_max });
  assert.ok(g.body_in_frame);
  close(g.hfov_deg, 80, 1e-6);
  close(frameY(g, 0.3, f.aspect_max), -0.6, 1e-9);
  close(frameY(g, 60.14, f.aspect_max), 0.84, 1e-6);
  // Earth below the horizon: default FOV, horizon one third of the height above the bottom edge.
  f = fitPhotoView({ bodyElDeg: -7.1, bodyRadiusDeg: 0.95, horizonElDeg: -1.2, aspect });
  assert.equal(f.body_in_frame, false);
  close(frameY(f, -1.2, aspect), -1 / 3, 1e-9);
});

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (tol ${tol})`);
const closeVec = (a, b, tol = 1e-9) => a.forEach((x, i) => close(x, b[i], tol));
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

test('ENU -> three mapping: east = +x, up = +y, north = -z', () => {
  closeVec(enuToThree([1, 0, 0]), [1, 0, 0]);
  closeVec(enuToThree([0, 1, 0]), [0, 0, -1]);
  closeVec(enuToThree([0, 0, 1]), [0, 1, 0]);
  closeVec(mat3Vec(M_ZUP_TO_YUP, [0.1, 0.2, 0.3]), enuToThree([0.1, 0.2, 0.3]));
});

test('azimuth is clockwise from north; round trip', () => {
  closeVec(azElToEnu(0, 0), [0, 1, 0]);
  closeVec(azElToEnu(90, 0), [1, 0, 0]);
  closeVec(azElToEnu(123, 90), [0, 0, 1], 1e-12);
  const r = enuToAzEl(azElToEnu(271.5, -12.25));
  close(r.az_deg, 271.5, 1e-9);
  close(r.el_deg, -12.25, 1e-9);
});

test('three SphereGeometry UV mapping equals M · body(lon, lat) for an equirectangular map with lon 0 at the centre', () => {
  for (const [lon, lat] of [[0, 0], [90, 0], [-90, 0], [180, 0], [35.2, 31.8], [-74, 40.7], [151.2, -33.9], [10, 89], [10, -89]]) {
    const [u, v] = equirectUv(lon, lat);
    closeVec(sphereGeomDirFromUv(u, v), mat3Vec(M_ZUP_TO_YUP, lonLatToVec(lon, lat)), 1e-12);
  }
  // Explicit anchors: texture centre (Gulf of Guinea) along geometry +x, north pole along +y, 90 E along -z.
  closeVec(sphereGeomDirFromUv(0.5, 0.5), [1, 0, 0], 1e-12);
  closeVec(sphereGeomDirFromUv(0.5, 1), [0, 1, 0], 1e-12);
  closeVec(sphereGeomDirFromUv(0.75, 0.5), [0, 0, -1], 1e-12);
});

test('Earth body frame: R_icrs_to_enu · Rz(era)', () => {
  // Identity sky rotation, era = 0: Greenwich meridian along ENU east (+x), 90 E along north, pole up.
  let B = earthBodyToEnu(I3, 0);
  closeVec(mat3Vec(B, lonLatToVec(0, 0)), [1, 0, 0]);
  closeVec(mat3Vec(B, lonLatToVec(90, 0)), [0, 1, 0]);
  closeVec(mat3Vec(B, lonLatToVec(0, 90)), [0, 0, 1], 1e-12);
  // era = 90 deg: the Earth has turned eastward, so Greenwich now points where 90 E pointed.
  B = earthBodyToEnu(I3, 90);
  closeVec(mat3Vec(B, lonLatToVec(0, 0)), [0, 1, 0], 1e-12);
  // The sub-point at ICRS right ascension RA has longitude RA - era.
  B = earthBodyToEnu(I3, 100);
  closeVec(mat3Vec(B, lonLatToVec(30 - 100, 20)), lonLatToVec(30, 20), 1e-12);
});

test('mesh matrix M·R·Mᵀ applied to SphereGeometry-local vectors gives the three.js world direction', () => {
  const R = mat3Mul(rotZ(37), [1, 0, 0, 0, Math.cos(0.4), -Math.sin(0.4), 0, Math.sin(0.4), Math.cos(0.4)]);
  const era = 211.3, B = earthBodyToEnu(R, era), meshRot = yupRotationFromZup(B);
  for (const [lon, lat] of [[0, 0], [45, 45], [-120, -60], [0, 90]]) {
    const local = sphereGeomDirFromUv(...equirectUv(lon, lat));
    const want = enuToThree(mat3Vec(B, lonLatToVec(lon, lat)));
    closeVec(mat3Vec(meshRot, local), want, 1e-12);
  }
  // It is a proper rotation.
  closeVec(mat3Mul(meshRot, mat3Transpose(meshRot)), I3, 1e-12);
});

test('vertical FOV from horizontal FOV', () => {
  close(verticalFovDeg(60, 16 / 9), (2 * Math.atan(Math.tan(30 * DEG) * 9 / 16)) / DEG, 1e-12);
  close(verticalFovDeg(90, 1), 90, 1e-9);
});

test('horizon interpolation wraps at 360', () => {
  const h = flatHorizon();
  h.el_deg[0] = 2; h.el_deg[1439] = 4;
  close(horizonElAt(h, 0), 2);
  close(horizonElAt(h, 359.875), 3);
  close(horizonElAt(h, -0.125), 3);
  close(horizonElAt(h, 360.125), 1);
});

test('horizonFromPatch finds a ridge of known height and distance', () => {
  const N = 201, d = 10, h = 1000, data = new Float32Array(N * N);
  // A plateau 50 m high whose edge is 500 m north of the centre (row index for north = +500 is 50).
  for (let r = 0; r <= 50; r++) for (let c = 0; c < N; c++) data[r * N + c] = 50;
  const patch = { meta: { grid_n: N, spacing_m: d, half_extent_m: h }, data };
  close(samplePatch(patch, 0, 500), 50, 1e-6);
  close(samplePatch(patch, 0, 0), 0, 1e-6);
  const hor = horizonFromPatch(patch, 2);
  close(hor.el_deg[0], Math.atan(48 / 500) / DEG, 0.08);
  close(hor.dist_km[0], 0.5, 0.011);
  close(hor.el_deg[720], Math.atan(-2 / 1000) / DEG, 0.02); // due south: flat ground, seen from 2 m up
});

test('star colours: blue stars are bluer, red stars redder', () => {
  const hot = bvToRgb(-0.2), cool = bvToRgb(1.6);
  assert.ok(hot[2] > hot[0]);
  assert.ok(cool[0] > cool[2]);
});

test('placeholder physics: Apollo 11 landing sky (Earth high and gibbous, Sun low in the east)', () => {
  const site = makeSite({ lat_deg: 0.67416, lon_deg: 23.47314 });
  const s = skyStateSync(site, Date.parse('1969-07-20T20:17:40Z'));
  assert.ok(s.earth.el_deg > 55 && s.earth.el_deg < 75, `earth el ${s.earth.el_deg}`);
  assert.ok(s.sun.el_deg > 5 && s.sun.el_deg < 16, `sun el ${s.sun.el_deg}`);
  assert.ok(s.sun.az_deg > 70 && s.sun.az_deg < 110, `sun az ${s.sun.az_deg}`);
  assert.ok(s.earth.phase_frac > 0.5 && s.earth.phase_frac < 0.85, `phase ${s.earth.phase_frac}`);
  close(s.earth.ang_radius_deg, 0.93, 0.08);
  close(s.sun.ang_radius_deg, 0.262, 0.01);
  closeVec(mat3Mul(s.r_icrs_to_enu, mat3Transpose(s.r_icrs_to_enu)), I3, 1e-9);
});

test('from the lunar south pole the Earth appears upside down (its north pole points below the horizontal)', () => {
  const site = makeSite({ lat_deg: -89.5, lon_deg: 0 });
  for (const iso of ['2026-11-15T00:00:00Z', '2027-03-01T12:00:00Z', '2028-08-08T06:00:00Z']) {
    const s = skyStateSync(site, Date.parse(iso));
    const B = earthBodyToEnu(s.r_icrs_to_enu, s.earth.era_deg);
    const northPoleEnu = mat3Vec(B, [0, 0, 1]);
    assert.ok(northPoleEnu[2] < -0.85, `Earth north pole up-component ${northPoleEnu[2]}`);
    // And from near the lunar north pole it is upright.
    const sN = skyStateSync(makeSite({ lat_deg: 89.5, lon_deg: 0 }), Date.parse(iso));
    assert.ok(mat3Vec(earthBodyToEnu(sN.r_icrs_to_enu, sN.earth.era_deg), [0, 0, 1])[2] > 0.85);
    // The Earth hugs the horizon at the poles.
    assert.ok(Math.abs(s.earth.el_deg) < 9, `earth el at pole ${s.earth.el_deg}`);
  }
});

test('placeholder physics: sub-solar longitude on Earth is consistent with UTC noon', () => {
  // At 12:00 UTC the Sun is near the Greenwich meridian (within the equation of time, < 4.5 deg).
  const site = makeSite({ lat_deg: 0, lon_deg: 0 });
  const s = skyStateSync(site, Date.parse('2026-03-20T12:00:00Z'));
  const B = earthBodyToEnu(s.r_icrs_to_enu, s.earth.era_deg);
  const sunBody = mat3Vec(mat3Transpose(B), s.earth.sun_dir_enu);
  const lon = Math.atan2(sunBody[1], sunBody[0]) / DEG, lat = Math.asin(sunBody[2]) / DEG;
  assert.ok(Math.abs(lon) < 4.5, `sub-solar lon ${lon}`);
  assert.ok(Math.abs(lat) < 1.0, `sub-solar lat at equinox ${lat}`);
});

test('constellationCentroid: mean direction of the line points (labels of constellation names)', async () => {
  // Points symmetric about RA 90°, Dec 0°: the centroid is that direction.
  const c = constellationCentroid([[[80, 0], [100, 0]], [[90, 10], [90, -10]]]);
  assert.ok(Math.abs(c[0]) < 1e-12 && Math.abs(c[1] - 1) < 1e-12 && Math.abs(c[2]) < 1e-12);
  assert.equal(constellationCentroid([]), null);
  // Orion from the shipped d3-celestial lines: between Betelgeuse (RA 88.8°, Dec +7.4°) and Rigel (78.6°, −8.2°).
  const { readFileSync } = await import('node:fs');
  const json = JSON.parse(readFileSync(new URL('../data/stars/constellations.json', import.meta.url)));
  const o = constellationCentroid(json.lines.Ori);
  const ra = Math.atan2(o[1], o[0]) / DEG, dec = Math.asin(o[2]) / DEG;
  assert.ok(ra > 75 && ra < 92 && dec > -8 && dec < 12, `${ra} ${dec}`);
});
