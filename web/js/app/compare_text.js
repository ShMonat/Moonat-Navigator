// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Text for the Sun and Earth data under the sky that depends only on the numbers (no DOM): eclipse lines, chart captions and the ranked
// summary of several scenarios. Pure functions, tested in web/tests/app_compare_text.test.mjs.

import { formatDuration, formatUtc } from "./state.js";
import { EARTH_NEVER_RISES_DEG } from "../sky/words.js";
import { stats, pctAbove } from "./derive.js";

// ---------------------------------------------------------------------------------------------
// Ranked summary ("Which crew had the most sunlight and the best view of Earth?")

const one = (v) => ({ min: v, max: v, mean: v });

/**
 * One summary row per scenario. Missions: share of the stay with sunlight (C6 sun_flux_frac > 0, so a total eclipse is
 * dark), Sun and Earth elevation (min, max, mean, deg), Earth phase (lit fraction 0..1) and the share of the stay with
 * Earth in view (earth_vis > 0). Single instants: the same at that instant (sunlight and Earth in view are 100 or 0).
 * items: Compare items [{ s, label, color, series | null, state0 }].
 */
export function rankRows(items) {
  return items.map((it) => {
    const base = { id: it.s.id, label: it.label, color: it.color };
    const se = it.series;
    if (se) {
      return {
        ...base, instant: false, sunlit: pctAbove(se.sun_flux_frac ?? se.sun_vis), sunEl: stats(se.sun_el),
        earthEl: stats(se.earth_el), earthLit: stats(se.earth_phase), earthUp: pctAbove(se.earth_vis),
      };
    }
    const st = it.state0;
    return {
      ...base, instant: true, sunlit: (st.sun.flux_frac ?? st.sun.vis_frac) > 0 ? 100 : 0, sunEl: one(st.sun.el_deg),
      earthEl: one(st.earth.el_deg), earthLit: one(st.earth.phase_frac), earthUp: st.earth.vis_frac > 0 ? 100 : 0,
    };
  });
}

/** Sort keys of the summary; larger is better for each. "lit" counts only when the Earth is ever in view. */
export const RANK_KEYS = {
  sunlit: (r) => r.sunlit,
  sun: (r) => r.sunEl.mean,
  earth: (r) => r.earthEl.mean,
  lit: (r) => (r.earthUp > 0 ? r.earthLit.mean : -1),
};
const TIE = { sunlit: 0.5, sun: 0.05, earth: 0.05, lit: 0.005 };

/** Rows sorted best first by `key`; ties fall back to sunlight, Sun height, Earth phase and Earth height. */
export function sortRows(rows, key = "sunlit") {
  const order = [key, ...["sunlit", "sun", "lit", "earth"].filter((k) => k !== key)];
  return [...rows].sort((a, b) => {
    for (const k of order) {
      const d = RANK_KEYS[k](b) - RANK_KEYS[k](a);
      if (Math.abs(d) > TIE[k]) return d;
    }
    return 0;
  });
}

/** Ids of the rows with the best value of `key`, or an empty set when all rows tie (nothing stands out). */
export function bestIds(rows, key) {
  if (rows.length < 2) return new Set();
  const vals = rows.map(RANK_KEYS[key]);
  const max = Math.max(...vals), min = Math.min(...vals);
  if (max - min <= TIE[key] || (key === "lit" && max < 0)) return new Set();
  return new Set(rows.filter((r) => max - RANK_KEYS[key](r) <= TIE[key]).map((r) => r.id));
}

/**
 * One sentence that answers the question, e.g. "All 6 have sunlight the whole time. Highest Sun: Apollo 16 (15° to 50°).
 * Highest Earth: Apollo 16 (73° to 77°). Fullest Earth: Apollo 11 (58% to 67% lit)." The leaders are by the mean over the
 * stay; the ranges are lowest to highest. Plain text (labels are not escaped).
 */
export function rankSentence(rows) {
  if (rows.length < 2) return "";
  const out = [];
  const lead = (key) => sortRows(rows, key)[0];
  const deg0 = (x) => `${x < -0.5 ? "−" : ""}${Math.abs(x).toFixed(0)}°`;
  const span = (st, f, unit = "") => (f(st.min) === f(st.max) ? `${f(st.mean)}${unit}` : `${f(st.min)} to ${f(st.max)}${unit}`);
  const pc = (x) => `${Math.round(x * 100)}%`;
  if (bestIds(rows, "sunlit").size === 0) {
    const p = rows[0].sunlit;
    out.push(p >= 99.5 ? `All ${rows.length} have sunlight the whole time.` : p <= 0.5 ? "None has sunlight." : `All ${rows.length} have sunlight ${Math.round(p)}% of the time.`);
  } else {
    out.push(`Most sunlight: ${lead("sunlit").label} (${Math.round(lead("sunlit").sunlit)}% of the time).`);
  }
  if (bestIds(rows, "sun").size) out.push(`Highest Sun: ${lead("sun").label} (${span(lead("sun").sunEl, deg0)}).`);
  if (rows.every((r) => r.earthUp === 0)) out.push("Earth never rises at any of them.");
  else {
    if (bestIds(rows, "earth").size) out.push(`Highest Earth: ${lead("earth").label} (${span(lead("earth").earthEl, deg0)}).`);
    if (bestIds(rows, "lit").size) out.push(`Fullest Earth: ${lead("lit").label} (${span(lead("lit").earthLit, pc, " lit")}).`);
  }
  return out.join(" ");
}

