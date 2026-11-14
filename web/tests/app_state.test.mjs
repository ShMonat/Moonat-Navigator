// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Tests for the scenario model, time helpers, validation and the URL hash (web/js/app/state.js).

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseUtc, isoUtc, toInputValue, formatDuration, normalizeLon, validateScenario, makeScenario, nextColorSlot,
  encodeHash, decodeHash, chooseStep, coverageEnd, describeYears, colorHex, PALETTE, scenarioTimes, physicsKey, formatUtc,
  pointLabel, isPointLabel, toUtcText, parseDuration, durationUnit, durationValueText, endFromDuration,
} from "../js/app/state.js";

test("the Sun/Earth choice round-trips through the URL hash and defaults to Sun", () => {
  const scenarios = [makeScenario({ lat_deg: 1, lon_deg: 2, t_start_utc: "1969-07-20T20:17:40Z" })];
  assert.equal(decodeHash(encodeHash({ scenarios })).body, "sun");
  assert.equal(decodeHash(encodeHash({ scenarios, body: "earth" })).body, "earth");
  assert.ok(!encodeHash({ scenarios }).includes("b="));
});

test("parseDuration reads numbers with units", () => {
  const H = 3600e3;
  assert.equal(parseDuration("36 h").ms, 36 * H);
  assert.equal(parseDuration("2.5 d").ms, 2.5 * 24 * H);
  assert.equal(parseDuration("2,5 days").ms, 2.5 * 24 * H);
  assert.equal(parseDuration("90 min").ms, 1.5 * H);
  assert.equal(parseDuration("21h36m").ms, 21.6 * H);
  assert.equal(parseDuration("1d 6h").ms, 30 * H);
  assert.equal(parseDuration("2.5 d").unit, "d");
  assert.deepEqual(parseDuration("48", "h"), { ms: 48 * H, unit: "h" });
  assert.equal(parseDuration("2", "d").ms, 48 * H);
});

test("parseDuration rejects invalid text", () => {
  for (const bad of ["", "  ", "abc", "h", "0", "0 h", "-3 h", "3 parsecs", "1.5.2 h", "2 h x", "1e3", null, undefined, 5]) {
    assert.equal(parseDuration(bad), null, String(bad));
  }
});

test("duration display converts the end instant to a number and back", () => {
  const t0 = "1969-07-20T20:17:40Z";
  const t1 = "1969-07-21T17:54:00Z"; // Apollo 11 surface stay: 21 h 36 min 20 s
  const ms = parseUtc(t1) - parseUtc(t0);
  assert.equal(durationUnit(ms), "h");
  assert.equal(durationValueText(ms, "h"), "21.6");
  assert.equal(durationValueText(ms, "d"), "0.9");
  assert.equal(durationUnit(3 * 86400e3), "d");
  assert.equal(durationValueText(3 * 86400e3), "3");
  assert.equal(endFromDuration(t0, ms), t1);
  assert.equal(endFromDuration(t0, parseDuration("21.6 h").ms), "1969-07-21T17:53:40Z");
  assert.equal(endFromDuration("nonsense", 1000), null);
  assert.equal(endFromDuration(t0, 0), null);
  assert.equal(endFromDuration(t0, NaN), null);
});

test("parseUtc reads ISO strings and datetime-local values as UTC", () => {
  assert.equal(parseUtc("1969-07-20T20:17:40Z"), Date.UTC(1969, 6, 20, 20, 17, 40));
  assert.equal(parseUtc("1969-07-20T20:17:40"), Date.UTC(1969, 6, 20, 20, 17, 40));
  assert.equal(parseUtc("1969-07-20T20:17"), Date.UTC(1969, 6, 20, 20, 17));
  assert.equal(parseUtc("2024-01-19"), Date.UTC(2024, 0, 19));
  assert.equal(parseUtc("2024-01-19T03:00:00+02:00"), Date.UTC(2024, 0, 19, 1));
  assert.ok(Number.isNaN(parseUtc("2024-13-01T00:00Z")));
  assert.ok(Number.isNaN(parseUtc("2023-02-30")));
  assert.ok(Number.isNaN(parseUtc("tomorrow")));
  assert.ok(Number.isNaN(parseUtc(null)));
});

