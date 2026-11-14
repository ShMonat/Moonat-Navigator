// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Route card of a rover traverse scenario (advanced mode): start and end (typed or picked on the globe), rover preset
// (VIPER-class / Apollo LRV / custom speed and slope limits), optional stops, start and end time, the "Plan route"
// button with progress, and the result: distance, driving time, a hillshade map with the path and the end points,
// and the elevation and slope profiles.

import { store, updateScenario, removeScenario, duplicateScenario, setScenarios, setActive, addScenario, activeScenario } from "../app/store.js";
import { colorHex, parseUtc, isoUtc, toUtcText, formatDuration, formatUtc, validateScenario } from "../app/state.js";
import { physicsCoverage } from "../app/physics_adapter.js";
import { planRoute, routeKey, onRouteProgress, RouteError, MAX_ROUTE_KM, routeTrack } from "./index.js";
import { greatCircle } from "./terrain.js";
import { PRESETS } from "./presets.js";
import { newRouteFields, routeRequest } from "./app.js";
import { registerRouteCard, startPick, cancelPick, pickState, onPickChange } from "./pick.js";

const drafts = new Map(); // scenario id -> draft of the planning inputs (not yet planned)
const unregister = new Map(); // scenario id -> unregister its pick handlers

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}
const fmtNum = (v, d = 5) => (v === null || v === undefined || !Number.isFinite(+v) ? "" : String(+(+v).toFixed(d)));
const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

/** Add a new traverse scenario: start at the selected scenario's place (if any), then pick on the globe. */
export function addRouteScenario() {
  const src = activeScenario();
  const s = addScenario({
    label: "Rover traverse",
    lat_deg: src?.lat_deg ?? null,
    lon_deg: src?.lon_deg ?? null,
    t_start_utc: src?.t_start_utc || null,
    t_end_utc: null,
    route: newRouteFields("viper"),
  });
  startPick(s.id, "start");
  document.getElementById("map-block")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return s;
}

function draftOf(s) {
  if (!drafts.has(s.id)) {
    const r = s.route || newRouteFields();
    drafts.set(s.id, {
      start_lat: s.lat_deg, start_lon: s.lon_deg, end_lat: r.end_lat_deg, end_lon: r.end_lon_deg,
      preset: r.preset in PRESETS ? r.preset : "custom", speed: r.speed_mps, slope: r.max_slope_deg, cross: r.max_cross_deg,
      stop_km: r.stop_every_km || "", stop_h: r.stop_h || "",
    });
  }
  return drafts.get(s.id);
}

/** Problems with a draft (messages), empty when it can be planned. */
function draftProblems(d) {
  const out = [];
  const pt = (la, lo, name) => {
    if (!Number.isFinite(num(la)) || !Number.isFinite(num(lo))) out.push(`Set the ${name} point (type it or pick it on the globe).`);
    else if (Math.abs(num(la)) > 90 || Math.abs(num(lo)) > 180) out.push(`The ${name} point is outside −90..90° latitude or −180..180° longitude.`);
  };
  pt(d.start_lat, d.start_lon, "start");
  pt(d.end_lat, d.end_lon, "end");
  if (!out.length) {
    const km = greatCircle({ lat_deg: num(d.start_lat), lon_deg: num(d.start_lon) }, { lat_deg: num(d.end_lat), lon_deg: num(d.end_lon) }).dist_m / 1000;
    if (km > MAX_ROUTE_KM) out.push(`The points are ${km.toFixed(1)} km apart. Please keep a traverse under ${MAX_ROUTE_KM} km (straight line).`);
  }
  if (!(num(d.speed) > 0 && num(d.speed) <= 20)) out.push("Speed must be between 0 and 20 m/s.");
  if (!(num(d.slope) >= 1 && num(d.slope) <= 45)) out.push("Max slope must be between 1° and 45°.");
  if (!(num(d.cross) >= 1 && num(d.cross) <= 45)) out.push("Max cross slope must be between 1° and 45°.");
  return out;
}

