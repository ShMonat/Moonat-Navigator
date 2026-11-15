// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The sub-solar point that drives the globe's day and night (web/js/physics subsolarPoint):
// 1. against JPL Horizons (target Moon, observer the Earth's centre, quantity 15 "SunSub-LON, SunSub-LAT" in MOON_ME,
//    cached in tests/fixtures/horizons_cache/subsolar_moon.json by scripts/fetch_subsolar_horizons.py). Horizons gives
//    the point at the instant the Moon's light leaves for the Earth (1.3 s earlier; the sub-solar point moves
//    0.000142°/s), so the two agree to about 0.0002°;
// 2. against the sky view: at a site, the Sun's elevation from skyState() equals 90° minus the angle between the site
//    and the sub-solar point, up to the parallax (R_moon / d_sun ≈ 0.0007°) on the smooth sphere;
// 3. the Earth's shadow on the globe during an eclipse (web/js/globe/daylight.js earthShadowAt) against the sky view's
//    geometry at the same site (the covered share of a uniform solar disk).
// Skipped while the ephemeris tables are not in this checkout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, fileFetch } from './physics_helpers.mjs';
import { loadEphem, makeSite, skyState, subsolarPoint } from '../js/physics/index.js';
import { occultedFluxFraction, sepRad } from '../js/physics/eclipse.js';
import { earthShadowAt, eclipsePossible } from '../js/globe/daylight.js';

const EPHEM_DIR = join(REPO, 'web', 'data', 'ephem');
const FIXTURE = join(REPO, 'tests', 'fixtures', 'horizons_cache', 'subsolar_moon.json');
const READY = existsSync(join(EPHEM_DIR, 'manifest.json')) && existsSync(FIXTURE);
const D = Math.PI / 180;

