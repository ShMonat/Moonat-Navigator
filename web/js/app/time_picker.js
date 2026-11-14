// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Date and time picker of the scenario cards' Start and End fields (UTC): a month calendar with month and year jumps
// (days outside the ephemeris coverage are disabled), hour and minute selectors (24-hour clock), Now and Clear, and
// "✨ Suggested for this place" (the suggested-dates engine, contract C11). It opens under the field on wide screens
// and as a sheet at the bottom of the screen on phones. Typing in the field still works: the picker follows the text.
// The picker writes the field's text and fires its "input" and "change" events, so the card's own parsing commits it.

import { parseUtc, toUtcText, formatUtc, formatDuration, describeYears, coverageEnd, DAY_MS } from "./state.js";
import { SUGGEST_KINDS, suggestIcon } from "./suggest_adapter.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** Below this width the picker is a sheet at the bottom of the screen. */
const SHEET_QUERY = "(max-width: 600px)";
/** Suggested dates are searched over this span from the shown month (C11 default: two years). */
const SUGGEST_SPAN_MS = 2 * 365.25 * DAY_MS;

let open = null; // the open picker (one at a time)

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

const pad = (n) => String(n).padStart(2, "0");
const dayOf = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;
const ymOf = (ms) => {
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
};

/** Is a picker open? (The card list does not rebuild its focus while one is.) */
export function pickerOpen() {
  return !!open;
}

/** Close the open picker, if any. */
export function closeTimePicker(focusInput = false) {
  if (open) open.close(focusInput);
}

/**
 * Give a UTC text field a date-and-time picker.
 * @param {HTMLInputElement} input   the field (text "YYYY-MM-DD hh:mm:ss", parsed by state.js parseUtc)
 * @param {object} opts
 *   title       "Start (UTC)" | "End (UTC)", the picker's heading
 *   coverage()  -> covered years (the ephemeris tables)
 *   emptyText   what an empty field means ("No start yet", "No end: a single instant")
 *   limits()    -> { min, max, note } (optional): days outside min..max (epoch ms) are disabled, `note` says why
 *               (the End: after the start, inside the start's run of covered years)
 *   rangeStart() -> epoch ms (optional): the start, marked in the End's calendar with the span up to the end
 *   defaultTime() -> epoch ms (optional): the time of day a first date gets (the End: the start's)
 *   suggest     (optional) { place() -> label | null, durationMs() -> ms | undefined,
 *                run({from, to, durationMs, signal, onProgress}) -> Promise<C11 list>, pick(suggestion) }
 * @returns {{ button: HTMLButtonElement, open(focusGrid), close() }} `button` (📅) goes next to the field.
 */
export function attachTimePicker(input, opts) {
  const button = el("button", {
    type: "button", class: "tp-btn", "aria-label": `Open the calendar: ${opts.title}`, title: "Calendar and suggested dates",
    "aria-haspopup": "dialog", "aria-expanded": "false",
  });
  button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4"/></svg>';
  input.setAttribute("aria-haspopup", "dialog");
  input.setAttribute("aria-expanded", "false");
  let typing = false; // the phone sheet's "Type instead": the next focus is for the keyboard
  const api = {
    button,
    open: (focusGrid = false) => openPicker(input, button, opts, focusGrid),
    close: () => {
      if (open?.input === input) open.close(false);
    },
  };
  // Touch on a phone: a tap opens the sheet without the on-screen keyboard (it would cover the sheet), so the field is
  // read-only for that tap; "Type instead" in the sheet gives the keyboard.
  input.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" && sheetMode() && !typing) input.readOnly = true;
  });
  input.addEventListener("click", () => {
    if (typing) return;
    if (open?.input !== input) api.open(false);
  });
  input.addEventListener("blur", () => {
    typing = false;
    input.readOnly = false;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || (e.key === "F4" && !e.altKey)) {
      e.preventDefault();
      if (open?.input === input) open.focusGrid();
      else api.open(true);
    } else if (e.key === "Escape" && open?.input === input) {
      e.preventDefault();
      e.stopPropagation();
      open.close(true);
    } else if (e.key === "Tab" && open?.input === input) {
      // Tab from the field goes into the open picker (it lives at the end of the page); Shift+Tab closes it.
      if (e.shiftKey || open.sheet) open.close(false);
      else {
        e.preventDefault();
        open.focusFirst();
      }
    }
  });
  input.addEventListener("input", () => {
    if (open?.input === input) open.syncFromInput();
  });
  button.addEventListener("click", () => {
    if (open?.input === input) open.close(true);
    else api.open(true);
  });
  input._typeInstead = () => {
    typing = true;
    input.readOnly = false;
    input.focus();
  };
  return api;
}

