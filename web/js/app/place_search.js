// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// "Search the Moon" (the search box on the globe), pure part: typed coordinates, the grouped result list (Home, then
// missions, potential Artemis sites and places of interest) and the one-line subtitle of each place.
// No DOM, so node tests can import it (web/tests/app_places.test.mjs). The box itself: web/js/app/places.js.
//
// Coordinates are selenographic (MOON_ME): latitude -90..90 deg, east-positive longitude -180..180 deg (CONTRACTS §0).

import { searchSites, KIND_LABEL, HOME_SITE_ID } from "./catalog.js";
import { normalizeLon } from "./state.js";

const NUM = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))";
const DEG_MARK = "(?:°|º|DEG(?:REES?)?)?";
// pre-letter, number, (degree sign, post-letter, separator, pre-letter: at least one character between the numbers),
// number, post-letter.
const COORDS_RE = new RegExp(
  `^([NSEW])?\\s*${NUM}(\\s*${DEG_MARK}\\s*([NSEW])?\\s*[,;/]?\\s*([NSEW])?\\s*)${NUM}\\s*${DEG_MARK}\\s*([NSEW])?$`,
);

/**
 * Coordinates typed in the search box, or null when the text is not a coordinate pair.
 * Accepts "-89.5, 130", "-89.5 130", "89.5S 130E", "89.5° S, 130° E", "S89.5 E130" and "130E 89.5S" (the letters
 * decide which number is which; without letters, latitude comes first). A longitude of 180..360 deg east is wrapped
 * to -180..180.
 * @returns {{lat: number, lon: number}|null} degrees: latitude, east longitude
 */
export function parseLatLon(text) {
  const s = String(text ?? "").trim().toUpperCase().replace(/[−–]/g, "-");
  const m = COORDS_RE.exec(s);
  if (!m || !m[3]) return null; // "10" is not "1, 0"
  let [, pre1, n1, , post1, pre2, n2, post2] = m;
  // "S89.5 E130": the letter after the first number belongs in front of the second one.
  if (pre1 && post1 && !pre2) {
    pre2 = post1;
    post1 = undefined;
  }
  if ((pre1 && post1) || (pre2 && post2)) return null;
  let a = { v: Number(n1), h: pre1 || post1 || null };
  let b = { v: Number(n2), h: pre2 || post2 || null };
  const isLat = (h) => h === "N" || h === "S";
  const isLon = (h) => h === "E" || h === "W";
  if (isLon(a.h) || isLat(b.h)) [a, b] = [b, a];
  if ((a.h && !isLat(a.h)) || (b.h && !isLon(b.h))) return null;
  const lat = a.h ? (a.h === "S" ? -Math.abs(a.v) : Math.abs(a.v)) : a.v;
  const lon = b.h ? (b.h === "W" ? -Math.abs(b.v) : Math.abs(b.v)) : b.v;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || lon < -180 || lon > 360) return null;
  return { lat, lon: lon > 180 ? normalizeLon(lon) : lon };
}

/** "−89.50°, 130.00°" (signed, with a true minus sign). */
export function fmtSigned(lat, lon, digits = 2) {
  const f = (x) => `${x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}°`;
  return `${f(lat)}, ${f(lon)}`;
}

/** "89.50° S, 130.00° E". */
export function fmtHemi(lat, lon, digits = 2) {
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(digits)}° ${lon >= 0 ? "E" : "W"}`;
}

/** Where a place is, in a few words: "south pole", "north pole", "near side" or "far side". */
export function areaOf(lat, lon) {
  if (lat <= -80) return "south pole";
  if (lat >= 80) return "north pole";
  return Math.abs(normalizeLon(lon)) <= 90 ? "near side" : "far side";
}

/** One-line subtitle of a catalog place in the search list and the place card. */
export function siteSubtitle(site) {
  const area = areaOf(site.lat_deg, site.lon_deg);
  if (site.kind === "home") return `Lunar base concept (IAC 2021) · ${area}`;
  if (site.kind === "candidate") return `Potential Artemis site · ${area} · approximate point`;
  if (site.kind === "mission") {
    const year = site.t_start_utc ? site.t_start_utc.slice(0, 4) : null;
    // A crash (C2 outcome "crash", e.g. Beresheet) is named as such in place of the lander.
    const who = site.outcome === "crash" ? "crash site"
      : site.crew && site.crew.length ? site.crew.join(" & ") : site.lander && site.lander !== site.name ? site.lander : null;
    return [site.agency, year, who].filter(Boolean).join(" · ");
  }
  return site.blurb || area;
}

/** Kind name of a place for the place card: "Mission", "Potential Artemis site", "Place of interest", "Home base". */
export const KIND_ONE = { home: "Home base", mission: "Mission", candidate: "Potential Artemis site", poi: "Place of interest" };

const GROUP_KINDS = ["mission", "candidate", "poi"];

const fold = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * The search list for a query: typed coordinates (or null), the home site when the query matches it, and the other
 * matches grouped by kind in a fixed order (missions, potential Artemis sites, places of interest), each group in
 * searchSites order (name matches first, then by name). `homeFirst`: the home site leads the list (an empty query,
 * or every typed word in its name or in "home base"); a home site found only through its description ("Luna 9"
 * matches its "lunar base") follows the groups. `best`: the place Enter picks for a typed query, searchSites' first
 * (a name match before a description match, whatever its group: "Shackleton" is the Shackleton rim, not the
 * potential Artemis site whose description mentions Shackleton); null without a query or a match.
 * @returns {{coords: {lat: number, lon: number}|null, home: object|null, homeFirst: boolean, best: object|null,
 *   groups: {kind: string, label: string, sites: object[]}[]}}
 */
export function placeResults(query, sites) {
  const q = String(query ?? "").trim();
  const coords = parseLatLon(q);
  const found = coords ? [] : searchSites(q, sites);
  const home = found.find((s) => s.id === HOME_SITE_ID || s.kind === "home") || null;
  const named = fold(`${home?.name} ${home?.id} home base`);
  const homeFirst = !!home && fold(q).split(/\s+/).filter(Boolean).every((w) => named.includes(w));
  const groups = [];
  for (const kind of GROUP_KINDS) {
    const list = found.filter((s) => s.kind === kind);
    if (list.length) groups.push({ kind, label: KIND_LABEL[kind], sites: list });
  }
  const best = q && found.length ? found[0] : null;
  return { coords, home, homeFirst, best, groups };
}
