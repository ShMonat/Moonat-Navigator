# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Team board: shared coordination state for all agents on both laptops.

The board lives on the git branch `board`, checked out as a worktree at `<repo>/board/`.
It is independent of feature branches, so every agent sees the same state.

Usage (from anywhere inside the repo or one of its worktrees):
    uv run python scripts/board.py sync                 # pull + print summary
    uv run python scripts/board.py new work <id> --title "..." --owner shay
    uv run python scripts/board.py new contract <id> --title "..." --owner shay
    uv run python scripts/board.py new flag <id> --title "..." --owner shahar
    uv run python scripts/board.py publish -m "message"  # commit + push board changes

Hook entry points (used by .claude/settings.json; quiet unless there is something to say):
    board.py session-start   # sync + summary, injected into the agent's context
    board.py notify          # on each prompt: report board changes made by others (fetch at most 1/min)
    board.py stop-check      # on stop: remind the agent to log progress if code changed but board did not

Standard library only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
import time
from pathlib import Path

BRANCH = "board"
REMOTE = "origin"
KINDS = {"work": "work", "contract": "contracts", "flag": "flags"}
PLACEHOLDER_RE = re.compile(r"PLACEHOLDER\[([A-Za-z0-9_.-]+)\]")
REWIRE_STATUSES = {"implemented", "changed"}
STOP_REMIND_SECONDS = 20 * 60
NOTIFY_MIN_INTERVAL = 60

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


# ---------------------------------------------------------------- git helpers
def git(*args: str, cwd: Path | None = None, check: bool = True, timeout: int = 60) -> str:
    r = subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, timeout=timeout, encoding="utf-8"
    )
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout.strip()


def code_root() -> Path:
    """Root of the worktree the agent is working in (may be a linked worktree)."""
    return Path(git("rev-parse", "--show-toplevel"))


def main_root() -> Path:
    """Root of the main checkout (parent of the common .git dir)."""
    return Path(git("rev-parse", "--path-format=absolute", "--git-common-dir")).parent


def board_dir(create: bool = True) -> Path | None:
    """Locate the board worktree, creating it from origin/board if needed."""
    porcelain = git("worktree", "list", "--porcelain")
    path = None
    for block in porcelain.split("\n\n"):
        lines = dict(line.split(" ", 1) for line in block.strip().splitlines() if " " in line)
        if lines.get("branch") == f"refs/heads/{BRANCH}":
            path = Path(lines["worktree"])
    if path and path.exists():
        return path
    if not create:
        return None
    target = main_root() / "board"
    git("worktree", "prune", check=False)
    local = git("rev-parse", "--verify", "--quiet", f"refs/heads/{BRANCH}", check=False)
    if not local:
        git("fetch", REMOTE, BRANCH, check=False, timeout=30)
        remote = git(
            "rev-parse", "--verify", "--quiet", f"refs/remotes/{REMOTE}/{BRANCH}", check=False
        )
        if not remote:
            raise RuntimeError(f"No '{BRANCH}' branch locally or on {REMOTE}. Ask the humans.")
        git("worktree", "add", "-b", BRANCH, str(target), f"{REMOTE}/{BRANCH}")
    else:
        git("worktree", "add", str(target), BRANCH)
    return target


def has_upstream(bd: Path) -> bool:
    return bool(git("rev-parse", "--abbrev-ref", "@{u}", cwd=bd, check=False))


def pull(bd: Path) -> str | None:
    """Pull latest board. Returns a warning string on failure (e.g. offline)."""
    if not has_upstream(bd):
        return "board has no upstream yet (not pushed) - showing local state"
    try:
        git("pull", "--rebase", "--autostash", "-q", cwd=bd, timeout=30)
    except Exception as e:  # offline, conflict, ...
        return f"could not pull board ({e}); showing local state"
    return None


# ---------------------------------------------------------------- parsing
def front_matter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8-sig")  # tolerate BOM (PowerShell 5 writes one)
    m = re.match(r"---\s*\n(.*?)\n---", text, re.S)
    meta: dict[str, str] = {}
    if not m:
        return meta
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            v = v.split("#", 1)[0].strip()  # strip inline comments
            meta[k.strip()] = v
    return meta


def items(bd: Path, kind: str) -> list[dict[str, str]]:
    out = []
    for p in sorted((bd / KINDS[kind]).glob("*.md")):
        meta = front_matter(p)
        meta.setdefault("id", p.stem)
        out.append(meta)
    return out


