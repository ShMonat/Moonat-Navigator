# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Record the Moonat 30-second demo video from the live web app.

The script drives the static site in web/ with Playwright and the installed Microsoft Edge, through the storyboard
in docs/submission/video_script.md, using the app's real UI: the quick-start buttons, the Compare and Sky tabs,
"Look at Earth" / "Look at Sun", the sky view drag and the timelapse slider. A fake mouse pointer and the English
captions are an HTML overlay injected into the page. Every video frame is a screenshot taken after an explicit,
deterministic step (a slider position, a mouse move), so timelapses are smooth and the result does not depend on
the speed of the machine. Frames are piped to the ffmpeg binary bundled with imageio-ffmpeg.

Outputs (git-ignored): outputs/video/moonat_demo.mp4 (1920x1080, 30 fps, H.264, yuv420p, at most 30.0 s) and
outputs/video/moonat_demo_720p.mp4. Key frames for review go to docs/figures/video_*.png.

Run (needs internet for the CDN libraries and map tiles; the Edge profile in outputs/video/.edge-profile caches them):
    uv run python scripts/video/record_demo.py                       # serves web/ itself
    uv run python scripts/video/record_demo.py --url https://shmonat.github.io/Moonat-Navigator/
"""

from __future__ import annotations

import argparse
import functools
import io
import math
import re
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image
from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
W, H, FPS = 1920, 1080, 30
MAX_FRAMES = 30 * FPS  # hard limit: 30.0 s
TARGET_FRAMES = 885  # 29.5 s: the end card is padded or trimmed to land here
DISCLOSURE = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."
APP_URL = "https://shmonat.github.io/Moonat-Navigator/"

# Captions: one main line (read in about 2-3 s) and a short sub line.
CAPTIONS = {
    "apollo": ("The sky Neil and Buzz saw", "Apollo 11 · Tranquility Base · 20 July 1969"),
    "compare": ("All six Apollo landings, ranked", "Sunlight and Earth, side by side"),
    "eclipse": (
        "The Earth eclipses the Sun, seen from the Moon",
        "Blue Ghost lander · 14 March 2025 · NASA eclipse times",
    ),
    "pole": (
        "At the south pole, the Sun skims the horizon",
        "Shackleton rim · real NASA LOLA terrain",
    ),
    "farside": ("On the far side, Earth never rises", "Chang'e 4 · Von Kármán crater · 2019"),
}

MOON_LOGO = (
    '<svg viewBox="0 0 32 32" width="{s}" height="{s}" aria-hidden="true">'
    '<circle cx="16" cy="16" r="13" fill="#d9d6cc"/><circle cx="21.5" cy="11.5" r="11" fill="#0b0d12"/></svg>'
)

TITLE_CARD = f"""
<div class="vc-logo">{MOON_LOGO.format(s=104)}<span>Moonat</span></div>
<div class="vc-l1">Lunar Landing Site Navigator</div>
<div class="vc-l2">See the Sun and Earth from anywhere on the Moon</div>
<div class="vc-rule"></div>
<div class="vc-l3">Team Moonat · NASA Space Apps 2026 · Tel Aviv</div>
<div class="vc-l4">Shay Monat &amp; team</div>
"""

END_CARD = f"""
<div class="vc-logo small">{MOON_LOGO.format(s=72)}<span>Moonat</span></div>
<div class="vc-url">{APP_URL}</div>
<div class="vc-l3">Validated against JPL Horizons · NASA LOLA terrain · NASA eclipse times</div>
<div class="vc-rule"></div>
<div class="vc-l4">Team Moonat · NASA Space Apps 2026 · Tel Aviv</div>
<div class="vc-fine">Screen capture of the live app. Software built with the help of AI (Claude Code).</div>
"""

# Runs before the app's own scripts: count 2D canvas draws (the sky view copies every render into its 2D canvas),
# so the recorder knows when a new sky frame is on screen; pin the theme; hide the first-visit introduction line.
INIT_SCRIPT = """
window.__draws = 0;
const __drawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (...a) { window.__draws++; return __drawImage.apply(this, a); };
try { localStorage.setItem("moonat-theme", "%THEME%"); localStorage.setItem("moonat-intro", "off"); } catch (e) { /* blocked */ }
"""

OVERLAY_CSS = """
#vid-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font-family: "Segoe UI Variable Display", "Segoe UI", "Inter", system-ui, sans-serif; }
#vid-scrim { position: absolute; left: 0; right: 0; bottom: 0; height: 290px; opacity: 0;
  background: linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.85)); }
#vid-cap { position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%); width: 1640px; text-align: center;
  color: #fff; opacity: 0; text-shadow: 0 2px 4px rgba(0,0,0,0.9), 0 0 22px rgba(0,0,0,0.75); }
