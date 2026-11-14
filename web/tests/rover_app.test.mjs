// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Rover traverse in the app: the scenario's `route` field in the URL hash and the physics key, the planning request,
// the quick start, and the two-step pick on the globe (web/js/rover/pick.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeScenario, encodeHash, decodeHash, physicsKey, validateScenario } from "../js/app/state.js";
import { QUICK_STARTS } from "../js/app/catalog.js";
import { setScenarios, store } from "../js/app/store.js";
import { routeRequest, newRouteFields } from "../js/rover/app.js";
import { registerRouteCard, startPick, consumeMapClick, pickState, cancelPick } from "../js/rover/pick.js";
import { routeKey } from "../js/rover/index.js";

const ROUTE = { end_lat_deg: -89.4395, end_lon_deg: -137.1934, preset: "viper", speed_mps: 0.2, max_slope_deg: 15, max_cross_deg: 15, stop_every_km: 2, stop_h: 1.5 };

test("URL hash: a traverse round-trips with its route; old 7-field rows still decode", () => {
  const s = makeScenario({ label: "Pole to ridge", lat_deg: -90, lon_deg: 0, t_start_utc: "2027-10-15T00:00:00Z", route: ROUTE });
  const plain = makeScenario({ label: "A11", lat_deg: 0.674, lon_deg: 23.473, t_start_utc: "1969-07-20T20:17:40Z" }, [s]);
  const back = decodeHash(encodeHash({ scenarios: [s, plain], xaxis: "dist" }));
  assert.equal(back.xaxis, "dist");
  assert.deepEqual(back.scenarios[0].route, ROUTE);
  assert.equal("route" in back.scenarios[1], false);
  // A link made before traverses existed: no route field anywhere.
  assert.equal("route" in makeScenario({ lat_deg: 1, lon_deg: 2 }), false);
  const h = encodeHash({ scenarios: [plain] });
  assert.equal(decodeHash(h).scenarios[0].route, undefined);
});

test("physics key follows the route, so a re-planned traverse is recomputed", () => {
  const a = makeScenario({ lat_deg: -90, lon_deg: 0, t_start_utc: "2027-10-15T00:00:00Z", route: ROUTE });
  const b = makeScenario({ ...a, id: undefined, route: { ...ROUTE, max_slope_deg: 20 } });
  assert.notEqual(physicsKey(a), physicsKey(b));
  const c = makeScenario({ lat_deg: -90, lon_deg: 0, t_start_utc: "2027-10-15T00:00:00Z" });
  assert.equal(physicsKey(c), ["", -90, 0, "2027-10-15T00:00:00Z", ""].join("|"));
});

test("planning request: preset values, custom overrides, completeness", () => {
  const s = makeScenario({ lat_deg: -90, lon_deg: 0, route: { ...ROUTE, preset: "custom", speed_mps: 0.5, max_slope_deg: 25 } });
  const r = routeRequest(s);
  assert.equal(r.complete, true);
  assert.equal(r.rover.speed_mps, 0.5);
  assert.equal(r.rover.max_slope_deg, 25);
  assert.deepEqual(r.stops, { stop_every_km: 2, stop_h: 1.5 });
  const lrv = routeRequest(makeScenario({ lat_deg: 26.1, lon_deg: 3.6, route: { ...newRouteFields("lrv"), end_lat_deg: 26.0, end_lon_deg: 3.7 } }));
  assert.equal(lrv.rover.speed_mps, 2.5);
  assert.equal(lrv.rover.max_slope_deg, 20);
  assert.equal(routeRequest(makeScenario({ lat_deg: 1, lon_deg: 2, route: newRouteFields() })).complete, false);
  // The planning key ignores the stops (they change the timeline, not the path), so changing them does not re-plan.
  const noStops = routeRequest(makeScenario({ ...s, id: undefined, route: { ...s.route, stop_every_km: 0, stop_h: 0 } }));
  assert.equal(routeKey(r.start, r.end, r.rover), routeKey(noStops.start, noStops.end, noStops.rover));
});

test("rover quick start: appended last, a complete VIPER-class traverse from the south pole", () => {
  assert.deepEqual(QUICK_STARTS.slice(0, 5).map((q) => q.key), ["apollo11", "apollo-all", "pole", "farside", "eclipse"]);
  const q = QUICK_STARTS[QUICK_STARTS.length - 1];
  assert.equal(q.key, "rover");
  const [p] = q.resolve([]);
  const s = makeScenario(p);
  assert.ok(validateScenario(s).ok);
  const r = routeRequest(s);
  assert.ok(r.complete);
  assert.equal(r.rover.preset, "viper");
  assert.deepEqual([s.lat_deg, s.lon_deg], [-90, 0]);
});

test("two-step pick: start, then end, then done; a click on a static scenario is not taken", () => {
  setScenarios([{ lat_deg: 1, lon_deg: 2 }]);
  assert.equal(consumeMapClick(5, 6), false, "static scenario: the click places it as before");
  setScenarios([{ lat_deg: -90, lon_deg: 0, route: ROUTE }]);
  const id = store.scenarios[0].id;
  const got = [];
  let done = 0;
  const off = registerRouteCard(id, { onPoint: (w, la, lo) => got.push([w, la, lo]), onDone: () => done++ });
  startPick(id);
  assert.deepEqual(pickState(), { id, step: "start" });
  assert.equal(consumeMapClick(-89.9, 10), true);
  assert.deepEqual(pickState(), { id, step: "end" });
  assert.equal(consumeMapClick(-89.5, -130), true);
  assert.equal(pickState(), null);
  assert.deepEqual(got, [["start", -89.9, 10], ["end", -89.5, -130]]);
  assert.equal(done, 1);
  // With a traverse selected, a plain click starts a new two-step pick at that start.
  assert.equal(consumeMapClick(-89.8, 20), true);
  assert.deepEqual(pickState(), { id, step: "end" });
  cancelPick();
  off();
  assert.equal(consumeMapClick(0, 0), false, "no card registered any more");
});
