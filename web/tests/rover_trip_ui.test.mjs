// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Trip planning like Google Maps' directions (web/js/rover/trip_edit.js, pick.js) and its "traffic" colour
// (web/js/rover/delay.js): a focused point field takes the next map click without adding a place; its dropdown closes
// on a map press, Esc, an outside press and blur; swap, add and remove a stop; the suggestions; the delay ratio (route
// time over a straight flat drive) and its colour thresholds.
// Run: node --test web/tests/rover_trip_ui.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setScenarios, store } from "../js/app/store.js";
import { registerRouteCard, consumeMapClick, pickState, cancelPick, dropTripPoint, dismissPick, isDismissed } from "../js/rover/pick.js";
import {
  tripRows, setRow, removeRow, swapRows, moveUp, addStopIndex, canAddStop, commitRows, fieldState, stopSuggestions, rowRole,
  rowName, autoArm, firstEmptyRow, END_ROW, MAX_POINTS,
} from "../js/rover/trip_edit.js";
import { tripDelay, delayLevel, delayText, DELAY_LEVELS, straightDrive, restStops } from "../js/rover/delay.js";
import { greatCircle, planRouteGrid } from "../js/rover/terrain.js";
import { computeRoute } from "../js/rover/route.js";
import { roverParams } from "../js/rover/presets.js";
import { newRouteFields } from "../js/rover/app.js";

const SITES = JSON.parse(readFileSync(fileURLToPath(new URL("../data/sites.json", import.meta.url)), "utf8")).sites;
const A17 = SITES.find((s) => s.id === "apollo17");
const A = { lat_deg: A17.lat_deg, lon_deg: A17.lon_deg };
const B = { lat_deg: 20.21, lon_deg: 30.84 };
const V = { lat_deg: 20.2, lon_deg: 30.8 };
const T0 = "1972-12-11T19:54:57Z";

/** One Apollo 17 trip scenario (optionally with its end and stops); returns its id. */
function trip(route = {}) {
  setScenarios([{ label: "Apollo 17", site_id: "apollo17", ...A, t_start_utc: T0, route: { ...newRouteFields("lrv"), ...route } }]);
  return store.scenarios[0].id;
}
const s0 = () => store.scenarios[0];
const ends = (s) => [s.route.end_lat_deg, s.route.end_lon_deg];
/** The card's map handler, as ui.js wires it: the picked point goes into the armed row. */
const cardHandler = (id) => ({ onPoint: (row, lat, lon) => commitRows(id, setRow(tripRows(s0()), row, { lat_deg: lat, lon_deg: lon }), SITES) });

test("a focused end field takes the next map click: it sets the end, closes the dropdown and adds no place", () => {
  const id = trip();
  const off = registerRouteCard(id, cardHandler(id));
  const shown = [];
  const f = fieldState(id, 1, "the end point", { onOpen: (o) => shown.push(o) });
  f.focus();
  assert.equal(f.open, true, "focus opens the suggestions");
  assert.deepEqual(pickState(), { id, row: 1, label: "the end point", soft: true }, "and arms the row for the map");
  // The press on the globe is outside the field: the dropdown closes, the field keeps its pick (also when the globe
  // takes the focus).
  f.pointerDown(false);
  assert.equal(f.open, false);
  f.blur(true);
  assert.equal(f.armed, true);
  // map.js offers the click to the pick first: consumed, so no new place card (dropPin) and no pin removed.
  assert.equal(consumeMapClick(20.21, 30.84), true);
  assert.equal(store.scenarios.length, 1);
  assert.deepEqual(ends(s0()), [20.21, 30.84]);
  assert.equal(pickState(), null);
  assert.deepEqual(shown, [true, false]);
  // The next click is an ordinary one again (map.js drops a pin or selects a site).
  assert.equal(consumeMapClick(20.3, 30.9), false);
  // A click on a catalog marker gives the site's own coordinates (map.js onSite): the end is that site.
  f.focus();
  assert.equal(consumeMapClick(A17.lat_deg + 0.02, A17.lon_deg), true);
  assert.equal(s0().route.end_lat_deg, Math.round((A17.lat_deg + 0.02) * 1e4) / 1e4);
  off();
});

