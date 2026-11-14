# Hackathon plan: from the starting gun (Sat 2026-11-14, 09:00) to submission

Read with: `docs/VISION.md` (what), `docs/ARCHITECTURE.md` (how), `docs/COLLABORATION.md` (the coordination protocol),
`docs/SUBMISSION.md` (the rules). Event schedule source: `docs/NASA_Space_Apps_TLV_5.11.pdf` (Hebrew). We are **team #9, Moonat**.
**Organizer rule: no work may start before Sat 09:00.** Before then: decisions, docs and checks only.

## Reality check: how the humans are available
- Limited availability (family commitments). Expect **frequent interruptions**.
- **Saturday (remote, at home):** ~09:00–18:00 with breaks, plus a few hours in the evening. **This is the main build day.**
- **Sunday (on site at Tel Aviv University, Neiman Library for Exact Sciences & Engineering):** a packed schedule with a
  live presentation. Little uninterrupted build time.

**What this means for agents:**
- Take **large, well-specified tasks with clear acceptance criteria**, and keep working autonomously.
- Don't block on the human for routine choices. Decide, log the decision in your work item, and move on. Stop only for
  domain conflicts (flags) or irreversible actions.
- When the human returns, give a short, checkable summary: what's done, numbers or plots, and what's next. They may only have 5 minutes.
- Humans: before stepping away, give each agent enough queued work to keep busy (the next 2–3 steps).

## 0. Before Saturday (humans)
- [ ] Shahar: complete her section in `docs/TEAM.md` and resolve the board flag `infra-review-by-shahar`.
- [x] Submission rules reviewed (docs/SUBMISSION.md). Event schedule reviewed (this file, §3).
- [ ] **Fri 2026-11-13 evening:** the challenge's Resources tab goes live. Check that our data plan uses **≥1 NASA dataset from
      that list**. If LOLA or ephemeris data isn't listed, add a listed dataset in a meaningful way. Adjust ARCHITECTURE §3.
- [ ] Both are registered and **approved** (not waitlisted) for the Tel Aviv event. Shay, as team lead, is the project-page editor.
- [ ] Settle the **[DECIDE]** items in ARCHITECTURE.md: ephemeris library, DEM resolution, app stack, hosting.
- [ ] Shay: answer the open questions at the end of VISION.md, and confirm the MVP / Should / Could tiers.
- [ ] Draft in `docs/submission/`: the project-page texts, the 30 s video script, the 5-minute presentation outline, and the two
      checkpoint-form answers (texts only, which is allowed).
- [ ] Both laptops: `uv sync`, `board.py sync`, and one test session to confirm the hooks fire.
- [ ] Sunday kit: laptops + chargers, **HDMI or USB-C adapter** (for the judging screen), headphones (quiet library),
      ID for the campus gate.

## 1. Kickoff, Sat 09:00–09:30 (both humans, together)
1. Confirm the decisions. Update ARCHITECTURE.md (status → agreed).
2. One agent creates the **7 draft contracts** from ARCHITECTURE §6 on the board (`status: agreed`) and creates the
   empty package folders on `main`.
3. Each human launches their agents with the starting prompts below. Every agent starts with the skill `start-work`.

## 2. Workstreams: starting prompts (each one is one agent session)
| # | Human | Work id | Starting prompt (summary) | Consumes (placeholder until real) | Provides |
|---|---|---|---|---|---|
| S1 | Shay | `ephem-core` | True apparent Sun/Earth/planet az/el from a lunar ME site; ICRS→ENU; pytest vs JPL Horizons at 3 sites × 3 epochs | – | body-track, sky-frame |
| S2 | Shay | `metrics` | Line of sight (disk fraction vs horizon), flux, Earth phase, time-to-set, % summaries, eclipse events | body-track, horizon-profile | metrics-series |
| S3 | Shay | `sky-viewer` | three.js lunar-sky renderer from SkyScene JSON: horizon silhouette, Earth with phase/texture, Sun; opens toward Earth; then the hemisphere, stars and timelapse | sky-scene | sky viewer component |
| H1 | Shahar | `dem-pipeline` | Download scripts + multi-res DEM access (polar 20 m, SLDEM2015, global coarse); `horizon_profile()` (algorithm validated by Shay) and caching | – | horizon-profile |
| H2 | Shahar | `catalog` | `missions.json` (Apollo 11–17 first; every value sourced), star catalog + constellation lines (licence checked), Earth texture | – | mission-catalog, star data |
| H3 | Shahar | `app-shell` | App skeleton per the stack decision: progressive scenario builder (coords → +location/+time, mission picker, map later), panels for Sun/Earth plots overlaid per scenario, sky viewer slot; **deploy early** to a public URL | scenario, metrics-series, sky-scene | scenario |
| S4 | Shay (later) | `scene` | Builds SkyScene and the time series for the app from ephem + horizon + metrics | all of the above | sky-scene |
| X1 | Shay (from Sat evening) | `submission` | Keeps `docs/submission/` texts, REFERENCES and AI_USE current; captures screen recordings; builds the 5-min deck and the 30 s video | everything | the deliverables |