test("isoUtc and toInputValue round-trip whole seconds", () => {
  const ms = Date.UTC(1972, 11, 11, 19, 54, 57);
  assert.equal(isoUtc(ms), "1972-12-11T19:54:57Z");
  assert.equal(toInputValue(ms), "1972-12-11T19:54:57");
  assert.equal(parseUtc(toInputValue(ms)), ms);
  assert.equal(formatUtc(ms), "11 Dec 1972, 19:54 UTC");
});

test("time fields: ISO order, 24-hour clock, typed variants read as UTC", () => {
  const ms = Date.UTC(1969, 6, 20, 20, 17, 40);
  assert.equal(toUtcText(ms), "1969-07-20 20:17:40");
  assert.equal(parseUtc(toUtcText(ms)), ms);
  assert.equal(parseUtc("1969-07-20 20:17:40 UTC"), ms);
  assert.equal(parseUtc("1969-7-20  20:17:40"), ms);
  assert.equal(parseUtc("1969-07-20 8:05"), Date.UTC(1969, 6, 20, 8, 5));
  assert.ok(Number.isNaN(parseUtc("1969-07-20 24:00")));
  assert.ok(Number.isNaN(parseUtc("07/20/1969 08:17:40 PM")));
  assert.equal(toUtcText(NaN), "");
});

test("formatDuration gives short human text", () => {
  assert.equal(formatDuration(45 * 60e3), "45 min");
  assert.equal(formatDuration((3 * 60 + 20) * 60e3), "3 h 20 min");
  assert.equal(formatDuration((2 * 24 + 5) * 3600e3), "2 d 5 h");
  assert.equal(formatDuration(18 * 86400e3 + 13 * 3600e3), "19 d");
  assert.equal(formatDuration(21 * 3600e3 + 36 * 60e3 + 20e3), "21 h 36 min");
});

test("normalizeLon maps 0..360 to -180..180 east-positive", () => {
  assert.equal(normalizeLon(23.5), 23.5);
  assert.ok(Math.abs(normalizeLon(336.6) - -23.4) < 1e-9);
  assert.equal(normalizeLon(180), 180);
  assert.equal(normalizeLon(-180), -180);
  assert.equal(normalizeLon(360), 0);
});

test("validateScenario: complete, polite errors, coverage", () => {
  const ok = makeScenario({ lat_deg: 0.67, lon_deg: 23.47, t_start_utc: "1969-07-20T20:17:40Z", t_end_utc: "1969-07-21T17:54:00Z" });
  assert.deepEqual(validateScenario(ok).errors, {});
  assert.ok(validateScenario(ok).ok);

  const inst = makeScenario({ lat_deg: 0, lon_deg: 0, t_start_utc: "2025-01-01T00:00:00Z" });
  assert.ok(validateScenario(inst).ok, "no end time is a valid single instant");

  const bad = makeScenario({ lat_deg: 95, lon_deg: 200, t_start_utc: "2025-01-02T00:00:00Z", t_end_utc: "2025-01-01T00:00:00Z" });
  const v = validateScenario(bad);
  assert.ok(!v.ok);
  assert.match(v.errors.lat_deg, /between/);
  assert.match(v.errors.lon_deg, /between/);
  assert.match(v.errors.t_end_utc, /after the start/);

  const incomplete = makeScenario({ lat_deg: 10 });
  assert.equal(validateScenario(incomplete).complete, false);

  const years = [...Array(11).keys()].map((i) => 1966 + i).concat([...Array(28).keys()].map((i) => 2013 + i));
  const out = makeScenario({ lat_deg: 0, lon_deg: 0, t_start_utc: "1990-01-01T00:00:00Z" });
  const vc = validateScenario(out, years);
  assert.match(vc.errors.t_start_utc, /cover 1966–1976 and 2013–2040/);

  // A start outside the tables is the message shown, even when the span is also too long.
  const longOut = makeScenario({ lat_deg: 0, lon_deg: 0, t_start_utc: "1985-03-01T00:00:00Z", t_end_utc: "2019-01-17T00:00:00Z" });
  const vl = validateScenario(longOut, years);
  assert.match(Object.values(vl.errors)[0], /sky tables cover/);
  assert.equal(vl.errors.t_end_utc, undefined);
});

