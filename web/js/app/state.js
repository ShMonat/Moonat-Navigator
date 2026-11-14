// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Scenario model (contract C7), validation, time helpers and the shareable URL hash.
// Pure functions only (no DOM), so they run under `node --test`.
//
// C7 scenario: { id, label, color, site_id | null, lat_deg, lon_deg, t_start_utc, t_end_utc | null }
//   - lat_deg: selenographic latitude, deg, -90..90 (MOON_ME frame).
//   - lon_deg: east-positive longitude, deg, -180..180.
//   - t_start_utc / t_end_utc: ISO-8601 UTC strings ("1969-07-20T20:17:40Z"); no end = a single instant.
//   - color: index into PALETTE (an integer slot). The hex value depends on the theme (see colorHex).

/** Categorical, colour-blind-safe palette (validated order; light and dark steps of the same hues). */
export const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"],
};

export const HOUR_MS = 3600e3;
export const DAY_MS = 86400e3;
/** Longest span we compute at once. Longer spans are refused politely. */
export const MAX_SPAN_MS = 120 * DAY_MS;
// Above this span the card notes that the series takes a moment (a series always has about 1000 samples, see chooseStep).
export const SLOW_SPAN_MS = 75 * DAY_MS;

/** Hex colour for a palette slot in a theme. Slots beyond the palette wrap (the UI adds dashes then). */
export function colorHex(slot, theme = "dark") {
  const p = PALETTE[theme] || PALETTE.dark;
  const i = ((Number(slot) || 0) % p.length + p.length) % p.length;
  return p[i];
}

/** True when a slot has wrapped past the palette, so lines need a second encoding (dash). */
export function isWrappedSlot(slot) {
  return Number(slot) >= PALETTE.dark.length;
}

/** Lowest palette slot not used by any scenario. Colours follow the scenario, never its rank. */
export function nextColorSlot(scenarios) {
  const used = new Set(scenarios.map((s) => s.color));
  let i = 0;
  while (used.has(i)) i++;
  return i;
}

let idCounter = 0;
/** Short unique id for a scenario. */
export function newId() {
  idCounter = (idCounter + 1) % 1e6;
  return "s" + Date.now().toString(36).slice(-4) + idCounter.toString(36) + Math.floor(Math.random() * 36 ** 2).toString(36);
}