#vid-cap .main { font-size: 50px; font-weight: 600; letter-spacing: 0.005em; line-height: 1.15; }
#vid-cap .sub { margin-top: 10px; font-size: 27px; font-weight: 400; color: #e4e9f2; }
#vid-card { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center;
  color: #f2f1ec; text-align: center; opacity: 0;
  background: radial-gradient(1400px 800px at 50% 38%, rgba(22, 30, 52, 0.97), rgba(6, 8, 13, 0.995) 70%); }
#vid-card .vc-logo { display: flex; align-items: center; gap: 26px; font-size: 128px; font-weight: 700; letter-spacing: -0.01em; }
#vid-card .vc-logo.small { font-size: 88px; gap: 18px; }
#vid-card .vc-l1 { margin-top: 18px; font-size: 46px; font-weight: 600; color: #f2f1ec; }
#vid-card .vc-l2 { margin-top: 10px; font-size: 32px; color: #b8c4d8; }
#vid-card .vc-rule { width: 140px; height: 3px; margin: 40px 0 34px; border-radius: 2px; background: #8fb4ff; }
#vid-card .vc-l3 { margin-top: 12px; font-size: 34px; font-weight: 500; color: #f2f1ec; }
#vid-card .vc-l4 { margin-top: 8px; font-size: 30px; color: #b8c4d8; }
#vid-card .vc-url { margin-top: 26px; font-size: 54px; font-weight: 600; color: #8fb4ff; letter-spacing: 0.005em; }
#vid-card .vc-fine { position: absolute; bottom: 40px; font-size: 20px; color: #8a93a6; }
#vid-cursor { position: absolute; left: 0; top: 0; width: 34px; height: 34px; display: none;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,0.6)); }
#vid-ripple { position: absolute; left: 0; top: 0; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
  border: 3px solid rgba(143, 180, 255, 0.95); display: none; }
