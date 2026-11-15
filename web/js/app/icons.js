// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Inline SVG icons. UI_ICONS: the interface's small line icons (buttons, labels, notes), one stroke style in
// currentColor, 1em square, aria-hidden, so they follow the text colour in both themes (no emoji pictographs, which
// phones draw as colour emoji). Below them: the metric cards' glyphs, coloured by CSS classes (theme-aware).

const f = (x) => (Math.round(x * 100) / 100).toString();

/** SVG bodies (24 × 24 viewBox, stroke = currentColor, width 2, round caps) of the interface icons. */
const PATHS = {
  // A crosshair: keep a body framed.
  follow: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  // A rover seen from the side: body, mast with a camera head, three wheels.
  rover: '<path d="M3.5 9.5h17v5h-17z"/><path d="M8 9.5V5.5h4"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="12" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  // A globe: the limb, a meridian and the equator.
  earth: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c-4.4 4.6-4.4 12.4 0 17M12 3.5c4.4 4.6 4.4 12.4 0 17"/>',
  // The Sun's disk with the Earth's disk over most of it.
  eclipse: '<circle cx="10" cy="12" r="7"/><circle cx="14.5" cy="12" r="7" fill="currentColor" stroke="none" opacity="0.55"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  // A four-point sparkle: suggested dates.
  suggest: '<path d="M12 3c.8 4.6 2.4 6.2 7 7-4.6.8-6.2 2.4-7 7-.8-4.6-2.4-6.2-7-7 4.6-.8 6.2-2.4 7-7z"/><path d="M19 15.5v4M17 17.5h4"/>',
  warning: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/>',
  // Shrinking corners: the full-screen control.
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  // A wheel: rover distances.
  wheel: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.2"/><path d="M12 4v5.8M12 14.2V20M4 12h5.8M14.2 12H20"/>',
  // A pin: a picked place.
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  // A flag on a pole: a trip's end.
  flag: '<path d="M6 21V4"/><path d="M6 4.5h11l-2.5 4 2.5 4H6"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none"/>',
  // The Earth's disk coming up over the skyline.
  earthrise: '<path d="M2.5 18.5h19"/><path d="M6.5 18.5a5.5 5.5 0 0 1 11 0"/><path d="M12 3.5v6M9.5 6 12 3.5 14.5 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  play: '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  // Travel modes of a rover trip: a VIPER-class rover (body, mast, three wheels), the Apollo LRV (open chassis, seats,
  // dish, two wheels) and custom limits (sliders).
  viper: '<rect x="4.5" y="9" width="14" height="5.5" rx="1.4"/><path d="M15.5 9V4.5M13.6 4.3h3.8"/><circle cx="7" cy="17.6" r="1.9"/><circle cx="11.5" cy="17.6" r="1.9"/><circle cx="16" cy="17.6" r="1.9"/>',
  lrv: '<path d="M2.5 13.5h19M8 13.5V9.5h3M13.5 13.5V9.5h3M19 9.2a2.6 2.6 0 0 0-3.6 0"/><circle cx="6" cy="16.6" r="2.4"/><circle cx="18" cy="16.6" r="2.4"/>',
  sliders: '<path d="M4 6h3M11 6h9M4 12h9M17 12h3M4 18h2M10 18h10"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  // Two opposite arrows: swap a trip's start and end.
  swap: '<path d="M8 19V5M4.5 8.5 8 5l3.5 3.5M16 5v14M12.5 15.5 16 19l3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  up: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
  // A house: the home base.
  home: '<path d="M4 11.5 12 4.5l8 7"/><path d="M6.5 10v9.5h11V10"/><path d="M10 19.5v-5h4v5"/>',
  // A clock face: "the sky now" (a live story).
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2.2"/>',
  // AI mode: a crescent Moon with a small four-point spark beside it.
  ai: '<path d="M13.2 4.6a7.6 7.6 0 1 0 6.2 10.6 6 6 0 0 1-6.2-10.6z"/><path d="M18.3 2.8c.35 1.9 1 2.55 2.9 2.9-1.9.35-2.55 1-2.9 2.9-.35-1.9-1-2.55-2.9-2.9 1.9-.35 2.55-1 2.9-2.9z"/>',
};