test("map clicks are armed by default: the first empty field takes the next click; none when all are set; Cancel or Esc disarm", () => {
  const id = trip();
  cancelPick();
  const off = registerRouteCard(id, cardHandler(id));
  assert.equal(firstEmptyRow(tripRows(s0())), 1);
  assert.equal(autoArm(id, tripRows(s0())), 1, "Trip on: the empty end takes the map at once");
  assert.deepEqual(pickState(), { id, row: 1, label: "the end point (B)" }, "no 'Choose on the map' needed");
  assert.equal(consumeMapClick(20.21, 30.84), true);
  assert.equal(store.scenarios.length, 1);
  assert.deepEqual(ends(s0()), [20.21, 30.84]);
  assert.equal(autoArm(id, tripRows(s0())), -1, "every field set: globe clicks are ordinary again");
  assert.equal(pickState(), null);
  assert.equal(consumeMapClick(20.3, 30.9), false);
  // "Add stop": the new empty stop takes the map.
  const g = addStopIndex(tripRows(s0()));
  assert.equal(autoArm(id, tripRows(s0(), g)), g);
  assert.equal(pickState().label, "stop B");
  // A focused field keeps the default pick of its own row (it does not turn it into a soft one).
  const f = fieldState(id, g, "stop B");
  f.focus();
  f.blur(false);
  assert.equal(f.armed, true, "the default pick outlives the field's focus");
  // Cancel or Esc (dismissPick): no default pick until the user turns back to the trip.
  dismissPick();
  assert.equal(isDismissed(id), true);
  assert.equal(autoArm(id, tripRows(s0(), g)), -1);
  assert.equal(consumeMapClick(20.3, 30.9), false, "a dismissed trip leaves the map to ordinary clicks");
  f.focus();
  assert.equal(isDismissed(id), false, "focusing one of its fields turns back to the trip");
  assert.equal(f.armed, true);
  off();
  cancelPick();
});

test("the stop dropdown is a styled floating card: no bullets, a background, items like 'Search the Moon'", () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const css = read("../css/rover.css");
  const globeCss = read("../css/globe.css");
  const ui = read("../js/rover/ui.js");
  const rule = /\n\.trip-list \{([^}]*)\}/.exec(css)?.[1] || "";
  for (const want of [/position: absolute/, /z-index: \d+/, /list-style: none/, /background: var\(--gs-bg\)/, /box-shadow: var\(--gs-shadow\)/, /border-radius: \d+px/]) {
    assert.match(rule, want);
  }
  assert.match(ui, /class: "trip-list", id: listId, role: "listbox"/);
  assert.match(ui, /class: `gs-item trip-opt is-\$\{o\.kind\}`/);
  assert.match(ui, /class: "gs-text" \}, el\("span", \{ class: "gs-name"/);
  // The item styles are global (globe.css), not scoped to the globe's search box; hover and keyboard highlight.
  assert.match(globeCss, /\n\.gs-item \{[^}]*display: flex/);
  assert.match(globeCss, /\n\.gs-item\[aria-selected="true"\], \.gs-item:hover \{/);
});

test("the dropdown closes on Esc, a press outside and blur; a soft pick ends when the focus leaves for anything but the map", () => {
  const id = trip();
  const f = fieldState(id, 1, "the end point");
  f.focus();
  f.pointerDown(true);
  assert.equal(f.open, true, "a press inside the field or its list keeps it open");
  assert.equal(f.escape(), true);
  assert.equal(f.open, false, "Esc closes the list");
  assert.equal(f.armed, true, "the first Esc keeps the map pick");
  assert.equal(f.escape(), true);
  assert.equal(f.armed, false, "the second Esc ends it");
  assert.equal(f.escape(), false, "nothing left to close");
  f.focus();
  f.pointerDown(false);
  assert.equal(f.open, false, "a press outside closes the list");
  f.blur(false);
  assert.equal(f.armed, false, "the focus went elsewhere: a map click is an ordinary click again");
  f.typed();
  f.blur(false);
  assert.equal(f.open, false, "blur closes the list");
  // "Choose on the map": the list closes and the pick stays after the field gives up the focus (a phone's keyboard).
  f.focus();
  f.chooseOnMap();
  assert.equal(f.open, false);
  f.blur(false);
  assert.deepEqual(pickState(), { id, row: 1, label: "the end point" });
  f.mapPicked();
  cancelPick();
  // A choice in the list closes it and ends the pick.
  f.focus();
  f.chose();
  assert.equal(f.open, false);
  assert.equal(pickState(), null);
});