"""

OVERLAY_JS = """
(() => {
  const root = document.createElement("div");
  root.id = "vid-root";
  root.innerHTML = `<div id="vid-scrim"></div><div id="vid-cap"><div class="main"></div><div class="sub"></div></div>
    <div id="vid-card"></div><div id="vid-ripple"></div>
    <svg id="vid-cursor" viewBox="0 0 24 24"><path d="M3 2 L3 20 L7.6 15.6 L10.9 22.8 L14 21.4 L10.8 14.4 L17.2 14.4 Z"
      fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  document.body.append(root);
  const $ = (id) => document.getElementById(id);
  window.__vid = {
    apply(s) {
      $("vid-cap").querySelector(".main").textContent = s.capMain;
      $("vid-cap").querySelector(".sub").textContent = s.capSub;
      $("vid-cap").style.opacity = s.capAlpha;
      $("vid-scrim").style.opacity = s.capAlpha;
      if (s.cardHtml !== null) $("vid-card").innerHTML = s.cardHtml;
      $("vid-card").style.opacity = s.cardAlpha;
      $("vid-card").style.display = s.cardAlpha > 0 ? "flex" : "none";
      const c = $("vid-cursor");
      c.style.display = s.cursorOn ? "block" : "none";
      c.style.transform = `translate(${s.cx - 5}px, ${s.cy - 3}px)`;
      const r = $("vid-ripple");
      r.style.display = s.ripple >= 0 ? "block" : "none";
      if (s.ripple >= 0) {
        r.style.left = `${s.cx}px`; r.style.top = `${s.cy}px`;
        r.style.transform = `scale(${0.35 + 1.1 * s.ripple})`;
        r.style.opacity = String(1 - s.ripple);
      }
      return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    },
  };
})();
"""


def ease(t: float) -> float:
    """Smooth ease-in-out on [0, 1] (cubic)."""
    t = min(1.0, max(0.0, t))
    return 4 * t**3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


# ---------------------------------------------------------------------------------------------------------------
# Local server and encoder


def serve(web_dir: Path) -> tuple[str, ThreadingHTTPServer]:
    """Serve web_dir on a free localhost port in a background thread. Returns (base URL, server)."""

    class Quiet(SimpleHTTPRequestHandler):
        extensions_map = {
            **SimpleHTTPRequestHandler.extensions_map,
            ".js": "text/javascript",
            ".mjs": "text/javascript",
            ".json": "application/json",
            ".bin": "application/octet-stream",
        }

        def log_message(self, *args):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(web_dir)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{httpd.server_address[1]}/", httpd


class Encoder:
    """Pipes RGB frames to ffmpeg (libx264, yuv420p, 30 fps) and refuses to go past MAX_FRAMES."""

    def __init__(self, path: Path):
        self.path = path
        self.n = 0
        self.last: np.ndarray | None = None
        self.keep: dict[str, np.ndarray] = {}
        cmd = [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-y",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            f"{W}x{H}",
            "-r",
            str(FPS),
            "-i",
            "-",
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "17",
            "-pix_fmt",
            "yuv420p",
            "-profile:v",
            "high",
            "-r",
            str(FPS),
            "-movflags",
            "+faststart",
            "-metadata",
            "title=Moonat: Lunar Landing Site Navigator (NASA Space Apps 2026 demo)",
            "-metadata",
            f"comment=Screen capture of the Moonat web app. {DISCLOSURE}",
            str(path),
        ]
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    def write(self, img: np.ndarray, n: int = 1) -> None:
        if self.n + n > MAX_FRAMES:
            raise RuntimeError(f"video would exceed {MAX_FRAMES} frames ({MAX_FRAMES / FPS:.1f} s)")
        buf = img.tobytes()
        for _ in range(n):
            self.proc.stdin.write(buf)
        self.n += n
        self.last = img

    def crossfade(self, img: np.ndarray, n: int) -> None:
        """n blended frames from the last written frame towards img (img itself is not written)."""
        a = self.last.astype(np.float32)
        b = img.astype(np.float32)
        for i in range(1, n + 1):
            t = ease(i / (n + 1))
            self.write(((1 - t) * a + t * b + 0.5).astype(np.uint8))

    def close(self) -> None:
        self.proc.stdin.close()
        if self.proc.wait() != 0:
            raise RuntimeError("ffmpeg failed")


# ---------------------------------------------------------------------------------------------------------------
# Director: overlay state, frame capture and the UI actions


class Director:
    def __init__(self, page: Page, enc: Encoder):
        self.page = page
        self.enc = enc
        self.pending: dict[
            int, str
        ] = {}  # in-flight requests, for "wait until the network is quiet"
        page.on("request", lambda r: self.pending.__setitem__(id(r), r.url))
        page.on("requestfinished", lambda r: self.pending.pop(id(r), None))
        page.on("requestfailed", lambda r: self.pending.pop(id(r), None))
        # Overlay state, applied before every screenshot. Alphas move towards their targets one step per frame.
        self.cap = ("", "")
        self.cap_alpha, self.cap_target = 0.0, 0.0
        self.card_html: str | None = None
        self.card_alpha, self.card_target = 0.0, 0.0
        self.cx, self.cy = 1250.0, 640.0
        self.cursor_on = False
        self.ripple = -1.0

    # -- overlay ---------------------------------------------------------------------------------------------
    def caption(self, key: str | None) -> None:
        """Fade a caption in (key from CAPTIONS) or out (None) over the next frames."""
        if key:
            self.cap = CAPTIONS[key]
            self.cap_target = 1.0
        else:
            self.cap_target = 0.0

    def card(self, html: str | None, alpha: float | None = None) -> None:
        if html is not None:
            self.card_html = html
            self.card_target = 1.0
        else:
            self.card_target = 0.0
        if alpha is not None:
            self.card_alpha = alpha

    def animating(self) -> bool:
        return self.cap_alpha != self.cap_target or self.card_alpha != self.card_target

    def _step_alphas(self) -> None:
        def step(a, target, rate):
            return min(target, a + rate) if a < target else max(target, a - rate)

        self.cap_alpha = step(self.cap_alpha, self.cap_target, 1 / 9)
        self.card_alpha = step(self.card_alpha, self.card_target, 1 / 12)

    def grab(self) -> np.ndarray:
        """Advance the overlay one frame, then screenshot the page."""
        self._step_alphas()
        self.page.evaluate(
            "s => window.__vid.apply(s)",
            {
                "capMain": self.cap[0],
                "capSub": self.cap[1],
                "capAlpha": ease(self.cap_alpha),
                "cardHtml": self.card_html,
                "cardAlpha": ease(self.card_alpha),
                "cursorOn": self.cursor_on,
                "cx": self.cx,
                "cy": self.cy,
                "ripple": self.ripple,
            },
        )
        png = self.page.screenshot(type="png")
        img = Image.open(io.BytesIO(png)).convert("RGB")
        if img.size != (W, H):
            img = img.resize((W, H), Image.LANCZOS)
        return np.asarray(img)

    def frame(self) -> np.ndarray:
        img = self.grab()
        self.enc.write(img)
        return img

    def hold(self, n: int) -> None:
        """n frames of a still page; screenshots are taken only while an overlay fade is running."""
        while n > 0 and self.animating():
            self.frame()
            n -= 1
        if n > 0:
            self.enc.write(self.grab(), n)

    def keyframe(self, name: str) -> None:
        self.enc.keep[name] = self.enc.last

    # -- waiting ---------------------------------------------------------------------------------------------
    def wait_net(self, quiet_s: float = 0.6, timeout: float = 15.0) -> None:
        """Wait until no request is in flight and the app's "Computing…" badge is hidden, for quiet_s."""
        t0 = time.time()
        quiet_since = None
        while time.time() - t0 < timeout:
            computing = self.page.evaluate("!document.getElementById('busy').hidden")
            if self.pending or computing:
                quiet_since = None
            elif quiet_since is None:
                quiet_since = time.time()
            elif time.time() - quiet_since >= quiet_s:
                return
            time.sleep(0.05)
        print(
            f"  warning: network/compute did not settle (computing={computing}, pending: "
            f"{', '.join(list(self.pending.values())[:4])})",
            file=sys.stderr,
        )

    def draws(self) -> int:
        return self.page.evaluate("window.__draws")

    def wait_draw(self, before: int, timeout: float = 5.0) -> None:
        """Wait until the sky view drew at least once after `before`, and stopped drawing."""
        t0 = time.time()
        while time.time() - t0 < timeout and self.draws() <= before:
            time.sleep(0.01)
        self.page.evaluate(
            "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
        )

    def wait_sky(self, timeout: float = 40.0) -> None:
        t0 = time.time()
        ready = """() => { const c = [...document.querySelectorAll('#sky-grid .sky-card')];
          return c.length > 0 && c.every(x => !x.querySelector('.sky-loading') && x.querySelector('canvas')
            && x.querySelector('.sky-card-foot').textContent.trim().length > 0); }"""
        while time.time() - t0 < timeout and not self.page.evaluate(ready):
            time.sleep(0.1)
        self.wait_net()
        n = (
            self.draws()
        )  # then wait until the views stop redrawing (textures arriving trigger redraws)
        while time.time() - t0 < timeout:
            time.sleep(0.4)
            m = self.draws()
            if m == n:
                break
            n = m

    def wait_compare(self, timeout: float = 40.0) -> None:
        t0 = time.time()
        self.wait_net()
        while time.time() - t0 < timeout and not self.page.evaluate(
            "document.querySelectorAll('#tab-compare .js-plotly-plot .main-svg').length > 0"
        ):
            time.sleep(0.1)
        self.wait_net()
        time.sleep(0.8)  # Plotly layout and the map's fit animation

    # -- pointer ---------------------------------------------------------------------------------------------
    def center(self, selector: str) -> tuple[float, float]:
        box = self.page.locator(selector).first.bounding_box()
        return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    def move_to(self, target, n: int = 12, during=None) -> None:
        """Glide the visible pointer to a selector's centre (or an (x, y) point) over n frames."""
        x1, y1 = self.center(target) if isinstance(target, str) else target
        x0, y0 = self.cx, self.cy
        self.cursor_on = True
        for i in range(1, n + 1):
            t = ease(i / n)
            self.cx, self.cy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            self.page.mouse.move(self.cx, self.cy)
            if during:
                during(i / n)
            self.frame()

    def click(
        self, target, wait=None, xfade: int = 6, n_move: int = 12, during=None, capture: bool = True
    ) -> None:
        """Move to target, show a press, click it for real, wait for the app, then cross-fade to the result.
        With capture=False the result is not filmed yet (the caller sets more up off camera, then reveal())."""
        self.move_to(target, n_move, during)
        for i in range(4):
            self.ripple = i / 8
            self.frame()
        self.page.mouse.click(self.cx, self.cy)
        if wait:
            wait()
        else:
            time.sleep(0.3)
        if not capture:
            self.ripple = -1.0
            return
        self.ripple = 0.6
        new = self.grab()
        self.ripple = -1.0
        self.enc.crossfade(new, xfade)
        self.enc.write(new)

    def click_chip(self, n: int, **kw) -> None:
        """Click the n-th quick-start chip. The chips sit under the scenario cards, so the panel (or page) that
        holds them scrolls smoothly while the pointer travels, until the chip is on screen."""
        delta = self.page.evaluate(
            """n => { const c = document.querySelector(`#quickstarts .chip:nth-child(${n})`);
            let s = c.parentElement;
            while (s && s !== document.body) {
              const o = getComputedStyle(s).overflowY;
              if ((o === 'auto' || o === 'scroll') && s.scrollHeight > s.clientHeight) break;
              s = s.parentElement;
            }
            if (!s || s === document.body) s = document.scrollingElement;
            document.querySelectorAll('[data-vid-scroll]').forEach(e => delete e.dataset.vidScroll);
            s.dataset.vidScroll = String(s.scrollTop);
            const r = c.getBoundingClientRect(), lo = 90, hi = window.innerHeight - 40;
            const want = r.bottom > hi ? r.bottom - hi : r.top < lo ? r.top - lo : 0;
            return Math.max(-s.scrollTop, Math.min(want, s.scrollHeight - s.clientHeight - s.scrollTop)); }""",
            n,
        )
        x, y = self.center(f"#quickstarts .chip:nth-child({n})")

        def scroll(t: float) -> None:
            self.page.evaluate(
                """d => { const s = document.querySelector('[data-vid-scroll]');
                s.scrollTop = Number(s.dataset.vidScroll) + d; }""",
                delta * ease(t),
            )

        self.click((x, y - delta), during=scroll if delta else None, **kw)

    def reveal(self, xfade: int = 8) -> None:
        """Cross-fade from the last frame to the page as it is now (after off-camera set-up)."""
        new = self.grab()
        self.enc.crossfade(new, xfade)
        self.enc.write(new)

    # -- app helpers -----------------------------------------------------------------------------------------
    def set_slider(self, value: float, timeout: float = 4.0) -> None:
        """Set the Sky tab time slider (0..1000, fractional allowed) through its own input event, then wait until
        the sky view has rendered the new time (its readout shows the time to the second)."""
        before = self.sky_readout()
        self.page.evaluate(
            """v => { const s = document.getElementById('sky-slider'); s.step = 'any'; s.value = String(v);
            s.dispatchEvent(new Event('input', { bubbles: true })); }""",
            value,
        )
        t0 = time.time()
        while time.time() - t0 < timeout and self.sky_readout() == before:
            time.sleep(0.01)
        self.page.evaluate(
            "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
        )

    def show_playing(self, on: bool) -> None:
        self.page.evaluate(
            "on => document.getElementById('btn-play').classList.toggle('playing', on)", on
        )

    def sky_readout(self) -> str:
        return self.page.evaluate("document.querySelector('.moonat-sky-info')?.innerText || ''")

    def body_az(self, name: str) -> float:
        """Azimuth (deg) of "Sun" or "Earth" from the sky view's readout ("Earth height 28.9° direction W 258.6°")."""
        m = re.search(rf"{name}\s+height\s+\S+\s+direction\s+\S+\s+([\d.]+)°", self.sky_readout())
        return float(m.group(1)) if m else float("nan")

    def center_on(self, name: str, passes: int = 2) -> None:
        """Turn the first sky view (by dragging) so the named body is at its centre: azimuth from the compass,
        height from the body's label, which the view draws level with the body's centre."""
        for _ in range(passes):
            az_c, _ = self.view_center_az()
            self.drag_sky(-100, 0, steps=1)  # calibrate: pixels per degree of azimuth
            az_1, _ = self.view_center_az()
            px_per_deg = 100 / ((((az_1 - az_c) + 540) % 360) - 180)
            label = self.page.evaluate(
                """n => { const f = document.querySelector('#sky-grid .moonat-sky-frame');
                const l = [...f.querySelectorAll('.moonat-sky-label')].find(e => e.textContent.trim() === n);
                return l && !l.classList.contains('below') ? parseFloat(l.style.top) - f.clientHeight / 2 : 0; }""",
                name,
            )
            d_az = (((self.body_az(name) - az_1) + 540) % 360) - 180
            self.drag_sky(-d_az * px_per_deg, -label, steps=1)

    def canvas_box(self) -> dict:
        return self.page.locator("#sky-grid .moonat-sky-frame canvas").first.bounding_box()

    def zoom_sky(self, ticks: int) -> None:
        """Ctrl + wheel over the first sky view: each tick multiplies the field of view by exp(0.12 * sign)."""
        b = self.canvas_box()
        self.page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        self.page.keyboard.down("Control")
        for _ in range(abs(ticks)):
            before = self.draws()
            self.page.mouse.wheel(0, 100 if ticks > 0 else -100)
            self.wait_draw(before)
        self.page.keyboard.up("Control")

    def drag_sky(self, dx: float, dy: float, steps: int = 8) -> None:
        b = self.canvas_box()
        x, y = b["x"] + b["width"] * 0.5, b["y"] + b["height"] * 0.5
        self.page.mouse.move(x, y)
        self.page.mouse.down()
        for i in range(1, steps + 1):
            self.page.mouse.move(x + dx * i / steps, y + dy * i / steps)
        before = self.draws()
        self.page.mouse.up()
        self.wait_draw(before, timeout=0.5)

    def view_center_az(self) -> tuple[float, float]:
        """Azimuth (deg) at the horizontal centre of the first sky view, read from its compass ticks, and the
        compass scale there (px per deg)."""
        ticks = self.page.evaluate("""() => { const v = document.querySelector('#sky-grid .moonat-sky-frame');
            return [...v.querySelectorAll('.moonat-sky-tick')].map(t =>
              [t.textContent.trim(), parseFloat(t.style.left) - v.clientWidth / 2]); }""")
        pts = []
        for label, x in ticks:
            az = COMPASS.get(label)
            if az is None and label.endswith("°"):
                az = float(label[:-1])
            if az is not None:
                pts.append((x, az))
        pts.sort()
        for (x1, a1), (x2, a2) in zip(pts, pts[1:], strict=False):
            if x1 <= 0 <= x2:
                a2 = a1 + ((a2 - a1 + 540) % 360 - 180)
                s = (x2 - x1) / (a2 - a1)
                return (a1 + (0 - x1) / s) % 360, s
        return float("nan"), float("nan")


COMPASS = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}


