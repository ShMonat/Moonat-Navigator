# Vision: Moonat

> Owner of the vision: **both** (product/UI/UX is a shared domain; see docs/TEAM.md). Physics accuracy: **Shay**.
> Status: v0.1, written from Shay's brief on 2026-11-07. Shay has more to add; open questions at the end.

## One sentence
A web app where anyone, from a curious kid to a mission planner, picks places on the Moon and times, and sees
**what the sky looks like from there**: where the Sun and Earth are, whether a hill blocks them, how much sunlight
and Earth contact you get. They can compare several sites and missions side by side.

## What makes it different
1. **Real terrain, not a smooth sphere.** A body can be above the local mathematical horizon and still be hidden
   behind a ridge or crater rim. Line-of-sight is decided by the actual LOLA topography around the site, including
   far-away mountains and lunar curvature.
2. **Accuracy first.** Every body sits at its true position: JPL ephemerides, the precise lunar orientation (libration
   included), light-time and aberration. Results are verified against JPL Horizons, and the numbers must survive Shay's review.
3. **The sky view is the centerpiece.** A rendered view of the lunar sky above the real horizon silhouette, with Earth
   (correct phase and orientation), the Sun, and ideally stars, constellations, planets and events such as eclipses.
   It's an image for a single moment and a timelapse for a mission.
4. **Playful entry point.** Load a historical mission (e.g. Apollo 11) and see the sky as Neil and Buzz saw it in July
   1969. Compare which of the six Apollo landings had the best view of the Earth and Sun.

## Inputs: scenarios
A **scenario** = one location + one start time + an optional end time (mission duration).
- **Progressive UI.** Start with one location and one time. Once they're filled, offer "+ add location" or
  "+ add time". This supports the same time at different places, different times at the same place, or entirely
  independent scenarios, each with its own duration.
- **Location: three ways**
  1. Coordinates (selenographic latitude/longitude).
  2. Click on a Moon map.
  3. **Historical missions**: pick a mission. It loads the landing coordinates and the mission start and end times (landing to
     liftoff or end of surface operations).
- **Time:** start (UTC) and optional end. For historical missions, these are prefilled.

## Outputs: three panels
### 1. Sun (data)
Elevation and azimuth; line of sight (fraction of the solar disk visible above the terrain); solar heat flux (on a
horizontal surface and on a Sun-facing surface); time to the next sunset or sunrise; % of the mission in sunlight.
### 2. Earth (data)
Elevation and azimuth; line of sight (fraction of the Earth disk visible); **phase** (illuminated fraction, which is the
opposite of the Moon phase seen from Earth); apparent size and distance; time to Earthset; % of the mission with Earth
contact (a direct-to-Earth comms proxy).
### 3. The sky (visual, the "wow")
- The horizon is fixed. The view opens **centred on the Earth's direction**. If the Sun isn't in frame, offer either a button to point at the Sun
  or, better, a **scrollable 3D sky hemisphere** (180°).
- Stretch goals for the wow: real stars, constellations, visible planets, and phenomena such as eclipses (Earth passing in
  front of the Sun) and comets.
- Single time: one image. Mission: a timelapse animation.

### Comparison behaviour
- **Data panels:** every scenario is overlaid on the same plot, one line per scenario. A single time gives values
  side by side (bars or a table). A mission gives value vs. mission time, with one line per mission.
- **Sky views:** one per scenario, since images can't overlap like lines. An "overlay the skies" option is an idea
  Shay isn't sure about yet. Decide later.

## Audience
Both pros and novices. Default to simple, but expose options. Plain-language explanations sit next to the numbers. The far side of the Moon
(e.g. Chang'e 4) never sees Earth, and the app should make that kind of insight obvious.

## Priorities (proposed by the agent; Shay and Shahar to confirm)
| Tier | Content |
|---|---|
| **MVP (must work Saturday evening)** | Scenarios (coordinates + mission picker); Sun and Earth az/el with **terrain line of sight**; Sun and Earth data panels with overlaid plots; a static sky image toward Earth with the real horizon silhouette, Earth (with phase) and Sun drawn |
| **Should** | Map click input; mission timelapse; Earth phase and orientation rendering; heat flux; time-to-set and % metrics; "point at Sun" |
| **Could (wow)** | Scrollable 3D sky hemisphere; stars and constellations; planets; eclipse detection and rendering; overlaying skies |
| **Later** | Comets; DSN-station-level comms windows; solar panel tilt options |

## Calculation philosophy (Shay, 2026-11-07)
Clean, standard-frame geometry, built fresh: don't port the old Earth View code. Visibility numbers come first, and
rendering builds on them. The terrain occlusion method is being researched before the event
(`docs/research/terrain-visibility-question.md`). See ARCHITECTURE §2.

## Open questions for Shay (he has more to share)
1. Heat flux: on which surfaces (horizontal, Sun-tracking, local slope, user-defined panel)? Include earthshine or albedo?
2. What exactly counts as "line of sight" for comms: Earth's centre visible, any part visible, or a minimum elevation margin?
3. How realistic should Earth be: texture with clouds, day/night terminator, city lights? Should its orientation follow real Earth rotation?
4. Timelapse: time step, playback speed, max mission length (Apollo 17 was ~3 days; a polar mission may be 14+ days)?
5. Historical missions list: Apollo only, or also Luna, Surveyor, Chang'e, Chandrayaan-3, SLIM, IM-1/IM-2, Blue Ghost?
6. "Other important numerics": anything else, such as temperature estimates, shadow fraction, or Sun-Earth angular separation?
7. Overlay-the-skies feature: keep, drop, or defer?
