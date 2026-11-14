// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Tests for the Compare tab's text helpers (web/js/app/compare_text.js).

import test from "node:test";
import assert from "node:assert/strict";
import { eclipseText } from "../js/app/compare_text.js";

const T = (s) => Date.parse(s);

test("eclipseText: total eclipse at Blue Ghost, 14 Mar 2025 (contacts from docs/validation/eclipse.md)", () => {
  const e = {
    start_ms: T("2025-03-14T05:00:42Z"), end_ms: T("2025-03-14T09:51:10Z"), max_ms: T("2025-03-14T07:25:00Z"), max_frac: 1,
    total_start_ms: T("2025-03-14T06:17:24Z"), total_end_ms: T("2025-03-14T08:34:24Z"),
  };
  const s = eclipseText([e], T("2025-03-14T04:30:00Z"), T("2025-03-14T10:20:00Z"));
  assert.match(s, /Earth eclipses the Sun/);
  assert.match(s, /total for 2 h 17 min \(06:17–08:34 UTC\)/);
  assert.match(s, /partly covered 05:00–09:51 UTC/);
});

test("eclipseText: partial eclipse, a phase cut by the window, and no eclipse", () => {
  const e = { start_ms: null, end_ms: T("2025-03-15T01:10:00Z"), max_ms: T("2025-03-14T23:00:00Z"), max_frac: 0.63, total_start_ms: null, total_end_ms: null };
  const s = eclipseText([e], T("2025-03-14T22:00:00Z"), T("2025-03-16T00:00:00Z"));
  assert.match(s, /up to 63% covered at 14 Mar 23:00 UTC \(before the start–15 Mar 01:10 UTC\)/);
  assert.equal(eclipseText([], 0, 1), "");
  assert.equal(eclipseText(undefined, 0, 1), "");
});

test("earthSide and earthElCaption: the caption fits near-side, polar and far-side sites", async () => {
  const { earthSide, earthElCaption } = await import("../js/app/compare_text.js");
  assert.equal(earthSide(0.6741, 23.473), "near"); // Apollo 11
  assert.equal(earthSide(-89.45, -136.97), "limb"); // Shackleton rim (south pole)
  assert.equal(earthSide(-45.4561, 177.5885), "far"); // Chang'e 4
  const it = (lat, lon) => ({ s: { lat_deg: lat, lon_deg: lon } });
  assert.match(earthElCaption([it(-45.4561, 177.5885)]), /far side, Earth never rises/);
  assert.doesNotMatch(earthElCaption([it(-45.4561, 177.5885)]), /near side/i);
  assert.match(earthElCaption([it(-89.45, -136.97)]), /poles and the limb/);
  assert.match(earthElCaption([it(0.67, 23.47), it(-45.46, 177.59)]), /Near side: Earth barely moves\. Far side: it never rises\./);
});

test("rankRows, sortRows, bestIds, rankSentence: ties on sunlight fall back to Sun height; ties are not highlighted", async () => {
  const { rankRows, sortRows, bestIds, rankSentence } = await import("../js/app/compare_text.js");
  const mission = (id, sunEl, earthEl, phase) => ({
    s: { id }, label: id, color: "#000",
    series: { sun_flux_frac: [1, 1, 1], sun_vis: [1, 1, 1], sun_el: sunEl, earth_el: earthEl, earth_phase: phase, earth_vis: [1, 1, 1] },
  });
  const rows = rankRows([
    mission("A11", [10.7, 15, 21.7], [59, 59, 59], [0.58, 0.62, 0.67]),
    mission("A16", [14.8, 30, 50], [73, 75, 77], [0.17, 0.3, 0.44]),
    mission("A12", [5.1, 12, 21.1], [61, 61, 61], [0.12, 0.17, 0.22]),
  ]);
  assert.deepEqual(sortRows(rows).map((r) => r.id), ["A16", "A11", "A12"]);
  assert.deepEqual(sortRows(rows, "lit").map((r) => r.id), ["A11", "A16", "A12"]);
  assert.equal(bestIds(rows, "sunlit").size, 0);
  assert.deepEqual([...bestIds(rows, "earth")], ["A16"]);
  assert.equal(
    rankSentence(rows),
    "All 3 have sunlight the whole time. Highest Sun: A16 (15° to 50°). Highest Earth: A16 (73° to 77°). Fullest Earth: A11 (58% to 67% lit).",
  );
  // Far side: the Earth never rises.
  const far = (id) => ({ s: { id }, label: id, color: "#000", series: { sun_flux_frac: [0, 1], sun_vis: [0, 1], sun_el: [-1, 2], earth_el: [-48, -47], earth_phase: [0.7, 0.71], earth_vis: [0, 0] } });
  assert.match(rankSentence(rankRows([far("a"), far("b")])), /Earth never rises at any of them\./);
});
