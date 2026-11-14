// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The page's side of the suggested-dates engine (contract C11 `suggest-dates`, web/js/suggest/index.js): the call for
// a scenario's place, the window a chosen suggestion opens, and the icon and Sun | Earth choice of each kind.

import { suggestDates as engineSuggest } from "../suggest/index.js";

/** Kinds in the order the list shows them (C11 KINDS), with their heading and icon. */
export const SUGGEST_KINDS = [
  { kind: "sun", icon: "☀", heading: "Most sunlight (solar power)" },
  { kind: "earth", icon: "🌍", heading: "Best Earth contact" },
  { kind: "both", icon: "☀🌍", heading: "Sunlight and Earth together" },
  { kind: "eclipse", icon: "🌑", heading: "Eclipses of the Sun by the Earth" },
  { kind: "earthrise", icon: "🌄", heading: "Earthrise over the skyline" },
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

/** Icon of a suggestion kind (✨ for a kind this page does not know). */
export function suggestIcon(kind) {
  return SUGGEST_KINDS.find((k) => k.kind === kind)?.icon ?? "✨";
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
