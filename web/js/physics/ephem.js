// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Reader for the per-year binary ephemeris tables (contract C1 `ephem-table`, docs/CONTRACTS.md).
// web/data/ephem/manifest.json describes the record layout; <YYYY>.bin holds N little-endian
// records, record k at YYYY-01-01T00:00:00Z + k·step_hours (POSIX time, like JS Date), covering
// the year plus one extra record. Positions are Moon-centred MOON_ME (km); the quaternion
// (w, x, y, z) rotates ICRS into MOON_ME; planet directions are ICRS unit vectors.
// The Python twin is moonat.ephem.table (owned by the `ephem` work item).

/** Number of float64 values in one decoded record: sun 3, earth 3, quaternion 4, planets 15. */
export const REC = 25;
const OFF_SUN = 0, OFF_EARTH = 3, OFF_Q = 6, OFF_PL = 10;
const CANON = [
  ['sun_me', OFF_SUN, 3],
  ['earth_me', OFF_EARTH, 3],
  ['q_icrs_to_me', OFF_Q, 4],
  ['planets_icrs', OFF_PL, 15],
];
export const OFFSETS = { sun: OFF_SUN, earth: OFF_EARTH, q: OFF_Q, planets: OFF_PL };

function joinUrl(base, name) {
  return base ? `${String(base).replace(/\/+$/, '')}/${name}` : name;
}

/**
 * Fetches the manifest and returns an ephemeris handle. Year files load later via ensureRange().
 * `fetchFn` is the global fetch in the browser; tests inject a file reader with the same shape
 * (returns {ok, status, json(), arrayBuffer()}).
 */
export async function openEphem(baseUrl, fetchFn = (url) => globalThis.fetch(url)) {
  const res = await fetchFn(joinUrl(baseUrl, 'manifest.json'));
  if (!res.ok) throw new Error(`ephem: cannot load manifest (${res.status}) from ${baseUrl}`);
  const manifest = await res.json();
  if (manifest.endianness && manifest.endianness !== 'little') throw new Error('ephem: only little-endian tables are supported');
  // Map the record layout onto the canonical decoded order, by field name (falls back on order).
  const fields = [];
  let byteOff = 0;
  manifest.record_layout.forEach((f, k) => {
    const size = f.dtype === 'f4' ? 4 : 8;
    const canon = CANON.find((c) => c[0] === f.name) || CANON[k];
    if (!canon || canon[2] !== f.count) {
      throw new Error(`ephem: unexpected record field ${f.name} (${f.dtype}×${f.count})`);
    }
    fields.push({ byteOff, size, count: f.count, dst: canon[1] });
    byteOff += size * f.count;
  });
  return {
    baseUrl,
    fetchFn,
    manifest,
    fields,
    recordBytes: manifest.record_bytes ?? byteOff,
    stepMs: manifest.step_hours * 3600000,
    years: new Set(manifest.years),
    data: new Map(), // year -> {P: Float64Array(N·REC), M: tangents, n: N}
    pending: new Map(), // year -> Promise
  };
}

// Per-step finite-difference tangents of every component, as documented in the manifest's
// `interpolation_scheme`: central differences inside, third-order one-sided at both ends.
function tangents(P, n) {
  const M = new Float64Array(n * REC);
  for (let c = 0; c < REC; c++) {
    for (let k = 1; k < n - 1; k++) M[k * REC + c] = 0.5 * (P[(k + 1) * REC + c] - P[(k - 1) * REC + c]);
    const p = (k) => P[k * REC + c];
    M[c] = (-11 * p(0) + 18 * p(1) - 9 * p(2) + 2 * p(3)) / 6;
    M[(n - 1) * REC + c] = (11 * p(n - 1) - 18 * p(n - 2) + 9 * p(n - 3) - 2 * p(n - 4)) / 6;
  }
  return M;
}

async function loadYear(eph, year) {
  if (eph.data.has(year)) return;
  if (!eph.pending.has(year)) {
    const p = (async () => {
      const res = await eph.fetchFn(joinUrl(eph.baseUrl, `${year}.bin`));
      if (!res.ok) throw new Error(`ephem: cannot load ${year}.bin (${res.status})`);
      const buf = await res.arrayBuffer();
      const dv = new DataView(buf);
      const n = Math.floor(buf.byteLength / eph.recordBytes);
      if (n < 4) throw new Error(`ephem: ${year}.bin has only ${n} records`);
      const P = new Float64Array(n * REC);
      for (let i = 0; i < n; i++) {
        const base = i * eph.recordBytes;
        for (const f of eph.fields) {
          for (let c = 0; c < f.count; c++) {
            const at = base + f.byteOff + c * f.size;
            P[i * REC + f.dst + c] = f.size === 8 ? dv.getFloat64(at, true) : dv.getFloat32(at, true);
          }
        }
      }
      eph.data.set(year, { P, M: tangents(P, n), n });
    })();
    eph.pending.set(year, p);
    p.catch(() => eph.pending.delete(year));
  }
  await eph.pending.get(year);
}

