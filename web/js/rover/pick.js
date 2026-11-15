// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Picking a trip's points on the Moon globe, as in Google Maps' directions: a trip card arms a pick for one of its
// rows (the start, a stop or the end): by default its first empty field, while it has one (until Cancel or Esc,
// dismissPick); the row whose field has the focus ("soft": it ends when the focus leaves for anything but the map);
// or the row that chose "Choose on the map". The next click on the globe, or the next place chosen in the globe's
// "Search the Moon" box, sets that point. The globe (web/js/app/map.js,
// places.js) offers every surface, site and pin click and every search choice to consumeMapClick() first; without an
// armed pick they do what they always do. A trip's start and end pins can also be dragged (dropTripPoint).
// Trip cards register their handler per scenario (registerRouteCard).

const cards = new Map(); // scenario id -> { onPoint(row, lat, lon) }
let pending = null; // { id, row, label, soft? }
let banner = null;
let downOnMap = null; // { t } when the last pointer down on the page was on the globe's block

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
 * Arm a pick: the next globe click sets row `row` (the waypoint index: 0 = the start, 1 = the first point after it)
 * of trip `id`. `label` names the point in the map banner ("the end point"). `soft`: armed by a focused field (the
 * field ends it when the focus leaves for anything but the map).
 */
export function startPick(id, row = 1, label = "the end", { soft = false } = {}) {
  pending = soft ? { id, row, label, soft: true } : { id, row, label };
  showBanner();
}

export function cancelPick() {
  if (!pending) return;
  pending = null;
  showBanner();
}

const dismissed = new Set(); // trip ids whose empty fields the user told to stop taking map clicks (Cancel, Esc)

/**
 * End the pick because the user asked (the banner's Cancel, Esc): that trip's empty fields stop taking map clicks
 * until the user turns back to the trip (undismiss: a field gets the focus, "Add stop", Trip switched on).
 */
export function dismissPick() {
  if (!pending) return;
  dismissed.add(pending.id);
  cancelPick();
}

/** True when the user dismissed trip `id`'s map pick (see dismissPick). */
export function isDismissed(id) {
  return dismissed.has(id);
}

/** Trip `id`'s empty fields may take map clicks again. */
export function undismiss(id) {
  dismissed.delete(id);
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

/**
 * A trip's start or end pin was dragged to lat, lon (deg): row 0 (the start) or -1 (the end, trip_edit.js END_ROW) of
 * trip `id` takes it. Returns true when a trip card took it.
 */
export function dropTripPoint(id, row, lat, lon) {
  const h = cards.get(id);
  if (!h) return false;
  h.onPoint(row, lat, lon);
  return true;
}

/**
 * True when a pointer went down on the globe's block in the last `withinMs` (a field that loses the focus to a press on
 * the map keeps its pick).
 */
export function pointerOnMap(withinMs = 1000) {
  return !!downOnMap && Date.now() - downOnMap.t <= withinMs;
}

const listeners = new Set();
/** Listen to pick state changes (armed, done, cancelled). Returns an unsubscribe function. */
export function onPickChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// On a wide screen a trip's fields can sit below the fold of the globe: while a point is being picked the globe is
// pinned under the site header ("map-pinned", rover.css), so the map is in reach of the field. It stays pinned after
// the pick, while the route is drawn there, until the page is scrolled with the wheel or a press lands outside the map
// and the trip fields.
function unpin() {
  if (!pending) document.getElementById("map-block")?.classList.remove("map-pinned");
}

if (typeof document !== "undefined") {
  // Capture phase: runs before the globe's handlers and before the focus moves.
  document.addEventListener("pointerdown", (e) => {
    const t = e.target;
    downOnMap = t?.closest?.("#map-block") ? { t: Date.now() } : null;
    if (!downOnMap && !t?.closest?.(".trip")) unpin();
  }, true);
  document.addEventListener("wheel", (e) => {
    if (!e.target?.closest?.("#map-block")) unpin();
  }, { capture: true, passive: true });
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
    banner.innerHTML = '<span class="rover-pick-text"></span><button type="button" class="rover-pick-cancel">Cancel</button>';
    banner.querySelector("button").addEventListener("click", dismissPick);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && pending) dismissPick();
    });
  }
  if (!pending) {
    banner.remove();
    host.classList.remove("rover-picking");
    return;
  }
  const tap = globalThis.matchMedia?.("(pointer: coarse)")?.matches;
  banner.querySelector(".rover-pick-text").textContent = `${tap ? "Tap" : "Click"} the map to set ${pending.label}`;
  host.classList.add("rover-picking", "map-pinned");
  if (!banner.isConnected) host.prepend(banner);
}
