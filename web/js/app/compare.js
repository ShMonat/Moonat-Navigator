// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The data under the sky: Sun and Earth sections (one shown at a time, by the page's "☀ Sun | 🌍 Earth" switch), and the
// "Side by side" table of several scenarios. Single instants get metric cards; missions get summary cards plus Plotly
// charts against mission elapsed time (or calendar time, or distance for rover traverses), one line per scenario,
// with a time cursor at the moment the sky shows.

import { store, subscribe, setUi } from "./store.js";
import { formatDuration, formatUtc, DAY_MS } from "./state.js";
import { horizonElAt, findEvents, stats, pctAbove, compassPoint } from "./derive.js";
import { elevationIcon, azimuthIcon, visibleIcon, phaseIcon, fluxIcon, ringIcon, clockIcon } from "./icons.js";
import { eclipseText, earthElCaption, rankRows, sortRows, bestIds, rankSentence, RANK_KEYS } from "./compare_text.js";
import { withDetail, envelopeIndices, longestRun, JULIAN_YEAR_MS } from "./playback.js";

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

let fluxMode = "normal"; // "normal" (Sun-facing panel) or "horiz" (flat ground)
let lastArgs = null;

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
  // Card grid by count (app.css): 6 in a row or 3 + 3, never 5 + 1.
  for (const id of ["cards-sun", "cards-earth"]) document.getElementById(id).dataset.n = String(Math.min(ok.length, 7));
  renderRank(ok);

  const sunCharts = document.getElementById("charts-sun");
  const earthCharts = document.getElementById("charts-earth");
  if (!anyMission) {
    cursorCtx = null;
    sunCharts.replaceChildren();
    earthCharts.replaceChildren();
    // The shells are gone, so the next mission render must rebuild them.
    delete sunCharts.dataset.ready;
    delete earthCharts.dataset.ready;
    sunCharts.hidden = earthCharts.hidden = true;
    return;
  }
  sunCharts.hidden = earthCharts.hidden = false;
  ensureChartShells(sunCharts, "sun");
  ensureChartShells(earthCharts, "earth");
  // The Earth elevation caption fits the sites shown (near side, poles and limb, far side).
  document.getElementById("help-earth-el").textContent = earthElCaption(ok);
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

const BODY_SUB = { sun: "Sunlight: power and heat", earth: "Earth in view: direct radio contact" };

/**
 * The "☀ Sun | 🌍 Earth" switch under the sky: shows one section at a time (the choice lives in store.body and the URL
 * hash) and calls onPick(body) on every press, also of the pressed half, so main.js can aim the sky views at it.
 * Plotly cannot measure a hidden chart, so the charts of a section are resized when it is shown.
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
  const body = store.body === "earth" ? "earth" : "sun";
  for (const b of document.querySelectorAll("#body-toggle button")) b.setAttribute("aria-pressed", String(b.dataset.body === body));
  document.getElementById("body-sub").textContent = BODY_SUB[body];
  document.getElementById("sec-sun").hidden = body !== "sun";
  document.getElementById("sec-earth").hidden = body !== "earth";
  document.getElementById(`charts-${body}`).before(document.getElementById("chart-tools"));
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
      const body = store.body === "earth" ? "earth" : "sun";
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
  box.innerHTML = `<div class="rank-head"><h2 class="rank-title" id="rank-title">Side by side</h2><p class="rank-sentence">${esc(rankSentence(rows))}</p></div>
    <div class="rank-scroll"><table class="rank-table"><thead><tr><th scope="col">Scenario</th>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="rank-foot">The best value in each column is highlighted. Select a column heading to sort by it.</p>`;
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
    return `<div class="insight">🌑 Earth never rises here: this is the Moon's far side, always turned away from Earth. A lander here needs a relay satellite to talk home.</div>`;
  }
  return "";
}

/** Solar flux (W/m²) on a Sun-facing panel and on flat ground, from a C6 sun state (uses its flux fields when present). */
function sunFlux(sun) {
  const normal = Number.isFinite(sun.flux_normal_wm2) ? sun.flux_normal_wm2 : S0 * (AU_KM / sun.dist_km) ** 2 * sun.flux_frac;
  const horiz = Number.isFinite(sun.flux_horiz_wm2) ? sun.flux_horiz_wm2 : normal * Math.max(0, Math.sin((sun.el_deg * Math.PI) / 180));
  return { normal, horiz };
}

/** " (3.6× the Sun's width)" from the C6 angular radii, or "" when they are missing. */
function sizeRatio(earth, sun) {
  const r = earth.ang_radius_deg / sun.ang_radius_deg;
  return Number.isFinite(r) && r > 0 ? ` (${r.toFixed(1)}× the Sun's width)` : "";
}