/** Make a C7 scenario, filling defaults. `existing` is used to choose a free colour. */
export function makeScenario(partial = {}, existing = []) {
  return {
    id: partial.id || newId(),
    label: partial.label ?? "",
    color: Number.isInteger(partial.color) ? partial.color : nextColorSlot(existing),
    site_id: partial.site_id ?? null,
    lat_deg: numOrNull(partial.lat_deg),
    lon_deg: numOrNull(partial.lon_deg),
    t_start_utc: partial.t_start_utc || null,
    t_end_utc: partial.t_end_utc || null,
    // Rover traverse (contract C10, web/js/rover/): lat/lon is the start; the field exists only for traverses.
    ...(partial.route ? { route: { ...partial.route } } : {}),
  };
}

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const TAIL_RE = "(?:[,\\s]+(?:at\\s+)?(\\d{1,2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?))?\\s*(Z|UTC|[+-]\\d{2}:?\\d{2})?";
// "20 July 1969", "20-Jul-1969 20:17", "July 20, 1969 20:17:40 UTC"
const DAY_MONTH_YEAR = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+${MONTH_RE}[,\\s-]+(\\d{4})${TAIL_RE}$`, "i");
const MONTH_DAY_YEAR = new RegExp(`^${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})${TAIL_RE}$`, "i");

/** English month-name dates and "YYYY/MM/DD" -> the "YYYY-MM-DD hh:mm:ss zone" form parseUtc reads; other text as is. */
function normalizeDateText(s) {
  let m = DAY_MONTH_YEAR.exec(s);
  if (m) return `${m[3]}-${MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1}-${m[1]}${m[4] ? " " + m[4] : ""}${m[5] ? " " + m[5] : ""}`;
  m = MONTH_DAY_YEAR.exec(s);
  if (m) return `${m[3]}-${MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1}-${m[2]}${m[4] ? " " + m[4] : ""}${m[5] ? " " + m[5] : ""}`;
  return s.replace(/^(-?\d{4})\/(\d{1,2})\/(\d{1,2})(?=$|[\sT])/, "$1-$2-$3");
}

/**
 * Parse a UTC time string to epoch milliseconds. Accepts ISO-8601 with or without "Z" and seconds,
 * "YYYY-MM-DD hh:mm[:ss]" with a space (one-digit month, day and hour allowed), "YYYY/MM/DD", English month names
 * ("20 July 1969 20:17", "Jul 20, 1969"), and an optional "UTC" suffix. Values without a zone are read as UTC.
 * Numeric day-month orders such as "07/20/1969" are refused (ambiguous).
 * Returns NaN when the string is not a time.
 */
export function parseUtc(str) {
  if (typeof str !== "string") return NaN;
  const s = normalizeDateText(str.trim());
  const m = /^(-?\d{4})-(\d{1,2})-(\d{1,2})(?:(?:T|\s+)(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(Z|UTC|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (!m) return NaN;
  const [, y, mo, d, h = "0", mi = "0", se = "0", frac = "0", zone] = m;
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se, Math.round(Number("0." + frac) * 1000));
  // Reject overflow such as month 13 or day 32.
  const chk = new Date(Date.UTC(+y, +mo - 1, +d));
  if (chk.getUTCMonth() !== +mo - 1 || chk.getUTCDate() !== +d || +h > 23 || +mi > 59 || +se > 59) return NaN;
  if (zone && zone.toUpperCase() !== "Z" && zone.toUpperCase() !== "UTC") {
    const sign = zone[0] === "-" ? -1 : 1;
    const z = zone.slice(1).replace(":", "");
    ms -= sign * (+z.slice(0, 2) * 60 + +z.slice(2, 4)) * 60e3;
  }
  return ms;
}

/** Epoch ms -> "YYYY-MM-DDTHH:MM:SSZ" (UTC, whole seconds). */
export function isoUtc(ms) {
  return new Date(Math.round(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

/** Epoch ms -> the value format of <input type="datetime-local" step="1">, read as UTC. */
export function toInputValue(ms) {
  if (!Number.isFinite(ms)) return "";
  return isoUtc(ms).slice(0, 19);
}

/** Epoch ms -> "YYYY-MM-DD hh:mm:ss" (UTC, 24-hour clock), the text of the scenario time fields. */
export function toUtcText(ms) {
  if (!Number.isFinite(ms)) return "";
  return isoUtc(ms).slice(0, 19).replace("T", " ");
}

/** Epoch ms -> "20 Jul 1969, 20:17 UTC". */
export function formatUtc(ms, { seconds = false } = {}) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const p = (n) => String(n).padStart(2, "0");
  const t = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${seconds ? ":" + p(d.getUTCSeconds()) : ""}`;
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}, ${t} UTC`;
}

/** Duration in ms -> short human text: "45 min", "3 h 20 min", "2 d 5 h", "18 d". */
export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "";
  const neg = ms < 0;
  let m = Math.round(Math.abs(ms) / 60e3);
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  let out;
  if (d >= 10) out = `${d + (h >= 12 ? 1 : 0)} d`;
  else if (d > 0) out = h ? `${d} d ${h} h` : `${d} d`;
  else if (h > 0) out = m ? `${h} h ${m} min` : `${h} h`;
  else out = `${m} min`;
  return neg ? "−" + out : out;
}

/** Normalise a longitude in degrees to -180..180 (east-positive). 0..360 inputs are accepted. */
export function normalizeLon(lon) {
  if (!Number.isFinite(lon)) return lon;
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  if (x === -180 && lon > 0) x = 180;
  return x;
}

/** "12.34° S" style label for a latitude, "45.60° E" for a longitude. */
export function fmtLat(lat, digits = 2) {
  if (!Number.isFinite(lat)) return "";
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? "N" : "S"}`;
}
export function fmtLon(lon, digits = 2) {
  if (!Number.isFinite(lon)) return "";
  return `${Math.abs(lon).toFixed(digits)}° ${lon >= 0 ? "E" : "W"}`;
}

/** Automatic name of a custom point: "Point 36.3° S, 119.3° E" (selenographic, east-positive longitude). */
export function pointLabel(lat, lon) {
  return `Point ${fmtLat(lat, 1)}, ${fmtLon(normalizeLon(lon), 1)}`;
}