def placeholders(root: Path) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for sub in ("src", "tests", "scripts", "app"):
        base = root / sub
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if p.suffix not in {".py", ".js", ".ts", ".html", ".md", ".toml", ".json"}:
                continue
            if p.name == "board.py":
                continue
            try:
                lines = p.read_text(encoding="utf-8").splitlines()
            except (UnicodeDecodeError, OSError):
                continue
            for i, line in enumerate(lines, 1):
                for cid in PLACEHOLDER_RE.findall(line):
                    found.setdefault(cid, []).append(f"{p.relative_to(root).as_posix()}:{i}")
    return found


# ---------------------------------------------------------------- summary
def summary(bd: Path, warn: str | None = None) -> str:
    out: list[str] = ["# BOARD (shared team state - see docs/COLLABORATION.md)"]
    if warn:
        out.append(f"! {warn}")
    state = bd / "STATE.md"
    if state.exists():
        out += ["", state.read_text(encoding="utf-8").strip()]

    work = items(bd, "work")
    active = [w for w in work if w.get("status") not in {"done", "dropped"}]
    out += ["", f"## Active work ({len(active)})"]
    for w in active:
        out.append(
            f"- {w['id']} [{w.get('owner', '?')}/{w.get('status', '?')}] {w.get('title', '')}"
            f" | branch {w.get('branch', '-')} | scope {w.get('scope', '-')} | updated {w.get('updated', '?')}"
        )
    done = [w for w in work if w.get("status") == "done"]
    if done:
        out.append("Done: " + ", ".join(w["id"] for w in done))

    contracts = items(bd, "contract")
    out += ["", f"## Contracts ({len(contracts)})"]
    for c in contracts:
        out.append(
            f"- {c['id']} [{c.get('status', '?')}] {c.get('title', '')}"
            f" | producer {c.get('producer', '?')} -> consumers {c.get('consumers', '?')}"
        )

    flags = items(bd, "flag")
    open_flags = [f for f in flags if f.get("status") != "resolved"]
    out += ["", f"## OPEN FLAGS ({len(open_flags)}) - need a human decision"]
    for f in open_flags:
        out.append(
            f"- {f['id']}: {f.get('title', '')} | decider {f.get('decider', '?')}"
            f" | raised by {f.get('raised_by', '?')}"
        )
    resolved = [f for f in flags if f.get("status") == "resolved"]
    if resolved:
        resolved.sort(key=lambda f: f.get("resolved", ""), reverse=True)
        out.append(
            "Recent decisions (resolved flags; read file for verdict): "
            + ", ".join(f["id"] for f in resolved[:8])
        )

    status = {c["id"]: c.get("status", "?") for c in contracts}
    ph = placeholders(code_root())
    if ph:
        out += ["", "## Placeholders in this worktree"]
        for cid, locs in sorted(ph.items()):
            st = status.get(cid, "NO CONTRACT")
            tag = "  <-- NEEDS WIRING (skill wire-contract)" if st in REWIRE_STATUSES else ""
            if st == "NO CONTRACT":
                tag = "  <-- missing contract file!"
            out.append(f"- {cid} [{st}] {len(locs)}x: {', '.join(locs[:4])}{tag}")
    return "\n".join(out)


# ---------------------------------------------------------------- commands
def cmd_sync(_: argparse.Namespace) -> int:
    bd = board_dir()
    print(summary(bd, pull(bd)))
    return 0


def cmd_new(a: argparse.Namespace) -> int:
    bd = board_dir()
    pull(bd)
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", a.id):
        print("id must be lowercase kebab-case, e.g. horizon-profile", file=sys.stderr)
        return 1
    dest = bd / KINDS[a.kind] / f"{a.id}.md"
    if dest.exists():
        print(f"{dest} already exists", file=sys.stderr)
        return 1
    tpl = (bd / "templates" / f"{a.kind}.md").read_text(encoding="utf-8")
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    text = (
        tpl.replace("{id}", a.id)
        .replace("{title}", a.title)
        .replace("{owner}", a.owner)
        .replace("{date}", now)
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text, encoding="utf-8")
    print(dest)
    return 0


def cmd_publish(a: argparse.Namespace) -> int:
    bd = board_dir()
    git("add", "-A", cwd=bd)
    if not git("diff", "--cached", "--name-only", cwd=bd):
        print("board: nothing to publish")
    else:
        git("commit", "-q", "-m", f"[board] {a.message}", cwd=bd)
    if not has_upstream(bd):
        git("push", "-q", "-u", REMOTE, BRANCH, cwd=bd, timeout=60)
        print("board published (upstream set)")
        return 0
    for attempt in range(4):
        try:
            git("pull", "--rebase", "--autostash", "-q", cwd=bd, timeout=30)
            git("push", "-q", REMOTE, BRANCH, cwd=bd, timeout=60)
            print("board published")
            return 0
        except Exception as e:
            err = e
            time.sleep(1 + attempt)
    print(f"board publish FAILED: {err}. Local commit kept; retry publish later.", file=sys.stderr)
    return 1


