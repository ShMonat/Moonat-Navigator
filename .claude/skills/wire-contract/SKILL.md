---
name: wire-contract
description: Replace placeholder code with the real implementation of a contract once the producing layer exists. Use when board sync shows "NEEDS WIRING", when a contract you consume becomes implemented or changed, or when the user asks to connect or wire layers together.
---

# Wire a placeholder to the real thing

1. `uv run python scripts/board.py sync`. The "Placeholders" section lists `PLACEHOLDER[<cid>]` locations and the
   contract status.
2. Read `board/contracts/<cid>.md`: the Shape, `location`, and the Change history, which shows what differs from what was assumed.
   Make sure the producer's code is on `main`: `git fetch && git merge origin/main` into your branch, or
   ask your human if their branch isn't merged yet.
3. Replace the adapter body with a call to the real `location`. Keep the adapter as a thin translation layer if
   the shape `changed`, so the rest of your code doesn't move. Delete the `PLACEHOLDER[...]` marker.
4. Run the tests. Any test that relied on synthetic data should now also be checked against real data. If
   results change meaningfully (numbers, plots), show your human a before/after comparison.
5. Update your work item (Progress log: "wired <cid>") and remove `<cid>` from its assumptions. If you were the last
   consumer, note it in the contract. Then `board.py publish -m "wired <cid>"`.
6. If the real data can't satisfy what your code needs, don't hack around it: raise a flag (skill `raise-flag`)
   with decider per domain.