test("swap reverses the trip: the end becomes the start (the card's place) and the stops run the other way", () => {
  const id = trip({ end_lat_deg: B.lat_deg, end_lon_deg: B.lon_deg, via: [V] });
  commitRows(id, swapRows(tripRows(s0())), SITES);
  let s = s0();
  assert.deepEqual([s.lat_deg, s.lon_deg], [B.lat_deg, B.lon_deg]);
  assert.equal(s.site_id, null);
  assert.equal(s.label, "Point 20.2° N, 30.8° E", "the automatic name follows the place");
  assert.deepEqual(ends(s), [A.lat_deg, A.lon_deg].map((x) => Math.round(x * 1e4) / 1e4));
  assert.deepEqual(s.route.via, [V]);
  assert.equal(s.t_start_utc, T0, "the times stay");
  commitRows(id, swapRows(tripRows(s)), SITES);
  s = s0();
  assert.equal(s.site_id, "apollo17", "swapped back: the catalog place again");
  assert.equal(s.label, "Apollo 17");
  assert.deepEqual(ends(s), [B.lat_deg, B.lon_deg]);
  // A label the user typed is kept.
  s.label = "Valley loop";
  commitRows(id, swapRows(tripRows(s)), SITES);
  assert.equal(s0().label, "Valley loop");
});

test("add a stop (an empty row before the end), set it, move it, remove it; the end and the start can go too", () => {
  const id = trip({ end_lat_deg: B.lat_deg, end_lon_deg: B.lon_deg });
  let rows = tripRows(s0());
  assert.ok(canAddStop(rows));
  const g = addStopIndex(rows);
  assert.equal(g, 1);
  rows = tripRows(s0(), g);
  assert.deepEqual(rows, [A, null, B]);
  assert.deepEqual(rows.map((_, i) => rowRole(i, 3)), ["start", "stop", "end"]);
  assert.equal(rowName(1, 3), "stop B");
  assert.equal(rowName(2, 3), "the end point (C)");
  assert.equal(rowName(0, 3), "the start point (A)");
  // An empty stop row changes nothing.
  commitRows(id, rows, SITES);
  assert.equal("via" in s0().route, false);
  // The map (or a choice) fills it.
  commitRows(id, setRow(rows, g, V), SITES);
  assert.deepEqual(s0().route.via, [V]);
  assert.deepEqual(ends(s0()), [B.lat_deg, B.lon_deg]);
  // Move up swaps it with the point before; the start stays the card's place when it is not moved.
  assert.deepEqual(moveUp([A, V, B], 2), [A, B, V]);
  // Remove the stop, then (with a stop again) the end, then the start.
  commitRows(id, removeRow(tripRows(s0()), 1), SITES);
  assert.equal("via" in s0().route, false);
  assert.deepEqual(ends(s0()), [B.lat_deg, B.lon_deg]);
  commitRows(id, setRow(tripRows(s0(), 1), 1, V), SITES);
  commitRows(id, removeRow(tripRows(s0()), 2), SITES);
  assert.deepEqual(ends(s0()), [V.lat_deg, V.lon_deg], "without its end, the trip ends at the stop");
  commitRows(id, setRow(tripRows(s0(), 1), 1, B), SITES); // A, B, V
  commitRows(id, removeRow(tripRows(s0()), 0), SITES);
  assert.deepEqual([s0().lat_deg, s0().lon_deg], [B.lat_deg, B.lon_deg], "without its start, the next point starts the trip");
  assert.deepEqual(ends(s0()), [V.lat_deg, V.lon_deg]);
  assert.equal(store.scenarios.length, 1);
  // A full trip has no room for another stop.
  const full = [A, ...Array.from({ length: MAX_POINTS - 2 }, (_, k) => ({ lat_deg: 20.2 + k * 0.01, lon_deg: 30.8 })), B];
  assert.equal(full.length, MAX_POINTS);
  assert.equal(canAddStop(full), false);
  assert.equal(canAddStop([A, null]), false, "no stop before the end is set");
});

