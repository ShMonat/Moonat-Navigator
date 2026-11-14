// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Site catalog (contract C2, web/data/sites.json), search, and the quick-start presets.

import { DAY_MS, isoUtc, parseUtc } from "./state.js";

const GEN = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.";

// Fallback used only if web/data/sites.json cannot be loaded. Coordinates and times are the commonly
// published NSSDCA/LROC values, rounded; the catalog layer provides the sourced, authoritative list.
const FALLBACK_SITES = [
  { id: "apollo11", name: "Apollo 11 (Tranquility Base)", kind: "mission", agency: "NASA", lander: "Eagle", crew: ["Neil Armstrong", "Buzz Aldrin"], lat_deg: 0.67416, lon_deg: 23.47314, t_start_utc: "1969-07-20T20:17:40Z", t_end_utc: "1969-07-21T17:54:00Z", blurb: "The first crewed landing on the Moon, in the Sea of Tranquility." },
  { id: "apollo12", name: "Apollo 12 (Ocean of Storms)", kind: "mission", agency: "NASA", lander: "Intrepid", crew: ["Pete Conrad", "Alan Bean"], lat_deg: -3.01239, lon_deg: -23.42157, t_start_utc: "1969-11-19T06:54:35Z", t_end_utc: "1969-11-20T14:25:47Z", blurb: "A precision landing next to the Surveyor 3 probe." },
  { id: "apollo14", name: "Apollo 14 (Fra Mauro)", kind: "mission", agency: "NASA", lander: "Antares", crew: ["Alan Shepard", "Edgar Mitchell"], lat_deg: -3.6453, lon_deg: -17.47136, t_start_utc: "1971-02-05T09:18:11Z", t_end_utc: "1971-02-06T18:48:42Z", blurb: "Landed in the Fra Mauro highlands, the original target of Apollo 13." },
  { id: "apollo15", name: "Apollo 15 (Hadley–Apennine)", kind: "mission", agency: "NASA", lander: "Falcon", crew: ["David Scott", "James Irwin"], lat_deg: 26.13222, lon_deg: 3.63386, t_start_utc: "1971-07-30T22:16:29Z", t_end_utc: "1971-08-02T17:11:23Z", blurb: "The first mission with the Lunar Roving Vehicle, beside Hadley Rille." },
  { id: "apollo16", name: "Apollo 16 (Descartes Highlands)", kind: "mission", agency: "NASA", lander: "Orion", crew: ["John Young", "Charles Duke"], lat_deg: -8.97301, lon_deg: 15.50019, t_start_utc: "1972-04-21T02:23:35Z", t_end_utc: "1972-04-24T01:25:47Z", blurb: "The only Apollo landing in the central lunar highlands." },
  { id: "apollo17", name: "Apollo 17 (Taurus–Littrow)", kind: "mission", agency: "NASA", lander: "Challenger", crew: ["Eugene Cernan", "Harrison Schmitt"], lat_deg: 20.1908, lon_deg: 30.77168, t_start_utc: "1972-12-11T19:54:57Z", t_end_utc: "1972-12-14T22:54:37Z", blurb: "The last crewed landing so far, in a deep valley on the edge of the Sea of Serenity." },
  { id: "change4", name: "Chang'e 4 (Von Kármán crater)", kind: "mission", agency: "CNSA", lander: "Chang'e 4", crew: null, lat_deg: -45.4446, lon_deg: 177.5991, t_start_utc: "2019-01-03T02:26:00Z", t_end_utc: null, blurb: "The first soft landing on the far side of the Moon." },
  { id: "chandrayaan3", name: "Chandrayaan-3 (Shiv Shakti point)", kind: "mission", agency: "ISRO", lander: "Vikram", crew: null, lat_deg: -69.373, lon_deg: 32.319, t_start_utc: "2023-08-23T12:33:00Z", t_end_utc: "2023-09-03T00:00:00Z", blurb: "India's first landing, the closest to the south pole at the time." },
  { id: "connecting_ridge", name: "Shackleton–de Gerlache connecting ridge", kind: "candidate", agency: "NASA", lander: null, crew: null, lat_deg: -89.45, lon_deg: -137.3, t_start_utc: null, t_end_utc: null, blurb: "A high ridge near the south pole with long periods of sunlight: an Artemis candidate region." },
];

let sites = [];
let source = "fallback";

/** Load the catalog. Resolves to the array of C2 sites. Never throws. */
export async function loadCatalog(url = "data/sites.json") {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j.sites) || !j.sites.length) throw new Error("no sites");
    sites = j.sites.filter((s) => Number.isFinite(s.lat_deg) && Number.isFinite(s.lon_deg));
    source = "file";
  } catch (err) {
    console.info("[moonat] sites.json not available, using the built-in list:", err.message);
    sites = FALLBACK_SITES.map((s) => ({ ...s, _generated_by: GEN }));
    source = "fallback";
  }
  return sites;
}

export function catalogSites() {
  return sites;
}
export function catalogSource() {
  return source;
}
export function siteById(id) {
  return sites.find((s) => s.id === id) || null;
}

/** Short label for a site: the name without the parenthesised place ("Apollo 11"). */
export function shortName(site) {
  return String(site.name || site.id).replace(/\s*\(.*\)\s*$/, "");
}

const KIND_ORDER = { mission: 0, candidate: 1, poi: 2 };
export const KIND_LABEL = { mission: "Missions", candidate: "Artemis III candidate regions", poi: "Places of interest" };

/**
 * Search sites by free text over name, agency, lander, crew, blurb and group name (so "Artemis" finds the candidate
 * regions). All query words must match.
 * Returns sites ranked: name-prefix matches first, then by kind and name.
 */