/**
 * Where a site sits relative to the Earth: "near" (the Earth stays more than ~15° up), "limb" (the poles and the limb:
 * the Earth skims the horizon and libration lifts and lowers it), "far" (it never rises; see earthNeverRises in
 * web/js/sky/words.js). From the angular distance d (deg) between the site and the mean sub-Earth point (0° N, 0° E):
 * near d < 75°, limb 75°–105°, far d > 105°. Inputs: selenographic latitude and east longitude (deg).
 */
export function earthSide(latDeg, lonDeg) {
  const r = Math.PI / 180;
  const d = Math.acos(Math.max(-1, Math.min(1, Math.cos(latDeg * r) * Math.cos(lonDeg * r)))) / r;
  if (!Number.isFinite(d)) return "near";
  return d > EARTH_NEVER_RISES_DEG ? "far" : d >= 75 ? "limb" : "near";
}

const EARTH_EL_BASE = "Height above the flat, ideal horizon. Dotted: the real terrain horizon in that direction.";
const EARTH_EL_SIDE = {
  near: "From the near side, Earth stays in about the same spot: libration rocks it by up to about 8° over a month.",
  limb: "Near the poles and the limb, Earth skims the horizon, and libration moves it up and down by several degrees, so hills can hide it.",
  far: "From the far side, Earth never rises: it stays below the horizon.",
};
const EARTH_EL_SHORT = { near: "Near side: Earth barely moves.", limb: "Poles and limb: it skims the horizon.", far: "Far side: it never rises." };

/** Caption of the Earth elevation chart for the scenarios shown ([{ s: { lat_deg, lon_deg } }]). */
export function earthElCaption(items) {
  const sides = [...new Set(items.map((it) => earthSide(it.s.lat_deg, it.s.lon_deg)))];
  if (sides.length === 1) return `${EARTH_EL_BASE} ${EARTH_EL_SIDE[sides[0]]}`;
  return `${EARTH_EL_BASE} ${["near", "limb", "far"].filter((k) => sides.includes(k)).map((k) => EARTH_EL_SHORT[k]).join(" ")}`;
}

/**
 * One line for the many eclipses of a long stay (more than two), e.g. "8 eclipses of the Sun by the Earth (5 total,
 * the longest totality 1 h 46 min), the first on 15 Jun 2030". HTML.
 */
export function eclipseSummary(eclipses) {
  const total = eclipses.filter((e) => e.max_frac >= 1);
  const longest = Math.max(0, ...total.filter((e) => e.total_start_ms != null && e.total_end_ms != null).map((e) => e.total_end_ms - e.total_start_ms));
  const first = formatUtc(eclipses[0].max_ms).split(",")[0];
  const kinds = total.length ? `${total.length} total${longest > 0 ? `, the longest totality ${formatDuration(longest)}` : ""}` : "all partial";
  return `<strong>${eclipses.length} eclipses of the Sun by the Earth</strong> (${kinds}), the first on ${first}`;
}

/**
 * Card text for the eclipses of the Sun by the Earth in a mission window (C6 series().eclipses), e.g.
 * "Earth eclipses the Sun: total for 2 h 17 min (06:17–08:34 UTC), partly covered 05:01–09:51 UTC".
 * Totality = the site in the Earth's umbra (eclipse_frac = 1); the partial span = first to last contact at the site
 * (the site in the penumbra). A phase cut by the window says "before the start" / "after the end".
 * t0, t1: window start and end (epoch ms, UTC). Returns HTML ("" when there is no eclipse).
 */
export function eclipseText(eclipses, t0, t1) {
  if (!eclipses || !eclipses.length) return "";
  if (eclipses.length > 2) return eclipseSummary(eclipses);
  const sameDay = new Date(t0).toISOString().slice(0, 10) === new Date(t1).toISOString().slice(0, 10);
  const clock = (ms) => {
    const s = formatUtc(ms); // "14 Mar 2025, 06:17 UTC"
    const hm = s.slice(-9, -4);
    return sameDay ? hm : `${s.slice(0, s.indexOf(" ", s.indexOf(" ") + 1))} ${hm}`;
  };
  const from = (ms) => (ms != null ? clock(ms) : "before the start");
  const to = (ms) => (ms != null ? clock(ms) : "after the end");
  return eclipses
    .map((e) => {
      const span = `${from(e.start_ms)}–${to(e.end_ms)} UTC`;
      if (e.max_frac >= 1) {
        const a = e.total_start_ms ?? t0, b = e.total_end_ms ?? t1;
        return `<strong>Earth eclipses the Sun</strong>: total for ${formatDuration(b - a)} (${from(e.total_start_ms)}–${to(e.total_end_ms)} UTC), partly covered ${span}`;
      }
      return `<strong>Earth eclipses the Sun</strong>: up to ${Math.round(e.max_frac * 100)}% covered at ${clock(e.max_ms)} UTC (${span})`;
    })
    .join("<br>");
}
