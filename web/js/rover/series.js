// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Sun and Earth along a planned traverse: the rover leaves the start at t0, drives the path at the planned speeds
// (optionally parking every N km), and stays at the end point after arrival. At each time step the sky is computed
// with the existing physics (web/js/physics: makeSite / series, the same visibility, flux and eclipse code) for the
// horizon sample the rover has reached (samples every 100–250 m, each with its own ray-marched horizon).

import { makeSite, series } from "../physics/index.js";
import { seriesSummary } from "../physics/metrics.js";
import { horizonElAt, prepareHorizon } from "../physics/visibility.js";
import { timeline, distanceAtTime, pointAtDistance, bracket } from "./route.js";
import { makePlane } from "./terrain.js";

const ARRAYS = [
  "t_ms", "sun_el", "sun_az", "sun_vis", "flux_horiz_wm2", "flux_normal_wm2", "earth_el", "earth_az", "earth_vis",
  "earth_phase", "earth_ang_diam_deg", "sun_eclipse", "sun_flux_frac",
];

/** Index of the sample nearest to distance d (m) in an ascending list of sample distances. */
export function nearestSample(dist, d) {
  if (dist.length < 2) return 0;
  const i = bracket(dist, d);
  return d - dist[i] <= dist[i + 1] - d ? i : i + 1;
}

/**
 * Where the rover is: a timeline with stops and helpers to get the distance, the position and the sky site at any
 * time since the start (ms). Sites are made once per horizon sample (makeSite with the sample's C3 horizon).
 * @param {object} route   planRoute() result
 * @param {object} [o]     {stop_every_km = 0, stop_h = 0, observer_height_m = 2}
 */
export function routeTrack(route, { stop_every_km = 0, stop_h = 0, observer_height_m = 2 } = {}) {
  const tl = timeline(route.path, { stop_every_km, stop_h });
  const plane = makePlane(route.centre.lat_deg, route.centre.lon_deg);
  const S = route.samples;
  const sites = new Map();
  const siteOf = (k) => {
    if (!sites.has(k)) {
      sites.set(k, makeSite({ lat_deg: S.lat[k], lon_deg: S.lon[k], ground_elev_m: S.horizons[k].ground_elev_m, observer_height_m, horizon: S.horizons[k] }));
    }
    return sites.get(k);
  };
  return {
    timeline: tl,
    arrival_ms: tl.arrival_s * 1000,
    length_m: route.path.dist_m[route.path.dist_m.length - 1],
    /** Distance travelled (m) at dtMs since the start. */
    distanceAt: (dtMs) => distanceAtTime(tl, dtMs / 1000),
    /** Exact position {lat_deg, lon_deg, elev_m} at a distance along the path (m). */
    positionAt(d) {
      const q = pointAtDistance(route.path, d);
      const ll = plane.toLatLon(q.x, q.y);
      return { lat_deg: ll.lat_deg, lon_deg: ll.lon_deg, elev_m: q.elev_m };
    },
    sampleAt: (d) => nearestSample(S.dist_m, d),
    siteOf,
    /** Sky site (C6) of the sample nearest to the rover at dtMs since the start, with its index and distance. */
    siteAt(dtMs) {
      const d = distanceAtTime(tl, dtMs / 1000);
      const k = nearestSample(S.dist_m, d);
      return { site: siteOf(k), k, distance_m: d };
    },
  };
}

/**
 * C6 series along the traverse, from t0Ms to t1Ms every stepMs (same sampling as series()).
 * Consecutive steps at the same horizon sample are evaluated in one series() call at that sample's site, so a
 * zero-length route gives exactly the static-site series. Extra fields (same length as t_ms):
 *   distance_km   distance travelled along the path (surface distance, km)
 *   position      [{lat, lon}] exact rover position (deg) on the path
 *   sample_index  horizon sample used for the sky
 *   sun_hz_el, earth_hz_el   terrain horizon elevation (deg) at the body's azimuth, at the rover's position
 * plus `route: {arrival_ms, length_km, stops}`. `eclipses` (contacts of an eclipse of the Sun by the Earth) come
 * from one series() at the route centre over the whole window (the rover is ≤ 30 km away: contacts shift by < 1 min);
 * `summary` is recomputed from the merged arrays (set times at sample resolution).
 */
export async function routeSeries(route, t0Ms, t1Ms, stepMs, opts = {}) {
  if (!(stepMs > 0)) throw new Error("routeSeries: stepMs must be > 0");
  const track = opts.track || routeTrack(route, opts);
  const n = t1Ms >= t0Ms ? Math.floor((t1Ms - t0Ms) / stepMs + 1e-9) + 1 : 0;
  const out = Object.fromEntries(ARRAYS.map((k) => [k, []]));
  out.distance_km = [];
  out.position = [];
  out.sample_index = [];
  out.sun_hz_el = [];
  out.earth_hz_el = [];
  const ks = new Array(n), ds = new Array(n);
  for (let i = 0; i < n; i++) {
    ds[i] = track.distanceAt(i * stepMs);
    ks[i] = track.sampleAt(ds[i]);
  }
  let eclipsed = false;
  for (let a = 0; a < n;) {
    let b = a;
    while (b + 1 < n && ks[b + 1] === ks[a]) b++;
    const site = track.siteOf(ks[a]);
    const part = await series(site, t0Ms + a * stepMs, t0Ms + b * stepMs, stepMs);
    for (const k of ARRAYS) for (const v of part[k]) out[k].push(v);
    if (part.eclipses.length) eclipsed = true;
    const hz = prepareHorizon(site.horizon);
    for (let i = a; i <= b; i++) {
      const p = track.positionAt(ds[i]);
      out.distance_km.push(ds[i] / 1000);
      out.position.push({ lat: p.lat_deg, lon: p.lon_deg });
      out.sample_index.push(ks[i]);
      out.sun_hz_el.push(horizonElAt(hz, out.sun_az[i]));
      out.earth_hz_el.push(horizonElAt(hz, out.earth_az[i]));
    }
    a = b + 1;
  }
  if (eclipsed) {
    const c = makeSite({ lat_deg: route.centre.lat_deg, lon_deg: route.centre.lon_deg });
    out.eclipses = (await series(c, t0Ms, t1Ms, stepMs)).eclipses;
  } else out.eclipses = [];
  out.summary = seriesSummary(out.t_ms, out.sun_vis, out.earth_vis, out.flux_horiz_wm2, null, null, out.sun_flux_frac);
  out.route = { arrival_ms: t0Ms + track.arrival_ms, length_km: track.length_m / 1000, stops: track.timeline.stops };
  return out;
}
