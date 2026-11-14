# 30-second demo video: script (v0.4, as recorded)

Format: screen capture of the live app + English captions, no voice, no people. Organizer template: team → challenge → name + tagline → idea → future.
The video is recorded by `scripts/video/record_demo.py` (Playwright driving the installed Microsoft Edge, frames encoded with the
FFmpeg in imageio-ffmpeg). Every frame is a real render of the app from NASA data; nothing in it is AI-generated imagery.
Hosted as an unlisted YouTube video or a public Google Drive file.

## Re-record (after UI changes)
```
uv run python scripts/video/record_demo.py                                   # serves web/ locally (~2.5 min)
uv run python scripts/video/record_demo.py --url https://shmonat.github.io/Moonat-Navigator/   # the deployed site
uv run python scripts/video/record_demo.py --only eclipse                    # preview one scene
```
Output: `outputs/video/moonat_demo.mp4` (1920×1080, 30 fps, H.264, yuv420p, 29.5 s) and `outputs/video/moonat_demo_720p.mp4`.
Key frames for review: `docs/figures/video_*.png`. Needs internet for the CDN libraries and the Moon textures (cached in
`outputs/video/.edge-profile` after the first run). The script stops with an error rather than write more than 30.0 s.
The recorder hides the first-visit introduction line (`localStorage["moonat-intro"] = "off"`).

## Storyboard
| t (s) | Visual (real UI actions) | Caption |
|---|---|---|
| 0–2.9 | Title card over the app | Moonat · Lunar Landing Site Navigator · See the Sun and Earth from anywhere on the Moon · Team Moonat · NASA Space Apps 2026 · Tel Aviv · Shay Monat & team |
| 2.9–6.6 | First visit: Apollo 11 on the Sky tab. Click **Focus**: a tall frame with the gibbous Earth high above the ground and its close-up; a short drag of the sky | The sky Neil and Buzz saw / Apollo 11 · Tranquility Base · 20 July 1969 |
| 6.6–9.7 | Click **Compare all Apollo landings**: the Compare tab with the "Side by side" ranked table and the Sun cards | All six Apollo landings, ranked / Sunlight and Earth, side by side |
| 9.7–16.2 | Click **Eclipse from the Moon** (Blue Ghost, 14 Mar 2025); focus mode, view centred on the Earth and zoomed in, constellation lines off. Timelapse: the Earth slides over the Sun (81 % → 100 %), totality with the red ring of Earth's atmosphere; cross-fade to the end of totality: the diamond ring near 08:35 UTC | The Earth eclipses the Sun, seen from the Moon / Blue Ghost lander · 14 March 2025 · NASA eclipse times |
| 16.2–22.9 | Click **South pole ridge** (opens on Compare), then **Sky**, focus mode, one fixed wide view to the south-east and south, **Play**: 19–24 Jan 2027, the Sun skims the horizon over lit ground with long, turning shadows and passes the crescent Earth, which sets behind the ridge | At the south pole, the Sun skims the horizon / Shackleton rim · real NASA LOLA terrain |
| 22.9–26.8 | Click **Far side (Chang'e 4)**: "Earth is below your feet"; a 10-day timelapse, the Sun moves and the shadows turn, the Earth stays 40–50° below the horizon | On the far side, Earth never rises / Chang'e 4 · Von Kármán crater · 2019 |
| 26.8–29.5 | End card | Moonat · https://shmonat.github.io/Moonat-Navigator/ · Validated against JPL Horizons · NASA LOLA terrain · NASA eclipse times |

Left out for time (nice to have): the globe spin to the south pole, the rover route map.