/** True when the draft differs from what the scenario last planned. */
function draftDirty(s, d) {
  const r = s.route || {};
  const same = (a, b) => (Number.isFinite(num(a)) ? num(a) : null) === (Number.isFinite(num(b)) ? num(b) : null);
  return !(same(d.start_lat, s.lat_deg) && same(d.start_lon, s.lon_deg) && same(d.end_lat, r.end_lat_deg) && same(d.end_lon, r.end_lon_deg)
    && same(d.speed, r.speed_mps) && same(d.slope, r.max_slope_deg) && same(d.cross, r.max_cross_deg)
    && same(d.stop_km || 0, r.stop_every_km || 0) && same(d.stop_h || 0, r.stop_h || 0) && (d.preset === r.preset || (d.preset === "custom" && !(r.preset in PRESETS))));
}

/** Commit the draft to the scenario (this plans the route). */
function commit(s, d) {
  const route = {
    end_lat_deg: num(d.end_lat), end_lon_deg: num(d.end_lon), preset: d.preset,
    speed_mps: num(d.speed), max_slope_deg: num(d.slope), max_cross_deg: num(d.cross),
    stop_every_km: Math.max(0, num(d.stop_km) || 0), stop_h: Math.max(0, num(d.stop_h) || 0),
  };
  updateScenario(s.id, { lat_deg: num(d.start_lat), lon_deg: num(d.start_lon), route, site_id: null }, "field");
}

/**
 * Build the card of a traverse scenario (called by the scenario list for scenarios with a `route`).
 * @param {object} s      C7 scenario with `route`
 * @param {number} index  position in the list
 */
