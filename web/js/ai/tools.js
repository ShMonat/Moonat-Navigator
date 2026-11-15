// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// AI mode's tools: thin wrappers over Moonat's own browser physics that the Claude agent (web/js/ai/agent.js) calls.
// The model never computes physics: every number it may cite comes from here.
//   - set_requirements: the model states the mission's requirements and its assumptions (shown in the panel).
//   - find_candidate_sites: catalog sites (contract C2) and NASA PGDA's most-sunlit spots (web/data/overlays).
//   - evaluate_site: one C6 series over the mission window with the real terrain horizon (C3 for catalog sites, C9
//     Moon Trek for other points, C5 tiles as the fallback): Sun and Earth shares, longest night and blackout, eclipses.
//   - suggest_dates: the suggested-dates engine (C11).
//   - final_recommendation: ends the run; the panel shows its ranked sites.
// All dependencies are injected (createTools(deps)), so the Node tests run the same code on the real ephemeris.

import { chooseStep, isoUtc, parseUtc, describeYears, coverageEnd, normalizeLon, DAY_MS } from "../app/state.js";
import { pctAbove } from "../app/derive.js";
import { longestRun } from "../app/playback.js";

/** The app's eye height above the ground (m), as everywhere in Moonat. Masts are not modelled in AI mode. */
export const EYE_HEIGHT_M = 2;
/** Caps per run (the browser does the physics, so keep a run to a minute or two). */
export const MAX_EVALUATIONS = 8;
export const MAX_TOOL_CALLS = 12;
/** Longest window evaluate_site accepts (the app's limit for one scenario). */
export const MAX_WINDOW_MS = 30 * 365.25 * DAY_MS;
/** Wait at most this long for NASA Moon Trek terrain before using the coarse tiles horizon. */
export const LIVE_TERRAIN_TIMEOUT_MS = 40e3;

const MOON_R_KM = 1737.4;
const REGIONS = ["south_pole", "north_pole", "near_side", "far_side", "anywhere"];
const SITE_KINDS = ["mission", "candidate", "poi", "home", "sunlit_spot"];
const SUGGEST_KINDS = ["sun", "earth", "both", "eclipse", "earthrise"];

/** What the StarHab siting study found (docs/research/starhab_site.md, 2030-2040), quoted for the home site. */
const STARHAB_KNOWN =
  "StarHab siting study (Moonat, 2030-2040): Sun 76.7 % / Earth 67.4 % at a 2 m eye; Sun 82.0 % / Earth 98.3 % " +
  "with a 10 m mast (longest night 7.0 d, no Earth blackout). Chosen from 80 648 screened polar points.";

const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const days = (ms) => round(ms / DAY_MS, 2);

// ---------------------------------------------------------------------------------------------
// Tool definitions (JSON Schema, strict: every object closed and every field required)

