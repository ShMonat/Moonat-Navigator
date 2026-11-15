<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# AI mode: "where should my mission go?"

**What it is.** The header's **AI mode** button opens a panel. A visitor describes a mission in plain words, for
example "a crewed base for 10 years from 2030 that needs maximum sunlight and continuous Earth contact", and gets
sites ranked by Claude, with Moonat's own numbers. It packages what we did by hand for the StarHab site
(docs/research/starhab_site.md): read the mission, turn it into requirements, screen candidate places with our
physics, then rank them and explain the choice.

**The rule that makes it trustworthy: the model never computes physics.** It does three things only:
1. It reads the mission and states its requirements and assumptions explicitly (region, dates, minimum sunlight,
   minimum Earth contact, longest tolerable night and Earth blackout, mobility). The panel shows them.
2. It calls Moonat's own functions as tools. They run in the visitor's browser, on the same code as the rest of the app.
3. It ranks and explains, citing the numbers the tools returned. The result cards show the **tool's** numbers (looked
   up by the evaluation id), not the model's copy of them. A site without an evaluation is marked "not evaluated".

The label on the panel and on the result: "AI suggestions; the numbers come from Moonat's validated physics."

## Design

| Part | File | What it does |
|---|---|---|
| Button | `web/index.html`, `web/js/app/main.js` (`initAiMode`) | Loads the panel on the first press (dynamic `import()`); the page's first load is unchanged |
| Panel | `web/js/ai/panel.js`, `web/css/ai.css` | Mission box, 3 example chips, key field, "Suggest sites", live log, ranked cards, "Show on map", "Add all to the map" |
| Agent loop | `web/js/ai/agent.js` | Manual tool loop over the Messages API; stop reasons; errors in plain words; token use and cost |
| Tools | `web/js/ai/tools.js` | Thin wrappers over the app's modules (below); caps per run |
| Result | `web/js/ai/result.js` | Cards with the tool's numbers; adding the sites as places within the map's 6-place limit |
| SDK and key | `web/js/ai/sdk.js` | Loads the SDK; keeps the key |

**API settings** (`agent.js`):
- SDK: the official `@anthropic-ai/sdk` **1.3.0** (released 2026-10-23), loaded as an ES module from
  `https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm` only when a run starts, with
  `dangerouslyAllowBrowser: true` (the key is the visitor's own and goes straight from their browser to Anthropic).
- Model `claude-opus-5-5`, adaptive thinking (`thinking: {type: "adaptive"}`), `output_config: {effort: "medium"}`,
  `max_tokens` 16 000, non-streaming (the log shows progress per tool call instead).
- Server-side refusal fallback: beta `server-side-fallback-2026-07-01` with `fallbacks: "default"` (a declined request is
  re-run on Anthropic's recommended fallback model inside the same call). After a mid-output fallback, the declined
  attempt's thinking and tool-use blocks are not echoed back (`echoContent`). Token use sums `usage.iterations`.
- `stop_reason` is checked before the content is used: `refusal` and `max_tokens` end the run with a plain message
  (a cut-off tool call is never run); `pause_turn` continues.
- Tools are JSON Schema with `strict: true`, every object closed (`additionalProperties: false`) and every field
  required; no numeric bounds in the schemas (the tools check ranges themselves). No forced `tool_choice` (Opus 5.5
  rejects it): the system prompt says which tool comes first and last.
- Prompt caching: top-level `cache_control: {type: "ephemeral"}`. The system prompt and tool list never change during
  a run, so every turn after the first reads the earlier turns from the cache.
- The SDK retries 429 and 5xx twice by itself; timeout 5 minutes per request.

## The tools

1. **`set_requirements`** (first, once): the mission as checkable numbers plus the assumptions. Shown in the panel.
2. **`find_candidate_sites({region, min_sunlit_pct, kinds, max_results})`**: catalog sites (`web/data/sites.json`:
   missions, potential Artemis sites, places of interest, StarHab with its study numbers) and NASA PGDA's most-sunlit
   spots (`web/data/overlays/overlays.json`, ground-level share of time with any sunlight over 18.6 years, ≥ 70 %),
   thinned to one per 2 km and named after the nearest catalog site within 40 km. Regions: `south_pole`,
   `north_pole` (poleward of 80°), `near_side`, `far_side`, `anywhere`.
3. **`evaluate_site({name, site_id, lat_deg, lon_deg, start_utc, end_utc})`**: one C6 `series()` over the window with
   the app's step rule (`chooseStep`: 1 h up to 2 years, 2 h up to 8, 3 h beyond) and the real terrain horizon:
   the catalog's precomputed C3 horizon, else NASA Moon Trek through `terrainAt` (C9, the same cache key as the app
   uses, so "Show on map" reuses it), else the coarse C5 tiles, else none. The window is clipped to the ephemeris
   (1966–1976, 2013–2040) and to 30 years. Returns:
   - `sun_visible_pct`: mean visible share of the Sun's limb-darkened flux (terrain and the Earth's shadow), as
     "Sun %" in the StarHab study;
   - `sunlit_time_pct`: share of the time with any sunlight (the app's "of the stay with sunlight");
   - `longest_night_days` (and its start): longest stretch with no sunlight (`playback.js longestRun`);
   - `earth_visible_pct`: mean visible share of the Earth's disk; `earth_in_view_time_pct`: share of the time with any
     of it in view; `longest_blackout_days`: longest stretch with the Earth fully hidden;
   - `sun_and_earth_time_pct`, `mean_flux_sun_facing_wm2` (C6 `flux_normal_wm2`), `eclipse_count`;
   - the terrain source and quality, ground height, sampling, and `eye_height_m: 2` with the note that **masts are
     not modelled** (near the poles a 10 m mast usually raises both shares: StarHab 67 % → 98 % Earth).
4. **`suggest_dates({name, site_id, lat_deg, lon_deg, from_utc, to_utc, window_days, kinds})`**: the C11 engine
   (`web/js/suggest/`), best windows for sun, earth, both, eclipses and Earthrises.
5. **`final_recommendation({summary, assumptions[], sites:[{name, site_id, lat_deg, lon_deg, start_utc, end_utc,
   evaluation_id, why, metrics}]})`**: ends the run.

**Caps per run:** at most 12 tool calls (requirements and the final call not counted), at most 8 evaluations, at most
16 model turns. Past a cap the tool answers with an error asking the model to finish; past 16 turns the run stops
with "too many steps". Evaluations run in the browser: about 0.05 s per site-year on the main thread, plus 1–5 s to
download terrain for a point outside the catalog (40 s timeout, then the tiles).

**Show on map / Add all:** each site becomes a place (a C7 scenario) with its name and the suggested start and end,
added to the places already shown (an empty card is filled first); the map's limit of 6 places applies, and the toast
says how many did not fit. Only real catalog ids are kept as a place's site; any other place is a custom point.

## Privacy of the key

- The visitor pastes their own Anthropic API key into a password field. By default it is kept in **sessionStorage**
  (this tab only); the "Remember on this device" box moves it to **localStorage**; "Forget key" removes it from both.
  It is stored in one place at a time, under `moonat.ai.anthropicKey`.
- It is sent only to `api.anthropic.com`, by the SDK, directly from the visitor's browser (SDK 1.x sends it as
  `Authorization: Bearer <key>`). There is no Moonat server.
