// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The data under the sky: Sun, Earth and Both sections (one shown at a time, by the page's Sun | Earth | Both switch in
// the timelapse bar), and the "Side by side" table of several scenarios. Single instants get metric cards; missions
// get summary cards plus Plotly charts against mission elapsed time (or calendar time, or distance for rover
// traverses), one line per scenario and body, with a time cursor at the moment the sky shows. Which charts each
// section holds, and the colour rule of their lines, are in chart_plan.js; chart descriptions sit behind "i" icons.

import { store, subscribe, setUi } from "./store.js";
import { formatDuration, formatUtc, DAY_MS } from "./state.js";
import { horizonElAt, findEvents, stats, pctAbove, compassPoint } from "./derive.js";
import { icon, elevationIcon, azimuthIcon, visibleIcon, phaseIcon, fluxIcon, ringIcon, clockIcon } from "./icons.js";
import { infoTip, setInfoText } from "./info_tip.js";
import { CHARTS, FLUX_HELP, FLUX_HELP_TILT, normBody, lineStyle, styleKey } from "./chart_plan.js";
import { eclipseText, earthElCaption, rankRows, sortRows, bestIds, rankSentence, RANK_KEYS } from "./compare_text.js";
import { withDetail, envelopeIndices, longestRun, JULIAN_YEAR_MS } from "./playback.js";
import { tiltPanelFlux, meanVisibleElevation } from "../physics/metrics.js";

const AU_KM = 149597870.7;
const S0 = 1361;
const PLOTLY_URL = "https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js";

let plotlyPromise = null;
let chartsGate = Promise.resolve();
/**
 * Hold the chart drawing (and the 1 MB Plotly download) until `promise` settles, e.g. until the first sky view is on
 * screen, so the charts under the sky do not slow down the view at the top.
 */
export function holdChartsUntil(promise) {
  chartsGate = Promise.resolve(promise).catch(() => {});
}

/** Load Plotly on first use (it is large, and only missions need it). */
function loadPlotly() {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  if (!plotlyPromise) {
    plotlyPromise = new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = PLOTLY_URL;
      sc.async = true;
      sc.onload = () => resolve(window.Plotly);
      sc.onerror = () => reject(new Error("Plotly failed to load"));
      document.head.append(sc);
    });
  }
  return plotlyPromise;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Degrees with a true minus sign ("−3.1°"), and no "−0.0°". */
