---
name: resolve-flag
description: Record a human's verdict on an open team-board flag. Use when the user says what was decided about a flag or conflict ("we decided...", "verdict on X", "Shahar and I agreed..."), from either human, to any agent.
---

# Record a verdict

1. `uv run python scripts/board.py sync`, then open `board/flags/<id>.md`. If the user didn't name the flag, match
   it from the open flags and confirm with them.
2. Fill in **Verdict**:
   - the decision, in the human's own words;
   - who decided it (the decider per the flag, or "both");
   - what must change and in which work items, files or contracts.
   Set `status: resolved` and `resolved: <YYYY-MM-DD HH:MM>`.
3. If the verdict changes a contract, update the contract's Shape and status, and add to its Change history. If it changes
   the vision or layer plan, update `board/STATE.md`, and `docs/ARCHITECTURE.md` via a normal code PR.
4. `uv run python scripts/board.py publish -m "verdict <id>"`. The other side's agents see it on their next prompt.
5. If the follow-up work falls in your own scope, do it now, or ask your human. Otherwise, leave it noted in the verdict
   for the owning agent.
