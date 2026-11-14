// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Compare tab: Sun and Earth sections. Single instants get metric cards; missions get summary cards plus Plotly
// charts against mission elapsed time (or calendar time), one line per scenario.

import { formatDuration, formatUtc, DAY_MS } from "./state.js";
import { horizonElAt, findEvents, stats, pctAbove, compassPoint } from "./derive.js";
import { elevationIcon, azimuthIcon, visibleIcon, phaseIcon, fluxIcon, ringIcon } from "./icons.js";

const AU_KM = 149597870.7;
const S0 = 1361;
const PLOTLY_URL = "https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js";

let plotlyPromise = null;
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
 * Render the Compare tab.
 * items: [{ s, label, color, dash, t0, t1, span, horizon, state0, series | null, look | null, error | null }]
 */
export function renderCompare(items, opts) {
  lastArgs = [items, opts];
  const ok = items.filter((it) => !it.error && it.state0);
  document.getElementById("compare-empty").hidden = ok.length > 0;
  document.getElementById("compare-body").hidden = ok.length === 0;
  const anyMission = ok.some((it) => it.series);
  document.getElementById("xaxis-toggle").hidden = !anyMission;

  document.getElementById("cards-sun").innerHTML = ok.map((it) => (it.series ? sunMissionCard(it) : sunInstantCard(it))).join("");
  document.getElementById("cards-earth").innerHTML = ok.map((it) => (it.series ? earthMissionCard(it) : earthInstantCard(it))).join("");

  const sunCharts = document.getElementById("charts-sun");
  const earthCharts = document.getElementById("charts-earth");
  if (!anyMission) {
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
  loadPlotly()
    .then((Plotly) => drawCharts(Plotly, ok, opts))
    .catch((err) => {
      for (const c of document.querySelectorAll(".chart")) c.textContent = "Charts could not load (offline?). " + err.message;
    });
}

/** Re-render with the last data (theme or toggle change). */
export function rerenderCompare(patch = {}) {
  if (!lastArgs) return;
  renderCompare(lastArgs[0], { ...lastArgs[1], ...patch });
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
  return `${formatUtc(it.t0)} · ${formatDuration(it.span)} stay`;
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
  const horizonDays = Math.round((look.t_ms[look.t_ms.length - 1] - look.t_ms[0]) / DAY_MS);
  const name = body === "sun" ? "Sun" : "Earth";
  if (ev.upAtStart) {
    if (ev.nextSet) return `<strong>${name} sets in ${formatDuration(ev.nextSet - it.t0)}</strong> <span class="muted">(${esc(formatUtc(ev.nextSet))})</span>`;
    return `<strong>${name} stays up</strong> for at least the next ${horizonDays} days`;
  }
  if (ev.nextRise) return `<strong>${name} rises in ${formatDuration(ev.nextRise - it.t0)}</strong> <span class="muted">(${esc(formatUtc(ev.nextRise))})</span>`;
  return `<strong>${name} does not rise</strong> in the next ${horizonDays} days`;
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
    row(elevationIcon(sun.el_deg), deg(sun.el_deg), "elevation above the flat horizon"),
    row(azimuthIcon(sun.az_deg), `${deg(sun.az_deg, 0)} ${compassPoint(sun.az_deg)}`, "azimuth (from north)"),
    row(visibleIcon(sun.vis_frac, "sun"), pct(sun.vis_frac * 100), `of the disk ${terrainSub(it)}`),
    row(fluxIcon(sun.flux_frac), wm2(fluxN), `on a Sun-facing panel · ${wm2(fluxH)} on flat ground`),
  ].join("");
  const foot = it.look ? `<div class="mcard-foot">${nextEventText(it, it.look.sun_vis, "sun")}</div>` : "";
  return wrapCard(it, `${cardHead(it, whenInstant(it))}<div class="mrows">${rows}</div>${foot}`);
}

