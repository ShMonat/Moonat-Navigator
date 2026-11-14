# Moonat - Lunar Landing Site Navigator

This is our NASA Space Apps 2026 entry. Challenge summary: `docs/challenge.md` (the original is `docs/Challenge description.pdf`).
**Read before working:** `docs/VISION.md` (what we build), `docs/ARCHITECTURE.md` (layers, data, contracts) and
`docs/PLAN.md` (workstreams and timeline). For the public front page, also read `docs/MAIN_TAB.md` (agreed spec;
open questions are listed at its end).
It's a hackathon with essentially one working day. Prefer working, demoable increments, and don't over-engineer, but keep
the physics right.

@docs/TEAM.md

**Your human is often interrupted** (limited availability this weekend). Work autonomously on well-specified
tasks: decide routine choices yourself and log them in your work item. Stop only for flags (domain conflicts) or irreversible
actions. When your human returns, give a 5-minute-readable summary: what's done, numbers or plots, and what's next.

## Coordination: mandatory for every agent
There are several agents on two laptops, and their humans barely talk. Shared state lives on **the board** (`./board/`, the
`board` branch). Full protocol: `docs/COLLABORATION.md`. Essentials:
- **Before working:** `uv run python scripts/board.py sync`. Read the summary, then claim a work item (skill
  `start-work`). Stay inside your declared scope.
- **While working:** publish progress to the board often (`board.py publish -m "..."`). No permission is needed for board
  publishes.
- **Building on a missing layer:** assume its shape in a contract (`status: assumed`). Isolate the assumption in
  one adapter marked `# PLACEHOLDER[<contract-id>]`. Re-wire it when the contract becomes `implemented` or `changed`
  (skill `wire-contract`).
- **Contradiction** with the vision, a decision, a contract, or the other human's domain: **raise a flag**
  (skill `raise-flag`) and tell your human. Don't silently override. Verdicts are recorded with skill `resolve-flag`.
- **Done:** skill `finish-work`.
- Only edit board files in `./board/`, and never edit them on a feature branch. `board/` is git-ignored on `main`.

## Stack
- Python 3.13, managed with **uv**. Never use bare `pip`, and never create other venvs.
  - Add a dependency: `uv add <pkg>`. For a dev-only dependency: `uv add --dev <pkg>`. Commit `pyproject.toml` and `uv.lock` together.
  - Run: `uv run python ...`, `uv run pytest`, `uv run ruff check --fix .`, `uv run ruff format .`
- No MATLAB. **Front end: a static website in `web/`** (plain HTML + ES modules, no build step; three.js, Plotly and Leaflet
  from CDN with pinned versions), hosted on GitHub Pages. Python precomputes data into `web/data/` and validates the physics.
  JS tests: `node --test web/tests/`. Local preview: `uv run python -m http.server -d web 8000`.
- **Binding data shapes: `docs/CONTRACTS.md`.** Kickoff decisions: `docs/ARCHITECTURE.md` §0.
- Shared raw data for all worktrees lives in the main checkout: `C:\Users\shaym\Projects\spaceapps-2026\data\raw\`
  (env `MOONAT_DATA_DIR` may override). Never download the same file twice; check there first.

## Submission rules: hard constraints (details in `docs/SUBMISSION.md`)
- Deadline **Sun 2026-11-15 23:59** Israel time. Everything user-facing is in **English**.
- **References:** when you add a dataset, library, code snippet, paper, image or texture, append it to
  `docs/REFERENCES.md` in the same change (name, use, URL, licence).
- **AI disclosure:** every new source file starts with
  `# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.` (or the equivalent comment).
  Generated data files carry the same note in metadata. AI-generated images or video need a visible "AI-generated" watermark.
  Never generate or alter the NASA logo, flags or mission insignia.
- Use at least one NASA dataset from the challenge's Resources tab (published Fri 2026-11-13).
- No images, voices or likenesses of minors in any media.

## Code conventions
- Comments and docstrings describe what the code does now. History belongs in git, not in comments.
- Every physics or geometry function states its units, frames and assumptions in its docstring, and has a test
  against a known value or a reference such as JPL Horizons.
- Plots and visuals must be readable in both dark and light themes.

## Repo layout
- `src/moonat/` is the Python package, with one subpackage per layer (see `docs/ARCHITECTURE.md` §5). `app/` holds the UI.
- `tests/` holds pytest tests. `scripts/` holds tooling, including `board.py` and the hooks.
- `data/` holds small curated files only. Large downloads go in `data/raw/` and derived data in `data/cache/`, and neither is committed.
  Every large dataset needs a download script (see `data/README.md`).
- `docs/` holds the challenge, team, protocol and design notes. `outputs/` holds generated figures (git-ignored).

## Git (code)
- Use feature branches `<human>/<work-id>`, and never commit code directly to `main`. Before starting: `git switch main && git pull`.
- Agents commit, push, merge or open PRs for code **only when their human asks**. Never force-push.
- Before merging: `uv run ruff check .` and `uv run pytest` pass. Never commit secrets, large data or outputs.
- If you change shared structure or conventions, update this file and `docs/` in the same PR.

## Domain notes and prior art
- Shay's MATLAB "Earth View" pipeline (method only; the code is not in this repo): JPL ephemeris (ICRF, Moon-centred) ->
  Moon-fixed frame (IAU lunar orientation) -> topocentric horizon frame at the site -> azimuth/elevation and apparent size.
  It used synthetic terrain, and real LOLA terrain is the upgrade.
- Likely building blocks: `skyfield` or `spiceypy` (ephemeris, lunar PA frame), `numpy`, `rasterio` (LOLA DEMs), `plotly`.
- The Moon has no atmosphere and therefore no refraction. The horizon is set by terrain plus curvature. Earth libration matters at the poles.
