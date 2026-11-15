// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The globe's day and night at the sky's moment (web/js/globe/daylight.js). The moment is the time the selected
// scenario's sky view shows (web/js/app/sky_panel.js), live while the timelapse plays; before the views exist, the
// selected scenario's start; with no scenario, now. The Sun's direction comes from the browser physics (subsolarAt:
// the same apparent Sun as the sky view, MOON_ME) and goes to the globe's shader (globe.setSunDir), with the Sun's and
// the Earth's positions while the Earth's shadow can touch the Moon (an eclipse). A one-line caption
// under the map's chips names the moment. The switch is store.daylight (the Layers panel, web/js/app/map_layers.js).
// At most one update per animation frame, and only when the moment changes.

import { store, subscribe } from "./store.js";
import { parseUtc } from "./state.js";
import { onSkyTime, skyMoments } from "./sky_panel.js";
import { subsolarAt } from "./physics_adapter.js";
import { pickMoment, daylightCaption, eclipsePossible, DAYLIGHT_NOTE } from "../globe/daylight.js";

/** A small half-lit disc (16 x 16): day and night. */
const DAY_NIGHT_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z"/></svg>';

let globe = null;
let caption = null;
let text = null;
let raf = 0;
let nowTimer = 0;
let lastKey = "";
let seq = 0;

function schedule() {
  if (!raf) raf = requestAnimationFrame(update);
}

function hide() {
  globe.setSunDir(null);
  caption.hidden = true;
}

function update() {
  raf = 0;
  if (!store.daylight) {
    lastKey = "";
    seq++;
    hide();
    return;
  }
  const starts = store.scenarios.map((s, i) => ({ id: s.id, label: s.label || `Scenario ${i + 1}`, t_ms: parseUtc(s.t_start_utc || "") }));
  const m = pickMoment(skyMoments(), starts, store.activeId, Date.now());
  if (m.now) {
    // Without a scenario the moment is the clock: to the minute, refreshed every minute.
    m.t_ms = Math.floor(m.t_ms / 60e3) * 60e3;
    if (!nowTimer) nowTimer = setTimeout(() => ((nowTimer = 0), schedule()), 60e3);
  }
  const key = `${m.t_ms}|${m.label}|${m.now}`;
  if (key === lastKey) return;
  lastKey = key;
  const n = ++seq;
  subsolarAt(m.t_ms)
    .then((p) => {
      if (n !== seq) return;
      const ecl = eclipsePossible(p.sun_me_km, p.earth_me_km);
      globe.setSunDir(p.dir_me, ecl ? { sunKm: p.sun_me_km, earthKm: p.earth_me_km } : null);
      const words = daylightCaption(m);
      if (text.textContent !== words) text.textContent = words;
      caption.hidden = false;
    })
    .catch(() => {
      // Outside the ephemeris years, or the tables did not load: the whole Moon lit, no caption.
      if (n === seq) hide();
    });
}

/** Shade the globe `g` by day and night and add its caption (web/js/app/map.js calls this once). */
export function initDaylight(g) {
  globe = g;
  caption = document.createElement("div");
  caption.className = "globe-daylight";
  caption.title = DAYLIGHT_NOTE;
  caption.hidden = true;
  caption.innerHTML = DAY_NIGHT_ICON;
  text = document.createElement("span");
  caption.append(text);
  g.slots.caption.append(caption);
  onSkyTime(schedule);
  subscribe((kind, detail) => {
    if (kind === "active" || kind === "label" || kind === "structure" || (kind === "ui" && "daylight" in detail)) schedule();
  });
  schedule();
}