/**
 * The sunlit-spot marker of the globe's sunlight layer (globe.js SPOT_FRAG) as an SVG string, for the map legend: a
 * disc of radius 3 and eight rays from 4.5 to 8.2 px, 1.5 px wide, in `color`, on a dark edge 1.3 px wider, 19 px
 * across at 1:1. aria-hidden.
 */
export function sunSpotIcon(color, size = 17) {
  const rays = (r0, r1) => Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return `M${(r0 * c).toFixed(2)} ${(r0 * s).toFixed(2)}L${(r1 * c).toFixed(2)} ${(r1 * s).toFixed(2)}`;
  }).join("");
  return `<svg class="sun-spot-ico" viewBox="-9.6 -9.6 19.2 19.2" width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
    `<g fill="rgba(10,10,18,0.85)" stroke="rgba(10,10,18,0.85)"><circle r="4.3" stroke="none"/><path d="${rays(3.2, 9.5)}" stroke-width="4.1"/></g>` +
    `<g fill="${color}" stroke="${color}"><circle r="3" stroke="none"/><path d="${rays(4.5, 8.2)}" stroke-width="1.5"/></g></svg>`;
}

/** Names of the interface icons. */
export const ICON_NAMES = Object.freeze(Object.keys(PATHS));

/**
 * One interface icon as an SVG string: `name` from ICON_NAMES, 1em square, currentColor, aria-hidden. `cls` adds CSS
 * classes. An unknown name gives "".
 */
export function icon(name, cls = "") {
  const body = PATHS[name];
  if (!body) return "";
  return `<svg class="ico-svg${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** One interface icon as an element: `<span class="ico">` holding icon(name), for code that builds the DOM. */
export function iconNode(name) {
  const s = document.createElement("span");
  s.className = "ico";
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = icon(name);
  return s;
}

/** Fill every empty `[data-icon]` element under `root` with its icon (static HTML names its icons this way). */
export function fillIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon);
    el.setAttribute("aria-hidden", "true");
  }
}

/** Elevation: a quarter-circle gauge with a dot at the elevation angle (negative angles dip below the ground line). */
export function elevationIcon(elDeg) {
  const r = 12;
  const cx = 3;
  const cy = 22;
  const a = Math.max(-30, Math.min(90, elDeg)) * (Math.PI / 180);
  const x = cx + r * Math.cos(a);
  const y = cy - r * Math.sin(a);
  return `<svg viewBox="0 0 30 30" aria-hidden="true">
    <path class="ico-faint" d="M${cx} ${cy - r} A${r} ${r} 0 0 1 ${cx + r} ${cy}"/>
    <path class="ico-stroke" d="M1 ${cy}H28"/>
    <path class="ico-stroke" d="M${cx} ${cy}L${f(x)} ${f(y)}" stroke-dasharray="2 2"/>
    <circle class="ico-dot" cx="${f(x)}" cy="${f(y)}" r="3.2"/>
  </svg>`;
}

/** Azimuth: a compass ring with N marked and a needle toward the azimuth. */
export function azimuthIcon(azDeg) {
  const a = (azDeg * Math.PI) / 180;
  const c = 15;
  const r = 10;
  const x = c + r * Math.sin(a);
  const y = c - r * Math.cos(a);
  return `<svg viewBox="0 0 30 30" aria-hidden="true">
    <circle class="ico-faint" cx="${c}" cy="${c}" r="12"/>
    <text x="${c}" y="5.2" text-anchor="middle" font-size="5.5" fill="currentColor" opacity="0.7">N</text>
    <path class="ico-stroke" d="M${c} ${c}L${f(x)} ${f(y)}"/>
    <circle class="ico-dot" cx="${f(x)}" cy="${f(y)}" r="3"/>
  </svg>`;
}

