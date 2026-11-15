// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Editing a rover trip's points the way Google Maps' directions panel does, without the DOM (node tests drive it; the
// fields themselves are web/js/rover/ui.js):
//   - the rows: the start (the scenario's place), the stops (`route.via`), the end, and an empty stop row while one is
//     being added (inserted before the end, like "Add stop");
//   - set, remove, swap (reverse the whole trip) and move up, written to the store (contract C7 + C10 `route`);
//   - the suggestions of a stop field: "Choose on the map" first, typed coordinates, Home, the places on the map and
//     catalog places;
//   - the map pick: by default the first empty field takes the next map click (autoArm), until Cancel or Esc;
//   - one field's dropdown and map pick (fieldState): focusing a field opens its suggestions and makes the next map
//     click set that row; the dropdown closes on a choice, a pointer down outside the field (the map included), Esc
//     and blur.
// Coordinates are selenographic (MOON_ME) latitude and east-positive longitude in degrees (CONTRACTS §0).

import { getScenario, updateScenario } from "../app/store.js";
import { MAX_VIA, isPointLabel, pointLabel, normalizeLon, fmtLat, fmtLon } from "../app/state.js";
import { shortName, searchSites, HOME_SITE_ID } from "../app/catalog.js";
import { tripWaypoints } from "./app.js";
import { greatCircle, MAX_ROUTE_KM } from "./terrain.js";
import { waypointLetter } from "./trip.js";
import { startPick, cancelPick, dismissPick, pickState, undismiss, isDismissed } from "./pick.js";

/** Most points of a trip: the start, MAX_VIA stops and the end. */
export const MAX_POINTS = MAX_VIA + 2;
/** Row index meaning "the trip's end, whatever its index" (a dragged end pin, pick.js dropTripPoint). */
export const END_ROW = -1;

const round4 = (x) => Math.round(x * 1e4) / 1e4;
const same = (a, b) => !!a && !!b && a.lat_deg === b.lat_deg && a.lon_deg === b.lon_deg;

/** The catalog site at a point (within 1e-4°) among `sites`, or null. */
export function siteAt(p, sites) {
  if (!p) return null;
  const tol = 1e-4 + 1e-9;
  return sites.find((x) => Math.abs(x.lat_deg - p.lat_deg) <= tol && Math.abs(normalizeLon(x.lon_deg - p.lon_deg)) <= tol) || null;
}

/** A point's name: its catalog place ("Apollo 17"), else its coordinates ("20.19° N, 30.77° E"). */
export function pointName(p, sites) {
  if (!p) return "";
  const site = siteAt(p, sites);
  return site ? shortName(site) : `${fmtLat(p.lat_deg)}, ${fmtLon(normalizeLon(p.lon_deg))}`;
}

/**
 * The rows of a trip card: [start, ...stops, end] (unset points null), with an empty stop row at index `gap` while a
 * stop is being added (only when every point is set; the gap is at most before the end).
 */
export function tripRows(s, gap = null) {
  const rows = tripWaypoints(s);
  if (Number.isInteger(gap) && gap >= 1 && rows.every(Boolean)) rows.splice(Math.min(gap, rows.length - 1), 0, null);
  return rows;
}

/** What row `i` of `n` rows is: "start", "stop" or "end". */
export function rowRole(i, n) {
  return i === 0 ? "start" : i === n - 1 ? "end" : "stop";
}

/** The words for row `i` of `n` in the map banner and labels: "the start point (A)", "the end point (B)", "stop B". */
export function rowName(i, n) {
  const role = rowRole(i, n);
  const L = waypointLetter(i);
  return role === "start" ? `the start point (${L})` : role === "end" ? `the end point (${L})` : `stop ${L}`;
}

/** The row the map fills by default: the first empty one (the start, a stop or the end), or -1 when all are set. */
export function firstEmptyRow(rows) {
  return rows.findIndex((p) => !p);
}

/**
 * Arm trip `id`'s default map pick: its first empty row takes the next click on the map (pick.js; the banner reads
 * "Click the map to set the end point (B)"), unless another pick is armed, the user dismissed the trip's pick (Cancel,
 * Esc) or every row is set; then map clicks are ordinary ones. Returns the armed row, or -1.
 */
export function autoArm(id, rows) {
  if (pickState() || isDismissed(id)) return -1;
  const k = firstEmptyRow(rows);
  if (k >= 0) startPick(id, k, rowName(k, rows.length));
  return k;
}

/** Rows with row `i` set to point `p` ({lat_deg, lon_deg}); END_ROW sets the last row. */
export function setRow(rows, i, p) {
  const out = [...rows];
  out[i === END_ROW ? out.length - 1 : i] = p;
  return out;
}

/** Rows without row `i` (the start may go when two points stay: the next one starts the trip). */
export function removeRow(rows, i) {
  return rows.filter((_, k) => k !== i);
}

/** Rows in reverse order (swap the start and the end; the stops in between run the other way). */
export function swapRows(rows) {
  return [...rows].reverse();
}

