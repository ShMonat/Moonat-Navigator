# 30-second demo video: script (v0.7, as recorded on the sky stage)

Format: screen capture of the live app + English captions, no voice, no people. Organizer template: team → challenge → name + tagline → idea → future.
The video is recorded by `scripts/video/record_demo.py` (Playwright driving the installed Microsoft Edge, frames encoded with the
FFmpeg in imageio-ffmpeg). Every frame is a real render of the app from NASA data; nothing in it is AI-generated imagery, and the
title and end cards use the app's own moon logo (no NASA logo or insignia). Captions and cards use no emoji or pictographs.
The hosted copy is `web/video/moonat_demo.mp4` (the 1080p file).

**Duration 29.8 s** (894 frames), 1920×1080, 30 fps, H.264 yuv420p, 8.5 MB (720p copy: 4.8 MB).

## Re-record (after UI changes)
```
uv run python scripts/video/record_demo.py                                   # serves web/ locally (~3 min)
uv run python scripts/video/record_demo.py --url https://shmonat.github.io/Moonat-Navigator/   # the deployed site
uv run python scripts/video/record_demo.py --only rover                      # preview one scene
```
Output: `outputs/video/moonat_demo.mp4` and `outputs/video/moonat_demo_720p.mp4`; copy the 1080p file to
`web/video/moonat_demo.mp4` to update the hosted demo. Key frames for review: `docs/figures/video_*.png`.
Needs internet for the CDN libraries and the Moon textures (cached in `outputs/video/.edge-profile` after the first run). The script
stops with an error rather than write more than 30.0 s. It hides the first-visit introduction line (`localStorage["moonat-intro"] = "off"`).
The sky stage fills the window height, so most shots film it as it is; only the eclipse uses the card's full-screen icon,
and the recorder leaves full screen with Esc before the next beat.

## Storyboard
| t (s) | Beat (real UI actions) | Caption |
|---|---|---|
| 0–2.5 | Title card over the app | Moonat · Lunar Landing Site Navigator · See the Sun and Earth from anywhere on the Moon · Team Moonat · NASA Space Apps 2026 · Tel Aviv · Shay Monat & team |
| 2.5–5.4 | First visit: the globe with its pins on the left, Apollo 11 on the sky stage: the gibbous Earth high above the horizon, with its close-up. A short drag of the sky shows the view is live | The sky Neil and Buzz saw / Apollo 11 · Tranquility Base · 20 July 1969 |
| 5.4–7.8 | Click the calendar button of the Apollo 11 card's start time: "Suggested for Apollo 11" (most sunlight, Earth always in view), whose list rolls down to the eclipses seen from the site | Moonat suggests the best dates / Most sunlight · Earth in view · eclipses |
| 7.8–9.9 | Type "Shackleton" in **Search the Moon** and pick "Shackleton rim": the globe flies to the south pole and the place joins the comparison | Search the Moon / Fly to any crater, landing site or Artemis region |
| 9.9–15.6 | Story **Eclipse from the Moon** (Blue Ghost, 14 Mar 2025), in full screen; the view centred on the Earth and zoomed in, constellation lines off. Timelapse: the Earth slides over the Sun (81 % → 100 %), totality with the red ring of Earth's atmosphere; cross-fade to the diamond ring near 08:35 UTC | The Earth eclipses the Sun, seen from the Moon / Blue Ghost lander · 14 March 2025 · NASA eclipse times |
| 15.6–20.4 | Esc, story **South pole ridge**: one fixed wide view to the south-east and south, **Play**: 19–24 Jan 2027, the Sun skims the horizon over lit ground with long, turning shadows and passes the crescent Earth, which sets behind the ridge | At the south pole, the Sun skims the horizon / Shackleton rim · real NASA LOLA terrain |
| 20.4–23.7 | Story **Rover: Shackleton rim to the ridge**: the planned route on the globe; click **Driver's view**, and the drive plays: the rover's dot moves along the route while the view rides with the rover over the sunlit slopes | Plan a rover drive / Driver's view along a 19 km route at the south pole |
| 23.7–26.8 | Story **Far side (Chang'e 4)**: "Earth is below your feet"; a 10-day timelapse, the Sun moves and the shadows turn, the Earth stays 40–50° below the horizon | On the far side, Earth never rises / Chang'e 4 · Von Kármán crater · 2019 |
| 26.8–29.8 | End card | Moonat · https://shmonat.github.io/Moonat-Navigator/ · Validated against JPL Horizons · NASA LOLA terrain · NASA eclipse times |

Left out for time: the Apollo side-by-side table.
