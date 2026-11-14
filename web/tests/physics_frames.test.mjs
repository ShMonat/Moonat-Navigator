// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Site frame, az/el, quaternion and Earth Rotation Angle checks against known values.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteFrame, enuToAzEl, matVec, quatToMatrix, eraDeg, MOON_RADIUS_KM } from '../js/physics/frames.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);
const AU = 149597870.7;

function azel(site, vMe) {
  const d = [vMe[0] - site.pos_me[0], vMe[1] - site.pos_me[1], vMe[2] - site.pos_me[2]];
  return enuToAzEl(matVec(site.r_me_to_enu, d));
}

test('equator / prime meridian: up = +X, east = +Y, north = +Z', () => {
  const s = siteFrame(0, 0, 0, 0);
  assert.deepEqual(s.r_me_to_enu.map((x) => Math.round(x * 1e12) / 1e12 + 0), [0, 1, 0, 0, 0, 1, 1, 0, 0]);
  close(s.pos_me[0], MOON_RADIUS_KM, 1e-9);
  close(azel(s, [AU, 0, 0]).el_deg, 90, 1e-9, 'zenith');
  const east = azel(s, [0, AU, 0]);
  close(east.az_deg, 90, 1e-9);
  // Parallax of the 1737.4 km offset at 1 au: asin(1737.4 / 1 au) = 0.000665 deg below the horizon.
  close(east.el_deg, -Math.asin(MOON_RADIUS_KM / Math.hypot(AU, MOON_RADIUS_KM)) * 180 / Math.PI, 1e-12);
  close(azel(s, [0, 0, AU]).az_deg, 0, 1e-9, 'north');
});

test('the altitude of the celestial (ME +Z) pole equals the latitude', () => {
  for (const [lat, lon] of [[45, 90], [-30, -120], [10, 170], [89, 0]]) {
    const s = siteFrame(lat, lon, 0, 0);
    const p = enuToAzEl(matVec(s.r_me_to_enu, [0, 0, 1]));
    close(p.el_deg, lat, 1e-9, `lat ${lat}`);
    if (lat > 0) close(p.az_deg % 360, 0, 1e-9, 'pole is due north');
  }
});

test('south pole: up = −Z, north = toward the 0° meridian (+X), right-handed', () => {
  const s = siteFrame(-90, 0, 0, 2);
  const [ex, ey, ez, nx, ny, nz, ux, uy, uz] = s.r_me_to_enu;
  assert.deepEqual([ux, uy, uz], [0, 0, -1]);
  assert.deepEqual([nx, ny, nz], [1, 0, 0]);
  // east × north = up
  assert.deepEqual([ey * nz - ez * ny, ez * nx - ex * nz, ex * ny - ey * nx].map((x) => x + 0), [0, 0, -1]);
  close(s.pos_me[2], -(MOON_RADIUS_KM + 0.002), 1e-12, 'eye 2 m above the sphere');
  // The Earth (near ME +X, far away) is due north at the south pole, about on the horizon.
  close(azel(s, [384400, 0, 0]).az_deg, 0, 1e-9);
});

test('site radius includes DEM height and eye height', () => {
  const s = siteFrame(0, 90, -1500, 2);
  close(Math.hypot(...s.pos_me), MOON_RADIUS_KM - 1.498, 1e-12);
});

test('quaternion (w,x,y,z) is an active rotation: 90° about Z maps X to Y', () => {
  const h = Math.SQRT1_2;
  const m = quatToMatrix([h, 0, 0, h]);
  const v = matVec(m, [1, 0, 0]);
  close(v[0], 0, 1e-15); close(v[1], 1, 1e-15); close(v[2], 0, 1e-15);
});

test('Earth Rotation Angle: J2000.0 value and sidereal rate', () => {
  // ERA(JD_UT1 = 2451545.0) = 0.7790572732640 rev = 280.46061837504 deg (IERS 2010 eq. 5.15).
  const j2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  close(eraDeg(j2000), 280.46061837504, 1e-9);
  // One UT1 day later the ERA has advanced 1.00273781191135448 rev = 360.98561228808 deg.
  close(eraDeg(j2000 + 86400000), (280.46061837504 + 360.98561228808) % 360, 1e-8);
  // 2026-11-14 00:00 UTC, from the formula evaluated in exact rational steps.
  const t = Date.UTC(2026, 10, 14);
  const du = t / 86400000 + 2440587.5 - 2451545.0;
  const ref = ((((0.7790572732640 + 1.00273781191135448 * du) % 1) + 1) % 1) * 360;
  close(eraDeg(t), ref, 1e-6);
});
