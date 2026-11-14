---
name: branch-discipline
description: Keep all code changes on a feature branch and never on main. Use before you create, edit or delete any file in this repo, and before any commit. Also use when the current branch is main.
---

# Work on a branch, never on main

`main` only receives work through a pull request. Check the branch before every change.

## Before you edit any file
1. Run `git branch --show-current`.
2. If the branch is `main` (or detached), stop. Do not edit yet.
   - `git status --short`. If the tree has uncommitted changes, tell your human and ask before you move them.
   - `git switch main && git pull`
   - `git switch -c <human>/<work-id>` (for example `shahar/horizon-profile`).
3. If the branch is already `<human>/<something>`, check that it matches the task. If it does not, create a new branch.

Use a short kebab-case work id. If you claimed a board work item (skill `start-work`), use its id.

## While you work
- Commit only on your feature branch.
- Commit, push, merge or open a PR only when your human asks. Never force-push.
- Do not run `git commit` or `git push` while on `main`.
- One branch per task. Do not mix unrelated changes.

## Exception: the board
Files in `./board/` live on the `board` branch. Edit them only through `uv run python scripts/board.py publish -m "..."`. Never edit board files on a feature branch.

## Before a PR
Run `uv run ruff check .` and `uv run pytest`. Both must pass.

## If you find yourself on main with changes
Do not commit. Create the feature branch from the current state (`git switch -c <human>/<work-id>`), which carries the changes with it. Then tell your human.