const deg = (x, d = 1) => {
  if (!Number.isFinite(x)) return "–";
  const a = Math.abs(x).toFixed(d);
  return `${x < 0 && Number(a) !== 0 ? "−" : ""}${a}°`;
};
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x)}%` : "–");
const wm2 = (x) => (Number.isFinite(x) ? `${Math.round(x).toLocaleString("en-US")} W/m²` : "–");

// "normal" (Sun-facing panel), "tilt" (a panel turning on a vertical mast, at a fixed tilt) or "horiz" (flat ground)
let fluxMode = "normal";
let lastArgs = null;

const tiltCache = new WeakMap();
/**
 * The turning panel at a fixed tilt for a mission series (physics/metrics.js): its tilt eps0 (deg, the mean Sun
 * elevation over the samples with some Sun above the terrain; NaN when there are none) and `view`, a series-like
 * object with `flux_tilt_wm2` (W/m²) per sample and in each eclipse detail, for withDetail. Cached per series.
 */
function tiltOf(se) {
  let v = tiltCache.get(se);
  if (!v) {
    const eps0 = meanVisibleElevation(se);
    const flux = (fn, el) => Array.from(fn, (f, i) => tiltPanelFlux(f, el[i], eps0));
    v = {
      eps0,
      view: {
        t_ms: se.t_ms,
        flux_tilt_wm2: flux(se.flux_normal_wm2, se.sun_el),
        // A detail without elevations is left out (withDetail then keeps the coarse samples).
        detail: (se.detail || []).map((d) => ({ t_ms: d.t_ms, flux_tilt_wm2: d.sun_el ? flux(d.flux_normal_wm2, d.sun_el) : null })),
      },
    };
    tiltCache.set(se, v);
  }
  return v;
}

const TILT_TIP = "Turns about a vertical mast to face the Sun; tilted at the mission's average Sun elevation while lit";

/** Tooltip of the "Fixed tilt" button: the tilt of each mission shown. */
function tiltTip(missions) {
  const tilts = missions.map((it) => ({ label: it.label, eps0: tiltOf(it.series).eps0 }));
  if (!tilts.length) return TILT_TIP;
  const one = (x) => (Number.isFinite(x.eps0) ? deg(x.eps0) : "undefined: the Sun never clears the terrain");
  if (tilts.length === 1) return `${TILT_TIP} (ε0 = ${one(tilts[0])})`;
  return `${TILT_TIP} (ε0: ${tilts.map((x) => `${x.label} ${one(x)}`).join(", ")})`;
}

/**
 * Render the Sun and Earth data.
 * items: [{ s, label, color, dash, t0, t1, span, horizon, state0, series | null, look | null, error | null }]
 */
export function renderCompare(items, opts) {
  lastArgs = [items, opts];
  const ok = items.filter((it) => !it.error && it.state0);
  document.getElementById("compare-body").hidden = ok.length === 0;
  const anyMission = ok.some((it) => it.series);
  document.getElementById("chart-tools").hidden = !anyMission;
  // Rover traverses (web/js/rover) can also be drawn against the distance driven; static sites cannot.
  const anyRoute = ok.some((it) => it.series?.distance_km);
  const distBtn = document.querySelector('#xaxis-toggle [data-x="dist"]');
  if (distBtn) distBtn.hidden = !anyRoute;
  if (opts.xaxis === "dist" && !anyRoute) {
    opts = { ...opts, xaxis: "met" };
    for (const b of document.querySelectorAll("#xaxis-toggle button")) b.setAttribute("aria-pressed", String(b.dataset.x === "met"));
  }
  const note = document.getElementById("xaxis-note");
  if (note) note.hidden = !(opts.xaxis === "dist" && ok.some((it) => !it.series?.distance_km));

  document.getElementById("cards-sun").innerHTML = ok.map((it) => (it.series ? sunMissionCard(it) : sunInstantCard(it))).join("");
  document.getElementById("cards-earth").innerHTML = ok.map((it) => (it.series ? earthMissionCard(it) : earthInstantCard(it))).join("");
  document.getElementById("cards-both").innerHTML = ok.map(bothCard).join("");
  // Card grid by count (app.css): 6 in a row or 3 + 3, never 5 + 1.
  for (const id of ["cards-sun", "cards-earth", "cards-both"]) document.getElementById(id).dataset.n = String(Math.min(ok.length, 7));
  renderRank(ok);

  const boxes = SECTIONS.map((b) => document.getElementById(`charts-${b}`));
  if (!anyMission) {
    cursorCtx = null;
    for (const box of boxes) {
      box.replaceChildren();
      // The shells are gone, so the next mission render must rebuild them.
      delete box.dataset.ready;
      box.hidden = true;
    }
    return;
  }
  SECTIONS.forEach((b, i) => {
    boxes[i].hidden = false;
    ensureChartShells(boxes[i], b);
  });
  const tip = tiltTip(ok.filter((it) => it.series));
  for (const tiltBtn of document.querySelectorAll('.flux-seg [data-flux="tilt"]')) tiltBtn.title = tip;
  for (const id of ["help-sun-flux", "help-both-flux"]) setInfoText(id, fluxMode === "tilt" ? FLUX_HELP_TILT : FLUX_HELP);
  // The Earth elevation caption fits the sites shown (near side, poles and limb, far side).
  setInfoText("help-earth-el", earthElCaption(ok));
  const args = lastArgs;
  chartsGate
    .then(() => (lastArgs === args ? loadPlotly() : null))
    .then((Plotly) => {
      if (!Plotly || lastArgs !== args) return;
      const a = performance.now();
      drawCharts(Plotly, ok, opts);
      performance.measure?.("moonat:charts", { start: a, end: performance.now() }); // read by the playback checks
    })
    .catch((err) => {
      for (const c of document.querySelectorAll(".chart")) c.textContent = "Charts could not load (offline?). " + err.message;
    });
}

/** The data sections, one per value of the Sun | Earth | Both switch. */
const SECTIONS = ["sun", "earth", "both"];

/** The Both section's charts are drawn only while it shows; this is set when they are up to date. */
let bothDrawnFor = null;

/**
 * The Sun | Earth | Both switch in the timelapse bar: shows one section at a time (the choice lives in store.body and
 * the URL hash) and calls onPick(body) on every press, also of the pressed button, so main.js can aim the sky views
 * (Sun, Earth) or leave them as they are (Both). Plotly cannot measure a hidden chart, so the charts of a section are
 * resized when it is shown; the Both charts are drawn when that section first shows for the current data.
 */
export function initBodySwitch(onPick = () => {}) {
  const seg = document.getElementById("body-toggle");
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    onPick(b.dataset.body);
    if (b.dataset.body !== store.body) setUi({ body: b.dataset.body });
  });
  subscribe((kind, detail) => {
    if (kind === "ui" && "body" in detail) syncBody();
  });
  syncBody();
}

/**
 * Apply store.body to the DOM (button state, which section is visible, the time-axis selector moved above that
 * section's charts) and fit the charts that just appeared.
 */
export function syncBody() {
  const body = normBody(store.body);
  for (const b of document.querySelectorAll("#body-toggle button")) b.setAttribute("aria-pressed", String(b.dataset.body === body));
  for (const b of SECTIONS) document.getElementById(`sec-${b}`).hidden = body !== b;
  document.getElementById(`charts-${body}`).before(document.getElementById("chart-tools"));
  if (body === "both" && lastArgs && bothDrawnFor !== lastArgs) rerenderCompare();
  resizeShownCharts();
  drawCursor(true);
}

/**
 * Fit the charts of the visible section to their boxes. Plotly's own window-resize handler cannot measure a hidden
 * chart, so charts that were hidden during a resize (the other section, or the whole data block while it was empty)
 * keep their old width until this runs: when a section is shown.
 */
export function resizeShownCharts() {
  if (!plotlyPromise) return;
  plotlyPromise.then((Plotly) => {
    requestAnimationFrame(() => {
      if (document.getElementById("compare-body").hidden) return;
      const body = normBody(store.body);
      for (const c of document.querySelectorAll(`#sec-${body} .chart`)) if (c.classList.contains("js-plotly-plot")) Plotly.Plots.resize(c);
    });
  }).catch(() => {});
}

/** Re-render with the last data (theme or toggle change). */
export function rerenderCompare(patch = {}) {
  if (!lastArgs) return;
  renderCompare(lastArgs[0], { ...lastArgs[1], ...patch });
}

// ---------------------------------------------------------------------------------------------
// Ranked summary of two or more scenarios: sunlight, Sun height, Earth height and Earth phase, best first, with the
// best value of each column highlighted. The column headers sort the table.

let rankKey = "sunlit";
let rankItems = [];
const RANK_COLS = [
  { key: "sunlit", title: "Sunlight", tip: "Share of the time with some sunlight (an eclipse counts as dark)" },
  { key: "sun", title: "Sun height", tip: "Sun elevation above the flat horizon, lowest to highest" },
  { key: "earth", title: "Earth height", tip: "Earth elevation above the flat horizon, lowest to highest" },
  { key: "lit", title: "Earth lit", tip: "Share of Earth's disk that is sunlit (its phase), lowest to highest" },
];

