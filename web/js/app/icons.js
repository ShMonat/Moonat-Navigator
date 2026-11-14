// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Tiny inline SVG glyphs that make the metric cards self-explanatory. Colours come from CSS classes (theme-aware).

const f = (x) => (Math.round(x * 100) / 100).toString();

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