/**
 * Makes sure every year file needed for times in [t0Ms, t1Ms] (UTC epoch ms) is loaded.
 * Throws if a time falls in a year that has no table.
 */
export async function ensureRange(eph, t0Ms, t1Ms = t0Ms) {
  const y0 = new Date(t0Ms).getUTCFullYear();
  const y1 = new Date(t1Ms).getUTCFullYear();
  const jobs = [];
  for (let y = y0; y <= y1; y++) {
    if (!eph.years.has(y)) {
      const ys = [...eph.years].sort((a, b) => a - b);
      throw new Error(`ephem: no table for year ${y} (available ${ys[0]}–${ys[ys.length - 1]})`);
    }
    jobs.push(loadYear(eph, y));
  }
  await Promise.all(jobs);
}

/**
 * Interpolated state at a UTC epoch (ms). Synchronous: call ensureRange() first.
 * Returns a Float64Array(REC) laid out as [sun_me 3, earth_me 3, q_icrs_to_me 4, planets_icrs 15]
 * (writes into `out` if given).
 * Scheme (manifest `interpolation_scheme`): u = (t − T(Y))/H, i = min(floor(u), N − 2), s = u − i;
 * cubic Hermite with the precomputed tangents on positions and planet directions (re-normalised);
 * slerp on the quaternion (shortest arc). Checked against moonat.ephem.table by
 * web/tests/physics_ephem.test.mjs.
 */
export function stateAtMs(eph, tMs, out = new Float64Array(REC)) {
  const year = new Date(tMs).getUTCFullYear();
  const Y = eph.data.get(year);
  if (!Y) throw new Error(`ephem: table for ${new Date(tMs).toISOString()} is not loaded`);
  const u = (tMs - Date.UTC(year, 0, 1)) / eph.stepMs;
  const i = Math.min(Math.floor(u), Y.n - 2);
  const s = u - i;
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const P = Y.P, M = Y.M, a = i * REC, b = a + REC;
  for (let c = 0; c < OFF_Q; c++) out[c] = h00 * P[a + c] + h10 * M[a + c] + h01 * P[b + c] + h11 * M[b + c];
  for (let c = OFF_PL; c < REC; c += 3) {
    const x = h00 * P[a + c] + h10 * M[a + c] + h01 * P[b + c] + h11 * M[b + c];
    const y = h00 * P[a + c + 1] + h10 * M[a + c + 1] + h01 * P[b + c + 1] + h11 * M[b + c + 1];
    const z = h00 * P[a + c + 2] + h10 * M[a + c + 2] + h01 * P[b + c + 2] + h11 * M[b + c + 2];
    const nrm = Math.hypot(x, y, z) || 1;
    out[c] = x / nrm; out[c + 1] = y / nrm; out[c + 2] = z / nrm;
  }
  slerp(P, a + OFF_Q, P, b + OFF_Q, s, out, OFF_Q);
  return out;
}

/** Spherical linear interpolation of unit quaternions (w, x, y, z), shortest arc, normalised. */
export function slerp(a, ao, b, bo, tau, out, oo) {
  let bw = b[bo], bx = b[bo + 1], by = b[bo + 2], bz = b[bo + 3];
  const aw = a[ao], ax = a[ao + 1], ay = a[ao + 2], az = a[ao + 3];
  let d = aw * bw + ax * bx + ay * by + az * bz;
  if (d < 0) { d = -d; bw = -bw; bx = -bx; by = -by; bz = -bz; }
  const th = Math.acos(Math.min(1, d)), st = Math.sin(th);
  let s0, s1;
  if (st < 1e-12) {
    s0 = 1 - tau; s1 = tau;
  } else {
    s0 = Math.sin((1 - tau) * th) / st; s1 = Math.sin(tau * th) / st;
  }
  const w = s0 * aw + s1 * bw, x = s0 * ax + s1 * bx, y = s0 * ay + s1 * by, z = s0 * az + s1 * bz;
  const n = Math.hypot(w, x, y, z);
  out[oo] = w / n; out[oo + 1] = x / n; out[oo + 2] = y / n; out[oo + 3] = z / n;
  return out;
}
