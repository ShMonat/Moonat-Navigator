// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// AI mode's result, as the panel shows it and as the map receives it. Pure functions (no DOM), tested in Node.
//   - resultSites(final, evaluations): the recommended sites with the numbers of their evaluate_site run (the tool's
//     numbers, not the model's copy of them).
//   - planPlaces(scenarios, sites, maxPlaces): the scenarios after adding sites as places (C7), within the map's limit.

import { parseUtc, isoUtc, normalizeLon } from "../app/state.js";

const near = (a, b, tol = 2e-4) => Math.abs(a - b) <= tol;
const samePlace = (s, p) => Number.isFinite(s.lat_deg) && near(s.lat_deg, p.lat_deg) && near(normalizeLon(s.lon_deg - p.lon_deg), 0);

/**
 * The recommended sites (final_recommendation input) with numbers: each site's `metrics` are the evaluate_site
 * result named by its evaluation_id (source "tool"); when that id is missing or unknown, the evaluation at the same
 * place is used; failing both, the model's own metrics are kept (source "model", shown as not checked).
 * Returns [{ rank, name, site_id, lat_deg, lon_deg, start_utc, end_utc, why, source, evaluation }].
 */
export function resultSites(final, evaluations) {
  const evals = evaluations instanceof Map ? [...evaluations.values()] : Object.values(evaluations || {});
  const byId = new Map(evals.map((e) => [e.evaluation_id, e]));
  return (final?.sites || []).map((s, i) => {
    let ev = byId.get(s.evaluation_id) || null;
    if (!ev) ev = evals.find((e) => samePlace(e, s)) || null;
    const lat = Number(s.lat_deg), lon = normalizeLon(Number(s.lon_deg));
    return {
      rank: i + 1,
      name: String(s.name || ev?.name || "Site").slice(0, 60),
      site_id: ev ? ev.site_id : s.site_id || "",
      lat_deg: ev ? ev.lat_deg : lat,
      lon_deg: ev ? ev.lon_deg : lon,
      start_utc: validIso(s.start_utc) || ev?.start_utc || null,
      end_utc: validIso(s.end_utc) || ev?.end_utc || null,
      why: String(s.why || ""),
      source: ev ? "tool" : "model",
      evaluation: ev,
      model_metrics: s.metrics || null,
    };
  });
}

function validIso(t) {
  const ms = parseUtc(String(t || ""));
  return Number.isFinite(ms) ? isoUtc(ms) : null;
}

/**
 * Add `sites` (resultSites items) as places: scenarios (C7) with the site's name, place and window (t_src "user").
 * A site already shown (same place and start) is not added again; an empty card (no place, not a trip) is filled
 * first; the map holds at most `maxPlaces` places, the rest are skipped.
 * Returns { scenarios (partials for store.setScenarios), focus (index of the first site's scenario, or -1), added,
 * skipped }.
 */
export function planPlaces(scenarios, sites, maxPlaces = 6) {
  const list = scenarios.map((s) => ({ ...s }));
  const hasPlace = (s) => Number.isFinite(s.lat_deg) && Number.isFinite(s.lon_deg);
  let added = 0, skipped = 0, focus = -1;
  for (const site of sites) {
    const fields = {
      label: site.name,
      site_id: site.site_id || null,
      lat_deg: site.lat_deg,
      lon_deg: site.lon_deg,
      t_start_utc: site.start_utc,
      t_end_utc: site.end_utc,
      t_src: "user",
    };
    const have = list.findIndex((s) => !s.route && samePlace(s, site) && s.t_start_utc === site.start_utc && (s.t_end_utc || null) === (site.end_utc || null));
    if (have >= 0) {
      if (focus < 0) focus = have;
      continue;
    }
    const empty = list.findIndex((s) => !hasPlace(s) && !s.route);
    if (empty >= 0) {
      list[empty] = { ...list[empty], ...fields };
      if (focus < 0) focus = empty;
      added++;
      continue;
    }
    if (list.filter(hasPlace).length >= maxPlaces) {
      skipped++;
      continue;
    }
    list.push(fields);
    if (focus < 0) focus = list.length - 1;
    added++;
  }
  return { scenarios: list, focus, added, skipped };
}