def _state_file(name: str) -> Path:
    return Path(git("rev-parse", "--path-format=absolute", "--git-common-dir")) / name


def hook_session_start(_: argparse.Namespace) -> int:
    try:
        bd = board_dir()
        warn = pull(bd)
        print(summary(bd, warn))
        print(
            "\n(Before starting work: claim a work item via skill start-work. Publish progress often.)"
        )
        _state_file("board-last-seen").write_text(git("rev-parse", "HEAD", cwd=bd))
    except Exception as e:
        print(f"[board] unavailable: {e}")
    return 0


def hook_notify(_: argparse.Namespace) -> int:
    try:
        stamp = _state_file("board-last-fetch")
        if stamp.exists() and time.time() - stamp.stat().st_mtime < NOTIFY_MIN_INTERVAL:
            return 0
        stamp.write_text(str(time.time()))
        bd = board_dir(create=False)
        if bd is None or not has_upstream(bd):
            return 0
        seen_f = _state_file("board-last-seen")
        seen = seen_f.read_text().strip() if seen_f.exists() else ""
        if pull(bd):
            return 0
        head = git("rev-parse", "HEAD", cwd=bd)
        if not seen or seen == head:
            seen_f.write_text(head)
            return 0
        me = git("config", "user.email", check=False)
        authors = git("log", "--format=%ae", f"{seen}..{head}", cwd=bd, check=False).split()
        changed = git(
            "diff",
            "--name-status",
            seen,
            head,
            "--",
            "flags",
            "contracts",
            "STATE.md",
            cwd=bd,
            check=False,
        )
        seen_f.write_text(head)
        if not changed or all(a == me for a in authors):
            return 0
        print(
            "[board] Changes by others since you last looked (open the files in ./board/ if relevant):"
        )
        print(changed)
        print(
            "If a flag you raised was resolved, apply the verdict. If a contract you consume is now "
            "implemented/changed, plan re-wiring (skill wire-contract)."
        )
    except Exception:
        pass  # never block the user's prompt
    return 0


def hook_stop_check(_: argparse.Namespace) -> int:
    try:
        raw = "" if sys.stdin.isatty() else sys.stdin.read()
        data = json.loads(raw.lstrip("﻿").strip() or "{}")
    except Exception:
        data = {}
    if data.get("stop_hook_active"):
        return 0
    try:
        root = code_root()
        if root.name == "board" or not (root / "pyproject.toml").exists():
            return 0
        dirty = git("status", "--porcelain", cwd=root).splitlines()
        paths = [
            root / ln[3:].strip('"')
            for ln in dirty
            if not ln[3:].startswith("board/") and not ln[3:].startswith(".claude/")
        ]
        mtimes = [p.stat().st_mtime for p in paths if p.exists() and p.is_file()]
        if not mtimes:
            return 0
        bd = board_dir(create=False)
        if bd is None:
            return 0
        me = git("config", "user.email", check=False)
        last = git("log", "-1", f"--author={me}", "--format=%ct", cwd=bd, check=False)
        last_t = float(last) if last else 0.0
        if max(mtimes) > last_t and time.time() - last_t > STOP_REMIND_SECONDS:
            print(
                "Board reminder: you changed code but your human's board has not been updated in 20+ min. "
                "Update your work item in ./board/work/ (progress log, placeholders, status) and run "
                '`uv run python scripts/board.py publish -m "..."`. If you have no work item yet, '
                "create one (skill start-work). Then finish your reply.",
                file=sys.stderr,
            )
            return 2
    except Exception:
        return 0
    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sync").set_defaults(fn=cmd_sync)
    n = sub.add_parser("new")
    n.add_argument("kind", choices=list(KINDS))
    n.add_argument("id")
    n.add_argument("--title", required=True)
    n.add_argument("--owner", required=True, choices=["shay", "shahar"])
    n.set_defaults(fn=cmd_new)
    pb = sub.add_parser("publish")
    pb.add_argument("-m", "--message", required=True)
    pb.set_defaults(fn=cmd_publish)
    sub.add_parser("session-start").set_defaults(fn=hook_session_start)
    sub.add_parser("notify").set_defaults(fn=hook_notify)
    sub.add_parser("stop-check").set_defaults(fn=hook_stop_check)
    a = p.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