Each agent builds against placeholders immediately and never waits. Wiring happens when the producer marks its contract
`implemented` and the code is merged to `main`.

## 3. Timeline (Israel time)
### Saturday 14.11: remote, the main build day
| Time | Milestone | Check |
|---|---|---|
| 09:00 | Work window opens. Kickoff (§1), then all agents launched | `board.py sync` shows the active items |
| ~12:00 | **Team sync 1 (10 min):** ephem validated vs Horizons; Apollo 11 horizon profile exists; app shell shows placeholder plots | merge to `main`; agents wire contracts |
| ~15:00 | **Vertical slice:** Apollo 11 at landing time, end to end: real Sun/Earth + terrain LOS + plots + static sky image | **the MVP safety net** |
| ~17:30 | **Team sync 2:** multi-scenario comparison, timelapse, map input; cut list for Sunday | |
| 19:00 | **Official kickoff on Zoom** (the link is sent before the event). At least one of us attends | |
| evening | **Deploy a public URL**; first full NASA submission (texts + a provisional demo link); record screen captures of the best views | only the last submission counts, so replace it later |

### Sunday 15.11: on site at TAU (activities end 20:00)
| Time | Event (official) | Our focus |
|---|---|---|
| 08:30–09:00 | arrival, registration | |
| 09:00–09:30 | opening | agents keep running |
| 09:30–13:00 | work + **mentoring round A: scientific and technical** | wow features by the cut order; **ask mentors to sanity-check our terrain-visibility method and validation** (Validity) |
| **by 13:00** | **Checkpoint 1 form** (short: where we are, blockers, which mentor we want for round B) | answer drafted in docs/submission/ |
| 13:00–14:15 | lunch + guest lecture | agents keep running |
| 14:15–17:00 | work + **mentoring round B: product, presentation, pitch** | **feature freeze at 15:00**; polish; the deck |
| **by 16:00** | **Checkpoint 2 form: a short solution summary** (a few sentences, no demo needed) | drafted in docs/submission/ |
| 17:00–17:45 | prepare presentations; test HDMI | deck final; app running locally as a backup to the URL |
| **17:45–18:45** | **Local judging: 5 min presentation + 2 min Q&A** | problem → solution → NASA data → live demo → impact |
| 18:45–20:00 | dinner, closing ceremony, prizes | |
| 20:00–23:59 | **finish the NASA submission from home** | final video, repo public, links tested in incognito, **Submit for Judging**, resubmit after any edit. **Target done by 22:30** |

**Cut order if behind** (first to go): comets → overlay-skies → constellations → planets → map click → timelapse.
**Never cut:** terrain line of sight, accuracy validation, the sky image toward Earth.

## 4. Two separate judgings: prepare both
| | Local (Tel Aviv, live) | Global (NASA site) |
|---|---|---|
| When | Sun 17:45–18:45 | submission by Sun 23:59 |
| Format | 5 min presentation + 2 min Q&A, on the room screen via HDMI | project page + **one** demo link (we prefer a **≤30 s video**) |
| Content | the problem, the solution, how we use NASA data, what we built (demo), value and impact | the page fields in docs/SUBMISSION.md |
| Criteria | **Impact, Creativity, Validity, Relevance, Presentation** | NASA's global criteria |

**Validity is our edge:** show the JPL Horizons cross-check and the terrain-visibility method explicitly. The organizers say an unfinished
product with a clear blueprint and reasoning still scores. Our architecture and research brief are part of the story.

## 5. Demo story (draft; fits the 30 s template: team → challenge → name + tagline → idea → future)
1. Apollo 11: "This is the sky Neil and Buzz saw." Earth hangs high in the sky, mostly lit (gibbous). The Moon seen from Earth was a waxing crescent then, and the app shows the figure it computes.
2. Compare all six Apollo sites: which had the best Earth view and the most sunlight during their stay?
3. South pole (an Artemis candidate): the Sun skims the horizon. One ridge decides power, and Earth dips in and out, which decides
   comms. A small location change has a big effect.
4. The far side (Chang'e 4): Earth never rises, which is why relay satellites exist.
