# How the agents collaborate

The humans will barely talk during the hackathon. Coordination happens through **the board**. The board is a set of small
Markdown files on a dedicated git branch `board`, checked out at `./board/` on every laptop by
`scripts/board.py`. Because the board is its own branch, it never mixes with feature branches. Every agent, on
either laptop and on any branch, sees the same state within seconds of a publish.

```
board/
  STATE.md        project snapshot: phase, layer status, what's next. Short (40 lines max).
  work/<id>.md    one file per work item: who, what, branch, scope, assumptions, progress log
  contracts/<id>.md  one file per interface between layers: the agreed shape of data/functions
  flags/<id>.md   one file per conflict that needs a human decision; also stores the verdict
  templates/      templates for the three kinds above
```
Each work item, contract and flag is its own file, so two agents editing at the same time almost never conflict.

## Commands (all via `uv run python scripts/board.py ...`)
| Command | What it does |
|---|---|
| `sync` | pull the latest board and print a summary: active work, contracts, open flags, placeholders that need wiring |
| `new work <id> --title "..." --owner shay` | create `board/work/<id>.md` from the template (also `contract`, `flag`) |
| `publish -m "msg"` | commit and push the board (it pulls with rebase and retries on a race) |

Hooks run automatically. At session start the board summary is injected. On each prompt, new or changed flags and
contracts from the other side are reported, checked at most once a minute. When the agent stops, if code changed
and the board hasn't been updated for 20 minutes or more, the agent is reminded to log progress.

## The rules
1. **Start of work:** run `sync`, then create a work item (skill `start-work`). Declare its scope: the folders/files
   you will own while it's active. Don't edit files inside another active item's scope. If you must, raise a flag
   or coordinate through the board.
2. **Publish often:** at start, at each meaningful step, when blocked and when done. Each publish adds one line to the
   item's progress log. The board is the *only* way the other side knows what you did.
3. **Building on something that doesn't exist yet:**
   - Write the shape you assume as a contract with `status: assumed`. Include units, frames, dtypes and an example.
   - In code, put **all** assumptions behind one adapter function in *your own* module, marked
     `# PLACEHOLDER[<contract-id>]: <what's faked>`. It returns synthetic data in the assumed shape. Never create
     files in the producer's folder.
   - Carry on building and testing against the placeholder.
4. **Producing something others assumed:** before building, read the contracts that have you as producer.
   Match the assumed shape if it's reasonable, and set the status to `agreed` then `implemented`. If you need a different shape, set
   `status: changed` and describe the difference under "Change history". `sync` lists every placeholder whose
   contract is `implemented` or `changed`, and the consumer side then re-wires it with the skill `wire-contract`.
5. **Conflicts:** if a task contradicts the established vision, a resolved flag, a contract, or work in the other
   human's domain (see `docs/TEAM.md`), raise a flag (skill `raise-flag`). Tell your human about it in plain words, and
   continue only on the parts that aren't contested. The humans decide verbally. Then *either* human tells *any*
   agent the verdict, and that agent records it (skill `resolve-flag`). Resolved flags are the project's decision log.
6. **Done:** use the skill `finish-work`. Update the work item (summary of changes, how to use it, known gaps) and
   contract statuses, update `STATE.md` if a layer's status changed, then publish.

## Git rules for code (separate from the board)
- Code lives on short-lived feature branches `<human>/<work-id>`. Never commit code directly to `main`.
- Agents commit, push, merge or open PRs for **code** only when their human asks. **Board publishes need no
  permission.** They are the point of the board.
- Before merging into `main`: `uv run ruff check .` and `uv run pytest` must pass.
- Never force-push, and never rewrite shared history.