/** True for a name made by pointLabel (or the older "Point -36.3°, 119.3°" form), which may be replaced freely. */
export function isPointLabel(label) {
  return /^Point -?\d+(?:\.\d+)?° ?[NS]?, -?\d+(?:\.\d+)?° ?[EW]?$/.test(String(label || ""));
}

/**
 * Validate a scenario. Returns { ok, complete, errors: {field: message}, warnings: [message] }.
 * `coverage` (optional) is a list of years the ephemeris covers; times outside them are errors.
 */
export function validateScenario(s, coverage = null) {
  const errors = {};
  const warnings = [];
  const hasLoc = s.lat_deg !== null && s.lon_deg !== null;
  if (s.lat_deg !== null && !(s.lat_deg >= -90 && s.lat_deg <= 90)) errors.lat_deg = "Latitude must be between −90° (south pole) and 90° (north pole).";
  if (s.lon_deg !== null && !(s.lon_deg >= -180 && s.lon_deg <= 180)) errors.lon_deg = "Longitude must be between −180° and 180° (east is positive).";
  const t0 = s.t_start_utc ? parseUtc(s.t_start_utc) : NaN;
  const t1 = s.t_end_utc ? parseUtc(s.t_end_utc) : NaN;
  if (s.t_start_utc && !Number.isFinite(t0)) errors.t_start_utc = "That start time is not a valid date: please write it as YYYY-MM-DD hh:mm (UTC), e.g. 1969-07-20 20:17.";
  if (s.t_end_utc && !Number.isFinite(t1)) errors.t_end_utc = "That end time is not a valid date: please write it as YYYY-MM-DD hh:mm (UTC).";
  // Coverage first: a date outside the tables is the message that matters, not the span it makes.
  if (coverage && coverage.length) {
    const years = new Set(coverage);
    const yrs = [t0, t1].filter(Number.isFinite).map((t) => new Date(t).getUTCFullYear());
    if (yrs.some((y) => !years.has(y))) {
      const field = Number.isFinite(t0) && !years.has(new Date(t0).getUTCFullYear()) ? "t_start_utc" : "t_end_utc";
      errors[field] = `Moonat's sky tables cover ${describeYears(coverage)} (the Apollo era, and today's and upcoming missions). Please pick a date in those years.`;
    }
  }
  if (Number.isFinite(t0) && Number.isFinite(t1) && !errors.t_start_utc && !errors.t_end_utc) {
    if (t1 <= t0) errors.t_end_utc = "The end time must be after the start time.";
    else if (t1 - t0 > MAX_SPAN_MS) errors.t_end_utc = `Please keep a mission under ${Math.round(MAX_SPAN_MS / DAY_MS)} days.`;
    else if (t1 - t0 > SLOW_SPAN_MS) warnings.push("Long spans take a moment to compute.");
  }
  const complete = hasLoc && Number.isFinite(t0);
  return { ok: complete && Object.keys(errors).length === 0, complete, errors, warnings };
}

