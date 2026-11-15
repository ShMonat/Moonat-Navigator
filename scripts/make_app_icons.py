# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Render the installable-app icons (web/icons/) from the app's map-pin logo.

The logo is the header SVG of web/index.html, unchanged: a 32-unit view box with a map pin (round head centred at
16,12 with radius 11, tip at 16,31) in the dark theme's accent colour (#8fb4ff), and the crescent Moon cut out of
the head (even-odd fill), so the dark theme's background (#090b10) shows through. Every point of the pin lies within
15 units of the view-box centre (16,16). Only the padding (a wider view box around the same centre) and the square
background differ between the icons:

- icon-192.png, icon-512.png ("any"): the pin spans 83 % of the icon's height.
- icon-maskable-192.png, icon-maskable-512.png ("maskable"): the pin fits in a circle of 68 % of the icon's width,
  inside the 80 % safe circle that Android may crop to.
- apple-touch-icon.png (180 x 180, iOS home screen): the pin spans 79 % of the height; iOS rounds the corners itself.

Rendered by the installed Microsoft Edge (Playwright), as the other app images; the PNGs carry the provenance and the
AI-assistance note in text chunks.

Run:  uv run python scripts/make_app_icons.py
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, PngImagePlugin
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "icons"
BG = "#090b10"  # --bg of the dark theme (web/css/app.css)
ACCENT = "#8fb4ff"  # --accent of the dark theme (web/css/app.css)
NOTE = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."

# The header logo of web/index.html (class logo-pin: var(--accent)); the crescent is a hole in the pin's head.
PIN_D = (
    "M16 31L7.03 18.37A11 11 0 1 1 24.97 18.37Z"
    "M14.54 5.55A7 7 0 1 0 22.04 14.72A5.92 5.92 0 0 1 14.54 5.55Z"
)
LOGO = f'<path fill="{ACCENT}" fill-rule="evenodd" d="{PIN_D}"/>'

# name -> (size in px, view-box width in logo units, centred on the view-box centre 16,16)
ICONS = {
    "icon-192.png": (192, 36.0),
    "icon-512.png": (512, 36.0),
    "icon-maskable-192.png": (192, 44.0),
    "icon-maskable-512.png": (512, 44.0),
    "apple-touch-icon.png": (180, 38.0),
}


def svg(size: int, width: float) -> str:
    x0 = 16 - width / 2
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="{x0} {x0} {width} {width}" '
        f'style="display:block"><rect x="{x0}" y="{x0}" width="{width}" height="{width}" fill="{BG}"/>{LOGO}</svg>'
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        for name, (size, width) in ICONS.items():
            page = browser.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
            page.set_content(
                f'<!doctype html><html><body style="margin:0;background:{BG}">{svg(size, width)}</body></html>'
            )
            png = page.screenshot()
            page.close()
            meta = PngImagePlugin.PngInfo()
            meta.add_text("Title", Path(name).stem)
            meta.add_text(
                "Description",
                f"Moonat app icon ({size} x {size}): the map-pin logo of the web app's header.",
            )
            meta.add_text(
                "Source",
                "web/index.html header logo, rendered by scripts/make_app_icons.py (Playwright + Edge)",
            )
            meta.add_text("Comment", NOTE)
            path = OUT / name
            Image.open(io.BytesIO(png)).convert("RGB").save(path, pnginfo=meta, optimize=True)
            print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1e3:.1f} kB)")
        browser.close()


if __name__ == "__main__":
    main()