/** Visible fraction: a disk with the hidden part under a ground band (fraction 0..1). */
export function visibleIcon(frac, body = "sun") {
  const r = 10;
  const cx = 15;
  // Place the ground line so the visible area fraction matches (inverse of the segment formula, by bisection).
  let lo = -1;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const d = (lo + hi) / 2;
    const v = 1 - (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI;
    if (v < frac) lo = d;
    else hi = d;
  }
  const d = (lo + hi) / 2;
  const cy = 16 - d * r; // disk centre; the ground line is at y = 16
  const id = "cl" + Math.random().toString(36).slice(2, 8);
  const cls = body === "sun" ? "ico-sun" : "ico-earth-lit";
  return `<svg viewBox="0 0 30 30" aria-hidden="true">
    <defs><clipPath id="${id}"><rect x="0" y="0" width="30" height="16"/></clipPath></defs>
    <circle class="ico-faint" cx="${cx}" cy="${f(cy)}" r="${r}"/>
    <circle class="${cls}" cx="${cx}" cy="${f(cy)}" r="${r}" clip-path="url(#${id})"/>
    <path class="ico-ground" d="M0 16 L6 14.5 L11 16.2 L18 13.8 L24 15.6 L30 15 V30 H0Z"/>
    <path class="ico-stroke" d="M0 16 L6 14.5 L11 16.2 L18 13.8 L24 15.6 L30 15"/>
  </svg>`;
}

/** Earth phase: a disk lit by `frac` (0..1) from the right. */
export function phaseIcon(frac) {
  const r = 11;
  const c = 15;
  const k = Math.max(0, Math.min(1, frac));
  const ex = Math.abs(2 * k - 1) * r;
  const sweep = k > 0.5 ? 0 : 1;
  const lit =
    k <= 0.001
      ? ""
      : k >= 0.999
        ? `<circle class="ico-earth-lit" cx="${c}" cy="${c}" r="${r}"/>`
        : `<path class="ico-earth-lit" d="M${c} ${c - r} A${r} ${r} 0 0 1 ${c} ${c + r} A${f(ex)} ${r} 0 0 ${sweep} ${c} ${c - r}Z"/>`;
  return `<svg viewBox="0 0 30 30" aria-hidden="true"><circle class="ico-earth-dark" cx="${c}" cy="${c}" r="${r}"/>${lit}</svg>`;
}

/** Sunlight power: a small panel with rays; ray count grows with the flux fraction (0..1). */
export function fluxIcon(frac) {
  const n = Math.max(0, Math.min(3, Math.round(frac * 3)));
  const rays = [
    "M8 3 L12 9",
    "M15 2 L15 9",
    "M22 3 L18 9",
  ].slice(0, n).map((d) => `<path d="${d}" stroke="var(--sun)" stroke-width="1.8" stroke-linecap="round"/>`).join("");
  return `<svg viewBox="0 0 30 30" aria-hidden="true">${rays}
    <path class="ico-stroke" d="M5 22 L10 12 H25 L20 22 Z"/>
    <path class="ico-faint" d="M7.5 17 H22.5 M12.5 12 L10 22 M17.5 12 L15 22"/>
    <path class="ico-stroke" d="M15 22 V27"/>
  </svg>`;
}

/** Duration: a small clock. */
export function clockIcon() {
  return `<svg viewBox="0 0 30 30" aria-hidden="true"><circle class="ico-stroke" cx="15" cy="15" r="10"/><path class="ico-stroke" d="M15 9 V15 L19 18"/></svg>`;
}

/** Fraction of time: a donut ring filled to pct (0..100). */
export function ringIcon(pct) {
  const r = 10;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct || 0)) / 100;
  return `<svg viewBox="0 0 30 30" aria-hidden="true">
    <circle cx="15" cy="15" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="4"/>
    <circle cx="15" cy="15" r="${r}" fill="none" stroke="var(--c)" stroke-width="4" stroke-dasharray="${f(p * c)} ${f(c)}" transform="rotate(-90 15 15)"/>
  </svg>`;
}