# ---------------------------------------------------------------------------------------------------------------
# The storyboard


def scene_title(d: Director) -> None:
    """0: title card over the app (a first visit opens Apollo 11 on the Sky tab), then fade to the app."""
    d.card(TITLE_CARD, alpha=1.0)
    d.hold(76)
    d.keyframe("title")
    d.card(None)
    d.hold(12)


def scene_apollo11(d: Director) -> None:
    """1: Apollo 11 on the Sky tab: Focus gives a tall frame with the high Earth and the ground together, like a
    Hasselblad photo; then a short drag of the sky."""
    d.click("#sky-grid .sky-focus-btn", wait=d.wait_sky, xfade=8)
    d.caption("apollo")
    b = d.canvas_box()
    start = (b["x"] + b["width"] * 0.70, b["y"] + b["height"] * 0.55)
    d.move_to(start, 10)
    d.page.mouse.down()
    # Drag the sky a little to the left and back: the view turns, showing the drag-to-look interaction.
    for i in range(1, 25):
        d.cx = start[0] - 160 * math.sin(math.pi * i / 24)
        before = d.draws()
        d.page.mouse.move(d.cx, d.cy)
        d.wait_draw(before, timeout=1.0)
        d.frame()
    d.page.mouse.up()
    d.cursor_on = False
    d.hold(50)
    d.keyframe("apollo11")