/** [1966..1976, 2013..2040] -> "1966–1976 and 2013–2040". */
export function describeYears(years) {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  const runs = [];
  for (const y of ys) {
    const last = runs[runs.length - 1];
    if (last && y === last[1] + 1) last[1] = y;
    else runs.push([y, y]);
  }
  const parts = runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`));
  return parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0] || "";
}

/**
 * End (epoch ms, exclusive) of the run of consecutive covered years that contains tMs: e.g. 1977-01-01 for a time in
 * 1969 when 1966–1976 are covered. Null when there is no coverage list or tMs is outside it.
 */
export function coverageEnd(tMs, years) {
  if (!years || !years.length || !Number.isFinite(tMs)) return null;
  const set = new Set(years);
  let y = new Date(tMs).getUTCFullYear();
  if (!set.has(y)) return null;
  while (set.has(y + 1)) y++;
  return Date.UTC(y + 1, 0, 1);
}

/** Times of a valid scenario in epoch ms: { t0, t1 (null for an instant), span (0 for an instant) }. */
export function scenarioTimes(s) {
  const t0 = parseUtc(s.t_start_utc);
  const t1 = s.t_end_utc ? parseUtc(s.t_end_utc) : null;
  return { t0, t1: Number.isFinite(t1) ? t1 : null, span: Number.isFinite(t1) ? t1 - t0 : 0 };
}

/** Sample step (ms) for a span: about 1000 samples, at least 5 min, rounded to whole minutes. */
export function chooseStep(spanMs) {
  const raw = Math.max(5 * 60e3, spanMs / 1000);
  return Math.ceil(raw / 60e3) * 60e3;
}

/** Signature of everything that changes the physics result of a scenario (not label or colour). */
export function physicsKey(s) {
  return [s.site_id || "", s.lat_deg, s.lon_deg, s.t_start_utc, s.t_end_utc || ""].join("|") + (s.route ? `|${JSON.stringify(s.route)}` : "");
}

// ---------------------------------------------------------------------------------------------
// URL hash: "#tab=sky&x=utc&b=earth&t=5250&look=sun&v=258.9,12.5,40&s=<base64url(JSON)>"; every key is optional.
//   tab: "sky" (default Compare); x: Compare time axis ("utc" | "dist", default mission elapsed time); b: "earth" (default
//   Sun section); Sky tab: t = time since the scenarios' start (whole seconds), look = "earth" | "sun" (the last Look
//   button), v = camera of the first sky view: azimuth, elevation, horizontal field of view (deg, local horizon frame);
//   s = the scenarios. Links made before t, look and v existed decode as before.
// s JSON = [[label, lat, lon, start, end|0, site_id|0, color(, route)], ...]
// route (rover traverses only): [end_lat, end_lon, preset, speed_mps, max_slope_deg, max_cross_deg, stop_every_km, stop_h]

const ROUTE_FIELDS = ["end_lat_deg", "end_lon_deg", "preset", "speed_mps", "max_slope_deg", "max_cross_deg", "stop_every_km", "stop_h"];

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const b = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "===".slice((b.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * Encode the app state into a URL hash string (with the leading "#"). `sky` (optional, Sky tab only):
 * { offsetMs, look, view: { az_deg, el_deg, fov_deg } }, as returned by the Sky tab; null fields are left out.
 */
export function encodeHash({ scenarios, tab = "compare", xaxis = "met", body = "sun", sky = null }) {
  const rows = scenarios.map((s) => [
    s.label || "",
    s.lat_deg === null ? null : round(s.lat_deg, 5),
    s.lon_deg === null ? null : round(s.lon_deg, 5),
    s.t_start_utc || 0,
    s.t_end_utc || 0,
    s.site_id || 0,
    s.color,
    ...(s.route ? [ROUTE_FIELDS.map((k) => s.route[k] ?? 0)] : []),
  ]);
  const p = new URLSearchParams();
  if (tab !== "compare") p.set("tab", tab);
  if (xaxis !== "met") p.set("x", xaxis);
  if (body === "earth") p.set("b", body);
  if (sky) {
    const t = Math.round((Number(sky.offsetMs) || 0) / 1000);
    if (t > 0) p.set("t", String(t));
    if (sky.look === "earth" || sky.look === "sun") p.set("look", sky.look);
    const v = sky.view;
    if (v && [v.az_deg, v.el_deg, v.fov_deg].every(Number.isFinite)) {
      p.set("v", [((v.az_deg % 360) + 360) % 360, v.el_deg, v.fov_deg].map((x) => String(round(x, 2))).join(","));
    }
  }
  p.set("s", b64urlEncode(JSON.stringify(rows)));
  return "#" + p.toString();
}

/**
 * Decode a URL hash. Returns { scenarios, tab, tabGiven, xaxis, body, sky: { offsetMs, look, view } } (sky fields null
 * when absent), with scenarios = [] for a link without them (e.g. "#tab=sky"). Null when the hash holds nothing
 * Moonat knows, or broken scenarios.
 */
export function decodeHash(hash) {
  if (!hash || hash.length < 2) return null;
  try {
    const p = new URLSearchParams(hash.replace(/^#/, ""));
    const s = p.get("s");
    if (!s && !["tab", "x", "b", "t", "look", "v"].some((k) => p.has(k))) return null;
    const rows = s ? JSON.parse(b64urlDecode(s)) : [];
    if (!Array.isArray(rows)) return null;
    const scenarios = [];
    for (const r of rows.slice(0, 64)) {
      if (!Array.isArray(r)) continue;
      const [label, lat, lon, start, end, site, color, rt] = r;
      const route = Array.isArray(rt)
        ? Object.fromEntries(ROUTE_FIELDS.map((k, i) => [k, k === "preset" ? String(rt[i] || "viper").slice(0, 16) : Number(rt[i]) || 0]))
        : null;
      scenarios.push(
        makeScenario(
          {
            label: typeof label === "string" ? label.slice(0, 80) : "",
            lat_deg: lat,
            lon_deg: lon,
            t_start_utc: typeof start === "string" ? start : null,
            t_end_utc: typeof end === "string" ? end : null,
            site_id: typeof site === "string" ? site : null,
            color: Number.isInteger(color) && color >= 0 && color < 256 ? color : undefined,
            route,
          },
          scenarios,
        ),
      );
    }
    const tab = p.get("tab") === "sky" ? "sky" : "compare";
    const xaxis = ["utc", "dist"].includes(p.get("x")) ? p.get("x") : "met";
    const body = p.get("b") === "earth" ? "earth" : "sun";
    const t = Number(p.get("t"));
    const look = ["earth", "sun"].includes(p.get("look")) ? p.get("look") : null;
    const v = (p.get("v") || "").split(",").map(Number);
    const view = v.length === 3 && v.every(Number.isFinite) && v[2] > 0 ? { az_deg: v[0], el_deg: v[1], fov_deg: v[2] } : null;
    const sky = { offsetMs: Number.isFinite(t) && t > 0 ? t * 1000 : null, look, view };
    return { scenarios, tab, tabGiven: p.has("tab"), xaxis, body, sky };
  } catch {
    return null;
  }
}

function round(x, d) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

// ---------------------------------------------------------------------------------------------
// Mission duration as a view of the end time (the scenario model keeps t_end_utc).

const DUR_UNIT_MS = { min: 60e3, h: 3600e3, d: 86400e3 };

/**
 * Parse a duration typed by the user: "36 h", "2.5 d", "90 min", "21h36m", "1d 6h" or a bare number (read in
 * `defaultUnit`, "h" or "d"). A comma may be the decimal mark. Returns { ms, unit } where `unit` is the last unit the
 * text used, or null when the text is not a positive finite duration.
 */
export function parseDuration(text, defaultUnit = "h") {
  if (typeof text !== "string") return null;
  const s = text.trim().toLowerCase().replace(/,/g, ".");
  if (!s) return null;
  const unitOf = (u) => {
    if (/^(d|day|days)$/.test(u)) return "d";
    if (/^(h|hr|hrs|hour|hours)$/.test(u)) return "h";
    if (/^(m|min|mins|minute|minutes)$/.test(u)) return "min";
    return null;
  };
  if (/^(\d+(\.\d+)?|\.\d+)$/.test(s)) {
    const v = Number(s);
    return v > 0 ? { ms: v * DUR_UNIT_MS[defaultUnit], unit: defaultUnit } : null;
  }
  const re = /(\d+(?:\.\d+)?|\.\d+)\s*([a-z]+)\s*/gy;
  let ms = 0;
  let unit = null;
  let pos = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    unit = unitOf(m[2]);
    if (!unit) return null;
    ms += Number(m[1]) * DUR_UNIT_MS[unit];
    pos = re.lastIndex;
  }
  if (pos !== s.length || !unit || !(ms > 0) || !Number.isFinite(ms)) return null;
  return { ms, unit };
}

/** Unit for showing a duration: hours below two days, days from two days up. */
export function durationUnit(ms) {
  return Math.abs(ms) < 2 * 86400e3 ? "h" : "d";
}

/** Duration in ms -> the number shown in a duration field for `unit` ("h" or "d"), rounded to 1 (hours) or 2 (days) decimals. */
export function durationValueText(ms, unit = durationUnit(ms)) {
  if (!Number.isFinite(ms)) return "";
  return String(+(ms / DUR_UNIT_MS[unit]).toFixed(unit === "h" ? 1 : 2));
}

/** End time (ISO string) from a start time string and a duration in ms, or null when either is unusable. */
export function endFromDuration(startUtc, ms) {
  const t0 = parseUtc(startUtc);
  return Number.isFinite(t0) && Number.isFinite(ms) && ms > 0 ? isoUtc(t0 + ms) : null;
}
