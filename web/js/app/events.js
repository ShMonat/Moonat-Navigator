// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Special events in the scenarios on screen, for the one-line hint under the timelapse ("🌑 The Earth eclipses the Sun
// from here on 14 Mar 2025: Show me"). Pure functions over the computed results (no DOM), tested in
// web/tests/app_events.test.mjs.
//
// Inputs: items as main.js computes them: { s (C7 scenario), label, t0 (epoch ms, UTC), span (ms, 0 for an instant),
// series | null (C6 series over the mission: t_ms[], earth_vis[], eclipses[]), look | null (C6 series over the next
// 30 days of a single instant) }. C6 eclipses: { start_ms, end_ms, max_ms, max_frac, total_start_ms, total_end_ms }
// (epoch ms UTC; max_frac = share of the Sun's disk the Earth covers at maximum, 1 = total).

import { formatUtc } from "./state.js";

const MIN = 60e3;
/** An eclipse window opened from a single instant: this long before the first and after the last contact. */
export const ECLIPSE_PAD_MS = 30 * MIN;
/** "Show me" an Earthrise: this long after the first sliver clears the skyline, so the Earth is plainly in view. */
export const EARTHRISE_LEAD_MS = 40 * MIN;

const dayText = (ms) => formatUtc(ms).split(",")[0]; // "14 Mar 2025"

function coverText(e) {
  return e.max_frac >= 1 ? "total" : `${Math.max(1, Math.round(e.max_frac * 100))}% covered`;
}

/**
 * The first moment in a C6 series when the Earth clears the skyline after being hidden (vis_frac 0 → > 0), or null.
 * A series that starts with the Earth in view has no Earthrise until the Earth has set.
 */
export function firstEarthrise(series) {
  const t = series?.t_ms;
  const v = series?.earth_vis;
  if (!t || !v || t.length < 2) return null;
  let hidden = !(v[0] > 0.001);
  for (let i = 1; i < t.length; i++) {
    const up = v[i] > 0.001;
    if (up && hidden) return t[i];
    hidden = !up;
  }
  return null;
}

/**
 * The hint to show for the items at `offsetMs` after their start, or null. In order of interest:
 *   1. an eclipse of the Sun by the Earth inside a mission window, unless the sky already shows it:
 *      { kind: "eclipse", item, text, offsetMs (its maximum, ms after that scenario's start), body: "sun" };
 *   2. for a single instant, an eclipse in the next 30 days: { kind: "eclipse-window", item, text, body: "sun",
 *      t_start_utc, t_end_utc, atMs } (the window from 30 min before the first contact to 30 min after the last; atMs:
 *      the maximum, epoch ms);
 *   3. an Earthrise inside a mission window, before the sky gets there: { kind: "earthrise", item, text, offsetMs,
 *      body: "earth" }.
 * `text` is plain text; the page adds the "Show me" button.
 */
export function pickHint(items, offsetMs = 0) {
  const multi = items.length > 1;
  const from = (it) => (multi ? ` from ${it.label}` : " from here");
  for (const it of items) {
    for (const e of it.series?.eclipses || []) {
      const a = (e.start_ms ?? it.t0) - it.t0;
      const b = (e.end_ms ?? it.t0 + it.span) - it.t0;
      const now = Math.min(offsetMs, it.span || 0);
      if (now >= a && now <= b) continue; // the sky is in this eclipse now
      return {
        kind: "eclipse", item: it, body: "sun", offsetMs: e.max_ms - it.t0,
        text: `🌑 The Earth eclipses the Sun${from(it)} on ${dayText(e.max_ms)} (${coverText(e)})`,
      };
    }
  }
  for (const it of items) {
    if (it.series || !it.look) continue;
    const e = (it.look.eclipses || []).find((x) => x.max_ms > it.t0);
    if (!e) continue;
    const start = (e.start_ms ?? e.max_ms) - ECLIPSE_PAD_MS;
    const end = (e.end_ms ?? e.max_ms) + ECLIPSE_PAD_MS;
    return {
      kind: "eclipse-window", item: it, body: "sun", atMs: e.max_ms,
      t_start_utc: new Date(Math.round(start / MIN) * MIN).toISOString().replace(".000Z", "Z"),
      t_end_utc: new Date(Math.round(end / MIN) * MIN).toISOString().replace(".000Z", "Z"),
      text: `🌑 The Earth eclipses the Sun${from(it)} on ${dayText(e.max_ms)} (${coverText(e)})`,
    };
  }
  for (const it of items) {
    if (!it.series) continue;
    const rise = firstEarthrise(it.series);
    if (rise === null) continue;
    const at = rise - it.t0;
    if (Math.min(offsetMs, it.span || 0) >= at) continue; // already risen on screen
    return {
      kind: "earthrise", item: it, body: "earth", offsetMs: Math.min(it.span, at + EARTHRISE_LEAD_MS),
      text: `🌍 The Earth rises over the skyline${from(it)} on ${formatUtc(rise)}`,
    };
  }
  return null;
}