const unit = (lat, lon) => [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
const angleDeg = (a, b) => {
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const x = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(Math.hypot(...x), c) / D;
};
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** Rows of the cached Horizons table: { t_ms (UTC), lon_deg (east, 0..360), lat_deg }. */
function horizonsRows() {
  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.match(fx.response, /Target pole\/equ : MOON_ME/);
  assert.match(fx.response, /Target radii {4}: 1737\.4, 1737\.4, 1737\.4 km/);
  const body = fx.response.slice(fx.response.indexOf('$$SOE') + 5, fx.response.indexOf('$$EOE'));
  return body.trim().split('\n').map((line) => {
    const c = line.split(',').map((x) => x.trim());
    const m = /^(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(c[0]);
    return { t_ms: Date.UTC(+m[1], MONTHS[m[2]], +m[3], +m[4], +m[5], +m[6], +m[7]), lon_deg: +c[3], lat_deg: +c[4] };
  });
}

test('subsolarPoint matches JPL Horizons (SunSub-LON/LAT, MOON_ME) within 0.001°', { skip: !READY && 'ephem tables or Horizons fixture not present' }, async () => {
  await loadEphem(EPHEM_DIR, { fetch: fileFetch });
  const rows = horizonsRows();
  assert.ok(rows.length >= 3);
  let worst = 0;
  for (const r of rows) {
    const p = await subsolarPoint(r.t_ms);
    const sep = angleDeg(unit(p.lat_deg, p.lon_deg), unit(r.lat_deg, r.lon_deg));
    worst = Math.max(worst, sep);
    assert.ok(sep < 0.001, `${new Date(r.t_ms).toISOString()}: ${sep.toFixed(6)}° from Horizons`);
    // The unit vector and the angles describe the same point; longitudes are in −180..180.
    assert.ok(angleDeg(p.dir_me, unit(p.lat_deg, p.lon_deg)) < 1e-9);
    assert.ok(p.lon_deg > -180 && p.lon_deg <= 180);
  }
  console.log(`# sub-solar point vs Horizons: worst ${(worst * 3600).toFixed(2)} arcsec over ${rows.length} epochs`);
});

test('the Sun elevation in the sky view is 90° − (angle to the sub-solar point), within 0.01°', { skip: !READY && 'ephem tables not present' }, async () => {
  await loadEphem(EPHEM_DIR, { fetch: fileFetch });
  const sites = [
    [0.67409, 23.47298], // Tranquility Base
    [-89.4395, -137.1934], // Shackleton rim
    [-85.96775, -2.28748], // Malapert massif
    [45.4446, 177.5991], // far side (Chang'e 4 longitude, north)
    [20.19, 30.77], // Taurus-Littrow
  ];
  const times = ['1969-07-20T20:17:40Z', '1972-12-11T19:54:57Z', '2026-11-15T00:00:00Z', '2030-03-01T06:00:00Z', '2038-08-17T13:45:00Z'];
  let worst = 0;
  for (const iso of times) {
    const t = Date.parse(iso);
    const p = await subsolarPoint(t);
    for (const [lat, lon] of sites) {
      const st = await skyState(makeSite({ lat_deg: lat, lon_deg: lon, ground_elev_m: 0, observer_height_m: 2 }), t);
      const expected = 90 - angleDeg(unit(lat, lon), p.dir_me);
      const d = Math.abs(st.sun.el_deg - expected);
      worst = Math.max(worst, d);
      assert.ok(d < 0.01, `${iso} at ${lat}, ${lon}: sky ${st.sun.el_deg.toFixed(5)}° vs globe ${expected.toFixed(5)}°`);
    }
  }
  // In fact it is the parallax only.
  assert.ok(worst < 0.001, `worst ${worst}°`);
  console.log(`# Sun elevation, sky view vs 90° − angle to the sub-solar point: worst ${worst.toFixed(5)}°`);
});

test('Apollo 11 landing: Tranquility Base in early morning light, the Sun about 10.7° up in the east', { skip: !READY && 'ephem tables not present' }, async () => {
  await loadEphem(EPHEM_DIR, { fetch: fileFetch });
  const t = Date.parse('1969-07-20T20:17:40Z');
  const p = await subsolarPoint(t);
  const el = 90 - angleDeg(unit(0.67409, 23.47298), p.dir_me);
  assert.ok(el > 10 && el < 11.5, `Sun elevation ${el}°`);
  // The morning terminator lies 90° west of the sub-solar point: about 12.8° E, west of the site.
  const terminatorLon = p.lon_deg - 90;
  assert.ok(Math.abs(terminatorLon - 12.78) < 0.05, `terminator at ${terminatorLon}° E`);
});

test("eclipse: the globe's Earth shadow at Blue Ghost equals the covered share of the Sun's disk in the sky view", { skip: !READY && 'ephem tables not present' }, async () => {
  await loadEphem(EPHEM_DIR, { fetch: fileFetch });
  const [lat, lon] = [18.5623, 61.8103]; // Blue Ghost Mission 1, Mare Crisium
  // 14 March 2025: before, during the partial phase (the story's 05:57:30, "Earth covers 81 %"), totality, after.
  const cases = [['2025-03-14T04:00:00Z', 0, 0], ['2025-03-14T05:57:30Z', 0.7, 0.9], ['2025-03-14T07:00:00Z', 1, 1], ['2025-03-14T10:30:00Z', 0, 0]];
  for (const [iso, lo, hi] of cases) {
    const t = Date.parse(iso);
    const p = await subsolarPoint(t);
    const globe = earthShadowAt(lat, lon, p.sun_me_km, p.earth_me_km);
    const st = await skyState(makeSite({ lat_deg: lat, lon_deg: lon, ground_elev_m: 0, observer_height_m: 0 }), t);
    const rs = st.sun.ang_radius_deg, re = st.earth.ang_radius_deg;
    const z = (sepRad(st.sun.enu, st.earth.enu) / D) / rs;
    const uniform = z >= 1 + re / rs ? 0 : occultedFluxFraction(z, re / rs, 0); // uniform disk, the sky's geometry
    assert.ok(Math.abs(globe - uniform) < 2e-3, `${iso}: globe ${globe} vs sky geometry ${uniform}`);
    assert.ok(globe >= lo && globe <= hi, `${iso}: ${globe}`);
    // The sky view's limb-darkened eclipse fraction differs from the uniform disk only by limb darkening.
    assert.ok(Math.abs(globe - st.sun.eclipse_frac) < 0.06, `${iso}: ${globe} vs ${st.sun.eclipse_frac}`);
  }
  // The quick test that switches the shadow on never misses a shadowed point: around the eclipse, every 10 min, a
  // moment it rejects has no shadow anywhere on the Moon (3° grid).
  let rejected = 0;
  for (let t = Date.parse('2025-03-14T01:00:00Z'); t <= Date.parse('2025-03-14T14:00:00Z'); t += 600e3) {
    const p = await subsolarPoint(t);
    if (eclipsePossible(p.sun_me_km, p.earth_me_km)) continue;
    rejected++;
    for (let la = -88.5; la < 90; la += 3) {
      for (let lo = -180; lo < 180; lo += 3) assert.equal(earthShadowAt(la, lo, p.sun_me_km, p.earth_me_km), 0);
    }
  }
  assert.ok(rejected > 20, `${rejected} moments rejected`);
  const mid = await subsolarPoint(Date.parse('2025-03-14T06:58:00Z'));
  assert.equal(eclipsePossible(mid.sun_me_km, mid.earth_me_km), true);
  const a11 = await subsolarPoint(Date.parse('1969-07-20T20:17:40Z'));
  assert.equal(eclipsePossible(a11.sun_me_km, a11.earth_me_km), false); // no shadow work outside eclipses
  assert.equal(earthShadowAt(0.674, 23.473, a11.sun_me_km, a11.earth_me_km), 0);
});
