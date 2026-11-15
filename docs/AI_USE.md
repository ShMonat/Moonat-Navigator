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
- 2026-11-14 (afternoon and evening): Shay reviewed the live app and asked for changes: a large 3D Moon globe with polar,
  near-side and far-side views, end time or duration, a Sun/Earth switch, terrain for any point, and a rover traverse planner.
  The orchestrating agent split the work among further agents: `polish`, `responsive` (phones and tablets), `ui-tweaks`,
  `globe`, `eclipse` (Earth eclipsing the Sun, checked against NASA eclipse times), `terrain-everywhere` and `terrain-live`
  (live NASA Moon Trek elevation), `rover` (path planning), `physics-xcheck` (an independent check of the browser code
  against JPL Horizons), `qa2` (a judge's-eye audit) and two QA fix agents. Shay decided the public release (a clean copy
  without the development history).
- 2026-11-14 (night) and 2026-11-15: Shay reviewed the app on his laptop and phone and asked for further changes:
  - the map works like a map app, with several pins, search, trips with stops and a home base;
  - suggested dates;
  - Follow during playback, with longer speeds;
  - a siting study for the StarHab base;
  - a view window that fills the screen like an app, with one camera group;
  - no emojis;
  - the Beresheet crash site;
  - map layers for permanently shadowed and most sunlit ground;
  - a view-direction wedge on the map.

  Agents built each item on its own branch: `suggest`, `starhab`, `qa4`, `view-ux`, `beresheet`, `map-layers`, `view-cone`
  and `rover-perf`. Each branch passed the same test gate before merging. The `video` agent re-recorded the demo on the
  final interface.
- 2026-11-14: screenshots in docs/figures are computed renders captured with a scripted browser. No AI-generated images or
  video are used, and no NASA logos or insignia appear.
- 2026-11-15: at Shay's request, each real mission's marker shows the flag of the nation that flew it. The flags are
  **unaltered third-party artwork**, not AI-generated: flag-icons (MIT) for the United States, China, India, Japan and
  Israel, and the public-domain Wikimedia Commons file for the Soviet Union, vendored byte-identical in web/assets/flags/
  (a test checks their SHA-256 against the source files) and only sized with CSS at their own aspect ratio. No AI drew,
  recoloured or cropped a flag. Sources and licences: docs/REFERENCES.md. The same change renamed "Artemis III candidate
  regions" to "Potential Artemis sites" (Shay: Artemis III is a mission in low Earth orbit; the landings are Artemis IV
  and later).