export function buildRouteCard(s, index) {
  unregister.get(s.id)?.();
  const d = draftOf(s);
  const card = el("article", { class: "scen route-card", "data-id": s.id, "aria-label": `Scenario ${index + 1}: rover traverse` });
  card.style.setProperty("--c", colorHex(s.color, store.theme));
  card.addEventListener("focusin", () => setActive(s.id));
  card.addEventListener("pointerdown", () => setActive(s.id));

  const label = el("input", { class: "scen-label", value: s.label || "", placeholder: "Rover traverse", "aria-label": "Scenario name", maxlength: "80" });
  label.addEventListener("input", () => updateScenario(s.id, { label: label.value }, "label"));
  const dup = el("button", { class: "icon-btn", title: "Duplicate", "aria-label": "Duplicate scenario", text: "⧉", onclick: () => duplicateScenario(s.id) });
  const rm = el("button", {
    class: "icon-btn", title: "Remove", "aria-label": "Remove scenario", text: "✕",
    onclick: () => (store.scenarios.length > 1 ? removeScenario(s.id) : setScenarios([{}])),
  });
  card.append(el("div", { class: "scen-head" }, el("span", { class: "swatch", "aria-hidden": "true" }), label, dup, rm));
  card.append(el("p", { class: "route-badge", text: "Rover traverse · advanced" }));

  // End points.
  const inputs = {};
  const numIn = (key, ph, aria) => {
    const i = el("input", { type: "number", step: "any", inputmode: "decimal", placeholder: ph, "aria-label": aria, value: fmtNum(d[key]) });
    i.addEventListener("input", () => {
      d[key] = i.value === "" ? null : Number(i.value);
      refresh();
    });
    inputs[key] = i;
    return i;
  };
  const ptRow = (which, tag) => el("div", { class: "route-pt" },
    el("span", { class: `route-pt-tag ${which}`, text: tag }),
    el("label", { class: "field" }, el("span", { text: "Lat (° N +)" }), numIn(`${which}_lat`, "e.g. −89.44", `${tag} latitude`)),
    el("label", { class: "field" }, el("span", { text: "Lon (° E +)" }), numIn(`${which}_lon`, "e.g. −137.19", `${tag} longitude`)));
  const pickBtn = el("button", { type: "button", class: "ghost route-pick", text: "📍 Pick start and end on the globe" });
  pickBtn.addEventListener("click", () => {
    if (pickState()?.id === s.id) cancelPick();
    else {
      setActive(s.id);
      startPick(s.id, "start");
      document.getElementById("map-block")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
  card.append(el("div", { class: "route-pts" }, ptRow("start", "Start"), ptRow("end", "End"), pickBtn));

  // Rover.
  const presetSel = el("select", { "aria-label": "Rover preset" },
    ...Object.values(PRESETS).map((p) => el("option", { value: p.id, text: p.label })),
    el("option", { value: "custom", text: "Custom" }));
  presetSel.value = d.preset;
  const roverNum = (key, text, ph) => {
    const i = el("input", { type: "number", step: "any", min: "0", inputmode: "decimal", placeholder: ph, value: fmtNum(d[key], 3) });
    i.addEventListener("input", () => {
      d[key] = i.value;
      d.preset = "custom";
      presetSel.value = "custom";
      refresh();
    });
    inputs[key] = i;
    return el("label", { class: "field" }, el("span", { text }), i);
  };
  const note = el("p", { class: "route-note" });
  presetSel.addEventListener("change", () => {
    d.preset = presetSel.value;
    const p = PRESETS[d.preset];
    if (p) {
      d.speed = p.speed_mps; d.slope = p.max_slope_deg; d.cross = p.max_cross_deg;
      inputs.speed.value = fmtNum(d.speed, 3); inputs.slope.value = fmtNum(d.slope, 3); inputs.cross.value = fmtNum(d.cross, 3);
    }
    refresh();
  });
  card.append(el("div", { class: "fields route-rover" },
    el("label", { class: "field route-preset" }, el("span", { text: "Rover" }), presetSel),
    roverNum("speed", "Speed (m/s)", "0.2"), roverNum("slope", "Max slope (°)", "15"), roverNum("cross", "Max cross slope (°)", "15")));
  card.append(note);

  // Stops.
  const stopIn = (key, ph, aria) => {
    const i = el("input", { type: "number", step: "any", min: "0", inputmode: "decimal", placeholder: ph, "aria-label": aria, value: d[key] ? fmtNum(d[key], 3) : "" });
    i.addEventListener("input", () => {
      d[key] = i.value;
      refresh();
    });
    return i;
  };
  card.append(el("div", { class: "route-stops" },
    el("span", { text: "Stop every" }), stopIn("stop_km", "–", "Stop every N km"), el("span", { text: "km for" }),
    stopIn("stop_h", "–", "Stop duration in hours"), el("span", { text: "h (optional)" })));

  // Times (UTC).
  const timeIn = (key, ph) => {
    const ms = s[key] ? parseUtc(s[key]) : NaN;
    const i = el("input", { type: "text", class: "utc-input", name: key, autocomplete: "off", spellcheck: "false", placeholder: ph, value: Number.isFinite(ms) ? toUtcText(ms) : "" });
    const commitTime = () => {
      const t = i.value.trim() ? parseUtc(i.value) : NaN;
      const val = i.value.trim() ? (Number.isFinite(t) ? isoUtc(t) : i.value) : null;
      if (val !== s[key]) updateScenario(s.id, { [key]: val });
      refresh();
    };
    i.addEventListener("change", commitTime);
    i.addEventListener("input", commitTime);
    i.addEventListener("blur", () => {
      const t = parseUtc(i.value);
      if (Number.isFinite(t)) i.value = toUtcText(t);
    });
    return i;
  };
  card.append(el("div", { class: "fields times" },
    el("label", { class: "field" }, el("span", { text: "Start (UTC)" }), timeIn("t_start_utc", "YYYY-MM-DD hh:mm:ss")),
    el("label", { class: "field" }, el("span", { text: "End (UTC, optional)" }), timeIn("t_end_utc", "on arrival"))));

  // Plan button, progress and result.
  const planBtn = el("button", { type: "button", class: "route-plan", text: "Plan route" });
  const status = el("span", { class: "route-status", role: "status" });
  const bar = el("div", { class: "route-bar" }, el("div", { class: "route-bar-fill" }));
  bar.hidden = true;
  const msg = el("p", { class: "scen-msg", role: "alert", hidden: true });
  const result = el("div", { class: "route-result", hidden: true });
  card.append(el("div", { class: "route-actions" }, planBtn, status), bar, msg, result);

  planBtn.addEventListener("click", () => {
    const probs = draftProblems(d);
    if (probs.length) return refresh();
    cancelPick();
    commit(s, d);
    showResult();
  });

  // Picking on the globe fills the draft, then plans.
  unregister.set(s.id, registerRouteCard(s.id, {
    onPoint: (which, lat, lon) => {
      d[`${which}_lat`] = Math.round(lat * 1e4) / 1e4;
      d[`${which}_lon`] = Math.round(lon * 1e4) / 1e4;
      inputs[`${which}_lat`].value = fmtNum(d[`${which}_lat`]);
      inputs[`${which}_lon`].value = fmtNum(d[`${which}_lon`]);
      refresh();
    },
    onDone: () => {
      if (!draftProblems(d).length) {
        commit(s, d);
        showResult();
      }
    },
  }));

  let seq = 0;
  function showResult() {
    const my = ++seq;
    const req = routeRequest(store.scenarios.find((x) => x.id === s.id) || s);
    if (!req.complete) {
      result.hidden = true;
      return refresh();
    }
    const key = routeKey(req.start, req.end, req.rover);
    planError = "";
    bar.hidden = false;
    status.textContent = "Fetching NASA terrain…";
    const stop = onRouteProgress(key, (stage, frac) => {
      if (my !== seq) return;
      const base = { terrain: 0, plan: 0.25, horizons: 0.3 }[stage] ?? 0;
      const w = { terrain: 0.25, plan: 0.05, horizons: 0.7 }[stage] ?? 0;
      bar.firstChild.style.width = `${Math.round(100 * (base + w * frac))}%`;
      status.textContent = stage === "terrain" ? "Fetching NASA terrain (LOLA, Moon Trek)…" : stage === "plan" ? "Finding the fastest drivable path…" : `Tracing the horizon along the route… ${Math.round(frac * 100)}%`;
    });
    planRoute(req.start, req.end, req.rover).then((r) => {
      stop();
      if (my !== seq) return;
      bar.hidden = true;
      status.textContent = "";
      renderResult(result, r, store.scenarios.find((x) => x.id === s.id) || s);
      result.hidden = false;
      refresh();
    }).catch((err) => {
      stop();
      if (my !== seq) return;
      bar.hidden = true;
      result.hidden = true;
      status.textContent = "";
      planError = err instanceof RouteError || err.code ? err.message : `Planning failed: ${err.message || err}`;
      refresh();
    });
  }

  function refresh() {
    if (!card.isConnected && card.dataset.built) return;
    const p = PRESETS[d.preset];
    note.textContent = p ? p.note : "Custom rover: your own speed and slope limits.";
    const probs = draftProblems(d);
    const planned = !!(s.route && Number.isFinite(s.route.end_lat_deg) && Number.isFinite(s.lat_deg));
    const dirty = draftDirty(s, d) || !planned;
    planBtn.disabled = probs.length > 0 || !dirty;
    planBtn.textContent = planned && dirty ? "Plan again" : "Plan route";
    const v = validateScenario(s, physicsCoverage());
    const typed = d.start_lat !== null || d.end_lat !== null;
    const errs = [...(planError ? [planError] : []), ...(dirty && typed ? probs.slice(0, 1) : []), ...Object.values(v.errors)];
    if (!errs.length && planned && !s.t_start_utc) errs.push("Set a start time (UTC): the rover leaves the start then.");
    msg.textContent = errs[0] || "";
    msg.hidden = !errs.length;
    msg.classList.toggle("warn", !planError && !Object.keys(v.errors).length && !(dirty && typed && probs.length));
    const pk = pickState();
    if (pk?.id === s.id) status.textContent = pk.step === "start" ? "Click the start on the globe…" : "Now click the end…";
    else if (planned && dirty) status.textContent = "Inputs changed: press Plan again.";
    else if (bar.hidden) status.textContent = "";
    pickBtn.textContent = pk?.id === s.id ? "Cancel picking" : "📍 Pick start and end on the globe";
  }
  let planError = "";
  unregister.set(s.id, ((u, v) => () => { u(); v(); })(unregister.get(s.id), onPickChange(refresh)));

  refresh();
  card.dataset.built = "1";
  if (s.route && Number.isFinite(s.route.end_lat_deg) && Number.isFinite(s.lat_deg)) showResult();
  return card;
}

// ---------------------------------------------------------------------------------------------
// Result: stats, hillshade map with the path, profiles.

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function renderResult(box, r, s) {
  const st = r.stats;
  const req = routeRequest(s);
  const track = routeTrack(r, req.stops);
  const km = (m) => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
  const stopsTxt = track.timeline.stops ? ` + ${track.timeline.stops} stop${track.timeline.stops > 1 ? "s" : ""} (${formatDuration(track.arrival_ms - st.drive_s * 1000)})` : "";
  const t0 = parseUtc(s.t_start_utc);
  const arrive = Number.isFinite(t0) ? ` · arrives ${formatUtc(t0 + track.arrival_ms)}` : "";
  box.replaceChildren(
    el("div", { class: "route-stats" },
      stat(km(st.length_m), `driven (straight line ${km(st.straight_m)})`),
      stat(formatDuration(st.drive_s * 1000), `driving${stopsTxt}`),
      stat(`${st.mean_speed_mps < 1 ? st.mean_speed_mps.toFixed(2) : st.mean_speed_mps.toFixed(1)} m/s`, "average speed"),
      stat(`${st.max_along_deg.toFixed(1)}°`, `steepest climb or descent · cross slope ≤ ${st.max_cross_deg.toFixed(1)}°`),
      stat(`+${Math.round(st.climb_m)} / −${Math.round(st.descent_m)} m`, "total climb / descent")),
    el("p", { class: "route-arrive muted", text: `${arrive.replace(/^ · /, "")}${arrive ? " · " : ""}terrain: LOLA ${Math.round(r.meta.fine_cell_m)} m grid (NASA Moon Trek)` }),
  );
  const canvas = el("canvas", { class: "route-map", role: "img", "aria-label": "Route map: shaded relief with the planned path" });
  box.append(canvas);
  box.append(el("p", { class: "route-legend" },
    el("span", { class: "lg-path" }), "planned path ",
    el("span", { class: "lg-steep" }), ` steeper than ${r.rover.max_slope_deg}° (no-go) `,
    el("span", { class: "lg-start", text: "S" }), " start ", el("span", { class: "lg-end", text: "E" }), " end"));
  box.append(profile(r, "elev"), profile(r, "slope"));
  requestAnimationFrame(() => drawMap(canvas, r, colorHex(s.color, store.theme)));
}

function stat(value, label) {
  return el("div", { class: "route-stat" }, el("b", { text: value }), el("span", { text: label }));
}

/** Hillshade crop around the path with the path, the end points, a scale bar and a north arrow. */
function drawMap(canvas, r, color) {
  const P = r.path, pv = r.preview;
  let x0 = Math.min(...P.x), x1 = Math.max(...P.x), y0 = Math.min(...P.y), y1 = Math.max(...P.y);
  const pad = Math.max(0.18 * Math.max(x1 - x0, y1 - y0), 800);
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  // Canvas shape follows the route (between 0.6 and 1.1 of the width tall).
  const W = canvas.clientWidth || 340, H = Math.round(W * Math.min(1.1, Math.max(0.6, (y1 - y0) / (x1 - x0))));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  // Match the canvas aspect.
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let w = x1 - x0, h = y1 - y0;
  if (w / h > W / H) h = (w * H) / W; else w = (h * W) / H;
  // Keep the crop inside the terrain grid when it fits (no empty margins).
  const clamp = (c, half, lo, hi) => (hi - lo >= 2 * half ? Math.min(hi - half, Math.max(lo + half, c)) : (lo + hi) / 2);
  const ccx = clamp(cx, w / 2, pv.x0, pv.x1), ccy = clamp(cy, h / 2, pv.y0, pv.y1);
  x0 = ccx - w / 2; x1 = ccx + w / 2; y0 = ccy - h / 2; y1 = ccy + h / 2;
  const sx = (x) => ((x - x0) / (x1 - x0)) * W, sy = (y) => ((y1 - y) / (y1 - y0)) * H;

  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, W, H);
  const img = new ImageData(pv.rgba, pv.width, pv.height);
  const off = document.createElement("canvas");
  off.width = pv.width;
  off.height = pv.height;
  off.getContext("2d").putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, sx(pv.x0), sy(pv.y1), sx(pv.x1) - sx(pv.x0), sy(pv.y0) - sy(pv.y1));

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const line = (width, style) => {
    ctx.beginPath();
    P.x.forEach((x, i) => (i ? ctx.lineTo(sx(x), sy(P.y[i])) : ctx.moveTo(sx(x), sy(P.y[i]))));
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.stroke();
  };
  line(5, "rgba(0,0,0,0.75)");
  line(2.6, color);
  const marker = (x, y, text, fill) => {
    ctx.beginPath();
    ctx.arc(sx(x), sy(y), 8, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, sx(x), sy(y) + 0.5);
  };
  marker(P.x[0], P.y[0], "S", "#1a8f5a");
  marker(P.x.at(-1), P.y.at(-1), "E", "#c0392b");

  // Scale bar (1-2-5 km) and north arrow (+y of the local plane = north at the route centre).
  const target = (x1 - x0) / 4;
  const nice = [100, 200, 500, 1000, 2000, 5000, 10000, 20000].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  const len = (nice / (x1 - x0)) * W;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(8, H - 26, len + 16, 20);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(16, H - 12); ctx.lineTo(16 + len, H - 12);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 16 + len / 2, H - 13);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(W - 26, 6, 20, 30);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(W - 16, 10); ctx.lineTo(W - 21, 22); ctx.lineTo(W - 11, 22);
  ctx.fill();
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("N", W - 16, 33);
}

