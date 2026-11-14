// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Share links (web/js/app/state.js encodeHash / decodeHash): the round trip of every field, links made before the Sky
// moment and view were added, and links without scenarios.

import test from "node:test";
import assert from "node:assert/strict";
import { encodeHash, decodeHash, makeScenario } from "../js/app/state.js";

function scenarios() {
  const list = [];
  list.push(makeScenario({ label: "Apollo 11", site_id: "apollo11", lat_deg: 0.6741, lon_deg: 23.473, t_start_utc: "1969-07-20T20:17:40Z", t_end_utc: "1969-07-21T17:54:00Z" }, list));
  list.push(makeScenario({ label: "Point 36.3° S, 119.3° E", lat_deg: -36.3, lon_deg: 119.3, t_start_utc: "2030-01-01T00:00:00Z" }, list));
  return list;
}
const rows = (list) => list.map(({ id, ...rest }) => rest); // ids are local, never in a link

test("round trip: scenarios, tab, Compare axis and section, Sky moment, look and camera", () => {
  const sc = scenarios();
  const sky = { offsetMs: 5 * 86400e3 + 14 * 3600e3, look: "sun", view: { az_deg: 258.93, el_deg: 12.5, fov_deg: 40.25 } };
  const h = encodeHash({ scenarios: sc, tab: "sky", xaxis: "utc", body: "earth", sky });
  const back = decodeHash(h);
  assert.deepEqual(rows(back.scenarios), rows(sc));
  assert.equal(back.tab, "sky");
  assert.equal(back.tabGiven, true);
  assert.equal(back.xaxis, "utc");
  assert.equal(back.body, "earth");
  assert.deepEqual(back.sky, sky);
  // Encoding what was decoded gives the same link.
  assert.equal(encodeHash({ ...back, scenarios: back.scenarios }), h);
});

test("the Sky moment is kept to the second; the camera to 0.01°; an azimuth is folded into 0..360", () => {
  const sc = scenarios();
  const back = decodeHash(encodeHash({ scenarios: sc, tab: "sky", sky: { offsetMs: 1234567, look: null, view: { az_deg: -90.123, el_deg: -3.456, fov_deg: 70 } } }));
  assert.equal(back.sky.offsetMs, 1235000);
  assert.deepEqual(back.sky.view, { az_deg: 269.88, el_deg: -3.46, fov_deg: 70 });
  assert.equal(back.sky.look, null);
});

test("defaults are left out of the link: T+0, no look, no camera, Compare, Sun, mission time", () => {
  const h = encodeHash({ scenarios: scenarios(), sky: { offsetMs: 0, look: null, view: null } });
  assert.match(h, /^#s=[A-Za-z0-9_-]+$/);
  const back = decodeHash(h);
  assert.deepEqual(back.sky, { offsetMs: null, look: null, view: null });
  assert.equal(back.tab, "compare");
  assert.equal(back.tabGiven, false);
});

test("links made before the Sky fields existed still open the same scenarios, tab, axis and section", () => {
  // Written with the earlier encoder (tab, x, b, s only).
  const sc = scenarios();
  const json = JSON.stringify(sc.map((s) => [s.label, s.lat_deg, s.lon_deg, s.t_start_utc || 0, s.t_end_utc || 0, s.site_id || 0, s.color]));
  const s = Buffer.from(json, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const old = `#tab=sky&x=utc&b=earth&s=${s}`;
  const back = decodeHash(old);
  assert.deepEqual(rows(back.scenarios), rows(sc));
  assert.equal(back.tab, "sky");
  assert.equal(back.xaxis, "utc");
  assert.equal(back.body, "earth");
  assert.deepEqual(back.sky, { offsetMs: null, look: null, view: null });
  // The new encoder writes the same link for the same state.
  assert.equal(encodeHash({ scenarios: back.scenarios, tab: "sky", xaxis: "utc", body: "earth" }), old);
});

test("a link without scenarios keeps its tab (\"#tab=sky\" opens Apollo 11 on the Sky tab)", () => {
  const h = decodeHash("#tab=sky");
  assert.deepEqual(h.scenarios, []);
  assert.equal(h.tab, "sky");
  assert.equal(h.tabGiven, true);
  assert.equal(decodeHash("#tab=compare").tab, "compare");
});

test("hashes Moonat does not know, or with broken scenarios, decode to null", () => {
  for (const h of ["", "#", "#garbage", "#s=%%%", "#utm_source=x", "#tab=sky&s=bm90IGpzb24"]) assert.equal(decodeHash(h), null, h);
});

test("bad Sky values are ignored, not trusted", () => {
  const sc = scenarios();
  const base = encodeHash({ scenarios: sc }).slice(1);
  const back = decodeHash(`#t=-5&look=moon&v=1,2&${base}`);
  assert.deepEqual(back.sky, { offsetMs: null, look: null, view: null });
  assert.equal(decodeHash(`#v=10,20,0&${base}`).sky.view, null);
  assert.equal(decodeHash(`#v=a,b,c&${base}`).sky.view, null);
});