test("pointLabel names custom points in N/S and E/W; isPointLabel recognises old and new names", () => {
  assert.equal(pointLabel(-36.3256, 119.305), "Point 36.3° S, 119.3° E");
  assert.equal(pointLabel(0.6741, -23.42), "Point 0.7° N, 23.4° W");
  assert.equal(pointLabel(10, 270), "Point 10.0° N, 90.0° W", "0..360 longitudes are normalised");
  assert.ok(isPointLabel("Point 36.3° S, 119.3° E"));
  assert.ok(isPointLabel("Point -36.3°, 119.3°"));
  assert.ok(!isPointLabel("Apollo 11"));
  assert.ok(!isPointLabel("Point 36.3° S, 119.3° E #2"));
  assert.ok(!isPointLabel(""));
});

test("describeYears groups runs", () => {
  assert.equal(describeYears([1966, 1967, 1968, 2013, 2014]), "1966–1968 and 2013–2014");
  assert.equal(describeYears([2020]), "2020");
});

test("colours follow the scenario: the lowest free slot is reused", () => {
  const a = makeScenario({}, []);
  const b = makeScenario({}, [a]);
  const c = makeScenario({}, [a, b]);
  assert.deepEqual([a.color, b.color, c.color], [0, 1, 2]);
  assert.equal(nextColorSlot([a, c]), 1);
  assert.equal(colorHex(0, "light"), PALETTE.light[0]);
  assert.equal(colorHex(PALETTE.dark.length + 1, "dark"), PALETTE.dark[1]);
});

test("URL hash round-trips scenarios, tab and x-axis (unicode labels too)", () => {
  const scenarios = [
    makeScenario({ label: "Apollo 11", site_id: "apollo11", lat_deg: 0.6741, lon_deg: 23.473, t_start_utc: "1969-07-20T20:17:40Z", t_end_utc: "1969-07-21T17:54:00Z" }),
    makeScenario({ label: "Chang'e 4 — far side ✓", lat_deg: -45.4561, lon_deg: 177.5885, t_start_utc: "2019-01-03T02:26:00Z", color: 5 }),
  ];
  const h = encodeHash({ scenarios, tab: "sky", xaxis: "utc" });
  assert.ok(h.startsWith("#"));
  const back = decodeHash(h);
  assert.equal(back.tab, "sky");
  assert.equal(back.xaxis, "utc");
  assert.equal(back.scenarios.length, 2);
  for (const k of ["label", "site_id", "lat_deg", "lon_deg", "t_start_utc", "t_end_utc", "color"]) {
    assert.deepEqual(back.scenarios.map((s) => s[k]), scenarios.map((s) => s[k]), k);
  }
  assert.equal(decodeHash("#garbage"), null);
  assert.equal(decodeHash("#s=%%%"), null);
  assert.equal(decodeHash(""), null);
});