/** Small SVG profile against distance: "elev" (m above the 1737.4 km sphere) or "slope" (along-track, deg). */
function profile(r, kind) {
  const P = r.path;
  const d = P.dist_m.map((x) => x / 1000);
  const y = kind === "elev" ? P.elev_m : P.along_deg;
  const W = 340, H = 92, L = 40, R = 8, T = 16, B = 20;
  let lo = Math.min(...y), hi = Math.max(...y);
  if (kind === "slope") {
    const m = Math.max(r.rover.max_slope_deg, Math.ceil(Math.max(Math.abs(lo), Math.abs(hi))));
    lo = -m; hi = m;
  } else if (hi - lo < 20) {
    const c = (hi + lo) / 2;
    lo = c - 10; hi = c + 10;
  }
  const dMax = Math.max(1e-6, d[d.length - 1]);
  const X = (v) => L + (v / dMax) * (W - L - R), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const pts = d.map((v, i) => `${X(v).toFixed(1)},${Y(y[i]).toFixed(1)}`).join(" ");
  const fmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Math.round(v)));
  const title = kind === "elev" ? "Elevation (m, above the 1737.4 km sphere)" : `Slope along the path (°, + uphill) · limit ±${r.rover.max_slope_deg}°`;
  const limits = kind === "slope"
    ? `<line x1="${L}" x2="${W - R}" y1="${Y(r.rover.max_slope_deg)}" y2="${Y(r.rover.max_slope_deg)}" class="pf-limit"/>
       <line x1="${L}" x2="${W - R}" y1="${Y(-r.rover.max_slope_deg)}" y2="${Y(-r.rover.max_slope_deg)}" class="pf-limit"/>
       <line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" class="pf-zero"/>`
    : "";
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="route-profile" role="img" aria-label="${title}">
    <text x="${L}" y="11" class="pf-title">${title}</text>
    <line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" class="pf-axis"/><line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="pf-axis"/>
    ${limits}
    <polyline points="${pts}" class="pf-line"/>
    <text x="${L - 4}" y="${T + 4}" class="pf-tick" text-anchor="end">${fmt(hi)}</text>
    <text x="${L - 4}" y="${H - B}" class="pf-tick" text-anchor="end">${fmt(lo)}</text>
    <text x="${L}" y="${H - 6}" class="pf-tick">0</text>
    <text x="${W - R}" y="${H - 6}" class="pf-tick" text-anchor="end">${dMax.toFixed(dMax < 10 ? 2 : 1)} km</text>
  </svg>`;
  const wrap = el("div", { class: "route-profile-wrap" });
  wrap.innerHTML = svg;
  return wrap;
}