def exit_focus(d: Director, xfade: int = 6) -> None:
    """Leave the Sky tab's focus mode with Esc (as a user would), cross-fading to the normal layout."""
    if d.page.evaluate("document.body.classList.contains('sky-focus')"):
        d.page.keyboard.press("Escape")
        time.sleep(0.5)
        d.wait_sky()
        d.reveal(xfade)


def scene_compare(d: Director) -> None:
    """2: 'Compare all Apollo landings' opens the Compare tab with the side-by-side ranked table."""
    d.caption(None)
    exit_focus(d)
    d.cursor_on = True
    d.click_chip(2, wait=d.wait_compare, xfade=8)
    d.caption("compare")
    d.hold(46)
    d.keyframe("compare")
    d.hold(16)


# Eclipse quick start: 2025-03-14 04:30 .. 10:20 UTC at Blue Ghost (slider 0..1000 = 350 min). It opens at 81 %
# covered (u = 250); totality starts near 06:18 (u = 309) and ends with the diamond ring near 08:35 (u = 700).
ECLIPSE_PARTS = [(250.0, 318.0, 72), (686.0, 714.0, 60)]  # (slider from, slider to, frames)


def scene_eclipse(d: Director) -> None:
    """3: Eclipse from the Moon: the Earth slides over the Sun, totality's red ring, then the diamond ring.
    Focus mode, the view centred on the Earth and zoomed in (Ctrl + wheel), constellation lines off; the close-up
    loupes stay on and show the Sun and the Earth magnified."""
    d.caption(None)
    d.click_chip(5, wait=d.wait_sky, capture=False)
    d.page.evaluate("document.querySelector('#sky-grid .sky-focus-btn').click()")
    time.sleep(0.6)
    d.wait_sky()
    d.set_slider(ECLIPSE_PARTS[0][0])
    before = d.draws()
    d.page.evaluate("document.getElementById('btn-look-sun').click()")
    d.wait_draw(before)
    d.center_on("Earth")
    d.zoom_sky(-11)
    d.center_on("Earth", passes=1)
    for name in ("Constellations",):
        d.page.evaluate(
            """n => [...document.querySelectorAll('#sky-grid .moonat-sky-frame button')]
                .find(b => b.getAttribute('aria-label') === n && b.getAttribute('aria-pressed') === 'true')?.click()""",
            name,
        )
    time.sleep(0.3)
    d.cursor_on = False
    d.show_playing(True)
    d.reveal(8)
    d.caption("eclipse")
    for k, (u0, u1, n) in enumerate(ECLIPSE_PARTS):
        if k:  # jump ahead to the end of totality: a short cross-fade
            d.set_slider(u0)
            d.show_playing(True)
            d.reveal(8)
        for i in range(1, n + 1):
            d.set_slider(u0 + (u1 - u0) * i / n)
            d.show_playing(True)
            d.frame()
            if (k, i) in ((0, n), (1, 30)):
                d.keyframe(f"eclipse{k + 1}")
        d.hold(16 if k == 0 else 12)
    d.show_playing(False)


