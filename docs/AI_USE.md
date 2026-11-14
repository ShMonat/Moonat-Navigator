# Use of AI

Disclosure required by NASA Space Apps (see docs/SUBMISSION.md, rule 7). Keep this current, because it feeds the "Use of AI"
field of the project page.

## How we work
The humans set the vision, the architecture and the physics requirements, and they review and validate all results. AI coding agents
(**Claude Code by Anthropic**) write essentially all of the code, tests and documentation under that direction. A deep-
research AI model is used to survey algorithms for terrain visibility (docs/research/).

## Marking AI-generated content
- **Code (in text and metadata):** every source file starts with the header comment
  `# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.` (or the equivalent comment syntax).
  Every commit by an agent carries a `Co-Authored-By: Claude ...` trailer (git metadata).
- **Data:** generated or derived data files carry the same note in their metadata (file header, JSON `"_generated_by"`
  field, or a sidecar README).
- **Images or video created by AI:** a **visible watermark** "AI-generated". Renders computed by our own code from NASA
  data, such as the sky views, are not AI-generated images. Note in the caption that they are computed renders.
- AI-generated content must **never include or alter the NASA logo, flags or mission insignia**.

## Log (add notable uses)
- 2026-11-07: Claude Code set up the repo, collaboration system, vision, architecture and plan docs from the team's briefs.
- 2026-11-14 (Sat, build day): one orchestrating Claude Code agent split the work among specialised Claude Code agents,
  each on its own branch and working copy. Agents: `ephem` (DE421 + MOON_ME ephemeris and tables, Horizons validation),
  `physics-js` (browser port of the geometry and visibility, tested against the Python reference), `terrain` (LOLA horizon
  profiles and DEM tiles), `catalog` (site catalog, stars, Earth textures), `web-app` (compare tab, scenario builder, map),
  `sky-viewer` (three.js sky view), `qa` (judge's-eye testing and fixes, docs/validation/qa.md), `video` (demo video script
  and captures) and `docs` (README, project page, references). Models: Claude Opus, Claude Sonnet and Claude Fable, chosen
  per task. The humans set the vision, the architecture and the physics requirements (before the event) and decided open flags;
  their review of the build-day results is pending. Agents wrote the code, tests, data scripts and docs, and ran the validation reports in docs/validation/ against
  JPL Horizons and published papers. Some data (catalog, polar site placement) still awaits Shahar's review, and demo content
  awaits both humans.
- 2026-11-14: screenshots in docs/figures are computed renders captured with a scripted browser. No AI-generated images or
  video are used, and no NASA logos or insignia appear.
