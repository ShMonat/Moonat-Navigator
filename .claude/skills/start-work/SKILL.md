---
name: start-work
description: Claim a new work item on the team board before changing code. Use at the start of any task that will edit code, data or docs in this repo, or when the user says "start", "work on", "build", "implement". Covers scope, contracts for missing layers, and placeholders.
---

# Start a work item

1. `uv run python scripts/board.py sync`. Read the active work, contracts and open flags.
   - If another active item's `scope` overlaps what you're about to touch, stop and tell your human. Coordinate
     through the board, or raise a flag (skill `raise-flag`).
   - If your task contradicts a resolved flag (decision), a contract, or established work in the other human's
     domain (`docs/TEAM.md`), raise a flag first.
2. Pick a short kebab-case id, e.g. `horizon-profile`. Identify your human (`shay` or `shahar`): ask if unsure, and
   remember it for the session.
3. `uv run python scripts/board.py new work <id> --title "..." --owner <human>`, then fill the front matter:
   - `layer`
   - `scope` (the folders/files you will own; keep it tight)
   - `consumes` and `provides` (contract ids)
   - the Goal.
4. **For every input that doesn't exist yet** (another layer or dataset):
   - If there's no contract, create one: `board.py new contract <cid> --title "..." --owner <human>`. Set `status: assumed`,
     `producer`, `consumers: <your id>`, and write the exact Shape (dtypes, units, frames, time scale) plus an Example.
   - If a contract exists, add yourself to `consumers` and build to its Shape.
   - In code, isolate the assumption in ONE adapter function inside your own scope, marked
     `# PLACEHOLDER[<cid>]: <what is faked>`. It returns synthetic data in exactly the contract's shape. Never
     create files in the producer's folder.
5. **For every output others will use**, create or claim the contract with `producer: <your id>`. If consumers already
   assumed a shape, match it if that's reasonable. Otherwise follow rule 4 in docs/COLLABORATION.md (`changed`).
6. Create the code branch: `git switch main && git pull && git switch -c <human>/<id>`.
7. `uv run python scripts/board.py publish -m "start <id>"`.

Then work. After each meaningful step, add a line to the item's Progress log and publish.
