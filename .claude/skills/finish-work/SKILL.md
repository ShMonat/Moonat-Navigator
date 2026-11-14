---
name: finish-work
description: Close out a work item on the team board - handoff notes, contract statuses, STATE.md, checks, and (only if the human asks) commit/PR. Use when a task is complete or when the user says "done", "wrap up", "hand off", "merge".
---

# Finish a work item

1. Run `uv run ruff check --fix .`, `uv run ruff format .` and `uv run pytest`. Fix failures, or record them as known gaps.
   Submission hygiene (docs/SUBMISSION.md): every new file has the AI-generated header, and every new dataset, library,
   paper or image is in `docs/REFERENCES.md`. User-facing text is in English.
2. Update `board/work/<id>.md`:
   - `status: done`, or `review` if it awaits the other human's review because it touched their domain;
   - `updated`;
   - a final Progress log line;
   - **Handoff notes**: what changed (files and modules), how to use it (one example call), known gaps, and the
     remaining placeholders.
3. For each contract you `provide`, set `status: implemented` and fill in `location`. If what you built differs from the
   assumed Shape, set `status: changed` and describe the delta in the Change history, because consumers will re-wire from it.
4. If a layer's status changed, update the table in `board/STATE.md` (keep it to 40 lines max).
5. `uv run python scripts/board.py publish -m "done <id>"`
6. Code: ask your human whether to commit, push and open a PR. Never merge or push code without their OK. Mention that `main`
   will only contain the work after the PR is merged, and that the other side's agents wire to it from `main`.
7. Give your human a short, checkable summary: what works, a plot or numbers if relevant, and what's not done.
