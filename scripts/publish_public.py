# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Publish a clean snapshot of the development repo's ``main`` to the public repo, without the development history.

The public repo (``ShMonat/Moonat-Navigator``) holds one commit per publish. Each commit has the current tree of
``main`` (minus ``EXCLUDE``) and, as its only parent, the previous public commit. No commit of the development
history is ever an ancestor, so ``git push`` sends only the new commit, its tree and its blobs.

Usage:
    uv run python scripts/publish_public.py              # publish origin/main
    uv run python scripts/publish_public.py --dry-run    # build and check the commit, don't push
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import subprocess
import sys
import tempfile
from pathlib import Path

PUBLIC_URL = "https://github.com/ShMonat/Moonat-Navigator.git"
# Organizer documents that were shared with participants, not published by them.
EXCLUDE = [
    "docs/NASA_Space_Apps_TLV_5.11.pdf",
    "docs/מצגת יצירת והגשת פרויקט באתר nasa space apps.pdf",
]
AUTHOR = {
    "GIT_AUTHOR_NAME": "Moonat team",
    "GIT_AUTHOR_EMAIL": "284313725+ShMonat@users.noreply.github.com",
    "GIT_COMMITTER_NAME": "Moonat team",
    "GIT_COMMITTER_EMAIL": "284313725+ShMonat@users.noreply.github.com",
}
ROOT = Path(__file__).resolve().parents[1]


def git(*args: str, env: dict | None = None, check: bool = True) -> str:
    """Run git in the repo root and return stripped stdout."""
    r = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if check and r.returncode != 0:
        sys.exit(f"git {' '.join(args)} failed:\n{r.stderr}")
    return r.stdout.strip()


def filtered_tree(ref: str) -> str:
    """Tree id of ``ref`` with the EXCLUDE paths removed, built in a temporary index."""
    with tempfile.TemporaryDirectory() as tmp:
        env = {"GIT_INDEX_FILE": str(Path(tmp) / "index")}
        git("read-tree", ref, env=env)
        for path in EXCLUDE:
            git("rm", "--cached", "-q", "--ignore-unmatch", "--", path, env=env)
        return git("write-tree", env=env)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--ref", default="origin/main", help="development ref to publish (default origin/main)"
    )
    ap.add_argument("--remote", default=PUBLIC_URL)
    ap.add_argument("--message", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--after-freeze",
        action="store_true",
        help="publish although the public repo is frozen at the Space Apps submission (Shay's decision only)",
    )
    a = ap.parse_args()

    # The public repo and site are frozen at the NASA Space Apps 2026 submission (tag space-apps-2026-submitted,
    # 2026-11-15, Shay's decision). Development continues in this private repo.
    if not a.after_freeze and not a.dry_run:
        raise SystemExit(
            "The public repo is frozen at the Space Apps 2026 submission (tag space-apps-2026-submitted). "
            "Publish only with Shay's explicit approval, using --after-freeze."
        )

    git("fetch", "-q", "origin")
    src = git("rev-parse", a.ref)
    tree = filtered_tree(src)

    r = subprocess.run(
        ["git", "fetch", "-q", a.remote, "main"], cwd=ROOT, capture_output=True, text=True
    )
    parent = git("rev-parse", "FETCH_HEAD") if r.returncode == 0 else None
    if parent and git("rev-parse", f"{parent}^{{tree}}") == tree:
        print("The public repo already has this tree; nothing to publish.")
        return

    when = dt.datetime.now(dt.UTC).strftime("%Y-%m-%d %H:%M UTC")
    msg = a.message or (
        "Moonat: initial public release"
        if parent is None
        else f"Update from the development repository ({when})"
    )
    msg += (
        "\n\nAI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."
    )
    commit = git("commit-tree", tree, *(["-p", parent] if parent else []), "-m", msg, env=AUTHOR)

    # Safety: the new commit's ancestry must be only itself plus the previous public commits.
    ancestry = set(git("rev-list", commit).split())
    expected = 1 + (int(git("rev-list", "--count", parent)) if parent else 0)
    if len(ancestry) != expected or src in ancestry:
        sys.exit("Refusing to push: the commit would carry development history.")
    leaked = [p for p in EXCLUDE if git("ls-tree", "--name-only", commit, "--", p)]
    if leaked:
        sys.exit(f"Refusing to push: excluded files present: {leaked}")

    print(
        f"public commit {commit[:10]} (tree of {a.ref} {src[:10]}, parent {parent[:10] if parent else 'none'})"
    )
    if a.dry_run:
        print("dry run: not pushed")
        return
    git("push", a.remote, f"{commit}:refs/heads/main")
    print(f"pushed to {a.remote}")


if __name__ == "__main__":
    main()