test("a dragged start or end pin moves that point of the trip (map.js onPinDrag)", () => {
  const id = trip({ end_lat_deg: B.lat_deg, end_lon_deg: B.lon_deg, via: [V] });
  const off = registerRouteCard(id, cardHandler(id));
  assert.deepEqual(setRow([A, V, B], END_ROW, A), [A, V, A]);
  assert.equal(dropTripPoint(id, END_ROW, 20.25, 30.9), true);
  assert.deepEqual(ends(s0()), [20.25, 30.9]);
  assert.deepEqual(s0().route.via, [V], "the stops stay");
  assert.equal(dropTripPoint(id, 0, 20.18, 30.75), true);
  assert.deepEqual([s0().lat_deg, s0().lon_deg], [20.18, 30.75]);
  assert.equal(store.scenarios.length, 1);
  off();
  assert.equal(dropTripPoint(id, 0, 0, 0), false, "no card: nothing happens");
});

test("suggestions: 'Choose on the map' first, typed coordinates, Home, places on the map, catalog places in reach", () => {
  const list = stopSuggestions({ from: A, sites: SITES, places: [{ lat_deg: 0.674, lon_deg: 23.473, label: "Apollo 11", color: "#3a68a2" }] });
  assert.equal(list[0].kind, "pick");
  assert.equal(list[0].name, "Choose on the map");
  const home = list.find((o) => o.kind === "home");
  assert.ok(home, "Home is offered");
  assert.equal(home.disabled, true, "the south-pole home is beyond one leg from Apollo 17");
  const a11 = list.find((o) => o.kind === "place");
  assert.equal(a11.name, "Apollo 11");
  assert.equal(a11.disabled, true);
  assert.ok(list.filter((o) => o.kind === "site").every((o) => !o.disabled), "without a query only places in reach");
  assert.ok(!list.some((o) => o.site?.id === "apollo17"), "not the point the leg starts from");
  const coords = stopSuggestions({ query: "20.2, 30.8", from: A, sites: SITES });
  assert.deepEqual(coords.map((o) => o.kind), ["pick", "coord"]);
  assert.deepEqual(coords[1].p, { lat_deg: 20.2, lon_deg: 30.8 });
  assert.match(coords[1].meta, /^Typed coordinates · \d\.\d\d km from A$/);
  assert.equal(stopSuggestions({ query: "home", from: A, sites: SITES })[1].kind, "home");
  assert.match(stopSuggestions({ from: A, tap: true, sites: [] })[0].meta, /tap/);
});

// ---- the delay ratio

const LRV = roverParams("lrv");
/** A planned route with a straight path through `pts`, `stretch` times longer than the great circles, driven `slow` times slower. */
function synthRoute(pts, { stretch = 1, slow = 1, rover = LRV } = {}) {
  const dist = [0], time = [0];
  for (let i = 1; i < pts.length; i++) {
    const d = greatCircle(pts[i - 1], pts[i]).dist_m * stretch;
    dist.push(dist.at(-1) + d);
    time.push(time.at(-1) + (d / rover.speed_mps) * slow);
  }
  return { start: pts[0], end: pts.at(-1), ...(pts.length > 2 ? { waypoints: pts } : {}), rover, stats: { length_m: dist.at(-1) }, path: { dist_m: dist, time_s: time } };
}

