// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Rover presets for the traverse planner and the slope-dependent speed model they feed.
// Sources (docs/REFERENCES.md, "Rover traverse planner"):
// - VIPER: NASA VIPER "Lunar Operations" page (drive speed "about 10 to 20 centimeters per second" toward a planned
//   destination; "can generally drive on a slope of up to 15 degrees", 25–30° only when necessary, with more slip) and
//   T. Fong, "Volatiles Investigating Polar Exploration Rover", NASA ARC robotics seminar, 2026 (NTRS 20260002876:
//   top speed 20 cm/s, nominal 10 cm/s, 15° slopes as the design limit, 0.8 cm/s speed made good with stops).
// - Apollo LRV: S. R. Jacob et al., "Apollo Lunar Roving Vehicle as-traversed performance metrics", LPSC 57 (2026),
//   NTRS 20250011301: theoretical 9–13 km/h (2.5–3.6 m/s); designed for 20–23° slopes "in favorable conditions", max 25°;
//   speed made good on Apollo 15/16: mean 2.0 / 1.7 m/s, best leg 2.6 / 2.5 m/s; steepest slope driven 22.1° / 24.7°.

/**
 * Rover parameters used by the planner (units in the names):
 *   speed_mps        level-ground driving speed (m/s), the cap at any slope
 *   max_slope_deg    steepest terrain slope a cell may have (deg); steeper cells are impassable
 *   max_cross_deg    steepest slope across the direction of motion (deg) (tip-over / side-slip limit)
 *   mu               motion-resistance coefficient on regolith (dimensionless; assumption, see speedFactor)
 *   power_margin     drive power at the speed cap / power needed on level ground (1 = sized for level ground)
 */
export const PRESETS = {
  viper: {
    id: "viper",
    label: "VIPER-class rover",
    speed_mps: 0.2,
    max_slope_deg: 15,
    max_cross_deg: 15,
    mu: 0.1,
    power_margin: 1,
    note: "NASA VIPER: top drive speed 20 cm/s (nominal 10 cm/s), slopes up to 15° (design limit).",
  },
  lrv: {
    id: "lrv",
    label: "Apollo LRV",
    speed_mps: 2.5,
    max_slope_deg: 20,
    max_cross_deg: 20,
    mu: 0.1,
    power_margin: 1,
    note: "Apollo LRV: 2.5 m/s (9 km/h) cruise, the low end of its 9–13 km/h design speed; slopes to 20° (designed for 20–23°, max 25°).",
  },
};

export const DEFAULT_PRESET = "viper";

/** Rover parameters from a preset id plus user overrides (missing or invalid fields fall back to the preset). */
export function roverParams(preset = DEFAULT_PRESET, overrides = {}) {
  const base = PRESETS[preset] || PRESETS[DEFAULT_PRESET];
  const pick = (k, lo, hi) => {
    const v = Number(overrides[k]);
    return Number.isFinite(v) && v >= lo && v <= hi ? v : base[k];
  };
  const max_slope_deg = pick("max_slope_deg", 1, 45);
  return {
    preset: PRESETS[preset] ? preset : DEFAULT_PRESET,
    speed_mps: pick("speed_mps", 0.001, 20),
    max_slope_deg,
    max_cross_deg: Math.min(pick("max_cross_deg", 1, 45), 45),
    mu: pick("mu", 0.01, 1),
    power_margin: pick("power_margin", 0.1, 20),
  };
}

/**
 * Speed factor v / v_level for a slope along the direction of motion (deg, + uphill).
 * Model: the drive delivers a fixed power P = power_margin · m g μ v_level (enough to hold v_level on level ground
 * when power_margin = 1). Uphill the motion resistance is m g (μ cos θ + sin θ), so v = P / (m g (μ cos θ + sin θ)),
 * capped at v_level. Downhill and on level ground the rover drives at v_level (gravity is not used to go faster).
 * Assumptions: rigid-wheel rolling resistance μ ≈ 0.1 on loose regolith; no wheel slip; no speed penalty for cross
 * slope (it is a hard limit instead). Mass and g cancel.
 */
export function speedFactor(alongDeg, mu = 0.1, powerMargin = 1) {
  if (!(alongDeg > 0)) return 1;
  const th = (alongDeg * Math.PI) / 180;
  return Math.min(1, (powerMargin * mu) / (mu * Math.cos(th) + Math.sin(th)));
}
