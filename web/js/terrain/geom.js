// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Shared geometry for the terrain module. Same conventions as docs/CONTRACTS.md §0 and
// moonat.terrain (Python): frame MOON_ME, sphere R = 1737.4 km, heights above the sphere, ENU at the
// site with up = radial unit vector, true azimuth clockwise from north.

export const R_M = 1737400;
export const D2R = Math.PI / 180;

/**
 * ENU basis (unit vectors east, north, up) in MOON_ME for a site at selenographic lat/lon (deg,
 * east-positive), as moonat.terrain.pds.enu_basis. Exactly at a pole (|lat| > 89.9999°) north is
 * the direction toward the 0° meridian.
 */
export function enuBasis(lat_deg, lon_deg) {
  const la = lat_deg * D2R, lo = lon_deg * D2R;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  let north, east;
  if (Math.abs(lat_deg) > 89.9999) {
    const dn = up[0];
    north = [1 - dn * up[0], -dn * up[1], -dn * up[2]];
    const n = Math.hypot(...north);
    north = north.map((x) => x / n);
    east = [north[1] * up[2] - north[2] * up[1], north[2] * up[0] - north[0] * up[2], north[0] * up[1] - north[1] * up[0]];
  } else {
    east = [-Math.sin(lo), Math.cos(lo), 0];
    north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
  }
  return { east, north, up };
}

/**
 * Central angle (rad) beyond which no terrain of radius ≤ rhoMax (m) can rise above elevation
 * elStar (rad) seen from an eye at radius rEye (m): θ = acos(r_E·cos(el_star) / ρ_max) − el_star.
 */
export function stopAngle(rEye, elStar, rhoMax) {
  const c = Math.max(-1, Math.min(1, (rEye * Math.cos(elStar)) / rhoMax));
  return Math.acos(c) - elStar;
}

/**
 * Site-centred oblique stereographic projection on the sphere R (m): the plane is tangent at the
 * site, x toward ENU east, y toward ENU north. For a unit vector u:
 *   x = 2R (u·e)/(1 + u·up),  y = 2R (u·n)/(1 + u·up).
 * Along the ray of azimuth A at central angle θ this is r = 2R tan(θ/2), x = r sin A, y = r cos A.
 * It equals the Esri "Stereographic" projection with Latitude_Of_Origin = lat and Central_Meridian
 * = lon on the 1737.4 km sphere (and, exactly at a pole, Central_Meridian 0 for the south pole and
 * 180 for the north pole, which puts +y toward the 0° meridian as enuBasis does).
 */
export function stereoXY(enu, ux, uy, uz) {
  const { east: e, north: n, up } = enu;
  const k = (2 * R_M) / (1 + ux * up[0] + uy * up[1] + uz * up[2]);
  return [k * (ux * e[0] + uy * e[1] + uz * e[2]), k * (ux * n[0] + uy * n[1] + uz * n[2])];
}

/** Esri WKT of the site-centred stereographic plane (see stereoXY). */
export function stereoWkt(lat_deg, lon_deg) {
  let lat = lat_deg, lon = lon_deg;
  if (lat > 89.9999) { lat = 90; lon = 180; } else if (lat < -89.9999) { lat = -90; lon = 0; }
  return 'PROJCS["Moonat_site_stereographic",GEOGCS["GCS_Moon_2000",DATUM["D_Moon_2000",'
    + 'SPHEROID["Moon_2000_IAU_IAG",1737400.0,0.0]],PRIMEM["Reference_Meridian",0.0],'
    + 'UNIT["Degree",0.0174532925199433]],PROJECTION["Stereographic"],PARAMETER["False_Easting",0.0],'
    + `PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",${lon}],PARAMETER["Scale_Factor",1.0],`
    + `PARAMETER["Latitude_Of_Origin",${lat}],UNIT["Meter",1.0]]`;
}

/**
 * A square grid in the site's stereographic plane: n × n float heights (m above the sphere, NaN =
 * no data), row 0 = north edge, col 0 = west edge, pixel centres at x = −half + (c + 0.5)·cell,
 * y = half − (r + 0.5)·cell (Esri exportImage bbox = outer pixel edges). With n odd the centre
 * pixel sits exactly on the site.
 */
export function gridBilinear(g, x, y) {
  const c = (x + g.half_m) / g.cell_m - 0.5;
  const r = (g.half_m - y) / g.cell_m - 0.5;
  const n = g.n;
  if (!(r >= 0 && r <= n - 1 && c >= 0 && c <= n - 1)) return NaN;
  const i = Math.min(Math.floor(r), n - 2), j = Math.min(Math.floor(c), n - 2);
  const fr = r - i, fc = c - j, d = g.data, k = i * n + j;
  return d[k] * (1 - fr) * (1 - fc) + d[k + 1] * (1 - fr) * fc + d[k + n] * fr * (1 - fc) + d[k + n + 1] * fr * fc;
}
