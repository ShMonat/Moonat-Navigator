# 30-second demo video: script (v0.5, as recorded)

Format: screen capture of the live app + English captions, no voice, no people. Organizer template: team → challenge → name + tagline → idea → future.
The video is recorded by `scripts/video/record_demo.py` (Playwright driving the installed Microsoft Edge, frames encoded with the
FFmpeg in imageio-ffmpeg). Every frame is a real render of the app from NASA data; nothing in it is AI-generated imagery.
The hosted copy is `web/video/moonat_demo.mp4` (the 1080p file).

## Re-record (after UI changes)
```
uv run python scripts/video/record_demo.py                                   # serves web/ locally (~2.5 min)
uv run python scripts/video/record_demo.py --url https://shmonat.github.io/Moonat-Navigator/   # the deployed site
uv run python scripts/video/record_demo.py --only eclipse                    # preview one scene
```
Output: `outputs/video/moonat_demo.mp4` (1920×1080, 30 fps, H.264, yuv420p, 29.5 s) and `outputs/video/moonat_demo_720p.mp4`;
copy the 1080p file to `web/video/moonat_demo.mp4` to update the hosted demo. Key frames for review: `docs/figures/video_*.png`.
Needs internet for the CDN libraries and the Moon textures (cached in `outputs/video/.edge-profile` after the first run). The script
stops with an error rather than write more than 30.0 s. It hides the first-visit introduction line (`localStorage["moonat-intro"] = "off"`).

## Storyboard
| t (s) | Visual (real UI actions) | Caption |
|---|---|---|
| 0–2.9 | Title card over the app | Moonat · Lunar Landing Site Navigator · See the Sun and Earth from anywhere on the Moon · Team Moonat · NASA Space Apps 2026 · Tel Aviv · Shay Monat & team |
| 2.9–6.3 | First visit: the globe with its coloured pins on the left, Apollo 11's sky on the right. Click **Focus**: a tall frame with the gibbous Earth high above the ground and its close-up | The sky Neil and Buzz saw / Apollo 11 · Tranquility Base · 20 July 1969 |
| 6.3–10.6 | Esc, click **✨ Suggest dates** on the Apollo 11 card: the left column scrolls to the list (most sunlight, Earth always in view, sunlight and Earth together), which rolls down to the eclipses seen from the site: "Total eclipse of the Sun by the Earth, 10 Feb 1971, 2 h 36 min" | Moonat suggests the best dates / Most sunlight · Earth in view · eclipses |
| 10.6–17.0 | Story **Eclipse from the Moon** (Blue Ghost, 14 Mar 2025); focus mode, the view centred on the Earth and zoomed in, constellation lines off. Timelapse: the Earth slides over the Sun (81 % → 100 %), totality with the red ring of Earth's atmosphere; cross-fade to the end of totality: the diamond ring near 08:35 UTC | The Earth eclipses the Sun, seen from the Moon / Blue Ghost lander · 14 March 2025 · NASA eclipse times |
| 17.0–22.7 | Story **South pole ridge**; focus mode, one fixed wide view to the south-east and south, **Play**: 19–24 Jan 2027, the Sun skims the horizon over lit ground with long, turning shadows and passes the crescent Earth, which sets behind the ridge | At the south pole, the Sun skims the horizon / Shackleton rim · real NASA LOLA terrain |
| 22.7–26.4 | Story **Far side (Chang'e 4)**: "Earth is below your feet"; a 10-day timelapse, the Sun moves and the shadows turn, the Earth stays 40–50° below the horizon | On the far side, Earth never rises / Chang'e 4 · Von Kármán crater · 2019 |
| 26.4–29.5 | End card | Moonat · https://shmonat.github.io/Moonat-Navigator/ · Validated against JPL Horizons · NASA LOLA terrain · NASA eclipse times |

Left out for time: the Apollo side-by-side table, the globe spin to the south pole, the rover route map.
