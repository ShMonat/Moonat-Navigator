// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The page's side of the suggested-dates engine (contract C11 `suggest-dates`, web/js/suggest/index.js): the call for
// a scenario's place, the window a chosen suggestion opens, and the icon and Sun | Earth choice of each kind.

import { suggestDates as engineSuggest } from "../suggest/index.js";
import { icon } from "./icons.js";

/** Kinds in the order the list shows them (C11 KINDS), with their heading and icons (web/js/app/icons.js names). */
export const SUGGEST_KINDS = [
  { kind: "sun", icons: ["sun"], heading: "Most sunlight (solar power)" },
  { kind: "earth", icons: ["earth"], heading: "Best Earth contact" },
  { kind: "both", icons: ["sun", "earth"], heading: "Sunlight and Earth together" },
  { kind: "eclipse", icons: ["eclipse"], heading: "Eclipses of the Sun by the Earth" },
  { kind: "earthrise", icons: ["earthrise"], heading: "Earthrise over the skyline" },
];

/** Suggestions per kind in the list: the best and the next best. */
export const SUGGEST_LIMIT = 2;
/** An eclipse or an Earthrise opens this long before its first and after its last contact. */
export const EVENT_PAD_MS = 30 * 60e3;

/**
 * Suggested dates for a place (C11): site = { lat_deg, lon_deg (deg, selenographic, east-positive), horizon (C3 or
 * null) }; opts = { from, to (epoch ms, UTC), durationMs (window length; undefined: the engine's lunar day), signal,
 * onProgress }. Resolves to the engine's list; rejects with an AbortError when the signal aborts.
 */
export function suggestDates(site, opts) {
  return engineSuggest(site, { ...opts, limit: SUGGEST_LIMIT });
}

/**
 * What a place's suggestions depend on beyond the dates: a catalog site's id, or a custom point's position and whether
 * its horizon is the real NASA Moon Trek one ("ready"), the coarse fallback ("fallback") or still approximate while
 * the terrain loads ("approx"). terrainStatus: terrain_live.js terrainState() of the point. The calendar searches
 * again when this changes while it is open.
 */
export function suggestKey(s, terrainStatus) {
  if (s.site_id) return `site:${s.site_id}`;
  const t = terrainStatus === "ready" || terrainStatus === "fallback" ? terrainStatus : "approx";
  return `${s.lat_deg},${s.lon_deg}:${t}`;
}

/** The caveat over a custom point's suggestions while its horizon is not the real terrain, else null. */
export function suggestCaveat(s, terrainStatus) {
  if (s.site_id || !Number.isFinite(s.lat_deg) || !Number.isFinite(s.lon_deg) || terrainStatus === "ready") return null;
  return terrainStatus === "fallback"
    ? "Approximate horizon (NASA Moon Trek could not be reached): hills nearby are missing."
    : "Approximate horizon until NASA terrain arrives: these dates then update.";
}

/** Icon of a suggestion kind as SVG markup (icons.js; the "suggest" sparkle for a kind this page does not know). */
export function suggestIcon(kind) {
  const names = SUGGEST_KINDS.find((k) => k.kind === kind)?.icons ?? ["suggest"];
  return names.map((n) => icon(n)).join("");
}

/** The page's Sun | Earth choice that fits a suggestion kind: "sun", "earth", or null (keep the current one). */
export function suggestBody(kind) {
  if (kind === "sun" || kind === "eclipse") return "sun";
  if (kind === "earth" || kind === "earthrise") return "earth";
  return null;
}

/**
 * The scenario times a chosen suggestion opens (all ISO-8601 UTC): { t_start_utc, t_end_utc, at_utc | null }.
 * A window (sun, earth, both) is the window itself. An event (eclipse, Earthrise) is its own span with EVENT_PAD_MS on
 * each side, and the sky opens at its maximum (`t_max_utc`). Null for a note (a statement without times).
 */
export function suggestWindow(g) {
  if (!g || g.note || !g.t_start_utc) return null;
  const t0 = Date.parse(g.t_start_utc);
  const t1 = g.t_end_utc ? Date.parse(g.t_end_utc) : NaN;
  if (!Number.isFinite(t0)) return null;
  const iso = (ms) => new Date(Math.round(ms / 60e3) * 60e3).toISOString().replace(".000Z", "Z");
  if (g.kind === "eclipse" || g.kind === "earthrise") {
    const at = g.t_max_utc ? Date.parse(g.t_max_utc) : NaN;
    const a = t0 - EVENT_PAD_MS;
    const b = (Number.isFinite(t1) ? t1 : t0) + EVENT_PAD_MS;
    return { t_start_utc: iso(a), t_end_utc: iso(b), at_utc: Number.isFinite(at) ? new Date(at).toISOString() : null };
  }
  return { t_start_utc: g.t_start_utc, t_end_utc: Number.isFinite(t1) && t1 > t0 ? g.t_end_utc : null, at_utc: null };
}