function renderRank(items) {
  let box = document.getElementById("rank-block");
  if (!box) {
    box = document.createElement("section");
    box.id = "rank-block";
    box.className = "rank-block";
    box.setAttribute("aria-labelledby", "rank-title");
    document.getElementById("sec-sun").before(box);
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-key]");
      if (!b) return;
      rankKey = b.dataset.key;
      renderRank(rankItems);
      box.querySelector(`button[data-key="${rankKey}"]`)?.focus();
    });
  }
  rankItems = items;
  box.hidden = items.length < 2;
  if (box.hidden) return;
  const rows = rankRows(items);
  const best = Object.fromEntries(Object.keys(RANK_KEYS).map((k) => [k, bestIds(rows, k)]));
  const range = (st, f) => (f(st.min) === f(st.max) ? f(st.mean) : `${f(st.min)} to ${f(st.max)}`);
  const cell = (r, key, text) => (best[key].has(r.id) ? `<td class="best">${text}<span class="sr-only"> (best)</span></td>` : `<td>${text}</td>`);
  const pct0 = (x) => `${Math.round(x * 100)}%`;
  const body = sortRows(rows, rankKey)
    .map((r, i) => `<tr style="--c:${r.color}">
      <th scope="row"><span class="rank-n">${i + 1}</span><span class="swatch" aria-hidden="true"></span><span class="rank-name" title="${esc(r.label)}">${esc(r.label)}</span></th>
      ${cell(r, "sunlit", r.instant ? (r.sunlit > 0 ? "yes" : "no") : pct(r.sunlit))}
      ${cell(r, "sun", range(r.sunEl, (x) => deg(x)))}
      ${cell(r, "earth", range(r.earthEl, (x) => deg(x, 0)))}
      ${cell(r, "lit", r.earthUp > 0 ? range(r.earthLit, pct0) : '<span class="muted">never up</span>')}
    </tr>`)
    .join("");
  const head = RANK_COLS.map((c) => `<th scope="col" title="${c.tip}"${c.key === rankKey ? ' aria-sort="descending"' : ""}>
      <button type="button" data-key="${c.key}" aria-pressed="${c.key === rankKey}">${c.title}<span class="sort-mark" aria-hidden="true">${c.key === rankKey ? " ▼" : ""}</span></button></th>`).join("");
  const how = infoTip("The best value in each column is highlighted. Select a column heading to sort by it.", { label: "How to read this table" });
  box.innerHTML = `<div class="rank-head"><h2 class="rank-title" id="rank-title">Side by side${how}</h2><p class="rank-sentence">${esc(rankSentence(rows))}</p></div>
    <div class="rank-scroll"><table class="rank-table"><thead><tr><th scope="col">Scenario</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------------------------
// Cards

function cardHead(it, when) {
  return `<div class="mcard-head"><span class="swatch" aria-hidden="true"></span><span class="mcard-title" title="${esc(it.label)}">${esc(it.label)}</span></div>
    <div class="mcard-when">${esc(when)}</div>`;
}

function row(icon, value, sub) {
  return `<div class="mrow-icon">${icon}</div><div class="mrow-val"><b>${value}</b><span>${sub}</span></div>`;
}

function wrapCard(it, inner) {
  return `<article class="mcard" style="--c:${it.color}">${inner}</article>`;
}

function whenInstant(it) {
  return formatUtc(it.t0);
}
function whenMission(it) {
  if (it.series?.route) return `${formatUtc(it.t0)} · ${it.series.route.length_km.toFixed(1)} km rover traverse, ${formatDuration(it.span)}`;
  // A base's stay of a year or more reads in years ("5 years", "1.5 years").
  if (it.span >= 365 * DAY_MS) {
    const y = (it.span / JULIAN_YEAR_MS).toFixed(1).replace(/\.0$/, "");
    return `${formatUtc(it.t0)} · ${y} ${y === "1" ? "year" : "years"}`;
  }
  return `${formatUtc(it.t0)} · ${formatDuration(it.span)} stay`;
}

/**
 * Card row for the longest stretch without something (sunlight, Earth in view) over the whole stay, when there is one
 * and the stay is not all of it: "9 d 14 h · longest darkness (12 dark spells, 10 % of the time)".
 */
function longestRow(it, values, what, spells) {
  const r = longestRun(it.series.t_ms, values);
  if (!r.count || r.ms >= 0.995 * it.span) return "";
  const share = (100 * r.total_ms) / Math.max(1, it.span);
  const sub = `${what}${r.count > 1 ? ` (${r.count} ${spells}, ${share < 1 ? share.toFixed(1) : Math.round(share)}% of the time)` : ""}`;
  return row(clockIcon(), formatDuration(r.ms), sub);
}

function terrainSub(it) {
  if (it.horizon) return it.horizon.approximate ? `clears the ${it.horizon.label || "approximate terrain (coarse)"}` : "clears the real terrain";
  return it.s.site_id ? "above the flat horizon (terrain not loaded yet)" : "above the flat horizon (custom point: no terrain yet)";
}

/** Text for the next set/rise of a body from a look-ahead series. */
function nextEventText(it, vis, body) {
  const look = it.look;
  if (!look) return "";
  const ev = findEvents(look.t_ms, vis);
  const lookEnd = look.t_ms[look.t_ms.length - 1];
  const horizonDays = Math.round((lookEnd - look.t_ms[0]) / DAY_MS);
  // The look-ahead (30 days) stops early at the end of the ephemeris tables: then say so, with the date.
  const cut = lookEnd - it.t0 < 29.5 * DAY_MS;
  const endDay = esc(formatUtc(lookEnd).split(",")[0]);
  const name = body === "sun" ? "Sun" : "Earth";
  if (ev.upAtStart) {
    if (ev.nextSet) return `<strong>${name} sets in ${formatDuration(ev.nextSet - it.t0)}</strong> <span class="muted">(${esc(formatUtc(ev.nextSet))})</span>`;
    return cut ? `<strong>${name} stays up</strong> at least until ${endDay} <span class="muted">(end of the data)</span>`
      : `<strong>${name} stays up</strong> for at least the next ${horizonDays} days`;
  }
  if (ev.nextRise) return `<strong>${name} rises in ${formatDuration(ev.nextRise - it.t0)}</strong> <span class="muted">(${esc(formatUtc(ev.nextRise))})</span>`;
  return cut ? `<strong>No ${body === "sun" ? "sunrise" : "Earthrise"}</strong> before ${endDay} <span class="muted">(end of the data)</span>`
    : `<strong>${name} does not rise</strong> in the next ${horizonDays} days`;
}

function farSideInsight(it, elArr, visArr) {
  const st = stats(elArr);
  if (pctAbove(visArr) === 0 && st.max < -3) {
    return `<div class="insight">Earth never rises here: this is the Moon's far side, always turned away from Earth. A lander here needs a relay satellite to talk home.</div>`;
  }
  return "";
}

/**
 * Solar flux (W/m²) on a Sun-facing panel, on a turning panel at a fixed tilt and on flat ground, from a C6 sun state
 * (uses its flux fields when present). For a single instant the "mission" is that one moment, so the turning panel's
 * tilt is the Sun's elevation when it is visible and it gets the Sun-facing flux.
 */
function sunFlux(sun) {
  const normal = Number.isFinite(sun.flux_normal_wm2) ? sun.flux_normal_wm2 : S0 * (AU_KM / sun.dist_km) ** 2 * sun.flux_frac;
  const horiz = Number.isFinite(sun.flux_horiz_wm2) ? sun.flux_horiz_wm2 : normal * Math.max(0, Math.sin((sun.el_deg * Math.PI) / 180));
  const tilt = tiltPanelFlux(normal, sun.el_deg, meanVisibleElevation({ sun_el: [sun.el_deg], sun_vis: [sun.vis_frac] }));
  return { normal, horiz, tilt };
}

