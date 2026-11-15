// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The map's "how to use" hint: a small "i" button at the end of the legend row under the globe (index.html #map-info)
// with the hint in a popover (#map-hint-pop). A click or tap toggles it and keeps it open; a mouse hover and keyboard
// focus show it while they last; Esc, a press elsewhere, or a second click closes it. The popover is placed above the
// button (below it when there is no room), inside the window.

const GAP = 8;

/** Wire the hint popover (main.js calls this once, at start). */
export function initMapHint() {
  const btn = document.getElementById("map-info");
  const pop = document.getElementById("map-hint-pop");
  if (!btn || !pop) return;
  let pinned = false;

  const place = () => {
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    pop.style.maxWidth = `${Math.min(340, vw - 2 * GAP)}px`;
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.max(GAP, Math.min(r.left + r.width / 2 - w / 2, vw - GAP - w));
    let top = r.top - h - GAP;
    if (top < GAP) top = Math.min(r.bottom + GAP, vh - GAP - h);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  };
  const show = () => {
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    btn.classList.add("open");
    place();
  };
  const hide = () => {
    pinned = false;
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    btn.classList.remove("open");
  };

  btn.addEventListener("click", () => {
    if (pinned) hide();
    else {
      pinned = true;
      show();
    }
  });
  btn.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse" && pop.hidden) show();
  });
  btn.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && !pinned && !btn.matches(":focus-visible")) hide();
  });
  btn.addEventListener("focus", () => {
    if (btn.matches(":focus-visible") && pop.hidden) show();
  });
  btn.addEventListener("blur", hide);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) {
      e.stopPropagation();
      hide();
    }
  }, true);
  document.addEventListener("pointerdown", (e) => {
    if (!pop.hidden && !btn.contains(e.target) && !pop.contains(e.target)) hide();
  });
  // The popover is fixed to the window: it follows the button when the page or the left column scrolls.
  const follow = () => {
    if (!pop.hidden) place();
  };
  window.addEventListener("scroll", follow, { passive: true, capture: true });
  window.addEventListener("resize", follow);
}