test("chooseStep: 5 min for days, 20 min for a month, 1 h up to 2 years, 2–3 h for longer missions", () => {
  const D = 86400e3, MIN = 60e3, Y = 365.25 * D;
  assert.equal(chooseStep(3600e3), 5 * MIN);
  assert.equal(chooseStep(21.6 * 3600e3), 5 * MIN, "Apollo 11");
  assert.equal(chooseStep(3.5 * D), 5 * MIN);
  assert.equal(chooseStep(14 * D), 20 * MIN);
  assert.equal(chooseStep(7 * D), 10 * MIN);
  assert.equal(chooseStep(29.5 * D), 20 * MIN);
  assert.equal(chooseStep(62 * D), 3600e3, "the pole story");
  assert.equal(chooseStep(Y), 3600e3);
  assert.equal(chooseStep(5 * Y), 2 * 3600e3);
  assert.equal(chooseStep(10 * Y), 3 * 3600e3);
  // Never more than about 82 000 samples, even for the 28-year run of tables (2013–2040).
  assert.ok(28 * Y / chooseStep(28 * Y) < 82000);
});

test("formatDuration counts years for long missions", () => {
  const D = 86400e3;
  assert.equal(formatDuration(Date.UTC(2035, 0, 1) - Date.UTC(2030, 0, 1)), "5 y");
  assert.equal(formatDuration(365 * D), "1 y");
  assert.equal(formatDuration(364 * D), "364 d");
  assert.equal(formatDuration(Date.UTC(2031, 4, 1) - Date.UTC(2030, 0, 1)), "1 y 120 d");
});

test("validateScenario: multi-year missions up to the ephemeris coverage, not across its gap", () => {
  const years = [...Array(11).keys()].map((i) => 1966 + i).concat([...Array(28).keys()].map((i) => 2013 + i));
  const five = makeScenario({ lat_deg: -89.44, lon_deg: -137.19, t_start_utc: "2030-01-01T00:00:00Z", t_end_utc: "2035-01-01T00:00:00Z" });
  const v5 = validateScenario(five, years);
  assert.ok(v5.ok, JSON.stringify(v5.errors));
  assert.match(v5.warnings.join(" "), /few seconds/);
  const all = makeScenario({ lat_deg: 0, lon_deg: 0, t_start_utc: "2013-01-01T00:00:00Z", t_end_utc: "2040-12-31T00:00:00Z" });
  assert.ok(validateScenario(all, years).ok, "the whole 2013–2040 run");
  const apollo = makeScenario({ lat_deg: 0, lon_deg: 0, t_start_utc: "1966-01-01T00:00:00Z", t_end_utc: "1976-12-31T00:00:00Z" });
  assert.ok(validateScenario(apollo, years).ok, "the whole 1966–1976 run");
  const gap = makeScenario({ lat_deg: 0, lon_deg: 0, t_start_utc: "1972-12-01T00:00:00Z", t_end_utc: "2014-01-01T00:00:00Z" });
  assert.match(validateScenario(gap, years).errors.t_end_utc, /gap .*1977–2012/);
  // Without a coverage list (before the tables load) a span is checked against 30 years only.
  assert.ok(validateScenario(five).ok);
});

test("scenarioTimes and physicsKey", () => {
  const s = makeScenario({ lat_deg: 1, lon_deg: 2, t_start_utc: "2020-01-01T00:00:00Z", t_end_utc: "2020-01-02T00:00:00Z", label: "x" });
  assert.equal(scenarioTimes(s).span, 86400e3);
  const s2 = { ...s, label: "renamed", color: 4 };
  assert.equal(physicsKey(s), physicsKey(s2), "label and colour do not change the physics key");
});

test("coverageEnd finds the end of the covered run of years", () => {
  const years = [1966, 1967, 1968, 1969, 1970, 1971, 1972, 1973, 1974, 1975, 1976, 2013, 2014];
  assert.equal(coverageEnd(Date.UTC(1969, 6, 20), years), Date.UTC(1977, 0, 1));
  assert.equal(coverageEnd(Date.UTC(2013, 0, 5), years), Date.UTC(2015, 0, 1));
  assert.equal(coverageEnd(Date.UTC(1990, 0, 1), years), null);
  assert.equal(coverageEnd(Date.UTC(1990, 0, 1), null), null);
});