/** " (3.6× the Sun's width)" from the C6 angular radii, or "" when they are missing. */
function sizeRatio(earth, sun) {
  const r = earth.ang_radius_deg / sun.ang_radius_deg;
  return Number.isFinite(r) && r > 0 ? ` (${r.toFixed(1)}× the Sun's width)` : "";
}

/**
 * The Both section's card of a scenario: its Sun rows and its Earth rows (the same as the Sun and Earth cards), each
 * under a small heading, in one card.
 */
function bothCard(it) {
  const sun = it.series ? sunMissionCard(it, true) : sunInstantCard(it, true);
  const earth = it.series ? earthMissionCard(it, true) : earthInstantCard(it, true);
  const sub = (name, label) => `<div class="mcard-sub">${icon(name)}${label}</div>`;
  return wrapCard(it, `${cardHead(it, it.series ? whenMission(it) : whenInstant(it))}${sub("sun", "Sun")}${sun}${sub("earth", "Earth")}${earth}`);
}

/** A card's body (bare: only its rows and footer, for the Both card) or the whole card with its head. */
function cardOrBody(it, bare, when, inner) {
  return bare ? inner : wrapCard(it, `${cardHead(it, when)}${inner}`);
}

function sunInstantCard(it, bare = false) {
  const sun = it.state0.sun;
  const { normal: fluxN, horiz: fluxH } = sunFlux(sun);
  const rows = [
    row(elevationIcon(sun.el_deg), deg(sun.el_deg), "height above the flat horizon (elevation)"),
    row(azimuthIcon(sun.az_deg), `${deg(sun.az_deg, 0)} ${compassPoint(sun.az_deg)}`, "direction (azimuth, from north)"),
    row(visibleIcon(sun.vis_frac, "sun"), pct(sun.vis_frac * 100), `of the disk ${terrainSub(it)}`),
    row(fluxIcon(sun.flux_frac), wm2(fluxN), `on a Sun-facing panel · ${wm2(fluxH)} on flat ground`),
  ].join("");
  const foot = it.look ? `<div class="mcard-foot">${nextEventText(it, it.look.sun_vis, "sun")}</div>` : "";
  return cardOrBody(it, bare, whenInstant(it), `<div class="mrows">${rows}</div>${foot}`);
}

function earthInstantCard(it, bare = false) {
  const e = it.state0.earth;
  const rows = [
    row(elevationIcon(e.el_deg), deg(e.el_deg), "height above the flat horizon (elevation)"),
    row(azimuthIcon(e.az_deg), `${deg(e.az_deg, 0)} ${compassPoint(e.az_deg)}`, "direction (azimuth, from north)"),
    row(visibleIcon(e.vis_frac, "earth"), pct(e.vis_frac * 100), `of the disk ${terrainSub(it)}`),
    row(phaseIcon(e.phase_frac), `${pct(e.phase_frac * 100)} lit`, `Earth phase · ${deg(2 * e.ang_radius_deg, 2)} wide${sizeRatio(e, it.state0.sun)}`),
  ].join("");
  const insight = it.look ? farSideInsight(it, it.look.earth_el, it.look.earth_vis) : "";
  const foot = it.look && !insight ? `<div class="mcard-foot">${nextEventText(it, it.look.earth_vis, "earth")}</div>` : "";
  return cardOrBody(it, bare, whenInstant(it), `<div class="mrows">${rows}</div>${foot}${insight}`);
}

function missionEvent(it, vis, body) {
  const ev = findEvents(it.series.t_ms, vis);
  const name = body === "sun" ? "Sunset" : "Earthset";
  const rise = body === "sun" ? "Sunrise" : "Earthrise";
  if (ev.upAtStart && ev.nextSet) return `<strong>${name}</strong> ${formatDuration(ev.nextSet - it.t0)} after the start`;
  if (ev.upAtStart) {
    const minVis = Math.min(...vis);
    const base = body === "sun" ? "<strong>No sunset</strong> during the stay" : "<strong>Earth stays in view</strong> the whole stay";
    if (minVis < 0.98) return `${base}, but terrain hides part of the disk at times (down to ${Math.max(1, Math.round(minVis * 100))}% visible)`;
    return base;
  }
  if (ev.nextRise) return `<strong>${rise}</strong> ${formatDuration(ev.nextRise - it.t0)} after the start`;
  return body === "sun" ? "<strong>Dark</strong> the whole stay" : "<strong>Earth hidden</strong> the whole stay";
}

function sunMissionCard(it, bare = false) {
  const se = it.series;
  const lit = pctAbove(se.sun_flux_frac ?? se.sun_vis); // a total eclipse by the Earth is not sunlight
  const el = stats(se.sun_el);
  const tilt = fluxMode === "tilt" ? tiltOf(se) : null;
  const flux = stats(fluxMode === "horiz" ? se.flux_horiz_wm2 : tilt ? tilt.view.flux_tilt_wm2 : se.flux_normal_wm2);
  const fluxSub = fluxMode === "horiz" ? "average on flat ground"
    : !tilt ? "average on a Sun-facing panel"
    : Number.isFinite(tilt.eps0) ? `average on a turning panel tilted ${deg(tilt.eps0)}`
    : "on a turning panel (no tilt: the Sun never clears the terrain)";
  const rows = [
    row(ringIcon(lit), pct(lit), "of the stay with sunlight"),
    row(elevationIcon(el.max), `${deg(el.min)} to ${deg(el.max)}`, "Sun height (elevation), lowest to highest"),
    row(fluxIcon(flux.mean / S0), wm2(flux.mean), fluxSub),
    // The night a base must ride out on batteries (terrain shadow, night, or the Earth's shadow).
    longestRow(it, se.sun_flux_frac ?? se.sun_vis, "longest darkness", "dark spells"),
  ].join("");
  // During an eclipse the card names it; the terrain's sunset or sunrise follows only when one happens.
  const ecl = eclipseText(se.eclipses, it.t0, it.t0 + it.span);
  const ev = findEvents(se.t_ms, se.sun_vis);
  const terrainEvent = !ecl || ev.nextSet || ev.nextRise || !ev.upAtStart ? missionEvent(it, se.sun_vis, "sun") : "";
  const foot = [ecl, terrainEvent].filter(Boolean).join("<br>");
  return cardOrBody(it, bare, whenMission(it), `<div class="mrows">${rows}</div><div class="mcard-foot">${foot}</div>`);
}