function sunInstantCard(it) {
  const sun = it.state0.sun;
  const { normal: fluxN, horiz: fluxH } = sunFlux(sun);
  const rows = [
    row(elevationIcon(sun.el_deg), deg(sun.el_deg), "height above the flat horizon (elevation)"),
    row(azimuthIcon(sun.az_deg), `${deg(sun.az_deg, 0)} ${compassPoint(sun.az_deg)}`, "direction (azimuth, from north)"),
    row(visibleIcon(sun.vis_frac, "sun"), pct(sun.vis_frac * 100), `of the disk ${terrainSub(it)}`),
    row(fluxIcon(sun.flux_frac), wm2(fluxN), `on a Sun-facing panel · ${wm2(fluxH)} on flat ground`),
  ].join("");
  const foot = it.look ? `<div class="mcard-foot">${nextEventText(it, it.look.sun_vis, "sun")}</div>` : "";
  return wrapCard(it, `${cardHead(it, whenInstant(it))}<div class="mrows">${rows}</div>${foot}`);
}

function earthInstantCard(it) {
  const e = it.state0.earth;
  const rows = [
    row(elevationIcon(e.el_deg), deg(e.el_deg), "height above the flat horizon (elevation)"),
    row(azimuthIcon(e.az_deg), `${deg(e.az_deg, 0)} ${compassPoint(e.az_deg)}`, "direction (azimuth, from north)"),
    row(visibleIcon(e.vis_frac, "earth"), pct(e.vis_frac * 100), `of the disk ${terrainSub(it)}`),
    row(phaseIcon(e.phase_frac), `${pct(e.phase_frac * 100)} lit`, `Earth phase · ${deg(2 * e.ang_radius_deg, 2)} wide${sizeRatio(e, it.state0.sun)}`),
  ].join("");
  const insight = it.look ? farSideInsight(it, it.look.earth_el, it.look.earth_vis) : "";
  const foot = it.look && !insight ? `<div class="mcard-foot">${nextEventText(it, it.look.earth_vis, "earth")}</div>` : "";
  return wrapCard(it, `${cardHead(it, whenInstant(it))}<div class="mrows">${rows}</div>${foot}${insight}`);
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

function sunMissionCard(it) {
  const se = it.series;
  const lit = pctAbove(se.sun_flux_frac ?? se.sun_vis); // a total eclipse by the Earth is not sunlight
  const el = stats(se.sun_el);
  const flux = stats(fluxMode === "horiz" ? se.flux_horiz_wm2 : se.flux_normal_wm2);
  const rows = [
    row(ringIcon(lit), pct(lit), "of the stay with sunlight"),
    row(elevationIcon(el.max), `${deg(el.min)} to ${deg(el.max)}`, "Sun height (elevation), lowest to highest"),
    row(fluxIcon(flux.mean / S0), wm2(flux.mean), fluxMode === "horiz" ? "average on flat ground" : "average on a Sun-facing panel"),
    // The night a base must ride out on batteries (terrain shadow, night, or the Earth's shadow).
    longestRow(it, se.sun_flux_frac ?? se.sun_vis, "longest darkness", "dark spells"),
  ].join("");
  // During an eclipse the card names it; the terrain's sunset or sunrise follows only when one happens.
  const ecl = eclipseText(se.eclipses, it.t0, it.t0 + it.span);
  const ev = findEvents(se.t_ms, se.sun_vis);
  const terrainEvent = !ecl || ev.nextSet || ev.nextRise || !ev.upAtStart ? missionEvent(it, se.sun_vis, "sun") : "";
  const foot = [ecl, terrainEvent].filter(Boolean).join("<br>");
  return wrapCard(it, `${cardHead(it, whenMission(it))}<div class="mrows">${rows}</div><div class="mcard-foot">${foot}</div>`);
}

function earthMissionCard(it) {
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
  return wrapCard(it, `${cardHead(it, whenMission(it))}<div class="mrows">${rows}</div>${foot}${insight}`);
}

// ---------------------------------------------------------------------------------------------
// Charts

const CHARTS = {
  sun: [
    { id: "sun-el", wide: true, title: "Sun elevation", help: "Height above the flat, ideal horizon. Dotted: the real terrain horizon in that direction. Above 0° does not guarantee sunlight." },
    { id: "sun-vis", title: "Visible Sun", help: "Share of the Sun's light that reaches the site (100% = the full Sun). Terrain and, during an eclipse, the Earth block part of it." },
    { id: "sun-flux", title: "Sunlight power", help: "Solar power reaching a panel, in W/m².", toggle: true },
  ],
  earth: [
    { id: "earth-el", wide: true, title: "Earth elevation", help: "Height above the flat, ideal horizon. Dotted: the real terrain horizon in that direction." },
    { id: "earth-vis", title: "Visible Earth", help: "How much of Earth's disk clears the terrain: a proxy for direct radio contact." },
    { id: "earth-phase", title: "Earth phase", help: "How much of Earth's disk is sunlit, as seen from the Moon." },
  ],
};

function ensureChartShells(container, body) {
  if (container.dataset.ready) return;
  container.dataset.ready = "1";
  container.innerHTML = CHARTS[body]
    .map(
      (c) => `<figure class="chart-card${c.wide ? " wide" : ""}" style="margin:0">
        <div class="chart-head"><h3>${c.title}</h3><p id="help-${c.id}">${c.help}</p>${c.toggle ? fluxToggle() : ""}</div>
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
      for (const x of seg.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
      rerenderCompare();
    });
  }
}

function fluxToggle() {
  return `<div class="seg flux-seg" role="group" aria-label="Panel orientation">
    <button data-flux="normal" aria-pressed="${fluxMode === "normal"}">Sun-facing</button>
    <button data-flux="horiz" aria-pressed="${fluxMode === "horiz"}">Flat</button></div>`;
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
  const line = (it, y, extra = {}) => {
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
      line: { color: it.color, width: idx ? 1.5 : 2, dash: it.dash ? "dash" : "solid", shape: "linear" },
      ...extra,
    };
  };
  const instantMarker = (it, y, fmt) => ({
    type: "scatter",
    mode: "markers",
    x: xaxis === "utc" ? [new Date(it.t0).toISOString().slice(0, 19).replace("T", " ")] : [0],
    y: [y],
    name: `${it.label} (instant)`,
    legendgroup: it.s.id,
    marker: { color: it.color, size: 11, symbol: "diamond", line: { color: th.paper, width: 2 } },
    hovertemplate: `${esc(it.label)}: ${fmt}<extra></extra>`,
  });

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
  // Many eclipses (a stay of years): each gets a "🌑" mark whose tooltip names it, instead of a label that would overlap.
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
          ...(nEclipses > 3 ? { text: "🌑", hovertext: `${text} (${formatUtc(e.max_ms).split(",")[0]})`, font: { size: 10 } } : { text, font: { size: 11, color: th.muted } }),
        });
      }
    }
    return { shapes, annotations };
  };
  const marks = eclipseMarks();
  const withEclipses = (layout) => (marks.shapes.length ? { ...layout, ...marks, margin: { ...layout.margin, t: Math.max(layout.margin.t, 26) } } : layout);

  const traces = (fnLine, fnInstant) => [...missions.flatMap(fnLine), ...instants.map(fnInstant).filter(Boolean)];

  const sunEl = traces(
    (it) => {
      const tr = [line(it, it.series.sun_el, { hovertemplate: "%{y:.1f}°" })];
      if (it.horizon) {
        tr.push(line(it, hzLine(it, "sun"), {
          name: `${it.label}: ${it.horizon.approximate ? "approximate terrain (coarse)" : "terrain horizon"}`, showlegend: false, opacity: dense(it) ? 0.5 : 0.85,
          line: { color: it.color, width: 1.5, dash: "dot" }, hovertemplate: "terrain %{y:.1f}°",
        }));
      }
      return tr;
    },
    (it) => instantMarker(it, it.state0.sun.el_deg, deg(it.state0.sun.el_deg)),
  );
  react("sun-el", sunEl, layoutBase("Elevation (°)", { ticksuffix: "°" }), config);

  // Visible Sun. Solid: the share of the Sun's light that reaches the site (C6 flux_frac: limb-darkened, after the
  // terrain and the Earth). Dashed, for windows with an eclipse: the terrain alone (C6 vis_frac, share of the disk).
  const anyEclipse = missions.some((it) => it.series.eclipses?.length);
  const sunVisTraces = traces(
    (it) => {
      // Long missions: the eclipses come from their own 2-min detail (playback.js missionSeries), not the coarse samples.
      const total = withDetail(it.series, it.series.sun_flux_frac ? "sun_flux_frac" : "sun_vis", (v) => v * 100);
      const tr = [line(it, total, { hovertemplate: "%{y:.0f}% of the Sun's light" })];
      if (it.series.eclipses?.length) {
        tr.push(line(it, withDetail(it.series, "sun_vis", (v) => v * 100), {
          name: `${it.label}: terrain only`, showlegend: false, line: { color: it.color, width: 1.5, dash: "dash" },
          hovertemplate: "terrain only %{y:.0f}%",
        }));
      }
      return tr;
    },
    (it) => {
      const f = it.state0.sun.flux_frac ?? it.state0.sun.vis_frac;
      return instantMarker(it, f * 100, `${Math.round(f * 100)}%`);
    },
  );
  if (anyEclipse) {
    // Legend key for the line styles (an empty trace): the scenario lines are solid, the terrain-only lines dashed.
    sunVisTraces.push({
      type: "scatter", mode: "lines", x: [null], y: [null], name: "Dashed: terrain only (Earth ignored)",
      line: { color: th.muted, width: 1.5, dash: "dash" }, hoverinfo: "skip",
    });
  }
  const sunVisLayout = withEclipses(layoutBase("Sunlight reaching the site (%)", { range: [-5, 105], ticksuffix: "%" }));
  if (anyEclipse) {
    // The legend takes the top row, so the eclipse labels move into the middle of their bands (the lines are at 0%
    // and 100% there).
    Object.assign(sunVisLayout, {
      showlegend: true,
      annotations: (sunVisLayout.annotations || []).map((a) => ({ ...a, y: 0.5, yanchor: "middle" })),
    });
  }
  react("sun-vis", sunVisTraces, sunVisLayout, config);

  const fluxKey = fluxMode === "horiz" ? "flux_horiz_wm2" : "flux_normal_wm2";
  // The scale starts at 0 and reaches at least 1400 W/m² for a Sun-facing panel (the solar constant is 1361) or 100 W/m²
  // on flat ground, so a site in the dark reads as zero power instead of a flat line on a 0-1 axis.
  let fluxMax = 0;
  for (const it of missions) for (const v of it.series[fluxKey]) if (v > fluxMax) fluxMax = v;
  for (const it of instants) fluxMax = Math.max(fluxMax, sunFlux(it.state0.sun)[fluxMode === "horiz" ? "horiz" : "normal"] || 0);
  react(
    "sun-flux",
    traces(
      (it) => [line(it, withDetail(it.series, fluxKey), { hovertemplate: "%{y:.0f} W/m²" })],
      (it) => {
        const f = sunFlux(it.state0.sun);
        const v = fluxMode === "horiz" ? f.horiz : f.normal;
        return instantMarker(it, v, `${Math.round(v)} W/m²`);
      },
    ),
    withEclipses(layoutBase(fluxMode === "horiz" ? "Flat ground (W/m²)" : "Sun-facing panel (W/m²)", { range: [0, Math.max(fluxMode === "horiz" ? 100 : 1400, fluxMax * 1.04)] })),
    config,
  );

  const earthEl = traces(
    (it) => {
      const tr = [line(it, it.series.earth_el, { hovertemplate: "%{y:.1f}°" })];
      if (it.horizon) {
        tr.push(line(it, hzLine(it, "earth"), {
          name: `${it.label}: ${it.horizon.approximate ? "approximate terrain (coarse)" : "terrain horizon"}`, showlegend: false, opacity: dense(it) ? 0.5 : 0.85,
          line: { color: it.color, width: 1.5, dash: "dot" }, hovertemplate: "terrain %{y:.1f}°",
        }));
      }
      return tr;
    },
    (it) => instantMarker(it, it.state0.earth.el_deg, deg(it.state0.earth.el_deg)),
  );
  react("earth-el", earthEl, layoutBase("Elevation (°)", { ticksuffix: "°" }), config);

  react(
    "earth-vis",
    traces(
      (it) => [line(it, it.series.earth_vis.map((v) => v * 100), { hovertemplate: "%{y:.0f}%" })],
      (it) => instantMarker(it, it.state0.earth.vis_frac * 100, `${Math.round(it.state0.earth.vis_frac * 100)}%`),
    ),
    layoutBase("Visible disk (%)", { range: [-5, 105], ticksuffix: "%" }),
    config,
  );

  react(
    "earth-phase",
    traces(
      (it) => [line(it, it.series.earth_phase.map((v) => v * 100), { hovertemplate: "%{y:.0f}% lit" })],
      (it) => instantMarker(it, it.state0.earth.phase_frac * 100, `${Math.round(it.state0.earth.phase_frac * 100)}% lit`),
    ),
    layoutBase("Lit fraction (%)", { range: [-5, 105], ticksuffix: "%" }),
    config,
  );
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
      const body = store.body === "earth" ? "earth" : "sun";
      const cur = cursorShapes();
      for (const c of document.querySelectorAll(`#sec-${body} .chart.js-plotly-plot`)) {
        const id = c.id.replace(/^chart-/, "");
        Plotly.relayout(c, { shapes: [...(baseShapes.get(id) || []), ...cur] });
      }
    }).catch(() => {});
  }, wait);
}