/** Rows with row `i` moved one place up (no-op for the first row). */
export function moveUp(rows, i) {
  if (i < 1 || i >= rows.length) return [...rows];
  const out = [...rows];
  [out[i - 1], out[i]] = [out[i], out[i - 1]];
  return out;
}

/** The index of the empty row "Add stop" inserts: before the end (one row before the last). */
export function addStopIndex(rows) {
  return Math.max(1, rows.length - 1);
}

/** True when another stop fits ("Add stop" shows): every point is set and the trip has room. */
export function canAddStop(rows) {
  return rows.length >= 2 && rows.every(Boolean) && rows.length < MAX_POINTS;
}

/**
 * Write rows to trip `id` in the store: the first row is the start (the scenario's place), the last set row the end,
 * the set rows between them the stops; empty rows are dropped. A new start moves the scenario (its catalog site and,
 * when the name was automatic, its name follow; the times stay: the trip is driven from there at the same time; the
 * card's place fields follow, "field" with `external`); otherwise only `route` changes ("field"). `sites`: the
 * catalog (siteAt).
 */
export function commitRows(id, rows, sites = []) {
  const s = getScenario(id);
  if (!s || !s.route) return;
  const start = rows[0] || null;
  const set = rows.slice(1).filter(Boolean).slice(0, MAX_POINTS - 1);
  const r = { ...s.route };
  const last = set.at(-1) || null;
  r.end_lat_deg = last ? round4(last.lat_deg) : null;
  r.end_lon_deg = last ? round4(last.lon_deg) : null;
  const via = set.slice(0, -1).map((p) => ({ lat_deg: round4(p.lat_deg), lon_deg: round4(p.lon_deg) }));
  if (via.length) r.via = via;
  else delete r.via;
  const cur = { lat_deg: s.lat_deg, lon_deg: s.lon_deg };
  if (!start || same(start, cur)) {
    updateScenario(id, { route: r }, "field");
    return;
  }
  const a = { lat_deg: round4(start.lat_deg), lon_deg: round4(normalizeLon(start.lon_deg)) };
  const site = siteAt(a, sites);
  const oldSite = siteAt(cur, sites);
  const autoName = !s.label || isPointLabel(s.label) || (oldSite && s.label === shortName(oldSite));
  updateScenario(id, {
    lat_deg: a.lat_deg, lon_deg: a.lon_deg, site_id: site ? site.id : null, route: r,
    ...(autoName ? { label: site ? shortName(site) : pointLabel(a.lat_deg, a.lon_deg) } : {}),
    // The times stay as they are (passing them keeps the store's place rule from resetting a mission's dates).
    t_start_utc: s.t_start_utc, t_end_utc: s.t_end_utc, ...(s.t_src ? { t_src: s.t_src } : {}),
  }, "field", { external: true });
}

// ---------------------------------------------------------------------------------------------
// Suggestions of a stop field.

const km = (m) => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;

/**
 * "−26.1, 3.7", "26.1 N 3.7 E", "26.1°N, 3.7°E" -> {lat_deg, lon_deg} (east-positive longitude), or null.
 */
export function parseLatLon(text) {
  const t = String(text || "").trim().replace(/[−–]/g, "-");
  const m = /^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i.exec(t);
  if (!m) return null;
  let lat = Number(m[1]), lon = Number(m[3]);
  if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 360)) return null;
  return { lat_deg: lat, lon_deg: Math.abs(lon) > 180 ? normalizeLon(lon) : lon };
}

/**
 * The suggestions of a stop field, in order:
 *   1. "Choose on the map" (kind "pick");
 *   2. typed coordinates (kind "coord");
 *   3. Home, the home base (kind "home"; with a query, only when it matches);
 *   4. the places on the map (kind "place": the other scenarios' places, `places` [{lat_deg, lon_deg, label, color}]);
 *   5. catalog places (kind "site"): without a query those within one leg's reach of `from`, nearest first; with a
 *      query the matches, an exact name first, then those in reach, nearest first.
 * Points beyond one leg (MAX_ROUTE_KM of straight line from `from`) are disabled, and `from` itself and the points in
 * `exclude` are left out. `tap`: words for a touch screen. Each item: {kind, name, meta, p?, disabled?, site?, color?}.
 */
