// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Picking a trip's points on the Moon globe ("Choose on the globe"): a trip card arms a pick for one of its rows
// (the end, or a stop), and the next click on the globe, or the next place chosen in the globe's "Search the Moon"
// box, sets that point. The globe (web/js/app/map.js, places.js) offers every surface, site and pin click and every
// search choice to consumeMapClick() first; without an armed pick they do what they always do.
// Trip cards register their handler per scenario (registerRouteCard).

const cards = new Map(); // scenario id -> { onPoint(row, lat, lon) }
let pending = null; // { id, row, label }
let banner = null;

/** A trip card's pick handler: onPoint(row, lat, lon) when the armed row gets a point. Returns an unregister function. */
export function registerRouteCard(id, handlers) {
  cards.set(id, handlers);
  // A card rebuilt for the same scenario registers again and keeps an armed pick.
  return () => {
    if (cards.get(id) !== handlers) return;
    cards.delete(id);
    if (pending?.id === id) cancelPick();
  };
}

/**
 * Arm a pick: the next globe click sets row `row` (the waypoint index, 1 = the first point after the start) of trip
 * `id`. `label` names the point in the banner ("B, the end").
 */
export function startPick(id, row = 1, label = "the end") {
  pending = { id, row, label };
  showBanner();
}

export function cancelPick() {
  if (!pending) return;
  pending = null;
  showBanner();
}

export function pickState() {
  return pending ? { ...pending } : null;
}

/** Offer a globe click (lat, lon in deg). Returns true when an armed trip pick took it. */
export function consumeMapClick(lat, lon) {
  if (!pending) return false;
  const h = cards.get(pending.id);
  const { row } = pending;
  pending = null;
  showBanner();
  if (!h) return false;
  h.onPoint(row, lat, lon);
  return true;
}

const listeners = new Set();
/** Listen to pick state changes (armed, done, cancelled). Returns an unsubscribe function. */
export function onPickChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function showBanner() {
  for (const fn of listeners) fn(pending);
  if (typeof document === "undefined") return;
  const host = document.getElementById("map-block");
  if (!host) return;
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "rover-pick-banner";
    banner.setAttribute("role", "status");
    banner.innerHTML = '<span class="rover-pick-text"></span><button type="button" class="ghost rover-pick-cancel">Cancel</button>';
    banner.querySelector("button").addEventListener("click", cancelPick);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && pending) cancelPick();
    });
  }
  if (!pending) {
    banner.remove();
    host.classList.remove("rover-picking");
    return;
  }
  banner.querySelector(".rover-pick-text").textContent = `Click the Moon, or search it, to set ${pending.label}`;
  host.classList.add("rover-picking");
  if (!banner.isConnected) host.prepend(banner);
}