function sheetMode() {
  return typeof window !== "undefined" && window.matchMedia(SHEET_QUERY).matches;
}

function openPicker(input, button, opts, focusGrid) {
  if (open) open.close(false);
  const years = [...new Set(opts.coverage() || [])].sort((a, b) => a - b);
  const covered = (y) => !years.length || years.includes(y);
  const sheet = sheetMode();
  const st = {
    input, button, sheet, opts, years,
    value: parseUtc(input.value),
    view: null,
    cursor: null,
    time: { h: 0, m: 0, s: 0 },
    sg: null, // suggestions: { from, to, abort, list, byDay }
  };

  // Time of day for picks: the field's, else the default (the End: the start's), else 00:00.
  const setTimeFrom = (ms) => {
    if (!Number.isFinite(ms)) return;
    const d = new Date(ms);
    st.time = { h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds() };
  };
  if (Number.isFinite(st.value)) setTimeFrom(st.value);
  else if (opts.defaultTime) setTimeFrom(opts.defaultTime());

  /** A shown month inside the coverage: the field's, else the start's (End), else today's, else the first covered. */
  const startView = () => {
    const cands = [st.value, opts.rangeStart?.(), Date.now()].filter(Number.isFinite);
    for (const ms of cands) if (covered(ymOf(ms).y)) return ymOf(ms);
    return { y: years[0] ?? new Date().getUTCFullYear(), m: 0 };
  };
  st.view = startView();
  st.cursor = Number.isFinite(st.value) && covered(ymOf(st.value).y) ? dayOf(st.value) : Date.UTC(st.view.y, st.view.m, 1);
  if (!Number.isFinite(st.value)) {
    const today = dayOf(Date.now());
    const t = ymOf(today);
    if (t.y === st.view.y && t.m === st.view.m) st.cursor = today;
    const rs = opts.rangeStart?.();
    if (Number.isFinite(rs) && ymOf(rs).y === st.view.y && ymOf(rs).m === st.view.m) st.cursor = dayOf(rs);
  }

  // ---- DOM
  const titleId = `tp-t-${Math.random().toString(36).slice(2, 8)}`;
  const root = el("div", { class: `tp-pop${sheet ? " tp-sheet" : ""}`, role: "dialog", "aria-labelledby": titleId });
  const valueText = el("span", { class: "tp-value" });
  const close = el("button", { type: "button", class: "icon-btn tp-close", "aria-label": "Close", text: "✕" });
  const head = el("div", { class: "tp-head" }, el("div", { class: "tp-title" }, el("strong", { id: titleId, text: opts.title }), valueText), close);
  if (sheet) {
    const typeBtn = el("button", { type: "button", class: "link-btn tp-type", text: "⌨ Type instead" });
    typeBtn.addEventListener("click", () => {
      api.close(false);
      input._typeInstead?.();
    });
    head.querySelector(".tp-title").append(typeBtn);
  }

  const prev = el("button", { type: "button", class: "icon-btn tp-prev", "aria-label": "Previous month", text: "‹" });
  const next = el("button", { type: "button", class: "icon-btn tp-next", "aria-label": "Next month", text: "›" });
  const monthSel = el("select", { class: "tp-month", "aria-label": "Month" }, ...MONTHS.map((m, i) => el("option", { value: String(i), text: m })));
  const yearSel = el("select", { class: "tp-year", "aria-label": "Year (the years the sky tables cover)" });
  for (const run of yearRuns(years)) {
    const g = el("optgroup", { label: run[0] < 2000 ? `${run[0]}–${run.at(-1)}: Apollo era` : `${run[0]}–${run.at(-1)}: today and next` });
    for (const y of run) g.append(el("option", { value: String(y), text: String(y) }));
    yearSel.append(g);
  }
  const nav = el("div", { class: "tp-nav" }, prev, monthSel, yearSel, next);
  const week = el("div", { class: "tp-week", "aria-hidden": "true" }, ...WEEKDAYS.map((w) => el("span", { text: w })));
  const grid = el("div", { class: "tp-grid", role: "group" });

  const hourSel = el("select", { class: "tp-h", "aria-label": "Hour (UTC, 24-hour clock)" },
    ...Array.from({ length: 24 }, (_, h) => el("option", { value: String(h), text: pad(h) })));
  const minSel = el("select", { class: "tp-m", "aria-label": "Minute" },
    ...Array.from({ length: 60 }, (_, m) => el("option", { value: String(m), text: pad(m) })));
  const secText = el("span", { class: "tp-sec", "aria-label": "seconds" });
  const time = el("div", { class: "tp-time" }, el("span", { class: "tp-time-label", text: "Time (UTC)" }), hourSel, el("span", { class: "tp-colon", text: ":" }), minSel, secText);

  const nowBtn = el("button", { type: "button", class: "ghost tp-now", text: "Now" });
  const clearBtn = el("button", { type: "button", class: "ghost tp-clear", text: "Clear" });
  const doneBtn = el("button", { type: "button", class: "tp-done", text: "Done" });
  const actions = el("div", { class: "tp-actions" }, nowBtn, clearBtn, el("span", { class: "tp-gap" }), doneBtn);
  const hint = el("p", { class: "tp-hint" });
  const calPane = el("div", { class: "tp-cal" }, nav, week, grid, time, actions, hint);

  const body = el("div", { class: "tp-body" }, calPane);
  let sgPane = null;
  if (opts.suggest) {
    sgPane = el("section", { class: "tp-sg", "aria-label": "Suggested dates for this place" });
    body.append(sgPane);
  }
  root.append(head, body);

  let backdrop = null;
  if (sheet) {
    backdrop = el("div", { class: "tp-backdrop" });
    backdrop.addEventListener("click", () => api.close(false));
    document.body.append(backdrop);
  }
  document.body.append(root);

  // ---- rendering
  const limits = () => opts.limits?.() || {};
  const dayDisabled = (ms) => {
    const { min, max } = limits();
    if (!covered(ymOf(ms).y)) return "outside the sky tables";
    if (Number.isFinite(min) && ms + DAY_MS <= min) return "before the start";
    if (Number.isFinite(max) && ms > max) return "past the start's run of sky tables";
    return "";
  };

  function renderHead() {
    valueText.textContent = Number.isFinite(st.value) ? formatUtc(st.value, { seconds: true }) : opts.emptyText || "Not set";
  }

  function renderGrid() {
    const { y, m } = st.view;
    monthSel.value = String(m);
    if (![...yearSel.options].some((o) => o.value === String(y))) yearSel.append(el("option", { value: String(y), text: String(y) }));
    yearSel.value = String(y);
    grid.setAttribute("aria-label", `${MONTHS[m]} ${y}`);
    prev.disabled = !stepMonth(-1, true);
    next.disabled = !stepMonth(1, true);
    const first = Date.UTC(y, m, 1);
    const lead = (new Date(first).getUTCDay() + 6) % 7; // Monday first
    const nDays = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const selDay = Number.isFinite(st.value) ? dayOf(st.value) : NaN;
    const today = dayOf(Date.now());
    const rs = opts.rangeStart?.();
    const rsDay = Number.isFinite(rs) ? dayOf(rs) : NaN;
    // Keep the cursor in the shown month.
    if (ymOf(st.cursor).y !== y || ymOf(st.cursor).m !== m) {
      st.cursor = Number.isFinite(selDay) && ymOf(selDay).y === y && ymOf(selDay).m === m ? selDay : first;
    }
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(el("span", { class: "tp-pad", "aria-hidden": "true" }));
    for (let d = 1; d <= nDays; d++) {
      const ms = Date.UTC(y, m, d);
      const off = dayDisabled(ms);
      const wd = (lead + d - 1) % 7;
      const sg = st.sg?.byDay?.get(ms);
      const label = `${WEEKDAY_NAMES[wd]} ${d} ${MONTHS[m]} ${y}${off ? ` (${off})` : ""}${sg ? `: suggested, ${[...new Set(sg.map((g) => g.title))].join("; ")}` : ""}`;
      const b = el("button", {
        type: "button", class: "tp-day", "data-ms": String(ms), tabindex: ms === st.cursor ? "0" : "-1", "aria-label": label,
        "aria-pressed": ms === selDay ? "true" : "false", "aria-disabled": off ? "true" : null,
        "aria-current": ms === today ? "date" : null, title: sg ? sg.map((g) => `${suggestIcon(g.kind)} ${g.title}`).join("\n") : (off ? `Not available: ${off}` : null),
      }, el("span", { text: String(d) }));
      if (Number.isFinite(rsDay) && Number.isFinite(selDay)) {
        if (ms === rsDay) b.classList.add("tp-range-start");
        else if (ms > rsDay && ms < selDay) b.classList.add("tp-in-range");
      } else if (ms === rsDay) b.classList.add("tp-range-start");
      if (sg) {
        b.classList.add("tp-has-sg");
        b.dataset.sg = sg[0].kind;
      }
      cells.push(b);
    }
    // A redraw (e.g. when the suggestions arrive) keeps the keyboard focus on its day.
    const focused = grid.contains(document.activeElement) ? document.activeElement.dataset.ms : null;
    grid.replaceChildren(...cells);
    if (focused) grid.querySelector(`[data-ms="${focused}"]`)?.focus();
    // Hint: the coverage, and why a typed date is not shown.
    const yv = Number.isFinite(st.value) ? ymOf(st.value).y : null;
    const outside = yv !== null && !covered(yv);
    hint.classList.toggle("bad", outside);
    hint.textContent = outside
      ? `${yv} is outside the sky tables. Pick a date in ${describeYears(years)}.`
      : `Sky tables: ${describeYears(years)}.${limits().note ? ` ${limits().note}` : ""}`;
  }

  function renderTime() {
    hourSel.value = String(st.time.h);
    minSel.value = String(st.time.m);
    secText.textContent = st.time.s ? `:${pad(st.time.s)}` : "";
  }

  /** The month `dir` months away, skipping years without tables; null at the ends of the coverage. */
  function stepMonth(dir, dry = false) {
    let { y, m } = st.view;
    m += dir;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    if (!covered(y)) {
      const later = years.filter((x) => (dir > 0 ? x > y : x < y));
      if (!later.length) return null;
      y = dir > 0 ? Math.min(...later) : Math.max(...later);
      m = dir > 0 ? 0 : 11;
    }
    if (!dry) setView({ y, m });
    return { y, m };
  }

  function setView(v, focusDay = false) {
    st.view = v;
    renderGrid();
    maybeResearch();
    if (focusDay) focusCursor();
  }

  function focusCursor() {
    const b = grid.querySelector(`[data-ms="${st.cursor}"]`);
    if (b) b.focus();
  }

  // ---- writing the field
  function commit(ms) {
    st.value = ms;
    input.value = Number.isFinite(ms) ? toUtcText(ms) : "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    renderHead();
    renderGrid();
  }

  function pickDay(ms) {
    if (dayDisabled(ms)) return;
    st.cursor = ms;
    commit(ms + ((st.time.h * 60 + st.time.m) * 60 + st.time.s) * 1000);
  }

  function setTime(h, m) {
    st.time = { h, m, s: 0 };
    renderTime();
    let day = Number.isFinite(st.value) ? dayOf(st.value) : st.cursor;
    if (dayDisabled(day)) return;
    commit(day + (h * 60 + m) * 60e3);
  }

  // ---- events
  grid.addEventListener("click", (e) => {
    const b = e.target.closest(".tp-day");
    if (!b || b.getAttribute("aria-disabled") === "true") return;
    pickDay(Number(b.dataset.ms));
    grid.querySelector(`[data-ms="${b.dataset.ms}"]`)?.focus();
  });
  grid.addEventListener("dblclick", (e) => {
    if (e.target.closest(".tp-day")?.getAttribute("aria-disabled") !== "true") api.close(true);
  });
  grid.addEventListener("keydown", (e) => {
    const b = e.target.closest(".tp-day");
    if (!b) return;
    const ms = Number(b.dataset.ms);
    let to = null;
    const d = new Date(ms);
    switch (e.key) {
      case "ArrowLeft": to = ms - DAY_MS; break;
      case "ArrowRight": to = ms + DAY_MS; break;
      case "ArrowUp": to = ms - 7 * DAY_MS; break;
      case "ArrowDown": to = ms + 7 * DAY_MS; break;
      case "Home": to = ms - ((d.getUTCDay() + 6) % 7) * DAY_MS; break;
      case "End": to = ms + (6 - ((d.getUTCDay() + 6) % 7)) * DAY_MS; break;
      case "PageUp": case "PageDown": {
        const k = (e.key === "PageUp" ? -1 : 1) * (e.shiftKey ? 12 : 1);
        const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1));
        const dd = Math.min(d.getUTCDate(), new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate());
        to = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), dd);
        break;
      }
      case "Enter": case " ":
        e.preventDefault();
        if (b.getAttribute("aria-disabled") !== "true") pickDay(ms);
        focusCursor();
        return;
      default: return;
    }
    e.preventDefault();
    if (!covered(ymOf(to).y)) return;
    st.cursor = to;
    const v = ymOf(to);
    if (v.y !== st.view.y || v.m !== st.view.m) setView(v, true);
    else {
      for (const x of grid.querySelectorAll(".tp-day")) x.tabIndex = Number(x.dataset.ms) === to ? 0 : -1;
      focusCursor();
    }
  });
  prev.addEventListener("click", () => stepMonth(-1));
  next.addEventListener("click", () => stepMonth(1));
  monthSel.addEventListener("change", () => setView({ y: st.view.y, m: Number(monthSel.value) }));
  yearSel.addEventListener("change", () => setView({ y: Number(yearSel.value), m: st.view.m }));
  hourSel.addEventListener("change", () => setTime(Number(hourSel.value), Number(minSel.value)));
  minSel.addEventListener("change", () => setTime(Number(hourSel.value), Number(minSel.value)));
  nowBtn.addEventListener("click", () => {
    const now = Math.floor(Date.now() / 60e3) * 60e3;
    st.time = { h: new Date(now).getUTCHours(), m: new Date(now).getUTCMinutes(), s: 0 };
    renderTime();
    st.cursor = dayOf(now);
    st.view = ymOf(now);
    commit(now);
    maybeResearch();
  });
  nowBtn.disabled = !covered(new Date().getUTCFullYear());
  if (nowBtn.disabled) nowBtn.title = "Today is outside the sky tables";
  clearBtn.addEventListener("click", () => {
    commit(NaN);
    api.close(true);
  });
  doneBtn.addEventListener("click", () => api.close(true));
  close.addEventListener("click", () => api.close(true));

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      api.close(true);
    } else if (e.key === "Tab") {
      // Keep Tab inside the picker (a dialog); Esc, Done or ✕ go back to the field.
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f.at(-1).focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    }
  });
  const focusables = () => [...root.querySelectorAll("button, select, [tabindex='0']")]
    .filter((x) => !x.disabled && x.offsetParent !== null && (!x.classList.contains("tp-day") || x.tabIndex === 0));

  // Close on a press outside the field, its button and the picker.
  const onDocDown = (e) => {
    const t = e.target;
    if (root.contains(t) || t === input || button.contains(t) || backdrop?.contains(t)) return;
    api.close(false);
  };
  // Follow the field when the page or the inputs column scrolls; close when the field leaves the screen.
  const onScroll = (e) => {
    if (sheet || (e.target instanceof Node && root.contains(e.target))) return;
    place();
  };
  const onResize = () => (sheetMode() !== sheet ? api.close(false) : place());
  document.addEventListener("pointerdown", onDocDown, true);
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);

  function place() {
    if (!input.isConnected) return api.close(false);
    if (sheet) return;
    const r = input.closest(".with-cal, .with-clear")?.getBoundingClientRect() || input.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return api.close(false);
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const w = Math.min(root.offsetWidth || 600, vw - 16);
    let left = Math.min(r.left - 2, vw - 8 - w);
    left = Math.max(8, left);
    const h = root.offsetHeight;
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    let top;
    if (h + 6 <= below || below >= above) {
      top = r.bottom + 6;
      root.style.maxHeight = `${Math.max(220, below - 6)}px`;
    } else {
      top = Math.max(8, r.top - 6 - Math.min(h, above));
      root.style.maxHeight = `${Math.max(220, above - 6)}px`;
    }
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  }

  // ---- suggested dates
  function sgRange(fromMs) {
    let from = dayOf(fromMs);
    const end = coverageEnd(from, years);
    return { from, to: Math.min(from + SUGGEST_SPAN_MS, end ?? Infinity) };
  }

  function firstFrom() {
    // From the field's day (the End: the start's), or today, inside the coverage.
    const cands = [opts.rangeStart?.(), st.value, Date.now()].filter(Number.isFinite);
    for (const ms of cands) if (coverageEnd(ms, years) !== null || !years.length) return ms;
    return Date.UTC(st.view.y, st.view.m, 1);
  }

  let sgTimer = 0;
  function maybeResearch() {
    if (!st.sg) return;
    const first = Date.UTC(st.view.y, st.view.m, 1);
    const last = Date.UTC(st.view.y, st.view.m + 1, 1);
    if (last > st.sg.from && first < st.sg.to) return; // the shown month is inside the searched span
    clearTimeout(sgTimer);
    sgTimer = setTimeout(() => runSuggest(first), 350);
  }

  async function runSuggest(fromMs) {
    if (!sgPane) return;
    st.sg?.abort.abort();
    const placeName = opts.suggest.place();
    if (!placeName) {
      st.sg = null;
      sgPane.replaceChildren(
        el("div", { class: "tp-sg-head" }, el("strong", { text: "✨ Suggested for this place" })),
        el("p", { class: "suggest-status", text: "Pick a place first: then the best dates for sunlight, Earth contact and eclipses show here." }),
      );
      return;
    }
    const { from, to } = sgRange(fromMs);
    const abort = new AbortController();
    st.sg = { from, to, abort, list: null, byDay: null };
    const durationMs = opts.suggest.durationMs?.();
    const sub = el("small", { text: `${formatUtc(from).split(",")[0]} to ${formatUtc(to).split(",")[0]}${durationMs ? ` · ${formatDuration(durationMs)} windows` : ""}` });
    const status = el("p", { class: "suggest-status", role: "status" }, el("span", { class: "spinner", "aria-hidden": "true" }), el("span", { text: "Searching…" }));
    const list = el("div", { class: "suggest-list" });
    sgPane.replaceChildren(el("div", { class: "tp-sg-head" }, el("strong", { text: `✨ Suggested for ${placeName}` }), sub), status, list);
    try {
      const progress = status.lastChild;
      const found = await opts.suggest.run({ from, to, durationMs, signal: abort.signal, onProgress: (f) => (progress.textContent = `Searching… ${Math.round(f * 100)}%`) });
      if (abort.signal.aborted || open !== api) return;
      st.sg.list = found;
      st.sg.byDay = new Map();
      for (const g of found) {
        if (g.note || !g.t_start_utc) continue;
        const k = dayOf(parseUtc(g.t_start_utc));
        if (!st.sg.byDay.has(k)) st.sg.byDay.set(k, []);
        st.sg.byDay.get(k).push(g);
      }
      status.hidden = !!found.length;
      status.textContent = found.length ? "" : "Nothing stands out in these dates. Try another year.";
      const nodes = [];
      for (const k of SUGGEST_KINDS) {
        const group = found.filter((g) => g.kind === k.kind);
        if (!group.length) continue;
        nodes.push(el("p", { class: "suggest-kind", text: `${k.icon} ${k.heading}` }));
        for (const g of group) nodes.push(suggestItem(g));
      }
      for (const g of found.filter((x) => !SUGGEST_KINDS.some((k) => k.kind === x.kind))) nodes.push(suggestItem(g));
      list.replaceChildren(...nodes);
      renderGrid();
      place();
    } catch (err) {
      if (abort.signal.aborted || err?.name === "AbortError" || open !== api) return;
      console.warn("[moonat] date suggestions failed", err);
      status.hidden = false;
      status.textContent = err?.name === "RangeError" ? "No sky tables for these dates: pick a month in a covered year."
        : "Suggestions are not available for this place right now.";
    }
  }

  /** One suggestion: a button that opens its window (a note is plain text). */
  function suggestItem(g) {
    const t0 = g.t_start_utc ? parseUtc(g.t_start_utc) : NaN;
    const t1 = g.t_end_utc ? parseUtc(g.t_end_utc) : NaN;
    let when = "";
    if (Number.isFinite(t0)) when = Number.isFinite(t1) && t1 > t0 ? `${formatUtc(t0)} · ${formatDuration(t1 - t0)}` : formatUtc(t0);
    const tip = [when, g.detail].filter(Boolean).join(" · ");
    // The title says what; the line under it when (two windows can share a title); the detail is in the tooltip.
    const text = el("span", { class: "si-text" }, el("b", { text: g.title || "Suggested dates" }),
      g.note && g.detail ? el("small", { class: "si-detail", text: g.detail }) : when ? el("small", { text: when }) : null);
    const icon = el("span", { class: "si-icon", "aria-hidden": "true", text: suggestIcon(g.kind) });
    if (g.note || !Number.isFinite(t0)) return el("div", { class: "suggest-item note" }, icon, text);
    const item = el("button", { type: "button", class: "suggest-item", title: tip }, icon, text);
    if (tip) item.setAttribute("aria-description", tip);
    item.addEventListener("click", () => {
      api.close(false);
      opts.suggest.pick(g);
    });
    return item;
  }

  // ---- open / close
  const api = {
    input,
    sheet,
    close(focusInput) {
      if (open !== api) return;
      open = null;
      st.sg?.abort.abort();
      clearTimeout(sgTimer);
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      root.remove();
      backdrop?.remove();
      document.documentElement.classList.remove("tp-sheet-open");
      input.readOnly = false;
      input.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-expanded", "false");
      if (focusInput && input.isConnected) {
        if (sheet) button.focus();
        else input.focus();
      }
    },
    focusGrid: () => focusCursor(),
    focusFirst: () => focusables()[0]?.focus(),
    syncFromInput() {
      const ms = parseUtc(input.value);
      st.value = ms;
      if (Number.isFinite(ms)) {
        setTimeFrom(ms);
        renderTime();
        if (covered(ymOf(ms).y)) {
          st.cursor = dayOf(ms);
          st.view = ymOf(ms);
        }
      }
      renderHead();
      renderGrid();
      maybeResearch();
    },
  };
  open = api;
  input.setAttribute("aria-expanded", "true");
  button.setAttribute("aria-expanded", "true");
  if (sheet) document.documentElement.classList.add("tp-sheet-open");
  renderHead();
  renderTime();
  renderGrid();
  place();
  if (opts.suggest) runSuggest(firstFrom());
  if (focusGrid || sheet) focusCursor();
  return api;
}

/** Covered years in runs of consecutive years: [[1966..1976], [2013..2040]]. */
function yearRuns(years) {
  const runs = [];
  for (const y of years) {
    const last = runs.at(-1);
    if (last && y === last.at(-1) + 1) last.push(y);
    else runs.push([y]);
  }
  return runs;
}