export function stopSuggestions({ query = "", from = null, sites = [], places = [], exclude = [], tap = false, fromLetter = "A" } = {}) {
  const q = String(query || "").trim();
  const ql = q.toLowerCase();
  const out = [{ kind: "pick", name: "Choose on the map", meta: `the next ${tap ? "tap" : "click"} on the Moon sets it` }];
  const reach = (p) => {
    const d = from ? greatCircle(from, p).dist_m : NaN;
    const far = Number.isFinite(d) && d > MAX_ROUTE_KM * 1000;
    return { d, far, meta: Number.isFinite(d) ? `${km(d)} from ${fromLetter}${far ? ` · too far for one leg (max ${MAX_ROUTE_KM} km)` : ""}` : "" };
  };
  const skip = (p) => (from && greatCircle(from, p).dist_m <= 1) || exclude.some((x) => x && greatCircle(x, p).dist_m <= 1);
  const coord = parseLatLon(q);
  if (coord) {
    const r = reach(coord);
    out.push({ kind: "coord", p: coord, name: `${fmtLat(coord.lat_deg)}, ${fmtLon(coord.lon_deg)}`, meta: ["Typed coordinates", r.meta].filter(Boolean).join(" · "), disabled: r.far });
    return out;
  }
  const home = sites.find((x) => x.id === HOME_SITE_ID || x.kind === "home");
  const used = new Set();
  if (home && (!q || searchSites(q, [home]).length || "home".startsWith(ql)) && !skip(home)) {
    const r = reach(home);
    out.push({ kind: "home", site: home, p: { lat_deg: home.lat_deg, lon_deg: home.lon_deg }, name: `Home: ${shortName(home)}`, meta: r.meta || "Home base", disabled: r.far });
    used.add(home.id);
  }
  for (const pl of places) {
    if (!Number.isFinite(pl.lat_deg) || !Number.isFinite(pl.lon_deg)) continue;
    const p = { lat_deg: pl.lat_deg, lon_deg: pl.lon_deg };
    if (skip(p) || (q && !String(pl.label || "").toLowerCase().includes(ql))) continue;
    const site = siteAt(p, sites);
    if (site) used.add(site.id);
    const r = reach(p);
    out.push({ kind: "place", p, name: pl.label || pointName(p, sites), meta: ["On the map", r.meta].filter(Boolean).join(" · "), disabled: r.far, color: pl.color, site });
  }
  const near = (q ? searchSites(q, sites) : sites).filter((site) => !used.has(site.id) && !skip(site)).map((site) => {
    const r = reach(site);
    const exact = !!ql && (site.name.toLowerCase() === ql || shortName(site).toLowerCase() === ql);
    return { site, r, exact, inReach: Number.isFinite(r.d) && !r.far };
  }).filter((x) => q || x.inReach);
  near.sort((a, b) => (b.exact - a.exact) || (b.inReach - a.inReach) || ((a.r.d || 0) - (b.r.d || 0)));
  for (const { site, r } of near.slice(0, 12)) {
    // The kind tells apart places of the same name (the Malapert Massif region and place of interest).
    const kind = site.kind === "candidate" ? "Potential Artemis site" : site.kind === "home" ? "Home base" : "";
    out.push({ kind: "site", site, p: { lat_deg: site.lat_deg, lon_deg: site.lon_deg }, name: site.name, meta: [kind, r.meta].filter(Boolean).join(" · "), disabled: r.far });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// One stop field's dropdown and map pick.

/**
 * The state of one stop field (row `row` of trip `id`; `label` names it in the map banner, e.g. "the end point (B)"):
 *   focus()        the dropdown opens and the field takes the next map click (a "soft" pick, which ends when the focus
 *                  leaves for anything but the map; the trip's default pick of this very row stays as it is); a trip
 *                  the user dismissed (Cancel, Esc) takes map clicks again;
 *   typed()        the dropdown opens (again);
 *   chooseOnMap()  "Choose on the map": the dropdown closes and the pick stays until a map click, Cancel or Esc;
 *   chose()        an item or typed coordinates were chosen: the dropdown closes and the pick ends;
 *   pointerDown(inside)  a pointer went down on the page: outside the field (the map included) the dropdown closes;
 *   blur(toMap)    the focus left: the dropdown closes, and a soft pick ends unless the focus left for the map;
 *   escape()       Esc: closes the dropdown, else dismisses the pick (pick.js dismissPick); true when it did something;
 *   mapPicked()    the map set this row (pick.js consumeMapClick): the dropdown closes.
 * `onOpen(open)` runs when the dropdown opens or closes. `open` and `armed` read the state.
 */
export function fieldState(id, row, label, { onOpen = null } = {}) {
  let open = false;
  const show = (v) => {
    if (open === v) return;
    open = v;
    onOpen?.(v);
  };
  const mine = () => {
    const p = pickState();
    return p && p.id === id && p.row === row ? p : null;
  };
  return {
    get open() { return open; },
    get armed() { return !!mine(); },
    focus() {
      undismiss(id);
      // A default or "Choose on the map" pick of this very row stays as it is; anything else becomes this field's soft pick.
      if (mine()?.label !== label) startPick(id, row, label, { soft: true });
      show(true);
    },
    typed() { show(true); },
    chooseOnMap() {
      show(false);
      startPick(id, row, label);
    },
    chose() {
      show(false);
      if (mine()) cancelPick();
    },
    pointerDown(inside) {
      if (!inside) show(false);
    },
    blur(toMap = false) {
      show(false);
      if (mine()?.soft && !toMap) cancelPick();
    },
    escape() {
      if (open) {
        show(false);
        return true;
      }
      if (mine()) {
        dismissPick();
        return true;
      }
      return false;
    },
    mapPicked() { show(false); },
  };
}
