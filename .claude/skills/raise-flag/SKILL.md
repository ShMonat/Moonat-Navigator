---
name: raise-flag
description: Raise a conflict flag on the team board when a request contradicts the project vision, a recorded decision (resolved flag), a contract, another agent's active work, or established work in the other human's domain. Use whenever something "doesn't align" or you are unsure who has the final say.
---

# Raise a flag

When to raise one:
- Your human asks for X, but the board, code or docs establish Y. That includes a resolved flag, a contract,
  something in the other human's domain (`docs/TEAM.md`), or a shared-domain item such as vision, UI/UX or scope.
- You'd need to edit inside another active work item's scope.
- You can't tell whose domain it is.

Steps:
1. `uv run python scripts/board.py sync`. Check that an open flag doesn't already cover it; if one does, add your
   input to it instead.
2. `uv run python scripts/board.py new flag <id> --title "<one line>" --owner <your human>`
3. Fill it in:
   - `decider`: `shay`, `shahar` or `both`, per the domain table.
   - Conflict: quote both sides and link the files, work items or flags involved.
   - 2–3 concrete Options, and optionally your recommendation.
   Keep it short. The humans will read it in 30 seconds.
4. Add `flag: <id>` to the Progress log of your work item. If you're fully blocked, set your item's `status: blocked`.
5. `uv run python scripts/board.py publish -m "flag <id>"`
6. Tell your human in plain words: what conflicts, with whom, and that they need to talk to the other human. Then continue
   **only** on parts the flag doesn't touch. Never implement the contested part on your own judgment.