- It is never logged, never in the address bar or a share link (the link code does not know about it), and never in
  the error messages.
- jsDelivr serves the SDK's code but never sees the key.

## Costs

The panel says: "Uses your own Anthropic API key; a typical mission costs about $0.10–0.30", and after each step shows
the tokens used and the cost so far at the Claude Opus 5.5 list prices ($4 per million input tokens, $20 per million
output tokens, cache writes $5, cache reads $0.20; a fallback model may be priced differently, so it is an estimate).

Estimate behind the note: about 5–8 turns; the context grows from about 5 000 to about 15 000 tokens (system prompt and
tools about 3 000, the candidate list about 2 000, each evaluation about 400), so about 60 000 input tokens in total,
most of them cache reads after the first turn (about $0.05–0.10), plus about 1 000–2 000 output tokens per turn with
medium effort (about $0.10–0.25).

## Limits

- Line of sight only, from an eye 2 m above the ground; no mast heights, no link budget, no slopes, ice or thermal
  environment (see the StarHab study's caveats).
- The ephemeris covers 1966–1976 and 2013–2040: later mission dates are clipped to 2040.
- Places the model names from its own knowledge have approximate coordinates; the tools still evaluate them exactly.
- The model can be wrong in its reading of the mission: that is why the requirements and assumptions are shown first.

## Testing

Without a key (what CI and the agents run):
- `node --test web/tests/ai_mode.test.mjs`: the tools on the real ephemeris, LOLA horizons and DEM tiles (StarHab
  2030: the same numbers as a direct C6 series; close to the study's 2 m values), the far side, clipping, caps, the C11
  engine; the loop with a scripted fake client (happy path, refusal, `max_tokens`, no answer, too many steps, 401, 429,
  network, a tool that throws, Stop); fallback echo and cost; result cards; adding places; key storage.
- `uv run python scripts/check_ai_mode.py`: Edge (Playwright) at 1920 × 1080 and 390 × 844 in both themes, on a local
  threaded server. Playwright answers the SDK's requests to api.anthropic.com with scripted responses, so the real SDK,
  loop and browser physics run end to end; it also sends one real request with an invalid key and checks the real 401
  is shown in plain words. Screenshots in `outputs/ai_mode/`.

**Live, with your own key (Shay):**
1. Open the site (or `uv run python -m http.server -d web 8000` and http://localhost:8000).
2. Press **AI mode** in the header.
3. Pick an example chip (or type a mission), paste your key from https://console.anthropic.com/ (Settings, API keys),
   and press **Suggest sites**. Leave "Remember on this device" off on a shared computer.
4. Watch the log; a run takes about one to three minutes. Then press **Show on map** on a card, or **Add all to the
   map**, and look at the sky and the charts as usual.
5. Press **Forget key** when you are done.
