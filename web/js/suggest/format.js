// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Text helpers for the suggested dates: UTC dates and times, durations and percentages, in the
// short English forms used by the titles ("14.8 d of continuous sunlight from 19 Jan 2027").

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const toMinute = (ms) => new Date(Math.round(ms / 60e3) * 60e3);

/** "19 Jan 2027" (UTC calendar date of the epoch ms, rounded to the minute). */
export function fmtDate(ms) {
  const d = toMinute(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "14:05" (UTC clock time, rounded to the minute; the caller adds "UTC"). */
export function fmtTime(ms) {
  const d = toMinute(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "19 Jan 2027, 14:05 UTC". */
export function fmtDateTime(ms) {
  return `${fmtDate(ms)}, ${fmtTime(ms)} UTC`;
}

/** Duration: "45 min", "2 h 10 min" (below two days), "14.8 d" (one decimal, ".0" dropped). */
export function fmtDur(ms) {
  const min = Math.round(ms / 60e3);
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) {
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${(ms / 86400e3).toFixed(1).replace(/\.0$/, '')} d`;
}

/** Percentage of a 0..1 fraction: "86 %", with "<1 %" and ">99 %" so that 0 and 100 mean exactly that. */
export function fmtPct(x) {
  const p = 100 * x;
  if (p > 0 && p < 0.5) return '<1 %';
  if (p >= 99.5 && p < 100) return '>99 %';
  return `${Math.round(p)} %`;
}

/** ISO-8601 UTC string to the second ("2027-01-19T14:05:00Z"), or null. */
export function iso(ms) {
  return ms === null || ms === undefined ? null : new Date(Math.round(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

/** Angle in degrees with one decimal ("4.2°"). */
export function fmtDeg(x) {
  return `${(Math.round(x * 10) / 10).toFixed(1)}°`;
}