test("delay ratio: 1.0 on a straight flat leg, above 1 for a detour or a slow climb, summed over the legs", () => {
  const flat = tripDelay(synthRoute([A, B]));
  assert.ok(Math.abs(flat.ratio - 1) < 1e-12, `straight flat leg: ${flat.ratio}`);
  assert.equal(flat.level, "green");
  assert.ok(Math.abs(flat.straight_m - greatCircle(A, B).dist_m) < 1e-9);
  assert.match(delayText(flat), /^As fast as a straight drive · route 1\.00× the straight line \(\d\.\d\d km\)$/);
  const detour = tripDelay(synthRoute([A, B], { stretch: 1.6 }));
  assert.ok(Math.abs(detour.ratio - 1.6) < 1e-12);
  assert.equal(detour.level, "red");
  assert.ok(Math.abs(detour.length_ratio - 1.6) < 1e-12);
  assert.ok(Math.abs(detour.delay_ms - 0.6 * detour.straight_ms) < 1e-6);
  assert.match(delayText(detour), /^\+\d+ min vs\. a straight drive · route 1\.6× the straight line \(\d\.\d\d km\)$/);
  const climb = tripDelay(synthRoute([A, B], { slow: 1.3 }));
  assert.equal(climb.level, "orange", "the uphill slowdown counts as traffic too");
  // Several legs: the straight lines and times add up.
  const three = synthRoute([A, V, B]);
  const d3 = tripDelay(three);
  assert.ok(Math.abs(d3.ratio - 1) < 1e-12);
  assert.ok(Math.abs(d3.straight_m - (greatCircle(A, V).dist_m + greatCircle(V, B).dist_m)) < 1e-9);
  assert.ok(d3.straight_m > greatCircle(A, B).dist_m, "through the stop, not A to B directly");
  // Rest stops follow the same rule on both drives (every 1 km, not at the end), so they do not count as delay.
  const stops = { stop_every_km: 1, stop_h: 2 };
  assert.equal(restStops(2500, stops), 2);
  assert.equal(restStops(3000, stops), 2);
  assert.equal(restStops(3000, {}), 0);
  const L = greatCircle(A, B).dist_m;
  const sd = straightDrive([A, B], LRV, stops);
  assert.ok(Math.abs(sd.total_s - (L / LRV.speed_mps + restStops(L, stops) * 7200)) < 1e-9);
  assert.ok(Math.abs(tripDelay(synthRoute([A, B]), stops).ratio - 1) < 1e-12);
  // The caller's arrival time (routeTrack) is used when given.
  assert.ok(Math.abs(tripDelay(synthRoute([A, B]), {}, 2 * sd.drive_s * 1000).ratio - 2) < 1e-12);
});

test("delay colours: green below 1.2, orange from 1.2 to below 1.5, red from 1.5", () => {
  assert.deepEqual({ ...DELAY_LEVELS }, { orange: 1.2, red: 1.5 });
  assert.equal(delayLevel(1), "green");
  assert.equal(delayLevel(1.1999), "green");
  assert.equal(delayLevel(1.2), "orange");
  assert.equal(delayLevel(1.4999), "orange");
  assert.equal(delayLevel(1.5), "red");
  assert.equal(delayLevel(3.2), "red");
  assert.equal(delayLevel(NaN), null);
  assert.equal(delayLevel(0.97), "green", "a route a little shorter than the straight line (its ends snapped)");
});

test("delay ratio of a planned route on flat ground is close to 1 (green)", async () => {
  const zeroFar = { height: () => 0, cells: [3790], smax: [Infinity], maxHeight: 0, sources: [], bytes: 0 };
  const flatGrid = (plane, half_m, n) => ({ layer: "synthetic", half_m, cell_m: (2 * half_m) / n, n, data: new Float32Array(n * n), bytes: 0 });
  const plan = planRouteGrid(A, B);
  const grids = { fine: flatGrid(plan.plane, plan.fine.half_m, 201), coarse: flatGrid(plan.plane, plan.coarse.half_m, 101) };
  const r = await computeRoute(A, B, { preset: "lrv" }, { grids, far: zeroFar, horizons: false });
  const d = tripDelay(r);
  assert.ok(d.ratio >= 0.98 && d.ratio < 1.1, `flat planned route: ratio ${d.ratio.toFixed(3)}`);
  assert.equal(d.level, "green");
});