function earthMissionCard(it, bare = false) {
  const se = it.series;
  const vis = pctAbove(se.earth_vis);
  const el = stats(se.earth_el);
  const ph = stats(se.earth_phase);
  const rows = [
    row(ringIcon(vis), pct(vis), "of the stay with Earth in view"),
    row(elevationIcon(el.max), `${deg(el.min)} to ${deg(el.max)}`, "Earth height (elevation), lowest to highest"),
    row(phaseIcon(ph.mean), `${pct(ph.min * 100)} to ${pct(ph.max * 100)}`, "of Earth's disk lit (phase)"),
    // The longest time without direct radio contact (the Earth hidden by terrain or below the horizon).
    vis > 0 ? longestRow(it, se.earth_vis, "longest Earth blackout", "blackouts") : "",
  ].join("");
  const insight = farSideInsight(it, se.earth_el, se.earth_vis);
  const foot = insight ? "" : `<div class="mcard-foot">${missionEvent(it, se.earth_vis, "earth")}</div>`;
  return cardOrBody(it, bare, whenMission(it), `<div class="mrows">${rows}</div>${foot}${insight}`);
}

// ---------------------------------------------------------------------------------------------
// Charts

/**
 * Build a section's chart cards once (chart_plan.js CHARTS): the title with its "i" icon (the description), the
 * panel orientation buttons on Sunlight power, and the chart box.
 */
function ensureChartShells(container, body) {
  if (container.dataset.ready) return;
  container.dataset.ready = "1";
  container.innerHTML = CHARTS[body]
    .map(
      (c) => `<figure class="chart-card${c.wide ? " wide" : ""}" style="margin:0">
        <div class="chart-head"><h3>${c.title}${infoTip(c.help, { id: `help-${c.id}`, label: `About the ${c.title} chart` })}</h3>${c.toggle ? fluxToggle() : ""}</div>
        <div class="chart" id="chart-${c.id}" role="img" aria-label="${c.title} chart"></div>
      </figure>`,
    )
    .join("");
  const seg = container.querySelector(".flux-seg");
  if (seg) {
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      fluxMode = b.dataset.flux;
      // The Sun and Both sections each have these buttons: both show the same choice.
      for (const x of document.querySelectorAll(".flux-seg button")) x.setAttribute("aria-pressed", String(x.dataset.flux === fluxMode));
      rerenderCompare();
    });
  }
}

