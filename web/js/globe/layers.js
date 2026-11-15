// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The Moon globe's optional map layers (contract C8b): NASA's permanently shadowed regions and the most sunlit ground,
// both from the PGDA polar illumination maps (web/data/overlays/overlays.json, built by
// scripts/data/build_map_layers.py), and the map style: the base map (Imagery, Elevation, Plain), the grid lines and the
// LOLA contour lines (web/data/basemaps/, scripts/data/build_base_maps.py). Pure helpers with no DOM and no three.js:
// the lists with their colours and wording, the link format (with the "noday" word of the day/night shading,
// daylight.js, and the style words "elev", "plain", "ct", "nogrid"), and the pole to show.
// Tests: web/tests/globe_layers.test.mjs, web/tests/globe_daylight.test.mjs, web/tests/globe_base_maps.test.mjs.

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

/**
 * Link word for the globe's day and night shading turned off (web/js/globe/daylight.js). The shading is on by default,
 * so a link only says when it is off: "ml=noday", "ml=psr.noday".
 */
export const NO_DAYLIGHT = "noday";

/**
 * The "ml" link value of the layers `list`, the day/night shading (`daylight`, default on) and the map `style`
 * ({ base, grid, contours }, normalizeStyle): "psr.sun.ct.elev.noday.nogrid". Only what differs from the default is
 * written, so the default map gives "" and links from before the style still read the same.
 */
export function formatMapLink(list, daylight = true, style = DEFAULT_STYLE) {
  const s = normalizeStyle(style);
  const base = BASE_MAPS.find((b) => b.id === s.base).word;
  return [formatLayers(list), s.contours ? CONTOURS_WORD : "", base, daylight ? "" : NO_DAYLIGHT, s.grid ? "" : NO_GRID]
    .filter(Boolean)
    .join(".");
}

/** Whether an "ml" link value (or none) keeps the day/night shading on: true unless it holds NO_DAYLIGHT. */
export function parseDaylight(str) {
  return !String(str ?? "").split(/[.,\s]+/).includes(NO_DAYLIGHT);
}

// ----- Base map and the grid and contour overlays -----

/**
 * The base maps, in panel order (a radio group, as on a web map); the first is the default. `word`: the link word
 * ("" for the default). Elevation and Plain are built from LOLA heights by scripts/data/build_base_maps.py
 * (web/data/basemaps/basemaps.json) and load on first use.
 */
export const BASE_MAPS = [
  {
    id: "imagery",
    label: "Imagery",
    note: "The Moon as photographed: LRO WAC mosaic, with LOLA relief at the poles.",
    source: "NASA LRO WAC (Moon Trek) and LOLA",
    word: "",
  },
  {
    id: "elevation",
    label: "Elevation",
    note: "Colour by height above the 1737.4 km reference sphere, with relief shading.",
    source: "NASA LRO LOLA (LDEM_16, LDEM_75S_240M)",
    word: "elev",
  },
  {
    id: "plain",
    label: "Plain",
    note: "Neutral grey with light relief shading, so the overlays stand out.",
    source: "NASA LRO LOLA (LDEM_16, LDEM_75S_240M)",
    word: "plain",
  },
];
export const BASE_IDS = BASE_MAPS.map((b) => b.id);

/** A known base map id, else the default ("imagery"). */
export function normalizeBase(id) {
  return BASE_IDS.includes(id) ? id : BASE_IDS[0];
}

/**
 * The Elevation colour ramp (= basemaps.json elevation.ramp): matplotlib "viridis", perceptually uniform and readable
 * with the common colour-vision deficiencies, from RANGE_KM[0] (dark violet) to RANGE_KM[1] (yellow); heights beyond
 * take the end colours. Heights are relative to the 1737.4 km reference sphere.
 */
export const ELEV_RAMP = {
  rangeKm: [-8, 8],
  stops: ["#440154", "#472d7b", "#3b528b", "#2c728e", "#21918c", "#28ae80", "#5ec962", "#addc30", "#fde725"],
};

/** Contour intervals (= basemaps.json contours): every 1 km (index lines every 5 km); poleward of 80°, 250 m (1 km). */
export const CONTOURS = {
  global: { intervalM: 1000, indexEvery: 5 },
  caps: { intervalM: 250, indexEvery: 4 },
  switchLatDeg: 80,
};

/** "1 km", "250 m": an interval in words. */
export function intervalText(m) {
  return m >= 1000 ? `${m / 1000} km` : `${m} m`;
}

/** The overlays that are not polar data layers: the lat/lon grid (on by default) and the contour lines (off). */
export const GRID_LAYER = {
  id: "grid",
  label: "Grid lines",
  note: "Latitude and longitude every 30°; near the poles every 10°, with rings at 80°, 85° and 88°.",
  source: "",
  swatches: [],
};
export const CONTOUR_LAYER = {
  id: "contours",
  label: "Contour lines",
  note:
    `Lines of equal height: every ${intervalText(CONTOURS.global.intervalM)} ` +
    `(bold every ${intervalText(CONTOURS.global.intervalM * CONTOURS.global.indexEvery)}); poleward of ` +
    `${CONTOURS.switchLatDeg}°, every ${intervalText(CONTOURS.caps.intervalM)} ` +
    `(bold every ${intervalText(CONTOURS.caps.intervalM * CONTOURS.caps.indexEvery)}).`,
  source: "NASA LRO LOLA (LDEM_16, LDEM_75S_240M)",
  swatches: [
    [
      "#808080", // the lines are dark on lit ground and light on dark ground
      `Contours: ${intervalText(CONTOURS.global.intervalM)}; ${intervalText(CONTOURS.caps.intervalM)} poleward of ` +
        `${CONTOURS.switchLatDeg}°`,
    ],
  ],
};

/** Default map style: the imagery base, grid lines on, contour lines off. */
export const DEFAULT_STYLE = Object.freeze({ base: "imagery", grid: true, contours: false });

/** Link words of the map style in "ml": the base map's word ("elev", "plain"), "ct" (contours on), "nogrid". */
export const CONTOURS_WORD = "ct";
export const NO_GRID = "nogrid";

/** A map style from any object: { base, grid, contours } with defaults for what is missing or unknown. */
export function normalizeStyle(s) {
  return {
    base: normalizeBase(s?.base),
    grid: s?.grid === undefined ? DEFAULT_STYLE.grid : !!s.grid,
    contours: !!s?.contours,
  };
}

/** The map style of an "ml" link value (or none): old links, without these words, give the default style. */
export function parseStyle(str) {
  const words = String(str ?? "").split(/[.,\s]+/);
  const base = BASE_MAPS.find((b) => b.word && words.includes(b.word));
  return { base: base ? base.id : DEFAULT_STYLE.base, grid: !words.includes(NO_GRID), contours: words.includes(CONTOURS_WORD) };
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
