// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Links each sky view to its place on the globe, like the heading cone of a web map's street-level view: the view's
// camera (C8 extra onViewChange: true azimuth and horizontal field of view, in the ENU frame of the view's site) drives
// a view-direction wedge at that place (C8b setViewCone), in the scenario's colour. One wedge per scenario; a rover
// trip's wedge sits at the rover's current position, the site its sky view is computed for (web/js/rover/sky_ride.js).
// Used by web/js/app/sky_panel.js; `rec` is one of its card records ({ it, view, rideSite }).

import { setViewCone } from "./globe_api.js";

/** Scenario id -> the last camera of its view, { az_deg, hfov_deg } (kept while a card's view is rebuilt). */
const cams = new Map();

/** Where a card's view stands now: the rover's position for a trip, else the scenario's site ({ lat_deg, lon_deg }). */
function placeOf(rec) {
  const it = rec.it;
  return (it.route && rec.rideSite) || it.site || it.s;
}

/** Start driving the card's wedge from its (new) view; the view's next render gives the camera. */
export function linkViewCone(rec) {
  rec.unlinkViewCone?.();
  const off = rec.view?.onViewChange?.((v) => {
    cams.set(rec.it.s.id, { az_deg: v.az_deg, hfov_deg: v.hfov_deg });
    syncViewCone(rec);
  });
  rec.unlinkViewCone = typeof off === "function" ? off : null;
}

/**
 * Put the card's wedge where its view stands now, with the last camera of its scenario's view: call after the place
 * moved (a rover trip's new moment) or the colour changed. setViewCone ignores a wedge that did not change.
 */
export function syncViewCone(rec) {
  const id = rec.it.s.id;
  const cam = cams.get(id);
  const p = placeOf(rec);
  if (!cam || !Number.isFinite(p?.lat_deg) || !Number.isFinite(p?.lon_deg)) return;
  setViewCone(id, { lat: p.lat_deg, lon: p.lon_deg, az_deg: cam.az_deg, hfov_deg: cam.hfov_deg, color: rec.it.color });
}

/** Remove the wedges of scenarios that are no longer shown (items: the sky panel's items). */
export function pruneViewCones(items) {
  const ids = new Set(items.map((it) => it.s.id));
  for (const id of [...cams.keys()]) {
    if (ids.has(id)) continue;
    cams.delete(id);
    setViewCone(id, null);
  }
}
