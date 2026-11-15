<!-- AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team. -->
# The sky view as an app (view UX), 2026-11-15

Shay's feedback (2026-11-15): the view window should be more intuitive. The Sun/Earth tracking and the rover's
"Look ahead" should sit together, the "Focus" button was unclear, and full screen should be the default, like an app or
Google Maps. Branch `shay/view-ux`. Web-app is Shahar's domain: pending her review.

## What changed

| Before | Now |
|---|---|
| The sky had a fixed height; the Sun \| Earth switch could fall under the fold | **One stage fills the window**: the "What to look for" line, the views (they take the rest of the height), the timelapse bar, then the Sun \| Earth switch. Height = the window minus the site header (`100dvh`, at least 420 px); on a desktop it also leaves room for the introduction line, so the whole stage is in sight at first paint. The data starts right under it. |
| "⤢ Focus" (fill the window) and "⛶ Full screen" in each card | **No Focus mode.** A small full-screen icon in each view's top-right corner (title "Full screen (Esc to exit)"). The view keeps the timelapse bar and the camera group under it. Without the browser's full screen (iPhone Safari) the view fills the window. A visible "Exit full screen" button (and Esc) returns. |
| "🎯 Track" in the timelapse bar, "🚙 Look ahead" in each trip card | **One camera group** in the timelapse bar: "Follow Sun" / "Follow Earth" (the label follows the Sun \| Earth switch) and "Driver's view" (only while a rover trip is on screen). At most one is on; pressing the one that is on gives free look; a drag pauses it ("· paused") and a press resumes. Same engine (`sky_panel.js` track modes `"body"` / `"ahead"`). |
| Phone: the page scrolled to the caption after a story | The page lands with the stage filling the phone screen (stage top at 4 px for every single-view story). |
| Several views: rows of 16:9 views | The views split the stage height (e.g. all six Apollo sites: 2 rows × 3 at 1920 × 1080). A view never goes below a minimum (one view ≤ 2.8:1; several ≤ 2.4:1; one narrow column ≤ 2:1); then the stage grows and the page scrolls. |

Decisions made by the agent (Shay can override): `dvh` as asked (the stage resizes when a phone's address bar hides;
`svh` would keep it fixed and let the data peek in); the full-screen icon sits in the card's head next to "⋯" (an overlay
inside the view would cover the close-up insets and the edge arrows); the camera buttons look like one segmented
control; on phones the camera group takes its own row when both buttons show.

## No emoji in the interface (Shay, same day)

Shay finds emoji unprofessional. Every emoji and emoji-capable pictograph in the app's visible text (☀ 🌍 🌑 🌄 🎯 🚙 🛞
✨ 📅 📍 ⌨ ✓ ⏸ ▶ ☼ ✦, and the plain U+2600–27BF symbols, which phones draw as colour emoji) is gone. Where an icon helps,
it is a line icon from one set, `web/js/app/icons.js` (`icon(name)`, `iconNode(name)`, `fillIcons()`; 24 × 24, stroke in
`currentColor`, 1em, `aria-hidden`): follow, rover, sun, earth, eclipse, earthrise, calendar, suggest, warning,
fullscreen, close, wheel, pin, flag, info, check, play, pause. Used by the camera group, the Sun | Earth switch, the
view cards' footers (Sun, Earth, eclipse, rover), the event hint, the suggested dates (headings and items), the trip
rows (pick on the globe, live drive line) and every close button (✕ became the close icon). The sky view's own HUD
toggles (sky-demo page only) got two inline SVGs in the same style, so the sky layer does not import the app layer.
Plain removals: the Apollo caption ("Switch to Earth …"), the far-side insight, the far-side note in the view, "Type
instead". The chart's eclipse mark for many eclipses is now "◐" (a text glyph, not an emoji). Emoji in code comments
were left as they are. `web/tests/app_view_ux.test.mjs` fails on any emoji in `web/js`, `web/css` or `index.html`
outside comments.

## How it was checked

Playwright with the installed Microsoft Edge (headless), local `web/` on a threaded server. All six stories at
1920 × 1080 and 390 × 844 (`is_mobile`, `has_touch`), dark and light themes; Back/Forward, a share link in a new page,
a playback speed, full screen and Esc in each run.