export function searchSites(query, list = sites) {
  const words = String(query || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter(Boolean);
  const norm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const scored = [];
  for (const s of list) {
    const name = norm(s.name);
    const hay = [name, norm(s.id), norm(s.agency), norm(s.lander), norm((s.crew || []).join(" ")), norm(s.blurb), norm(KIND_LABEL[s.kind])].join(" ");
    if (!words.every((w) => hay.includes(w))) continue;
    let score = KIND_ORDER[s.kind] ?? 3;
    if (words.length && name.startsWith(words[0])) score -= 10;
    else if (words.length && name.includes(words[0])) score -= 5;
    scored.push([score, s]);
  }
  scored.sort((a, b) => a[0] - b[0] || naturalCompare(a[1].name, b[1].name));
  return scored.map((x) => x[1]);
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

/** Find a site in the catalog by candidate ids, then by a name pattern (and optional kind). */
export function matchSite(ids = [], namePattern = null, kind = null, list = sites) {
  for (const id of ids) {
    const s = list.find((x) => x.id === id);
    if (s) return s;
  }
  if (namePattern) {
    const s = list.find((x) => namePattern.test(x.name || "") && (!kind || x.kind === kind));
    if (s) return s;
  }
  return null;
}

/** Turn a catalog site into the fields of a C7 scenario (label, site_id, lat, lon, times). */
export function scenarioFieldsFromSite(site, { start = null, end = undefined } = {}) {
  const t0 = start || site.t_start_utc || null;
  let t1 = end !== undefined ? end : site.t_end_utc || null;
  // Very long surface missions (rovers, multi-year landers) are trimmed to their first ~month.
  if (end === undefined && t0 && t1 && parseUtc(t1) - parseUtc(t0) > CATALOG_SPAN_LIMIT_MS) t1 = isoUtc(parseUtc(t0) + CATALOG_TRIM_MS);
  return { label: shortName(site), site_id: site.id, lat_deg: site.lat_deg, lon_deg: site.lon_deg, t_start_utc: t0, t_end_utc: t1 };
}

/** Missions longer than this load trimmed to CATALOG_TRIM_MS (one lunar day-night cycle). */
export const CATALOG_SPAN_LIMIT_MS = 60 * DAY_MS;
export const CATALOG_TRIM_MS = 30 * DAY_MS;

/** True when a scenario holds a trimmed version of a long catalog mission. */
export function isTrimmedMission(scenario, site) {
  if (!site || !site.t_start_utc || !site.t_end_utc || scenario.t_start_utc !== site.t_start_utc || !scenario.t_end_utc) return false;
  const full = parseUtc(site.t_end_utc) - parseUtc(site.t_start_utc);
  return full > CATALOG_SPAN_LIMIT_MS && Math.abs(parseUtc(scenario.t_end_utc) - parseUtc(site.t_start_utc) - CATALOG_TRIM_MS) < 60e3;
}

// ---------------------------------------------------------------------------------------------
// Quick starts. Each resolves to a list of partial scenarios against the loaded catalog.

const APOLLO = [11, 12, 14, 15, 16, 17];
// Two lunar months at the Shackleton rim point of Gläser et al. (2014), from the end of the southern summer into the
// season when the Sun skims the horizon (scan of Dec 2026 to May 2027 at 30 min steps, Sun and Earth with the LOLA
// horizon). Opening instant: the Sun 0.07 deg above the local horizontal in the south, lighting the crater rim with long
// shadows, and a 18%-lit crescent Earth 5.8 deg up in the south-east. Later the Sun drops below the horizontal and
// distant peaks hide it three times (17 Feb, 17 Mar, 21 Mar); about 94% of the window is sunlit.
const POLE_START = "2027-01-19T00:00:00Z";
const POLE_END = "2027-03-22T00:00:00Z";

export const QUICK_STARTS = [
  {
    key: "apollo11",
    label: "Apollo 11 · 1969",
    title: "The sky Neil Armstrong and Buzz Aldrin saw from Tranquility Base",
    resolve: (list) => [fromMatch(list, ["apollo11", "apollo_11", "a11"], /apollo\s*11\b/i)],
  },
  {
    key: "apollo-all",
    label: "Compare all Apollo landings",
    title: "Which Apollo crew had the best view of Earth and the most sunlight?",
    resolve: (list) => APOLLO.map((n) => fromMatch(list, [`apollo${n}`, `apollo_${n}`, `a${n}`], new RegExp(`apollo\\s*${n}\\b`, "i"))),
  },
  {
    key: "pole",
    label: "South pole ridge",
    title: "Near the south pole the Sun skims the horizon with long shadows, and distant peaks switch the sunlight on and off (two lunar months)",
    resolve: (list) => {
      const s = matchSite(["shackleton_rim", "connecting_ridge", "connecting-ridge", "shackleton_ridge"], /connecting ridge|ridge|shackleton/i, null, list) ||
        matchSite([], /south pole/i, null, list) || FALLBACK_SITES.find((x) => x.id === "connecting_ridge");
      return [{ ...scenarioFieldsFromSite(s, { start: POLE_START, end: POLE_END }) }];
    },
  },
  {
    key: "farside",
    label: "Far side (Chang'e 4)",
    title: "From the far side, Earth never rises: the first two weeks after Chang'e 4 landed",
    resolve: (list) => {
      const s = fromMatch(list, ["change4", "change_4", "chang_e_4", "change-4"], /chang.?e.?4/i);
      const t0 = parseUtc(s.t_start_utc);
      return [{ ...s, t_end_utc: isoUtc(t0 + 14 * DAY_MS) }];
    },
  },
];

function fromMatch(list, ids, pattern) {
  const site = matchSite(ids, pattern, null, list) || matchSite(ids, pattern, null, FALLBACK_SITES);
  return scenarioFieldsFromSite(site);
}
