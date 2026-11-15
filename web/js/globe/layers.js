// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The Moon globe's optional map layers (contract C8b): NASA's permanently shadowed regions and the most sunlit ground,
// both from the PGDA polar illumination maps (web/data/overlays/overlays.json, built by
// scripts/data/build_map_layers.py). Pure helpers with no DOM and no three.js: the layer list with its colours and
// wording, the link format, and the pole to show. Tests: web/tests/globe_layers.test.mjs.

/** Latitude (deg) poleward of which the layers have data (both poles). */
export const LAYER_LIMIT_LAT = 80;

/** Share-of-time thresholds of the sunlight classes (= overlays.json layers[sun].thresholds). */
export const LIT_THRESHOLDS = [0.7, 0.8];

const SOURCE = "NASA LOLA / PGDA, Mazarico et al. 2011";

/**
 * The layers, in panel order. `swatches`: [CSS colour, legend text] for the panel; `rgb`: the colours the globe's
 * shader blends over the ground (0..1, sRGB), with `alpha` the blend weight. Blue for shadow and yellow-orange for
 * sunlight read on the grey Moon and stay apart for the common colour-vision deficiencies.
 */
export const LAYERS = [
  {
    id: "psr",
    label: "Permanently shadowed regions",
    note: "Ground the Sun never reaches directly, poleward of 80°.",
    source: SOURCE,
    swatches: [["#4452ff", "Never in direct sunlight"]],
    rgb: { psr: [0.27, 0.32, 1.0] },
    alpha: { psr: 0.78 },
  },
  {
    id: "sun",
    label: "Most sunlit (lit ≥ 70 % of the time)",
    note: "Lit: some of the Sun in view, at ground level, averaged over 18.6 years. No ground is lit all the time: the best ridges here are lit 89–93 % of the time.",
    source: SOURCE,
    swatches: [
      ["#ff9a1f", "Lit 70–80 % of the time"],
      ["#ffe14d", "Lit 80 % of the time or more"],
    ],
    rgb: { low: [1.0, 0.6, 0.12], high: [1.0, 0.88, 0.3] },
    alpha: { low: 0.78, high: 0.92 },
  },
];

export const LAYER_IDS = LAYERS.map((l) => l.id);

/** Known layer ids from any list, without repeats, in panel order. */
export function normalizeLayers(list) {
  const set = new Set(Array.isArray(list) ? list : []);
  return LAYER_IDS.filter((id) => set.has(id));
}

/** The link value of a layer list ("psr.sun"; "" for none). A dot, since a comma is escaped in a URL. */
export function formatLayers(list) {
  return normalizeLayers(list).join(".");
}

/** A link value ("psr.sun"; commas work too) as a layer list; unknown words are dropped. */
export function parseLayers(str) {
  return normalizeLayers(String(str ?? "").split(/[.,\s]+/));
}

/** The list with layer `id` turned on or off. */
export function setLayer(list, id, on) {
  const rest = normalizeLayers(list).filter((x) => x !== id);
  return normalizeLayers(on ? [...rest, id] : rest);
}

/**
 * The pole to show when a layer is turned on away from the poles: the north pole when the view looks at the northern
 * hemisphere (view direction z > 0.2, i.e. its centre is north of about 11.5° N), else the south pole, where the
 * landing candidates are. dir: unit vector of the view centre in MOON_ME.
 */
export function poleFor(dir) {
  return Array.isArray(dir) && dir[2] > 0.2 ? "north" : "south";
}

/** Latitude, longitude (deg) and zoom of the view that shows a pole's whole layer area (poleward of 80°). */
export const POLE_VIEW = {
  south: { lat: -90, lon: 0, zoom: 5 },
  north: { lat: 90, lon: 0, zoom: 5 },
};

/** Points (deg) that sample a pole's layer area: the pole and rings at 85° and 81°, every 45°. */
export function capSamples(pole) {
  const s = pole === "north" ? 1 : -1;
  const out = [{ lat: 90 * s, lon: 0 }];
  for (const lat of [85, 81]) for (let lon = -180; lon < 180; lon += 45) out.push({ lat: lat * s, lon });
  return out;
}
