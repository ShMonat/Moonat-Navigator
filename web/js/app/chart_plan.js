// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The plan of the data charts under the sky (compare.js draws them): which charts each choice of the Sun | Earth | Both
// switch shows, their titles and helper sentences (shown behind an "i" icon), and the colour rule of their lines.
// Pure data and functions, so the grouping and the colours are tested without a browser.

/** The switch's three values: "sun" and "earth" aim the views and pick the data; "both" shows both bodies' data. */
export const BODIES = Object.freeze(["sun", "earth", "both"]);

/** A switch value from anything (a link, a story): "sun" | "earth" | "both", "sun" when unknown. */
export function normBody(b) {
  return b === "earth" || b === "both" ? b : "sun";
}

export const FLUX_HELP = "Solar power reaching a panel, in W/m².";
export const FLUX_HELP_TILT = `${FLUX_HELP} Fixed tilt: the panel turns on a vertical mast to face the Sun, tilted at the stay's average Sun elevation while lit.`;

/**
 * The charts of each section, in page order. id: the chart's DOM id ("chart-<id>") and its helper's ("help-<id>");
 * bodies: the bodies it draws (two for a chart that shares a quantity); wide: full width; toggle: the panel
 * orientation buttons (Sunlight power). In "both" the charts that share a quantity (elevation, visible disk) hold both
 * bodies; the body-specific ones (Sunlight power, Earth phase) stay charts of their own.
 */
export const CHARTS = Object.freeze({
  sun: [
    { id: "sun-el", bodies: ["sun"], wide: true, title: "Sun elevation", help: "Height above the flat, ideal horizon. Dotted: the real terrain horizon in that direction. Above 0° does not guarantee sunlight." },
    { id: "sun-vis", bodies: ["sun"], title: "Visible Sun", help: "Share of the Sun's light that reaches the site (100% = the full Sun). Terrain and, during an eclipse, the Earth block part of it." },
    { id: "sun-flux", bodies: ["sun"], title: "Sunlight power", help: FLUX_HELP, toggle: true },
  ],
  earth: [
    { id: "earth-el", bodies: ["earth"], wide: true, title: "Earth elevation", help: "Height above the flat, ideal horizon. Dotted: the real terrain horizon in that direction." },
    { id: "earth-vis", bodies: ["earth"], title: "Visible Earth", help: "How much of Earth's disk clears the terrain: a proxy for direct radio contact." },
    { id: "earth-phase", bodies: ["earth"], title: "Earth phase", help: "How much of Earth's disk is sunlit, as seen from the Moon." },
  ],
  both: [
    { id: "both-el", bodies: ["sun", "earth"], wide: true, title: "Elevation", help: "Height of the Sun and the Earth above the flat, ideal horizon. Dotted: the real terrain horizon in each body's direction. Above 0° does not guarantee sunlight or a radio link." },
    { id: "both-vis", bodies: ["sun", "earth"], title: "Visible disk", help: "Sun: the share of its light that reaches the site (terrain and, during an eclipse, the Earth block part of it). Earth: how much of its disk clears the terrain, a proxy for direct radio contact." },
    { id: "both-flux", bodies: ["sun"], title: "Sunlight power", help: FLUX_HELP, toggle: true },
    { id: "both-phase", bodies: ["earth"], title: "Earth phase", help: "How much of Earth's disk is sunlit, as seen from the Moon." },
  ],
});

/** The charts shown for a switch value. */
export function chartsFor(body) {
  return CHARTS[normBody(body)];
}

/**
 * Line colours of the bodies with one scenario on screen, per theme: the Sun a clear red, the Earth blue (the page's
 * --earth). The red keeps clear of the eclipse colour (orange, #ffb27a) and the warning colour (--warn, amber).
 */
export const BODY_LINE = Object.freeze({
  dark: Object.freeze({ sun: "#ff6b6b", earth: "#5aa9ff" }),
  light: Object.freeze({ sun: "#e5484d", earth: "#1f6fd1" }),
});

/**
 * The colour and line style of one body's line (Plotly line.color and line.dash).
 * body: "sun" | "earth"; mode: "both" for the Both section, else "single"; multi: several scenarios on screen;
 * color: the scenario's colour; wrapped: the scenario's colour slot is a repeat (more scenarios than colours);
 * theme: "dark" | "light".
 * One scenario: the body's colour (the Sun red, the Earth blue), solid. Several scenarios: the scenario's colour; in
 * the Both section the line style tells the body (Sun solid, Earth dashed; a repeated colour slot dash-dotted), and
 * elsewhere a repeated slot is dashed, as on the rest of the page.
 */
export function lineStyle({ body, mode = "single", multi = false, color, wrapped = false, theme = "dark" }) {
  if (!multi) return { color: (BODY_LINE[theme] || BODY_LINE.dark)[body === "earth" ? "earth" : "sun"], dash: "solid" };
  if (mode !== "both") return { color, dash: wrapped ? "dash" : "solid" };
  if (body === "earth") return { color, dash: wrapped ? "longdashdot" : "dash" };
  return { color, dash: wrapped ? "dashdot" : "solid" };
}

/**
 * Legend entries that explain the line styles of a Both chart with several scenarios (empty traces in the legend):
 * [{ name, dash }]: "Solid: Sun" on a chart of both bodies, "Dashed: Earth" on any chart with Earth lines; [] when
 * the colours already tell the bodies (one scenario) or outside the Both section.
 */
export function styleKey({ bodies, mode = "single", multi = false }) {
  if (!multi || mode !== "both") return [];
  const out = [];
  if (bodies.length > 1) out.push({ name: "Solid: Sun", dash: "solid" });
  if (bodies.includes("earth")) out.push({ name: "Dashed: Earth", dash: "dash" });
  return out;
}
