// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Node bridge for scripts/validate_horizons_js.py: evaluates the browser physics (web/js/physics,
// contract C6) at the requested sites and UTC instants and prints the results as JSON.
// It calls both skyState() and series() (a one-sample window), so both public paths are checked.
//
// stdin:  {"ephem_dir": "<abs path to web/data/ephem>",
//          "states": [{"id", "lat_deg", "lon_deg", "ground_elev_m", "observer_height_m", "t_utc"}]}
// stdout: {"node": "<version>", "states": [{"id", "t_ms", "sky": {...}, "series": {...}}]}
// Units: degrees, km, UTC epoch ms (as in C6). The ICRS->ENU matrix is row-major.
import { readFile } from 'node:fs/promises';
import { loadEphem, makeSite, skyState, series } from '../web/js/physics/index.js';

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// fetch()-like reader of local files: the physics module asks for "<ephem_dir>/<name>".
async function localFetch(path) {
  try {
    const buf = await readFile(path);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => ab };
  } catch {
    return { ok: false, status: 404 };
  }
}

const req = await readStdin();
await loadEphem(req.ephem_dir, { fetch: localFetch });

const out = [];
for (const s of req.states) {
  const site = makeSite({
    lat_deg: s.lat_deg, lon_deg: s.lon_deg, ground_elev_m: s.ground_elev_m, observer_height_m: s.observer_height_m,
  });
  const tMs = Date.parse(s.t_utc);
  if (!Number.isFinite(tMs)) throw new Error(`bad time ${s.t_utc}`);
  const st = await skyState(site, tMs);
  const se = await series(site, tMs, tMs, 60000);
  const body = (b) => ({
    az_deg: b.az_deg, el_deg: b.el_deg, dist_km: b.dist_km, ang_radius_deg: b.ang_radius_deg, enu: b.enu,
  });
  out.push({
    id: s.id,
    t_ms: tMs,
    sky: {
      sun: { ...body(st.sun), eclipse_frac: st.sun.eclipse_frac },
      earth: { ...body(st.earth), phase_frac: st.earth.phase_frac },
      r_icrs_to_enu: st.r_icrs_to_enu,
    },
    series: {
      sun_az: se.sun_az[0], sun_el: se.sun_el[0], sun_eclipse: se.sun_eclipse[0],
      earth_az: se.earth_az[0], earth_el: se.earth_el[0], earth_phase: se.earth_phase[0],
      earth_ang_diam_deg: se.earth_ang_diam_deg[0],
    },
  });
}
process.stdout.write(JSON.stringify({ node: process.version, states: out }));
