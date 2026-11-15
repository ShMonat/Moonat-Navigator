// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// "i" info icons: a small button next to a title whose popover holds a helper sentence (chart descriptions, the data
// source under a sky view). The popover opens on hover (mouse, app.css), on click or tap, and with Enter or Space (the
// button is a real <button>); Esc, a second press or a click elsewhere closes it. Screen readers get the text as the
// button's description (aria-describedby). One delegated listener serves every tip on the page (initInfoTips).

import { icon } from "./icons.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let seq = 0;

/**
 * The markup of one info icon with its popover (HTML string).
 * text: the helper sentence (plain text, escaped here); id: the popover's id (default: a new one), so code can later
 * change the text with setInfoText; label: the button's accessible name; end: the popover opens toward the left (for
 * an icon at the right edge of its box).
 */
export function infoTip(text, { id = null, label = "More about this", end = false } = {}) {
  const pid = id || `info-${++seq}`;
  return `<span class="info-tip${end ? " end" : ""}"><button type="button" class="info-btn" aria-label="${esc(label)}" aria-expanded="false" aria-controls="${esc(pid)}" aria-describedby="${esc(pid)}">${icon("info")}</button><span class="info-pop" id="${esc(pid)}" role="tooltip">${esc(text)}</span></span>`;
}

/** Change the text of the info popover with this id (no-op when it is not on the page). */
export function setInfoText(id, text, doc = globalThis.document) {
  const el = doc?.getElementById(id);
  if (el && el.textContent !== text) el.textContent = text;
}

/** Open or close one tip (its wrapper .info-tip): the class "open" and the button's aria-expanded. */
export function setTipOpen(wrap, open) {
  wrap.classList.toggle("open", open);
  wrap.querySelector(".info-btn")?.setAttribute("aria-expanded", String(open));
}

/** Close every open tip except `keep`. */
function closeAll(doc, keep = null) {
  for (const w of doc.querySelectorAll(".info-tip.open")) if (w !== keep) setTipOpen(w, false);
}

let ready = false;

/** Install the one delegated listener for every info icon on the page (safe to call more than once). */
export function initInfoTips(doc = document) {
  if (ready) return;
  ready = true;
  doc.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".info-btn");
    if (!btn) {
      // A click inside an open popover (selecting its text) keeps it; anywhere else closes them all.
      if (!e.target.closest?.(".info-pop")) closeAll(doc);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const wrap = btn.closest(".info-tip");
    const open = !wrap.classList.contains("open");
    closeAll(doc, wrap);
    setTipOpen(wrap, open);
  });
  doc.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const wrap = doc.querySelector(".info-tip.open");
    if (!wrap) return;
    setTipOpen(wrap, false);
    wrap.querySelector(".info-btn")?.focus();
  });
}