# South-pole timelapse in the quick start's window (2027-01-19 .. 03-22; slider 0..1000), 19-24 Jan: the Sun skims
# 0.0-0.2 deg above the horizontal, lighting the ground with long shadows, and passes the crescent Earth, which
# sinks and sets behind the ridge (u = 79).
POLE_PARTS = [(0.0, 92.0, 122)]  # (slider from, slider to, frames)
POLE_VIEW_AZ = 152.0  # fixed camera, about 105..200 deg: the Sun from 181 to 120 deg, the Earth at 131..141 deg


def scene_pole(d: Director) -> None:
    """4: South pole ridge: a fixed wide view in focus mode, the Sun skimming the lit ground."""
    d.caption(None)
    exit_focus(d)
    d.cursor_on = True
    d.click_chip(3, wait=d.wait_compare, xfade=6)  # opens on the Compare tab
    d.click("#tab-btn-sky", wait=d.wait_sky, n_move=12, capture=False)
    # Off-camera set-up, then a cross-fade: focus mode, the start time, the Earth framing widened by two Ctrl +
    # wheel ticks, turned to POLE_VIEW_AZ and tilted so the horizon sits a little above the middle.
    d.page.evaluate("document.querySelector('#sky-grid .sky-focus-btn').click()")
    time.sleep(0.6)
    d.wait_sky()
    d.set_slider(POLE_PARTS[0][0])
    before = d.draws()
    d.page.evaluate("document.getElementById('btn-look-earth').click()")
    d.wait_draw(before)
    d.zoom_sky(2)
    az0, _ = d.view_center_az()
    d.drag_sky(-100, 0, steps=1)  # calibrate: pixels dragged per degree turned
    az1, _ = d.view_center_az()
    px_per_deg = 100 / (((az1 - az0 + 540) % 360) - 180)
    d.drag_sky(-(((POLE_VIEW_AZ - az1 + 540) % 360) - 180) * px_per_deg, -130, steps=1)
    az_c, scale = d.view_center_az()
    print(
        f"    view centre {az_c:.1f} deg, drag {px_per_deg:.1f} px/deg, compass {scale:.1f} px/deg"
    )
    d.cursor_on = True
    d.reveal(8)
    # Press play (the real button), then step the slider frame by frame.
    d.click(
        "#btn-play",
        wait=lambda: (d.set_slider(POLE_PARTS[0][0]), d.show_playing(True)),
        xfade=1,
    )
    d.cursor_on = False  # the pointer leaves the controls so the play/pause state stays visible
    d.caption("pole")
    for k, (u0, u1, n) in enumerate(POLE_PARTS):
        if k:  # jump ahead in the window: a short cross-fade
            d.set_slider(u0)
            d.show_playing(True)
            d.reveal(10)
        for i in range(1, n + 1):
            d.set_slider(u0 + (u1 - u0) * i / n)
            d.show_playing(True)
            d.frame()
            if i == 52:
                d.keyframe("pole")
    d.show_playing(False)
    d.hold(6)