| Check | Result |
|---|---|
| Console errors, page errors, failed requests, HTTP ≥ 400 | 0 in all four runs |
| Stage fit at first paint | 1920 × 1080: 138–1070 px (window 1080); 1366 × 768: 138–758; 768 × 1024: 4–1020; 390 × 844: 4–840 |
| C8: the opening view (Apollo 11) shows the Earth and the horizon | OK at all four sizes: the Earth drawn in the frame (no edge arrow), the horizon near the bottom. 1920 × 1080 and 1366 × 768 use the tall frame (1199 × 702, 666 × 390) with blurred side bands; 768 × 1024 (718 × 768) and 390 × 844 (356 × 431) the full view |
| Camera group | Follow on/off; Driver's view replaces Follow and the reverse; a drag gives "Driver's view · paused" (`aria-pressed="mixed"`), a press resumes, a press turns it off; Driver's view only shows with the rover story |
| Full screen | Native full screen and the Exit button, timelapse bar and camera group visible; Esc leaves both |
| Layout shift, first visit | 1920 × 1080: 0.008 (dark), 0.003 (light), from the left column's first card render, not the stage; phone: 0 |
| Layout shift, story switches | 0 for every story outside the 500 ms after the click (CLS rule), except the phone rover story: 0.07–0.08 in one of two runs, when the planned route arrives and the trip card above the stage grows (the stage still ends at its place, top 4 px). Within the 500 ms, the phone's inputs above the stage change height (e.g. six place cards to one), which the landing scroll then corrects |
| Tests | `node --test web/tests/` (new: `app_view_ux.test.mjs`), `uv run pytest -q`, `uv run ruff check .` |

## For the video recorder (`scripts/video/record_demo.py`)

Removed: `.sky-focus-btn`, `body.sky-focus`, `#sky-panel.focus`, `.sky-card.is-focus`, `#btn-track` (and its
`.trk-*` spans), the trip card's `.ride-ahead` "Look ahead" button. Now: full screen = `#sky-grid .sky-fs-btn` (icon only),
`body.sky-full`, `#sky-panel.full`, `.sky-card.is-full`, `.sky-exit-btn` ("Exit full screen"; Esc also exits);
camera = `#cam-group`, `#btn-follow` ("Follow Sun" / "Follow Earth"), `#btn-driver` ("Driver's view"). The stage is
`#sky-stage`. Labels without emoji: the Sun | Earth switch buttons read "Sun" / "Earth" (`#body-toggle
button[data-body]`, unchanged), the picker heading "Suggested for …", the trip option "Choose on the globe", the
rover note "Rover 1.10 of 19.3 km …"; the event hint text starts "The Earth eclipses …" (`#event-hint .hint-text`). Full screen uses the browser's full screen when available, so a recorder that wants the old in-page
"Focus" look can add the classes itself or accept the browser full screen.

## Thinner page (2026-11-15 afternoon, Shay's red marks)

- Gone: the introduction line, the "Validated" header badge (the checks panel opens from the footer and from About),
  the time in each sky card's head, the "Numbers in the view" option (the view's readout is always full), the Sun and
  Earth numbers and the eclipse line under each view, "Mission: 2 d" under the End field, the separate switch row.
- The switch is **Sun | Earth | Both**, in the timelapse bar next to the camera group (`#view-group` > `#body-toggle`,
  `#cam-group`). Sun and Earth aim the views and pick the data; Both shows both bodies' data and leaves the aim alone
  ("Follow" follows the body last aimed). Links: `b=both`.
- Both section (`#sec-both`): one Elevation and one Visible disk chart with both bodies, then Sunlight power and Earth
  phase. Line colours (`web/js/app/chart_plan.js`): one scenario, the Sun red and the Earth blue; several, the
  scenario's colour, and in Both the Earth dashed ("Solid: Sun / Dashed: Earth" in the legend).
- Chart descriptions, the table how-to and the data sources under each view sit behind "i" icons
  (`web/js/app/info_tip.js`: hover, click or tap, Enter or Space; Esc closes).
- One scrollbar: the left column no longer scrolls on its own; a picked trip point pins the globe under the header.
