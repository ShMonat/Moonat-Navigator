// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Regression tests for the QA round 3 fixes (docs/validation/qa3.md).

import test from "node:test";
import assert from "node:assert/strict";
import { copyLabel } from "../js/app/state.js";
import { store, setScenarios, duplicateScenario } from "../js/app/store.js";

test("copyLabel numbers copies from the base name instead of stacking '(copy)'", () => {
  assert.equal(copyLabel("Apollo 11", ["Apollo 11"]), "Apollo 11 (copy)");
  assert.equal(copyLabel("Apollo 11", ["Apollo 11", "Apollo 11 (copy)"]), "Apollo 11 (copy 2)");
  assert.equal(copyLabel("Apollo 11 (copy)", ["Apollo 11", "Apollo 11 (copy)"]), "Apollo 11 (copy 2)");
  assert.equal(copyLabel("Apollo 11 (copy 2)", ["Apollo 11", "Apollo 11 (copy)", "Apollo 11 (copy 2)"]), "Apollo 11 (copy 3)");
  // A freed name is used again; an empty label stays empty.
  assert.equal(copyLabel("Apollo 11 (copy 3)", ["Apollo 11 (copy 3)"]), "Apollo 11 (copy)");
  assert.equal(copyLabel("", ["", ""]), "");
  assert.equal(copyLabel(null), "");
});

test("duplicating the last card five times gives five distinct names", () => {
  setScenarios([{ label: "Apollo 11", lat_deg: 0.6741, lon_deg: 23.473, t_start_utc: "1969-07-20T20:17:40Z" }]);
  for (let i = 0; i < 5; i++) duplicateScenario(store.scenarios[store.scenarios.length - 1].id);
  assert.deepEqual(store.scenarios.map((s) => s.label), [
    "Apollo 11", "Apollo 11 (copy)", "Apollo 11 (copy 2)", "Apollo 11 (copy 3)", "Apollo 11 (copy 4)", "Apollo 11 (copy 5)",
  ]);
  assert.equal(new Set(store.scenarios.map((s) => s.id)).size, 6);
});
