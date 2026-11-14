// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Scenario builder inputs (web/js/app/state.js): the date forms people type, and messages that list every problem.

import test from "node:test";
import assert from "node:assert/strict";
import { parseUtc, validateScenario, makeScenario } from "../js/app/state.js";

const A11 = Date.UTC(1969, 6, 20, 20, 17);

test("parseUtc accepts YYYY/MM/DD and English month names, read as UTC", () => {
  for (const s of [
    "1969/07/20 20:17", "1969/7/20 20:17", "20 July 1969 20:17", "20 Jul 1969, 20:17", "20-Jul-1969 20:17", "July 20, 1969 20:17",
    "Jul 20 1969 20:17 UTC", "20th July 1969 at 20:17", "july 20, 1969 20:17:00Z",
  ]) {
    assert.equal(parseUtc(s), A11, s);
  }
  assert.equal(parseUtc("20 July 1969"), Date.UTC(1969, 6, 20));
  assert.equal(parseUtc("Sept 3, 2023"), Date.UTC(2023, 8, 3));
  assert.equal(parseUtc("20 July 1969 22:17 +02:00"), A11);
});

test("parseUtc still refuses ambiguous or impossible dates", () => {
  for (const s of ["07/20/1969 08:17:40 PM", "20/07/1969", "31 June 2027", "30 Febuary 2024", "July 1969", "tomorrow", "1969/13/01"]) {
    assert.ok(Number.isNaN(parseUtc(s)), s);
  }
});

test("a bad date says which format to use", () => {
  const v = validateScenario(makeScenario({ lat_deg: 0, lon_deg: 0, t_start_utc: "next Tuesday" }));
  assert.match(v.errors.t_start_utc, /YYYY-MM-DD hh:mm \(UTC\)/);
});

test("validation reports every problem: a bad latitude and a date outside the tables together", () => {
  const v = validateScenario(makeScenario({ lat_deg: 95, lon_deg: 10, t_start_utc: "1980-06-01" }), [1969, 1970]);
  assert.ok(v.errors.lat_deg && v.errors.t_start_utc);
});