def scene_farside(d: Director) -> None:
    """5: Far side (Chang'e 4): the Earth stays below the horizon while the Sun crosses the sky."""
    d.caption(None)
    exit_focus(d)
    d.cursor_on = True
    d.click_chip(4, wait=d.wait_sky, xfade=8)
    d.caption("farside")
    d.cursor_on = False
    d.hold(10)
    n = 70
    for i in range(1, n + 1):
        d.set_slider(760.0 * i / n)
        d.show_playing(True)
        d.frame()
        if i == n // 2:
            d.keyframe("farside")
    d.show_playing(False)
    d.hold(6)


def scene_end(d: Director) -> None:
    """6: end card, padded so the whole video lands on TARGET_FRAMES."""
    d.caption(None)
    d.card(END_CARD)
    d.hold(14)
    d.keyframe("end")
    remaining = TARGET_FRAMES - d.enc.n
    if remaining < 45:
        print(f"  warning: only {remaining} frames left for the end card", file=sys.stderr)
    d.hold(max(45, remaining))


SCENES = [
    scene_title,
    scene_apollo11,
    scene_compare,
    scene_eclipse,
    scene_pole,
    scene_farside,
    scene_end,
]
# Saved to docs/figures/video_<name>.png for review.
KEYFRAMES = ["apollo11", "compare", "eclipse1", "eclipse2", "pole", "farside"]


