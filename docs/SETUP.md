# First-time setup (Windows laptop)

About 10 minutes. Run these in PowerShell. Or paste this whole file into Claude Code and say "set me up per this file".

## 1. Install the tools
```powershell
winget install --id Git.Git -e
winget install --id astral-sh.uv -e
winget install --id GitHub.cli -e
```
Close and reopen the terminal so the new commands are on PATH. Then:
```powershell
uv python install 3.13
```

## 2. Tell git who you are (skip if already set)
```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## 3. Log in to GitHub
You need write access to `ShMonat/Moonat`. Shay adds you as a collaborator, and you accept the email invite.
```powershell
gh auth login      # choose GitHub.com -> HTTPS -> login with a web browser
gh auth setup-git
```

## 4. Get the code
```powershell
cd $HOME\Projects        # or wherever you keep projects
gh repo clone ShMonat/Moonat
cd Moonat
uv sync                  # creates .venv with the exact pinned packages
uv run pytest            # should pass
uv run python scripts/board.py sync   # creates ./board (the shared team board) and prints it
```

## 5. Introduce yourself (Shahar, once)
`docs/TEAM.md` has a placeholder section for Shahar. Ask your agent to interview you briefly and fill it in:
stack, strengths, and how you like results presented. Commit it via a small PR. Your agents and Shay's agents rely on it.
Also resolve the open board flag `infra-review-by-shahar`: tell your agent "verdict on infra review: ...".

## 6. Start working
Open the `Moonat` folder in Claude Code. It reads `CLAUDE.md`, and the hooks in `.claude/settings.json` show the
team board at the start of every session. Claude Code may ask you once to trust the project's hooks: allow it.
How agents coordinate (the board, work items, contracts, placeholders, flags) is in `docs/COLLABORATION.md`.
Day to day you only talk to your agent. It claims work, publishes progress and raises flags. When it raises a flag,
talk to Shay, then tell any agent the verdict.