const num = (description) => ({ type: "number", description });
const str = (description) => ({ type: "string", description });
const obj = (properties, description) => ({
  type: "object",
  ...(description ? { description } : {}),
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** The tool definitions sent to the Messages API, in a fixed order (a stable prefix for prompt caching). */
export const TOOL_DEFS = [
  {
    name: "set_requirements",
    description:
      "Call this FIRST, exactly once, before any other tool. State the mission's requirements as explicit, checkable " +
      "numbers, and list every assumption you made where the user was vague. The panel shows them to the user.",
    strict: true,
    input_schema: obj({
      mission_summary: str("One plain sentence: what the mission is."),
      region: { type: "string", enum: REGIONS, description: "Where on the Moon to look." },
      start_utc: str("Mission start, ISO 8601 UTC, e.g. 2030-01-01T00:00:00Z. Moonat covers 1966-1976 and 2013-2040."),
      end_utc: str("Mission end, ISO 8601 UTC."),
      min_sun_pct: num("Minimum mean visible share of the Sun's flux (0-100); 0 if sunlight does not matter."),
      min_earth_pct: num("Minimum mean visible share of the Earth's disk (0-100); 0 if Earth contact does not matter."),
      max_night_days: num("Longest tolerable stretch without sunlight (days); 0 if no limit."),
      max_blackout_days: num("Longest tolerable stretch with the Earth fully hidden (days); 0 if no limit or if the Earth must stay hidden."),
      earth_must_be_hidden: { type: "boolean", description: "True when the site must NOT see the Earth (e.g. radio quiet)." },
      mobility: str("Fixed site, or rover range in km, as the user implies."),
      assumptions: { type: "array", items: { type: "string" }, description: "Each assumption in one short plain sentence." },
    }),
  },
  {
    name: "find_candidate_sites",
    description:
      "List candidate places from Moonat's catalog (landing sites of past missions, NASA's potential Artemis sites, " +
      "places of interest, the StarHab home base) and NASA PGDA's most-sunlit spots near both poles (ground-level " +
      "share of time with any sunlight over 18.6 years, at least 70 %). Call this to find sites before evaluating them. " +
      "The lit % of a sunlit spot is NASA's ground-level value; it is a screening number, not a mission result.",
    strict: true,
    input_schema: obj({
      region: { type: "string", enum: REGIONS, description: "south_pole / north_pole: poleward of 80 deg; near_side / far_side: the rest, by longitude; anywhere." },
      min_sunlit_pct: num("Only sunlit spots lit at least this share of the time (0-100; 0 keeps all). Catalog sites have no lit % and are not filtered by it."),
      kinds: { type: "array", items: { type: "string", enum: SITE_KINDS }, description: "Kinds to include; empty means all." },
      max_results: { type: "integer", description: "At most this many sites (1-40)." },
    }),
  },
  {
    name: "evaluate_site",
    description:
      "Run Moonat's validated physics for one place over a time window: JPL DE421 Sun and Earth positions, the real " +
      "NASA LOLA terrain horizon, eclipses of the Sun by the Earth. Returns the mean visible share of the Sun's flux, " +
      "the share of time with sunlight, the longest night, the Earth's mean visible share, the share of time with any " +
      "Earth in view, the longest Earth blackout, the mean flux on a Sun-facing panel and the eclipse count. Eye height " +
      "2 m. Takes a few seconds per site (longer for points outside the catalog: their terrain is downloaded). At most 8 per run.",
    strict: true,
    input_schema: obj({
      name: str("A short name for the place, e.g. 'Malapert massif crest'."),
      site_id: str("The catalog id from find_candidate_sites (e.g. 'art_malapert'), or '' for any other point."),
      lat_deg: num("Selenographic latitude, degrees (south negative)."),
      lon_deg: num("East longitude, degrees (-180 to 180)."),
      start_utc: str("Window start, ISO 8601 UTC."),
      end_utc: str("Window end, ISO 8601 UTC (up to 30 years after the start)."),
    }),
  },
  {
    name: "suggest_dates",
    description:
      "Moonat's suggested-dates engine for one place: the best windows for solar power (sun), direct-to-Earth contact " +
      "(earth) or both at once, plus eclipses and Earthrises, between two dates. Use it when the mission's dates are " +
      "flexible, e.g. to choose the best 14 days in a year.",
    strict: true,
    input_schema: obj({
      name: str("The place's short name."),
      site_id: str("Catalog id, or '' for any other point."),
      lat_deg: num("Latitude, degrees."),
      lon_deg: num("East longitude, degrees."),
      from_utc: str("Search from, ISO 8601 UTC."),
      to_utc: str("Search to, ISO 8601 UTC (the engine searches up to a few years)."),
      window_days: num("Length of each window in days (0 = one lunar day, 14.8 d)."),
      kinds: { type: "array", items: { type: "string", enum: SUGGEST_KINDS }, description: "Which kinds of windows; empty means sun, earth and both." },
    }),
  },
  {
    name: "final_recommendation",
    description:
      "Call this LAST to end the run: the recommended sites, best first (1 to 5), each with its window and the " +
      "evaluation_id of the evaluate_site result its numbers come from. Every number in 'why' must come from a tool result.",
    strict: true,
    input_schema: obj({
      summary: str("Two or three plain sentences: the answer and the main trade-off."),
      assumptions: { type: "array", items: { type: "string" }, description: "The assumptions the answer rests on." },
      sites: {
        type: "array",
        description: "Recommended sites, best first.",
        items: obj({
          name: str("Short name."),
          site_id: str("Catalog id or ''."),
          lat_deg: num("Latitude, degrees."),
          lon_deg: num("East longitude, degrees."),
          start_utc: str("Suggested start, ISO 8601 UTC."),
          end_utc: str("Suggested end, ISO 8601 UTC."),
          evaluation_id: str("The evaluation_id (e.g. 'E2') of the evaluate_site result for this site and window, or ''."),
          why: str("One to three plain sentences citing the tool's numbers."),
          metrics: obj({
            sun_pct: num("Sun visible share (%) as returned by evaluate_site."),
            earth_pct: num("Earth visible share (%) as returned."),
            longest_night_days: num("Longest night (days) as returned."),
            longest_blackout_days: num("Longest Earth blackout (days) as returned."),
          }, "The key numbers as the tool returned them."),
        }),
      },
    }),
  },
];

/** Names of the tools, in order. */
export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

// ---------------------------------------------------------------------------------------------
// Geometry helpers (pure)

/** Great-circle distance on the 1737.4 km sphere between two selenographic points (deg) -> km. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * MOON_R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** True when the point (deg, east lon) lies in `region` (REGIONS). Poles: poleward of 80 deg; sides by longitude. */
export function inRegion(lat, lon, region) {
  const L = normalizeLon(lon);
  switch (region) {
    case "south_pole": return lat <= -80;
    case "north_pole": return lat >= 80;
    case "near_side": return Math.abs(lat) < 80 && Math.abs(L) <= 90;
    case "far_side": return Math.abs(lat) < 80 && Math.abs(L) > 90;
    default: return true;
  }
}

/** "85.95 S, 3.42 W". */
export function latLonText(lat, lon) {
  const L = normalizeLon(lon);
  return `${Math.abs(lat).toFixed(2)} ${lat < 0 ? "S" : "N"}, ${Math.abs(L).toFixed(2)} ${L < 0 ? "W" : "E"}`;
}

// ---------------------------------------------------------------------------------------------
// find_candidate_sites (pure: data in, list out)

/**
 * Candidate sites: catalog sites (C2) and PGDA sunlit spots ([lat, lon, area_km2, lit_pct] rows), filtered by region
 * and kind; spots also by min_sunlit_pct and thinned to one per 2 km (the most lit kept). Spots come first, most lit
 * first; then catalog sites (home, potential Artemis sites, places of interest, missions). Each spot is named after
 * the nearest catalog site within 40 km.
 */
export function findCandidates({ region = "anywhere", min_sunlit_pct = 0, kinds = [], max_results = 15 }, sites = [], spotRows = []) {
  const want = new Set(kinds && kinds.length ? kinds : SITE_KINDS);
  const reg = REGIONS.includes(region) ? region : "anywhere";
  const n = Math.max(1, Math.min(40, Math.round(Number(max_results) || 15)));
  const minLit = Number(min_sunlit_pct) || 0;
  const out = [];
  if (want.has("sunlit_spot")) {
    const rows = spotRows
      .filter(([la, lo, , lit]) => inRegion(la, lo, reg) && lit >= minLit)
      .sort((a, b) => b[3] - a[3]);
    const kept = [];
    for (const r of rows) {
      if (kept.some((k) => distanceKm(k[0], k[1], r[0], r[1]) < 2)) continue;
      kept.push(r);
    }
    for (const [la, lo, area, lit] of kept) {
      let near = null;
      for (const s of sites) {
        const d = distanceKm(la, lo, s.lat_deg, s.lon_deg);
        if (d < 40 && (!near || d < near.d)) near = { name: s.name, d };
      }
      out.push({
        kind: "sunlit_spot", site_id: "", name: `Sunlit spot ${latLonText(la, lo)}${near ? `, ${round(near.d, 0)} km from ${near.name}` : ""}`,
        lat_deg: la, lon_deg: lo, pgda_lit_time_pct: lit, area_km2: area,
      });
    }
  }
  const order = { home: 0, candidate: 1, poi: 2, mission: 3 };
  const cat = sites
    .filter((s) => want.has(s.kind) && inRegion(s.lat_deg, s.lon_deg, reg))
    .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  for (const s of cat) {
    const row = { kind: s.kind, site_id: s.id, name: s.name, lat_deg: s.lat_deg, lon_deg: s.lon_deg };
    if (s.kind === "mission") Object.assign(row, { agency: s.agency || "", landed_utc: s.t_start_utc || "" });
    if (s.kind === "home") row.known = STARHAB_KNOWN;
    if (s.blurb) row.about = String(s.blurb).slice(0, 160);
    out.push(row);
  }
  // Keep a mix: when both groups are asked for, give the catalog at least a third of the places.
  let list = out;
  if (out.length > n) {
    const spots = out.filter((r) => r.kind === "sunlit_spot");
    const catalog = out.filter((r) => r.kind !== "sunlit_spot");
    const nCat = Math.min(catalog.length, Math.max(n - spots.length, Math.ceil(n / 3)));
    list = [...spots.slice(0, n - nCat), ...catalog.slice(0, nCat)];
  }
  return {
    region: reg,
    count: list.length,
    sites: list,
    note:
      "pgda_lit_time_pct: NASA PGDA (Mazarico et al. 2011), share of time with any sunlight at ground level over 18.6 " +
      "years, 240 m or 60 m pixels. Catalog sites have no precomputed numbers here: evaluate them.",
  };
}

// ---------------------------------------------------------------------------------------------
// evaluate_site metrics (pure: a C6 series in, numbers out)

/**
 * The mission numbers of a C6 series (arrays of equal length, evenly spaced samples):
 *   sun_visible_pct = mean sun_flux_frac x 100 (visible share of the Sun's limb-darkened flux, terrain and Earth);
 *   sunlit_time_pct = share of samples with sun_flux_frac > 0 (the app's "of the stay with sunlight");
 *   earth_visible_pct = mean earth_vis x 100; earth_in_view_time_pct = share with earth_vis > 0;
 *   sun_and_earth_time_pct = share with both > 0;
 *   longest night / blackout = longest stretch with sun_flux_frac = 0 / earth_vis = 0 (playback.js longestRun);
 *   mean_flux_sun_facing_wm2 = mean flux_normal_wm2; eclipse_count = series.eclipses.length.
 */
export function seriesMetrics(se) {
  const n = se.t_ms.length;
  const sun = se.sun_flux_frac ?? se.sun_vis;
  let fs = 0, fe = 0, fn = 0, both = 0;
  for (let i = 0; i < n; i++) {
    fs += sun[i];
    fe += se.earth_vis[i];
    fn += se.flux_normal_wm2[i];
    if (sun[i] > 0 && se.earth_vis[i] > 0) both++;
  }
  const night = longestRun(se.t_ms, sun);
  const black = longestRun(se.t_ms, se.earth_vis);
  const ecl = se.eclipses || [];
  return {
    sun_visible_pct: round(n ? (100 * fs) / n : 0),
    sunlit_time_pct: round(pctAbove(sun)),
    longest_night_days: days(night.ms),
    longest_night_start_utc: night.start_ms != null ? isoUtc(night.start_ms) : null,
    mean_flux_sun_facing_wm2: round(n ? fn / n : 0, 0),
    earth_visible_pct: round(n ? (100 * fe) / n : 0),
    earth_in_view_time_pct: round(pctAbove(se.earth_vis)),
    longest_blackout_days: days(black.ms),
    longest_blackout_start_utc: black.start_ms != null ? isoUtc(black.start_ms) : null,
    sun_and_earth_time_pct: round(n ? (100 * both) / n : 0),
    eclipse_count: ecl.length,
    total_eclipse_count: ecl.filter((e) => e.total_start_ms != null).length,
  };
}

/**
 * Check and clip a window to the ephemeris coverage `years`: the start must be in a covered year; the end is clipped
 * to the end of that run of covered years and to MAX_WINDOW_MS. Returns { t0, t1, note } or { error }.
 */
export function checkWindow(startUtc, endUtc, years) {
  const t0 = parseUtc(String(startUtc || ""));
  let t1 = parseUtc(String(endUtc || ""));
  if (!Number.isFinite(t0)) return { error: `start_utc "${startUtc}" is not a date (use ISO 8601 UTC).` };
  if (!Number.isFinite(t1)) return { error: `end_utc "${endUtc}" is not a date (use ISO 8601 UTC).` };
  if (t1 <= t0) return { error: "end_utc must be after start_utc." };
  const cov = years && years.length ? years : null;
  const notes = [];
  if (cov) {
    const runEnd = coverageEnd(t0, cov);
    if (runEnd === null) return { error: `Moonat's ephemeris covers ${describeYears(cov)}; the start ${isoUtc(t0)} is outside it.` };
    if (t1 > runEnd - 3600e3) {
      t1 = runEnd - 3600e3;
      notes.push(`end clipped to ${isoUtc(t1)} (the ephemeris ends there)`);
    }
  }
  if (t1 - t0 > MAX_WINDOW_MS) {
    t1 = t0 + MAX_WINDOW_MS;
    notes.push(`end clipped to ${isoUtc(t1)} (30-year limit)`);
  }
  if (t1 <= t0) return { error: "The window is empty after clipping to the ephemeris coverage." };
  return { t0, t1, note: notes.join("; ") || null };
}

// ---------------------------------------------------------------------------------------------
// The tool runner

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), ms))),
  ]);
}

