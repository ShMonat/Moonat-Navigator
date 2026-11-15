# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Make the link-preview image and the home-screen icon of the web app from real renders.

- web/assets/og.png (1200 x 630): the app's own sky view of the 14 March 2025 eclipse seen from Blue Ghost (the
  "Eclipse from the Moon" quick start at 81 % cover), with the app's controls hidden and a title band. Used by the
  og:image / twitter:image tags of web/index.html.
- web/assets/apple-touch-icon.png (180 x 180): the Moonat crescent (as web/assets/favicon.svg) on the dark theme.

Both are browser renders (Playwright + the installed Microsoft Edge, system fonts), not generated imagery. The PNGs
carry their provenance and the AI-assistance note in text chunks.

Run (needs internet for three.js from the CDN):  uv run python scripts/make_social_images.py
"""

from __future__ import annotations

import functools
import io
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, PngImagePlugin
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
NOTE = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."

# Hide the app around the focused sky view, so the view fills the 1200 x 630 frame; then add a title band.
FRAME_CSS = """
#tab-sky.focus { padding: 0 !important; gap: 0 !important; }
#tab-sky.focus .sky-controls, #tab-sky.focus .sky-card-head, #tab-sky.focus .sky-card-foot,
.moonat-sky-bar, .moonat-sky-note, .toast { display: none !important; }
#tab-sky.focus .sky-card.is-focus { border: 0 !important; border-radius: 0 !important; }
"""
BAND = """
<div style="position:fixed;left:0;right:0;bottom:0;height:150px;z-index:99999;pointer-events:none;
  background:linear-gradient(to top, rgba(4,6,10,0.92) 35%, rgba(4,6,10,0));"></div>
<div style="position:fixed;left:44px;bottom:34px;z-index:100000;color:#f2f1ec;font-family:system-ui,'Segoe UI',sans-serif;">
  <div style="display:flex;align-items:center;gap:16px;font-size:54px;font-weight:700;letter-spacing:-0.01em;">
    <svg viewBox="0 0 32 32" width="58" height="58"><defs><mask id="ogm"><rect width="32" height="32" fill="#fff"/>
      <circle cx="21.5" cy="11.5" r="11" fill="#000"/></mask></defs>
      <circle cx="16" cy="16" r="13" fill="#d9d6cc" mask="url(#ogm)"/></svg>Moonat</div>
  <div style="margin-top:6px;font-size:25px;color:#cfd6e4;">The real sky from anywhere on the Moon, at any moment</div>
  <div style="margin-top:4px;font-size:17px;color:#9aa6ba;">14 March 2025: the Earth eclipses the Sun, seen from Blue Ghost &middot;
    NASA LOLA terrain &middot; JPL ephemeris</div>
</div>
"""
ICON_HTML = """<!doctype html><html><body style="margin:0;background:#0b0d12;">
<svg viewBox="0 0 32 32" width="180" height="180" style="display:block">
  <rect width="32" height="32" fill="#0b0d12"/>
  <defs><mask id="m"><rect width="32" height="32" fill="#fff"/><circle cx="20.6" cy="12.4" r="9.4" fill="#000"/></mask></defs>
  <circle cx="16" cy="16" r="11" fill="#e2dfd5" mask="url(#m)"/>
</svg></body></html>"""


def serve(web_dir: Path) -> tuple[str, ThreadingHTTPServer]:
    """Serve web_dir on a free localhost port in a background thread. Returns (base URL, server)."""

    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(web_dir)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{httpd.server_address[1]}/", httpd


def save_png(png: bytes, path: Path, description: str) -> None:
    """Save PNG bytes with provenance text chunks."""
    meta = PngImagePlugin.PngInfo()
    meta.add_text("Title", path.stem)
    meta.add_text("Description", description)
    meta.add_text(
        "Source",
        "Moonat web app (https://shmonat.github.io/Moonat-Navigator/), rendered with Playwright + Microsoft Edge",
    )
    meta.add_text("Comment", NOTE)
    Image.open(io.BytesIO(png)).convert("RGB").save(path, pnginfo=meta, optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1e3:.0f} kB)")


def main() -> None:
    base, httpd = serve(WEB)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                channel="msedge",
                headless=True,
                args=["--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
            )
            ctx = browser.new_context(
                viewport={"width": 1200, "height": 630}, device_scale_factor=1, color_scheme="dark"
            )
            ctx.add_init_script(
                "try { localStorage.setItem('moonat-theme','dark'); localStorage.setItem('moonat-intro','off'); } catch (e) {}"
            )
            page = ctx.new_page()
            page.goto(base)
            page.wait_for_selector("#globe-search")
            page.click("#globe-search")  # the stories are the first group of the search list
            page.click(".gs-story[data-story=eclipse]")
            ready = """() => { const v = document.querySelector('#sky-grid .sky-view');
                return !!(v && v.querySelector('canvas') && !v.querySelector('.sky-loading'))
                  && document.getElementById('sky-clock').textContent.startsWith('T+1 h 28'); }"""
            page.wait_for_function(ready, timeout=60000)
            page.add_style_tag(content=FRAME_CSS)
            page.click("#sky-grid .sky-focus-btn")
            time.sleep(2.5)  # focus layout, resize and the textures' redraws
            page.evaluate("html => document.body.insertAdjacentHTML('beforeend', html)", BAND)
            time.sleep(0.5)
            save_png(
                page.screenshot(),
                WEB / "assets" / "og.png",
                "Moonat link preview: the app's sky view of the 14 March 2025 eclipse (the Earth covers 81 % of the Sun) "
                "from Blue Ghost, Mare Crisium; NASA LOLA terrain, JPL DE421 ephemeris, NASA Blue Marble Earth.",
            )

            icon = browser.new_page(viewport={"width": 180, "height": 180})
            icon.set_content(ICON_HTML)
            save_png(
                icon.screenshot(),
                WEB / "assets" / "apple-touch-icon.png",
                "Moonat home-screen icon: the crescent logo.",
            )
            browser.close()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