function earthInstantCard(it) {
  const e = it.state0.earth;
  const rows = [
    row(elevationIcon(e.el_deg), deg(e.el_deg), "elevation above the flat horizon"),
    row(azimuthIcon(e.az_deg), `${deg(e.az_deg, 0)} ${compassPoint(e.az_deg)}`, "azimuth (from north)"),
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
  const lit = pctAbove(se.sun_vis);
  const el = stats(se.sun_el);
  const flux = stats(fluxMode === "horiz" ? se.flux_horiz_wm2 : se.flux_normal_wm2);
  const rows = [
    row(ringIcon(lit), pct(lit), "of the stay with sunlight"),
    row(elevationIcon(el.max), `${deg(el.min)} to ${deg(el.max)}`, "Sun elevation, lowest to highest"),
    row(fluxIcon(flux.mean / S0), wm2(flux.mean), fluxMode === "horiz" ? "average on flat ground" : "average on a Sun-facing panel"),
  ].join("");
  return wrapCard(it, `${cardHead(it, whenMission(it))}<div class="mrows">${rows}</div><div class="mcard-foot">${missionEvent(it, se.sun_vis, "sun")}</div>`);
}

function earthMissionCard(it) {
  const se = it.series;
  const vis = pctAbove(se.earth_vis);
  const el = stats(se.earth_el);
  const ph = stats(se.earth_phase);
  const rows = [
    row(ringIcon(vis), pct(vis), "of the stay with Earth in view"),
    row(elevationIcon(el.max), `${deg(el.min)} to ${deg(el.max)}`, "Earth elevation, lowest to highest"),
    row(phaseIcon(ph.mean), `${pct(ph.min * 100)} to ${pct(ph.max * 100)}`, "of Earth's disk lit (phase)"),
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
    { id: "sun-vis", title: "Visible Sun", help: "How much of the Sun's disk clears the terrain. 100% = full sunlight." },
    { id: "sun-flux", title: "Sunlight power", help: "Solar power reaching a panel, in W/m².", toggle: true },
  ],
  earth: [
    { id: "earth-el", wide: true, title: "Earth elevation", help: "Height above the flat, ideal horizon. Dotted: the real terrain horizon in that direction. From the near side, Earth barely moves." },
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
        <div class="chart-head"><h3>${c.title}</h3><p>${c.help}</p>${c.toggle ? fluxToggle() : ""}</div>
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
      title: { text: xaxis === "utc" ? "UTC" : `Time since start (${unitName})`, font: { size: 12, color: th.muted } },
      type: xaxis === "utc" ? "date" : "linear",
      gridcolor: th.grid, linecolor: th.axis, zeroline: false, tickfont: { color: th.muted }, showspikes: false,
    },
    yaxis: {
      title: { text: yTitle, font: { size: 12, color: th.muted } },
      gridcolor: th.grid, linecolor: th.axis, zerolinecolor: th.axis, zerolinewidth: 1.5, tickfont: { color: th.muted }, ...yExtra,
    },
  });
  const config = { displaylogo: false, responsive: true, displayModeBar: window.matchMedia?.("(pointer: coarse)").matches ? false : "hover", modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toggleSpikelines"] };

  const line = (it, y, extra = {}) => ({
    type: "scatter",
    mode: "lines",
    x: xValues(it.series.t_ms, it.t0, xaxis, unitMs),
    y,
    name: it.label,
    legendgroup: it.s.id,
    line: { color: it.color, width: 2, dash: it.dash ? "dash" : "solid", shape: "linear" },
    ...extra,
  });
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

  const missions = items.filter((it) => it.series);
  const instants = items.filter((it) => !it.series);

  const traces = (fnLine, fnInstant) => [...missions.flatMap(fnLine), ...instants.map(fnInstant).filter(Boolean)];

  const sunEl = traces(
    (it) => {
      const tr = [line(it, it.series.sun_el, { hovertemplate: "%{y:.1f}°" })];
      if (it.horizon) {
        tr.push(line(it, it.series.sun_az.map((az) => horizonElAt(it.horizon, az)), {
          name: `${it.label}: ${it.horizon.approximate ? "approximate terrain (coarse)" : "terrain horizon"}`, showlegend: false, opacity: 0.85,
          line: { color: it.color, width: 1.5, dash: "dot" }, hovertemplate: "terrain %{y:.1f}°",
        }));
      }
      return tr;
    },
    (it) => instantMarker(it, it.state0.sun.el_deg, deg(it.state0.sun.el_deg)),
  );
  Plotly.react("chart-sun-el", sunEl, layoutBase("Elevation (°)", { ticksuffix: "°" }), config);

  Plotly.react(
    "chart-sun-vis",
    traces(
      (it) => [line(it, it.series.sun_vis.map((v) => v * 100), { hovertemplate: "%{y:.0f}%" })],
      (it) => instantMarker(it, it.state0.sun.vis_frac * 100, `${Math.round(it.state0.sun.vis_frac * 100)}%`),
    ),
    layoutBase("Visible disk (%)", { range: [-5, 105], ticksuffix: "%" }),
    config,
  );

  const fluxKey = fluxMode === "horiz" ? "flux_horiz_wm2" : "flux_normal_wm2";
  Plotly.react(
    "chart-sun-flux",
    traces(
      (it) => [line(it, it.series[fluxKey], { hovertemplate: "%{y:.0f} W/m²" })],
      (it) => {
        const f = sunFlux(it.state0.sun);
        const v = fluxMode === "horiz" ? f.horiz : f.normal;
        return instantMarker(it, v, `${Math.round(v)} W/m²`);
      },
    ),
    layoutBase(fluxMode === "horiz" ? "Flat ground (W/m²)" : "Sun-facing panel (W/m²)", { rangemode: "tozero" }),
    config,
  );

  const earthEl = traces(
    (it) => {
      const tr = [line(it, it.series.earth_el, { hovertemplate: "%{y:.1f}°" })];
      if (it.horizon) {
        tr.push(line(it, it.series.earth_az.map((az) => horizonElAt(it.horizon, az)), {
          name: `${it.label}: ${it.horizon.approximate ? "approximate terrain (coarse)" : "terrain horizon"}`, showlegend: false, opacity: 0.85,
          line: { color: it.color, width: 1.5, dash: "dot" }, hovertemplate: "terrain %{y:.1f}°",
        }));
      }
      return tr;
    },
    (it) => instantMarker(it, it.state0.earth.el_deg, deg(it.state0.earth.el_deg)),
  );
  Plotly.react("chart-earth-el", earthEl, layoutBase("Elevation (°)", { ticksuffix: "°" }), config);

  Plotly.react(
    "chart-earth-vis",
    traces(
      (it) => [line(it, it.series.earth_vis.map((v) => v * 100), { hovertemplate: "%{y:.0f}%" })],
      (it) => instantMarker(it, it.state0.earth.vis_frac * 100, `${Math.round(it.state0.earth.vis_frac * 100)}%`),
    ),
    layoutBase("Visible disk (%)", { range: [-5, 105], ticksuffix: "%" }),
    config,
  );

  Plotly.react(
    "chart-earth-phase",
    traces(
      (it) => [line(it, it.series.earth_phase.map((v) => v * 100), { hovertemplate: "%{y:.0f}% lit" })],
      (it) => instantMarker(it, it.state0.earth.phase_frac * 100, `${Math.round(it.state0.earth.phase_frac * 100)}% lit`),
    ),
    layoutBase("Lit fraction (%)", { range: [-5, 105], ticksuffix: "%" }),
    config,
  );
}
