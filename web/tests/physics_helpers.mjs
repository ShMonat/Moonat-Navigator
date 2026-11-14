// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Test helpers for the browser physics: a fetch() replacement for local files and in-memory data,
// and a synthetic, analytic ephemeris written in the C1 binary layout.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));

function response(body, isJson) {
  return {
    ok: true,
    status: 200,
    json: async () => (isJson ? body : JSON.parse(new TextDecoder().decode(body))),
    arrayBuffer: async () => body,
  };
}

/** fetch()-like reader of local files (paths or file: URLs). */
export async function fileFetch(url) {
  try {
    const buf = await readFile(url);
    return response(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), false);
  } catch {
    return { ok: false, status: 404 };
  }
}

/** fetch()-like reader of an in-memory map {"<base>/<name>": object | ArrayBuffer}. */
export function memFetch(files) {
  return async (url) => {
    if (!(url in files)) return { ok: false, status: 404 };
    const v = files[url];
    return v instanceof ArrayBuffer ? response(v, false) : response(v, true);
  };
}

// ---- Synthetic analytic ephemeris -------------------------------------------------------------
export const AU = 149597870.7;
const DAY = 86400000;
const T_REF = Date.UTC(2025, 0, 1);
const TILT = (6.7 * Math.PI) / 180; // fixed tilt of the ME frame about ICRS X
const EPS = (23.44 * Math.PI) / 180;
export const PLANETS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'];

function rotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function mul(a, b) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    o[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
  }
  return o;
}
function mv(m, v) {
  return [0, 1, 2].map((i) => m[3 * i] * v[0] + m[3 * i + 1] * v[1] + m[3 * i + 2] * v[2]);
}
function qmul(a, b) {
  const [aw, ax, ay, az] = a, [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

/**
 * Exact synthetic state at tMs: ICRS vectors of the Sun, Earth and planets seen from the Moon's
 * centre, the ICRS->ME rotation (matrix and quaternion), and the ME positions.
 */
export function synthModel(tMs) {
  const d = (tMs - T_REF) / DAY;
  const phi = (2 * Math.PI * d) / 27.321661 + 0.3; // Moon rotation angle
  const R = mul(rotX(TILT), rotZ(-phi)); // v_me = R · v_icrs
  const qz = [Math.cos(-phi / 2), 0, 0, Math.sin(-phi / 2)];
  const qx = [Math.cos(TILT / 2), Math.sin(TILT / 2), 0, 0];
  const q = qmul(qx, qz);
  const lam = (2 * Math.PI * d) / 365.25 + 1.0;
  const rs = AU * (1 - 0.0167 * Math.cos((2 * Math.PI * d) / 365.25));
  const sunIcrs = [rs * Math.cos(lam), rs * Math.sin(lam) * Math.cos(EPS), rs * Math.sin(lam) * Math.sin(EPS)];
  const beta = phi + 0.05 * Math.sin((2 * Math.PI * d) / 27.55); // libration-like wobble
  const re = 384400 + 20000 * Math.cos((2 * Math.PI * d) / 27.55);
  const i5 = (5.1 * Math.PI) / 180;
  // Near side: the Earth stays close to ME +X, as for the real Moon.
  const earthIcrs = [re * Math.cos(beta), re * Math.sin(beta) * Math.cos(i5), re * Math.sin(beta) * Math.sin(i5)];
  const planetsIcrs = PLANETS.map((_, k) => {
    const a = 0.7 * k + (2 * Math.PI * d) / (80 + 150 * k);
    const v = [Math.cos(a), Math.sin(a), 0.05 * (k - 2)];
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  });
  return { R, q, sunIcrs, earthIcrs, planetsIcrs, sunMe: mv(R, sunIcrs), earthMe: mv(R, earthIcrs) };
}

/** Builds manifest + year files for the synthetic model in the C1 layout, keyed by URL. */
export function buildSynthTables(base, years, stepHours) {
  const layout = [
    { name: 'sun_me', dtype: 'f8', count: 3 },
    { name: 'earth_me', dtype: 'f8', count: 3 },
    { name: 'q_icrs_to_me', dtype: 'f8', count: 4 },
    { name: 'planets_icrs', dtype: 'f4', count: 15 },
  ];
  const recordBytes = 3 * 8 + 3 * 8 + 4 * 8 + 15 * 4;
  const files = {};
  files[`${base}/manifest.json`] = {
    years, step_hours: stepHours, frame: 'MOON_ME_DE421', ephemeris: 'synthetic', time_scale: 'UTC',
    record_layout: layout, record_bytes: recordBytes,
    interpolation: 'cubic Hermite (C1) on positions; slerp on quaternion',
    max_interp_error_arcsec: 1, planets: PLANETS, _generated_by: 'synthetic test table',
  };
  const stepMs = stepHours * 3600000;
  for (const y of years) {
    const t0 = Date.UTC(y, 0, 1);
    const n = Math.round((Date.UTC(y + 1, 0, 1) - t0) / stepMs) + 1;
    const buf = new ArrayBuffer(n * recordBytes);
    const dv = new DataView(buf);
    for (let i = 0; i < n; i++) {
      const m = synthModel(t0 + i * stepMs);
      let o = i * recordBytes;
      for (const x of [...m.sunMe, ...m.earthMe, ...m.q]) { dv.setFloat64(o, x, true); o += 8; }
      for (const p of m.planetsIcrs) for (const x of p) { dv.setFloat32(o, x, true); o += 4; }
    }
    files[`${base}/${y}.bin`] = buf;
  }
  return files;
}

export { mv, mul };
