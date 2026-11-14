# 30-second demo video: script (v0.3, as recorded)

Format: screen capture of the live app + English captions, no voice, no people. Organizer template: team → challenge → name + tagline → idea → future.
The video is recorded by `scripts/video/record_demo.py` (Playwright driving the installed Microsoft Edge, frames encoded with the
FFmpeg in imageio-ffmpeg). Every frame is a real render of the app from NASA data; nothing in it is AI-generated imagery.
Hosted as an unlisted YouTube video or a public Google Drive file.

## Re-record (after UI changes)
```
uv run python scripts/video/record_demo.py                                   # serves web/ locally (~2.5 min)
uv run python scripts/video/record_demo.py --url https://shmonat.github.io/Moonat-Navigator/   # the deployed site
uv run python scripts/video/record_demo.py --only pole                       # preview one scene
```
Output: `outputs/video/moonat_demo.mp4` (1920×1080, 30 fps, H.264, yuv420p, 29.0 s) and `outputs/video/moonat_demo_720p.mp4`.
Key frames for review: `docs/figures/video_*.png`. Needs internet for the CDN libraries and the map tiles (cached in
`outputs/video/.edge-profile` after the first run). The script stops with an error rather than write more than 30.0 s.

## Storyboard
| t (s) | Visual (real UI actions) | Caption |
|---|---|---|
| 0–3.1 | Title card over the app | Moonat · Lunar Landing Site Navigator · See the Sun and Earth from anywhere on the Moon · Team Moonat · NASA Space Apps 2026 · Tel Aviv · Shay Monat & team |
| 3.1–7.8 | Click **Sky**, then **Focus**: the Apollo 11 sky in a tall frame, the gibbous Earth high above the ground with its close-up; drag the sky; click **Look at Earth** | This is the sky Neil and Buzz saw / Apollo 11 · Tranquility Base · 20 July 1969 |
| 7.8–13.0 | Esc, click **Compare**, then **Compare all Apollo landings**: Sun cards and charts, scroll to the Earth section | Compare all six Apollo landings / Sunlight and Earth in the sky, side by side |
| 13.0–21.7 | Click **South pole ridge**, **Sky** (focus mode, one fixed wide view to the south-east and south), **Play**. Part 1, 19–24 Jan 2027: the Sun skims the horizon over lit ground with long, turning shadows and passes the crescent Earth, which sinks and sets behind the ridge. Cross-fade to part 2, 15–19 Feb: a distant peak hides the Sun (Sun close-up: "% visible") and it comes back, while a thin crescent Earth stands in the south-east | At the south pole, one ridge decides power and contact with Earth / Shackleton rim · Jan–Feb 2027 · real NASA LOLA terrain |
| 21.7–25.8 | Esc, click **Far side (Chang'e 4)**: timelapse over 10 days, the Sun moves and the shadows turn, the Earth stays 40–50° below the horizon | On the far side, Earth never rises / Chang'e 4 needs a relay satellite to call home |
| 25.8–29.0 | End card | Moonat · https://shmonat.github.io/Moonat-Navigator/ · Validated against JPL Horizons · NASA LOLA terrain |

The south-pole shot uses two stretches of the quick start's window (2027-01-19 → 03-22, the Gläser 2014 rim point). While the Sun is
above the local horizontal (19 Jan – 10 Feb) it never sets there, so the lit-ground part shows the Earth setting instead. The Sun's
sets behind distant peaks all happen with the Sun 0.7–1.5° below the horizontal (the rim is high, so the Sun is still above the
terrain horizon), when the nearby flat ground is unlit; part 2 is therefore dark except for the Sun, its close-up and the Earth.