function fluxToggle() {
  return `<div class="seg flux-seg" role="group" aria-label="Panel orientation">
    <button data-flux="normal" aria-pressed="${fluxMode === "normal"}" title="Always faces the Sun (tracks it in azimuth and elevation)">Sun-facing</button>
    <button data-flux="tilt" aria-pressed="${fluxMode === "tilt"}" title="${TILT_TIP}">Fixed tilt</button>
    <button data-flux="horiz" aria-pressed="${fluxMode === "horiz"}" title="Lies flat on level ground">Flat</button></div>`;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function plotTheme() {
  return {
    paper: cssVar("--surface"),
    text: cssVar("--text-2"),
    muted: cssVar("--muted"),
    grid: cssVar("--grid"),
    axis: cssVar("--axis"),
    hoverBg: cssVar("--surface-2"),
    hoverBorder: cssVar("--border-strong"),
    textStrong: cssVar("--text"),
  };
}

/** x values for a series: hours or days since start (MET), or UTC strings for Plotly date axes. */
function xValues(t, t0, xaxis, unitMs) {
  if (xaxis === "utc") return t.map((ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " "));
  return t.map((ms) => (ms - t0) / unitMs);
}

function drawCharts(Plotly, items, { xaxis = "met" } = {}) {
  const th = plotTheme();
  const maxSpan = Math.max(...items.map((it) => it.span || 0));
  const unitMs = maxSpan > 4 * DAY_MS ? DAY_MS : 3600e3;
  const unitName = unitMs === DAY_MS ? "days" : "hours";
  const multi = items.length > 1;

  const layoutBase = (yTitle, yExtra = {}) => ({
    paper_bgcolor: th.paper,
    plot_bgcolor: th.paper,
    font: { family: "system-ui, -apple-system, Segoe UI, sans-serif", size: 12, color: th.text },
    margin: { l: 56, r: 14, t: multi ? 30 : 12, b: 44 },
    showlegend: multi,
    legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { size: 12, color: th.text }, bgcolor: "rgba(0,0,0,0)" },
    hovermode: "x unified",
    hoverlabel: { bgcolor: th.hoverBg, bordercolor: th.hoverBorder, font: { color: th.textStrong, size: 12 } },
    xaxis: {
      title: { text: xaxis === "utc" ? "UTC" : xaxis === "dist" ? "Distance travelled (km)" : `Time since start (${unitName})`, font: { size: 12, color: th.muted } },
      type: xaxis === "utc" ? "date" : "linear",
      gridcolor: th.grid, linecolor: th.axis, zeroline: false, tickfont: { color: th.muted }, showspikes: false,
    },
    yaxis: {
      title: { text: yTitle, font: { size: 12, color: th.muted } },
      gridcolor: th.grid, linecolor: th.axis, zerolinecolor: th.axis, zerolinewidth: 1.5, tickfont: { color: th.muted }, ...yExtra,
    },
  });
  const config = { displaylogo: false, responsive: true, displayModeBar: window.matchMedia?.("(pointer: coarse)").matches ? false : "hover", modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toggleSpikelines"] };

  // Long series (months to years) are drawn as a min/max envelope per pixel column (playback.js envelopeIndices): a few
  // thousand points per line whatever the span, and a dark spell of one sample keeps its full depth.
  const bins = Math.max(300, Math.min(1600, (document.getElementById("compare-body").clientWidth || 1000) - 70));
  // A dense envelope (the Sun circling a polar sky for years) gets a fainter terrain line, so the body's own line reads.
  const dense = (it) => it.series.t_ms.length > 4 * bins;
  // y: values per sample of it.series, or { t, y } (a field with the eclipse detail spliced in, playback.js withDetail).
  // Rover traverses on the distance axis use the distance driven at each sample (web/js/rover routeSeries).
  // st: the line's { color, dash } (chart_plan.js lineStyle: one scenario, the Sun red and the Earth blue; several, the
  // scenario's colour, and in the Both section the Earth dashed); width: the line width when not an envelope.
  const line = (it, y, st, extra = {}, width = 2) => {
    const s = Array.isArray(y) ? { t: it.series.t_ms, y } : y;
    const idx = s.t.length > 4 * bins ? envelopeIndices(s.t, s.y, bins) : null;
    const pick = (arr) => (idx ? idx.map((i) => arr[i]) : arr);
    const x = xaxis === "dist" && s.t === it.series.t_ms ? pick(it.series.distance_km) : xValues(pick(s.t), it.t0, xaxis, unitMs);
    return {
      type: "scatter",
      mode: "lines",
      x,
      y: pick(s.y),
      name: it.label,
      legendgroup: it.s.id,
      line: { color: st.color, width: idx ? Math.min(1.5, width) : width, dash: st.dash, shape: "linear" },
      ...extra,
    };
  };
  const instantMarker = (it, y, fmt, st, extra = {}) => ({
    type: "scatter",
    mode: "markers",
    x: xaxis === "utc" ? [new Date(it.t0).toISOString().slice(0, 19).replace("T", " ")] : [0],
    y: [y],
    name: `${it.label} (instant)`,
    legendgroup: it.s.id,
    marker: { color: st.color, size: 11, symbol: "diamond", line: { color: th.paper, width: 2 } },
    hovertemplate: `${esc(it.label)}: ${fmt}<extra></extra>`,
    ...extra,
  });
  const theme = store.theme === "light" ? "light" : "dark";
  const styleOf = (it, body, mode) => lineStyle({ body, mode, multi, color: it.color, wrapped: !!it.dash, theme });

  // On the distance axis only rover traverses are drawn (a static site has no distance).
  const missions = items.filter((it) => it.series && (xaxis !== "dist" || it.series.distance_km));
  const instants = xaxis === "dist" ? [] : items.filter((it) => !it.series);
  // Every chart gets the sky's time cursor on top of its own shapes (drawCursor keeps it current).
  cursorCtx = { missions, xaxis, unitMs, th };
  const react = (id, data, layout) => {
    baseShapes.set(id, layout.shapes || []);
    Plotly.react(`chart-${id}`, data, { ...layout, shapes: [...(layout.shapes || []), ...cursorShapes()] }, config);
  };

  // Eclipses of the Sun by the Earth (C6 series().eclipses): a light band for the partial phases, a darker one for
  // totality, labelled once per event.
  const xOf = (it, ms) => {
    if (xaxis !== "dist") return xValues([ms], it.t0, xaxis, unitMs)[0];
    const t = it.series.t_ms;
    const i = Math.max(0, Math.min(t.length - 1, Math.round((ms - t[0]) / ((t[1] - t[0]) || 1))));
    return it.series.distance_km[i];
  };
  // Terrain horizon in the body's direction: per sample at the rover's position for traverses, else the site profile.
  const hzLine = (it, body) => it.series[`${body}_hz_el`] ?? it.series[`${body}_az`].map((az) => horizonElAt(it.horizon, az));
  // Many eclipses (a stay of years): each gets a "◐" mark (a text glyph, not an emoji) whose tooltip names it, instead of a label that would overlap.
  const nEclipses = missions.reduce((n, it) => n + (it.series.eclipses?.length || 0), 0);
  const eclipseMarks = () => {
    const shapes = [], annotations = [];
    for (const it of missions) {
      for (const e of it.series.eclipses || []) {
        const a = e.start_ms ?? it.series.t_ms[0], b = e.end_ms ?? it.series.t_ms[it.series.t_ms.length - 1];
        const band = (x0, x1, op) => ({ type: "rect", xref: "x", yref: "paper", x0, x1, y0: 0, y1: 1, fillcolor: th.muted, opacity: op, line: { width: 0 }, layer: "below" });
        shapes.push(band(xOf(it, a), xOf(it, b), 0.07));
        if (e.total_start_ms != null && e.total_end_ms != null) shapes.push(band(xOf(it, e.total_start_ms), xOf(it, e.total_end_ms), 0.12));
        const text = e.max_frac >= 1 ? "Earth hides the Sun" : `Earth covers ${Math.round(e.max_frac * 100)}% of the Sun`;
        annotations.push({
          x: xOf(it, e.max_ms), y: 1, xref: "x", yref: "paper", yanchor: "bottom", showarrow: false,
          ...(nEclipses > 3 ? { text: "◐", hovertext: `${text} (${formatUtc(e.max_ms).split(",")[0]})`, font: { size: 11, color: th.muted } } : { text, font: { size: 11, color: th.muted } }),
        });
      }
    }
    return { shapes, annotations };
  };
  const marks = eclipseMarks();
  const withEclipses = (layout) => (marks.shapes.length ? { ...layout, ...marks, margin: { ...layout.margin, t: Math.max(layout.margin.t, 26) } } : layout);

  const traces = (fnLine, fnInstant) => [...missions.flatMap(fnLine), ...instants.map(fnInstant).filter(Boolean)];

  // The Both section: a chart that shares a quantity draws each scenario's Sun and Earth lines. One scenario: legend
  // "Sun" and "Earth" (the colours tell them apart). Several: the legend lists the scenarios once (their Sun line) and
  // a key says the Earth lines are dashed (chart_plan.js styleKey); the hover names the body.
  const NAME = { sun: "Sun", earth: "Earth" };
  const bodyNames = (it, body, mode, two) => {
    if (mode !== "both" || !two) return {};
    if (!multi) return { name: NAME[body], legendgroup: body };
    return { name: body === "sun" ? it.label : `${it.label} (Earth)`, showlegend: body === "sun" };
  };
  const hoverName = (body, mode, two) => (mode === "both" && two ? `${NAME[body]} ` : "");
  const keyTraces = (bodies, mode) => styleKey({ bodies, mode, multi }).map((k) => ({
    type: "scatter", mode: "lines", x: [null], y: [null], name: k.name, line: { color: th.muted, width: 2, dash: k.dash }, hoverinfo: "skip",
  }));
  const instantSymbol = (body, mode) => (mode === "both" && multi && body === "earth" ? "circle" : "diamond");

  /** Elevation lines of the given bodies, each with its terrain horizon (dotted) in that body's direction. */
  const elTraces = (bodies, mode) => {
    const two = bodies.length > 1;
    return [
      ...traces(
        (it) => bodies.flatMap((body) => {
          const st = styleOf(it, body, mode);
          const tr = [line(it, it.series[`${body}_el`], st, { hovertemplate: `${hoverName(body, mode, two)}%{y:.1f}°`, ...bodyNames(it, body, mode, two) })];
          if (it.horizon) {
            const where = it.horizon.approximate ? "approximate terrain (coarse)" : "terrain horizon";
            tr.push(line(it, hzLine(it, body), { ...st, dash: "dot" }, {
              name: `${it.label}: ${two ? `${where} toward the ${NAME[body]}` : where}`, showlegend: false, opacity: dense(it) ? 0.5 : 0.85,
              legendgroup: two && !multi ? body : it.s.id, hovertemplate: `${two ? `${NAME[body]} ` : ""}terrain %{y:.1f}°`,
            }, 1.5));
          }
          return tr;
        }),
        (it) => bodies.map((body) => instantMarker(it, it.state0[body].el_deg, `${hoverName(body, mode, two)}${deg(it.state0[body].el_deg)}`, styleOf(it, body, mode), {
          ...(two ? { marker: { color: styleOf(it, body, mode).color, size: 11, symbol: instantSymbol(body, mode), line: { color: th.paper, width: 2 } } } : {}),
          ...(two && !multi ? { name: `${NAME[body]} (instant)`, legendgroup: body } : {}),
        })),
      ).flat(),
      ...keyTraces(bodies, mode),
    ];
  };
  const twoLayout = (layout, two) => (two ? { ...layout, showlegend: true, margin: { ...layout.margin, t: Math.max(layout.margin.t, 30) } } : layout);
  react("sun-el", elTraces(["sun"], "single"), layoutBase("Elevation (°)", { ticksuffix: "°" }), config);

  // Visible Sun. Solid: the share of the Sun's light that reaches the site (C6 flux_frac: limb-darkened, after the
  // terrain and the Earth). Dashed, for windows with an eclipse: the terrain alone (C6 vis_frac, share of the disk).
  // In the Sun section, for windows with an eclipse, a dashed line adds the terrain alone (C6 vis_frac, share of the
  // disk); the Both section leaves it out (dashed lines are the Earth's there).
  const anyEclipse = missions.some((it) => it.series.eclipses?.length);
  /** Visible lines of the given bodies: the Sun's share of light (after terrain and eclipses), the Earth's disk share. */
  const visTraces = (bodies, mode) => {
    const two = bodies.length > 1;
    const out = traces(
      (it) => bodies.flatMap((body) => {
        const st = styleOf(it, body, mode);
        const names = bodyNames(it, body, mode, two);
        if (body === "earth") return [line(it, it.series.earth_vis.map((v) => v * 100), st, { hovertemplate: `${hoverName(body, mode, two)}%{y:.0f}%`, ...names })];
        // Long missions: the eclipses come from their own 2-min detail (playback.js missionSeries), not the coarse samples.
        const total = withDetail(it.series, it.series.sun_flux_frac ? "sun_flux_frac" : "sun_vis", (v) => v * 100);
        // With both bodies, the Sun's line is drawn wider, so it still shows where the Earth's line lies on it (both 100%).
        const tr = [line(it, total, st, { hovertemplate: `${hoverName(body, mode, two)}%{y:.0f}% of the Sun's light`, ...names }, two ? 3.5 : 2)];
        if (mode !== "both" && it.series.eclipses?.length) {
          tr.push(line(it, withDetail(it.series, "sun_vis", (v) => v * 100), { ...st, dash: "dash" }, {
            name: `${it.label}: terrain only`, showlegend: false, hovertemplate: "terrain only %{y:.0f}%",
          }, 1.5));
        }
        return tr;
      }),
      (it) => bodies.map((body) => {
        const b = it.state0[body];
        const f = body === "sun" ? b.flux_frac ?? b.vis_frac : b.vis_frac;
        const st = styleOf(it, body, mode);
        return instantMarker(it, f * 100, `${hoverName(body, mode, two)}${Math.round(f * 100)}%`, st, {
          ...(two ? { marker: { color: st.color, size: 11, symbol: instantSymbol(body, mode), line: { color: th.paper, width: 2 } } } : {}),
          ...(two && !multi ? { name: `${NAME[body]} (instant)`, legendgroup: body } : {}),
        });
      }),
    ).flat();
    out.push(...keyTraces(bodies, mode));
    if (anyEclipse && mode !== "both" && bodies.includes("sun")) {
      // Legend key for the line styles (an empty trace): the scenario lines are solid, the terrain-only lines dashed.
      out.push({
        type: "scatter", mode: "lines", x: [null], y: [null], name: "Dashed: terrain only (Earth ignored)",
        line: { color: th.muted, width: 1.5, dash: "dash" }, hoverinfo: "skip",
      });
    }
    return out;
  };
  /** The visible-share layout: eclipse bands when the chart has the Sun; a legend on top moves their labels down. */
  const visLayout = (yTitle, bodies, mode) => {
    const two = bodies.length > 1;
    let lay = layoutBase(yTitle, { range: [-5, 105], ticksuffix: "%" });
    if (bodies.includes("sun")) lay = withEclipses(lay);
    const legend = two || (anyEclipse && mode !== "both");
    if (legend) {
      // The legend takes the top row, so the eclipse labels move into the middle of their bands (the lines are at 0%
      // and 100% there).
      lay = twoLayout(lay, true);
      if (lay.annotations) lay.annotations = lay.annotations.map((a) => ({ ...a, y: 0.5, yanchor: "middle" }));
    }
    return lay;
  };
  react("sun-vis", visTraces(["sun"], "single"), visLayout("Sunlight reaching the site (%)", ["sun"], "single"), config);

  // Fixed tilt: the flux comes from tiltOf(series).view (flux_tilt_wm2), one tilt per scenario.
  const fluxKey = { horiz: "flux_horiz_wm2", tilt: "flux_tilt_wm2" }[fluxMode] || "flux_normal_wm2";
  const fluxSrc = (it) => (fluxMode === "tilt" ? tiltOf(it.series).view : it.series);
  const tiltLabel = (eps0) => (Number.isFinite(eps0) ? `tilt ${deg(eps0)}` : "never lit");
  // The scale starts at 0 and reaches at least 1400 W/m² for a Sun-facing or turning panel (the solar constant is 1361)
  // or 100 W/m² on flat ground, so a site in the dark reads as zero power instead of a flat line on a 0-1 axis.
  let fluxMax = 0;
  for (const it of missions) for (const v of fluxSrc(it)[fluxKey]) if (v > fluxMax) fluxMax = v;
  for (const it of instants) fluxMax = Math.max(fluxMax, sunFlux(it.state0.sun)[fluxMode] || 0);
  let fluxTitle = fluxMode === "horiz" ? "Flat ground (W/m²)" : "Sun-facing panel (W/m²)";
  // Several scenarios on a phone-width page: the legend keeps the plain names (long ones would squeeze the plot), and
  // each tilt is in the hover and on the scenario's card.
  const tiltInLegend = (document.getElementById("compare-body").clientWidth || 1000) >= 700;
  if (fluxMode === "tilt") {
    // One mission: its tilt on the axis; several: each scenario's tilt in its legend entry and hover.
    const eps = missions.length === 1 && !instants.length ? tiltOf(missions[0].series).eps0 : null;
    fluxTitle = eps === null ? (tiltInLegend ? "Turning panel, tilt per scenario (W/m²)" : "Turning panel (W/m²)")
      : Number.isFinite(eps) ? `Turning panel, tilt ${deg(eps)} (W/m²)` : "Turning panel, tilt undefined (W/m²)";
  }
  const fluxTraces = (mode) => traces(
    (it) => {
      const st = styleOf(it, "sun", mode);
      if (fluxMode !== "tilt") return [line(it, withDetail(it.series, fluxKey), st, { hovertemplate: "%{y:.0f} W/m²" })];
      const t = tiltLabel(tiltOf(it.series).eps0);
      const name = multi && tiltInLegend ? `${it.label} · ${t}` : it.label;
      return [line(it, withDetail(fluxSrc(it), fluxKey), st, { name, hovertemplate: `%{y:.0f} W/m² (${t})` })];
    },
    (it) => {
      const v = sunFlux(it.state0.sun)[fluxMode];
      return instantMarker(it, v, `${Math.round(v)} W/m²`, styleOf(it, "sun", mode));
    },
  );
  const fluxLayout = () => withEclipses(layoutBase(fluxTitle, { range: [0, Math.max(fluxMode === "horiz" ? 100 : 1400, fluxMax * 1.04)] }));
  react("sun-flux", fluxTraces("single"), fluxLayout(), config);

  react("earth-el", elTraces(["earth"], "single"), layoutBase("Elevation (°)", { ticksuffix: "°" }), config);
  react("earth-vis", visTraces(["earth"], "single"), visLayout("Visible disk (%)", ["earth"], "single"), config);

  const phaseTraces = (mode) => [
    ...traces(
      (it) => [line(it, it.series.earth_phase.map((v) => v * 100), styleOf(it, "earth", mode), { hovertemplate: "%{y:.0f}% lit" })],
      (it) => instantMarker(it, it.state0.earth.phase_frac * 100, `${Math.round(it.state0.earth.phase_frac * 100)}% lit`, styleOf(it, "earth", mode)),
    ),
    ...keyTraces(["earth"], mode),
  ];
  const phaseLayout = () => layoutBase("Lit fraction (%)", { range: [-5, 105], ticksuffix: "%" });
  react("earth-phase", phaseTraces("single"), phaseLayout(), config);

  // The Both section (drawn only while it shows): one Elevation and one Visible disk chart with both bodies, then the
  // body-specific Sunlight power and Earth phase.
  if (normBody(store.body) === "both") {
    react("both-el", elTraces(["sun", "earth"], "both"), twoLayout(layoutBase("Elevation (°)", { ticksuffix: "°" }), true), config);
    react("both-vis", visTraces(["sun", "earth"], "both"), visLayout("Visible disk (%)", ["sun", "earth"], "both"), config);
    react("both-flux", fluxTraces("both"), fluxLayout(), config);
    react("both-phase", phaseTraces("both"), twoLayout(phaseLayout(), multi), config);
    bothDrawnFor = lastArgs;
  }
  // A chart first drawn in a hidden section gets Plotly's default 700 px width, and Plotly.react keeps it: fit the
  // shown section to its box (e.g. the Far side story opens the Earth section; 700 px overflows a phone).
  resizeShownCharts();
}

// ---------------------------------------------------------------------------------------------
// Time cursor: a dotted vertical line at the moment the sky views show (the timelapse slider). On the "time since start"
// axis one line; on the UTC and distance axes one per scenario, in its colour, where it is at that moment.

let cursorMs = 0;
let cursorCtx = null; // { missions, xaxis, unitMs, th } of the last chart draw
const baseShapes = new Map(); // chart id -> its own shapes (eclipse bands)
let cursorTimer = 0;
let cursorLast = 0;

/** Move the charts' time cursor to `offsetMs` after the scenarios' start (throttled while the timelapse plays). */
export function setChartCursor(offsetMs) {
  cursorMs = Math.max(0, Number(offsetMs) || 0);
  drawCursor();
}

function cursorShapes() {
  if (!cursorCtx || !cursorCtx.missions.length) return [];
  const { missions, xaxis, unitMs, th } = cursorCtx;
  const line = (x, color) => ({
    type: "line", xref: "x", yref: "paper", x0: x, x1: x, y0: 0, y1: 1, layer: "above",
    line: { color, width: 1.5, dash: "dot" },
  });
  if (xaxis === "met") return [line(cursorMs / unitMs, th.textStrong)];
  const seen = new Set();
  const out = [];
  for (const it of missions) {
    const t = it.t0 + Math.min(cursorMs, it.span || 0);
    let x;
    if (xaxis === "utc") x = new Date(t).toISOString().slice(0, 19).replace("T", " ");
    else {
      const tt = it.series.t_ms;
      const i = Math.max(0, Math.min(tt.length - 1, Math.round((t - tt[0]) / ((tt[1] - tt[0]) || 1))));
      x = it.series.distance_km[i];
    }
    const key = `${x}|${missions.length > 1 ? it.color : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line(x, missions.length > 1 ? it.color : th.textStrong));
  }
  return out;
}

/** Redraw the cursor on the shown charts: at most about 12 times a second, or at once (`now`). */
function drawCursor(now = false) {
  if (!plotlyPromise || !cursorCtx) return;
  clearTimeout(cursorTimer);
  const wait = now ? 0 : Math.max(0, 80 - (performance.now() - cursorLast));
  cursorTimer = setTimeout(() => {
    cursorLast = performance.now();
    plotlyPromise.then((Plotly) => {
      const body = normBody(store.body);
      const cur = cursorShapes();
      for (const c of document.querySelectorAll(`#sec-${body} .chart.js-plotly-plot`)) {
        const id = c.id.replace(/^chart-/, "");
        Plotly.relayout(c, { shapes: [...(baseShapes.get(id) || []), ...cur] });
      }
    }).catch(() => {});
  }, wait);
}