# ---------------------------------------------------------------------------------------------------------------


def save_keyframe(img: np.ndarray, path: Path, max_bytes: int = 1_000_000) -> None:
    """Save a 1280x720 PNG; quantize to a palette if the file would be larger than max_bytes."""
    im = Image.fromarray(img).resize((1280, 720), Image.LANCZOS)
    im.save(path, optimize=True)
    if path.stat().st_size > max_bytes:
        im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(
            path, optimize=True
        )


def probe(path: Path) -> tuple[int, float, str]:
    """(frames, seconds, ffmpeg stream line) of a video file, from the bundled ffmpeg."""
    frames, secs = imageio_ffmpeg.count_frames_and_secs(str(path))
    info = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-i", str(path)],
        capture_output=True,
        text=True,
    ).stderr
    stream = next((ln.strip() for ln in info.splitlines() if "Video:" in ln), "")
    return frames, secs, stream


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--url", help="record this deployed URL instead of serving web/ locally")
    ap.add_argument("--out-dir", default=str(ROOT / "outputs" / "video"))
    ap.add_argument(
        "--figures-dir",
        default=str(ROOT / "docs" / "figures"),
        help="where video_*.png key frames go",
    )
    ap.add_argument("--no-keyframes", action="store_true")
    ap.add_argument("--theme", choices=["dark", "light"], default="dark")
    ap.add_argument("--headed", action="store_true", help="show the browser window")
    ap.add_argument(
        "--only",
        choices=[s.__name__.removeprefix("scene_") for s in SCENES],
        help="preview one scene to outputs/video/preview_<scene>.mp4 (no 720p copy, no key frames)",
    )
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    mp4 = out_dir / "moonat_demo.mp4"
    mp4_720 = out_dir / "moonat_demo_720p.mp4"
    scenes = SCENES
    if args.only:
        scenes = [s for s in SCENES if s.__name__ == f"scene_{args.only}"]
        mp4 = out_dir / f"preview_{args.only}.mp4"

    httpd = None
    url = args.url
    if not url:
        url, httpd = serve(ROOT / "web")
    print(f"recording {url}")

    t_start = time.time()
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(out_dir / ".edge-profile"),
            channel="msedge",
            headless=not args.headed,
            viewport={"width": W, "height": H},
            device_scale_factor=1,
            color_scheme=args.theme,
            args=[
                "--ignore-gpu-blocklist",
                "--enable-gpu-rasterization",
                "--force-color-profile=srgb",
                "--hide-scrollbars",
                "--window-size=1920,1200",
            ],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.add_init_script(INIT_SCRIPT.replace("%THEME%", args.theme))
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(url, wait_until="load")
        page.add_style_tag(content=OVERLAY_CSS)
        page.evaluate(OVERLAY_JS)
        page.mouse.move(1250, 640)

        enc = Encoder(mp4)
        d = Director(page, enc)
        d.wait_sky()  # a first visit opens Apollo 11 on the Sky tab
        try:
            if args.only:
                d.frame()  # a first frame for cross-fades to start from
            for scene in scenes:
                n0 = enc.n
                scene(d)
                print(
                    f"  {scene.__name__:16s} {n0 / FPS:5.2f}-{enc.n / FPS:5.2f} s ({enc.n - n0} frames)"
                )
        finally:
            enc.close()
            ctx.close()
            if httpd:
                httpd.shutdown()
        if errors:
            print("page errors:\n  " + "\n  ".join(errors), file=sys.stderr)
    if args.only:
        frames, secs, _ = probe(mp4)
        print(f"{mp4}: {frames} frames, {secs:.2f} s (preview)")
        return 0

    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(mp4),
            "-vf",
            "scale=1280:720:flags=lanczos",
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "19",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(FPS),
            "-movflags",
            "+faststart",
            "-metadata",
            f"comment=Screen capture of the Moonat web app. {DISCLOSURE}",
            str(mp4_720),
        ],
        check=True,
    )

    if not args.no_keyframes:
        fig_dir = Path(args.figures_dir)
        for name in KEYFRAMES:
            if name in enc.keep:
                path = fig_dir / f"video_{name}.png"
                save_keyframe(enc.keep[name], path)
                print(
                    f"  key frame {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}"
                    f" ({path.stat().st_size / 1e6:.2f} MB)"
                )

    ok = True
    for f in (mp4, mp4_720):
        frames, secs, stream = probe(f)
        good = frames <= MAX_FRAMES and secs <= 30.0
        ok &= good
        print(
            f"{f}: {frames} frames, {secs:.2f} s, {f.stat().st_size / 1e6:.1f} MB {'OK' if good else 'TOO LONG'}"
        )
        print(f"  {stream}")
    print(f"done in {time.time() - t_start:.0f} s")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