/**
 * Create the tool runner. deps:
 *   sites(): C2 catalog sites; spotRows(): Promise of PGDA rows [lat, lon, area_km2, lit_pct];
 *   catalogHorizon(siteId): Promise<C3 | null>; liveTerrain(lat, lon): Promise<terrainAt result> (optional);
 *   tilesHorizon(lat, lon): Promise<C3 | null>; makeSite(spec); series(site, t0, t1, step): Promise<C6 series>;
 *   suggest(spec, opts): Promise<C11 list>; coverage(): covered years; onProgress(text) (optional).
 * Returns { run(name, input) -> Promise<result object>, evaluations: Map(id -> result), counts }.
 * A result with `error` is sent back to the model as an error tool result.
 */
export function createTools(deps) {
  const evaluations = new Map();
  const horizons = new Map(); // key -> Promise<{horizon, label, quality}>
  const counts = { calls: 0, evaluations: 0 };
  const say = (t) => deps.onProgress?.(t);

  /** The catalog site for an id, or one within ~15 m of the point. */
  function catalogSite(siteId, lat, lon) {
    const list = deps.sites() || [];
    if (siteId) {
      const s = list.find((x) => x.id === siteId);
      if (s) return s;
    }
    return list.find((x) => Math.abs(x.lat_deg - lat) < 5e-4 && Math.abs(normalizeLon(x.lon_deg - lon)) < 5e-4) || null;
  }

  /** The horizon for a place: the catalog's C3 file, else NASA Moon Trek (C9), else the coarse tiles, else none. */
  function horizonFor(site, lat, lon, name) {
    const key = site ? `site:${site.id}` : `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (!horizons.has(key)) {
      horizons.set(key, (async () => {
        if (site) {
          const h = await deps.catalogHorizon(site.id).catch(() => null);
          if (h) return { horizon: h, quality: "real", label: "NASA LOLA horizon precomputed for this catalog site (0.25 deg steps, up to 20 m DEM near the poles)" };
        }
        if (deps.liveTerrain) {
          say(`Downloading NASA terrain for ${name}`);
          try {
            const r = await withTimeout(deps.liveTerrain(lat, lon), LIVE_TERRAIN_TIMEOUT_MS);
            if (r?.horizon && !r.horizon.approximate) {
              const res = r.meta?.resolution_m ? `${Math.round(r.meta.resolution_m)} m` : "LOLA";
              return { horizon: r.horizon, quality: "real", label: `NASA LOLA terrain via Moon Trek (${res}), computed in the browser` };
            }
            if (r?.horizon) return { horizon: r.horizon, quality: "approximate", label: "approximate horizon (coarse LOLA tiles; Moon Trek unavailable)" };
          } catch {
            // fall through to the tiles
          }
        }
        const h = await deps.tilesHorizon(lat, lon).catch(() => null);
        if (h) return { horizon: h, quality: "approximate", label: "approximate horizon (coarse LOLA tiles, about 0.5-4 km)" };
        return { horizon: null, quality: "none", label: "no terrain (smooth horizon): treat the numbers as rough" };
      })());
    }
    return horizons.get(key);
  }

  function placeOf(input) {
    const lat = Number(input.lat_deg);
    const lon = normalizeLon(Number(input.lon_deg));
    if (!(lat >= -90 && lat <= 90)) return { error: `lat_deg ${input.lat_deg} is not a latitude (-90 to 90).` };
    if (!Number.isFinite(lon)) return { error: `lon_deg ${input.lon_deg} is not a longitude.` };
    const site = catalogSite(String(input.site_id || ""), lat, lon);
    return site ? { site, lat: site.lat_deg, lon: site.lon_deg } : { site: null, lat, lon };
  }

  async function evaluateSite(input) {
    if (counts.evaluations >= MAX_EVALUATIONS) {
      return { error: `Limit reached: at most ${MAX_EVALUATIONS} site evaluations per run. Call final_recommendation now with the sites already evaluated.` };
    }
    const p = placeOf(input);
    if (p.error) return p;
    const w = checkWindow(input.start_utc, input.end_utc, deps.coverage());
    if (w.error) return w;
    counts.evaluations++;
    const name = String(input.name || (p.site ? p.site.name : latLonText(p.lat, p.lon))).slice(0, 80);
    const hz = await horizonFor(p.site, p.lat, p.lon, name);
    say(`Computing ${name}: ${isoUtc(w.t0).slice(0, 10)} to ${isoUtc(w.t1).slice(0, 10)}`);
    const site = deps.makeSite({ lat_deg: p.lat, lon_deg: p.lon, observer_height_m: EYE_HEIGHT_M, horizon: hz.horizon });
    const step = chooseStep(w.t1 - w.t0);
    const se = await deps.series(site, w.t0, w.t1, step);
    const m = seriesMetrics(se);
    const id = `E${evaluations.size + 1}`;
    const result = {
      evaluation_id: id,
      name,
      site_id: p.site?.id || "",
      lat_deg: round(p.lat, 5),
      lon_deg: round(p.lon, 5),
      start_utc: isoUtc(w.t0),
      end_utc: isoUtc(w.t1),
      window_days: days(w.t1 - w.t0),
      ...(w.note ? { window_note: w.note } : {}),
      ...m,
      ground_elev_m: Number.isFinite(hz.horizon?.ground_elev_m) ? Math.round(hz.horizon.ground_elev_m) : null,
      terrain: hz.label,
      terrain_quality: hz.quality,
      eye_height_m: EYE_HEIGHT_M,
      sampling: `every ${round(step / 3600e3, 2)} h, ${se.t_ms.length} samples`,
      notes:
        "Eye 2 m above the ground (the app's standard). Masts are not modelled: near the poles a 10 m mast usually " +
        "raises both shares (StarHab study: Earth 67 % at 2 m, 98 % at 10 m). Line of sight only, not a link budget.",
    };
    evaluations.set(id, result);
    say(`${name}: Sun ${Math.round(m.sun_visible_pct)} %, Earth ${Math.round(m.earth_visible_pct)} %, longest night ${round(m.longest_night_days, 1)} d`);
    return result;
  }

  async function suggest(input) {
    const p = placeOf(input);
    if (p.error) return p;
    const t0 = parseUtc(String(input.from_utc || ""));
    const t1 = parseUtc(String(input.to_utc || ""));
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return { error: "from_utc and to_utc must be ISO 8601 UTC dates, from before to." };
    const name = String(input.name || (p.site ? p.site.name : latLonText(p.lat, p.lon))).slice(0, 80);
    const hz = await horizonFor(p.site, p.lat, p.lon, name);
    say(`Searching dates at ${name}`);
    const kinds = (input.kinds || []).filter((k) => SUGGEST_KINDS.includes(k));
    const wd = Number(input.window_days);
    let list;
    try {
      list = await deps.suggest(
        { lat_deg: p.lat, lon_deg: p.lon, horizon: hz.horizon, observer_height_m: EYE_HEIGHT_M },
        { from: t0, to: t1, kinds: kinds.length ? kinds : ["sun", "earth", "both"], limit: 3, ...(wd > 0 ? { durationMs: wd * DAY_MS } : {}) },
      );
    } catch (err) {
      return { error: `The date search failed: ${err?.message || err}` };
    }
    const meta = list.meta || {};
    return {
      name,
      site_id: p.site?.id || "",
      searched: meta.from_utc ? `${meta.from_utc} to ${meta.to_utc}` : null,
      terrain: hz.label,
      eye_height_m: EYE_HEIGHT_M,
      windows: list.map((g) => ({
        kind: g.kind, rank: g.rank, start_utc: g.t_start_utc, end_utc: g.t_end_utc, ...(g.t_max_utc ? { max_utc: g.t_max_utc } : {}),
        score_pct: round(100 * (g.score ?? 0)), title: g.title, detail: g.detail, ...(g.note ? { note: true } : {}),
      })),
      scores: "sun: mean visible Sun flux share; earth: mean Earth disk share; both: mean of min(Sun, Earth) at each moment.",
    };
  }

  async function find(input) {
    const rows = await deps.spotRows().catch(() => []);
    return findCandidates(input, deps.sites() || [], rows || []);
  }

  async function run(name, input = {}) {
    if (name !== "final_recommendation" && name !== "set_requirements") {
      counts.calls++;
      if (counts.calls > MAX_TOOL_CALLS) {
        return { error: `Limit reached: at most ${MAX_TOOL_CALLS} tool calls per run. Call final_recommendation now.` };
      }
    }
    switch (name) {
      case "set_requirements": return { ok: true, note: "Requirements recorded and shown to the user. Now find and evaluate sites." };
      case "find_candidate_sites": return find(input);
      case "evaluate_site": return evaluateSite(input);
      case "suggest_dates": return suggest(input);
      case "final_recommendation": return { ok: true };
      default: return { error: `Unknown tool ${name}.` };
    }
  }

  return { run, evaluations, counts };
}
