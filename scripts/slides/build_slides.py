# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Rebuild the 7-slide presentation (web/slides/): QR code, app screenshots, layout check and PDF.

    uv run python scripts/slides/build_slides.py https://shmonat.github.io/Moonat-Navigator/

1. QR code to the live app -> web/slides/img/qr.svg (qrcode package).
2. Screenshots of the site given (real renders, the installed Microsoft Edge via Playwright) -> web/slides/img/*.jpg.
   States come from share-link hashes (web/js/app/state.js), story rows of the globe's search list and clicks; the
   Apollo 15 render is framed like NASA photo AS15-88-11863, whose top band is cut from the raw-data copy.
   Retake some only: --only rover,driver (names of the saved images).
3. Layout check of the local deck at 1920x1080 and 390x844: nothing outside its slide, nothing under the footer.
4. PDF of the local deck, one slide per page -> web/slides/moonat_slides.pdf (7 pages).

Options: --skip-shots (keep the screenshots, redo QR, check and PDF), --headed (show the browser).
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import os
import re
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import qrcode
import qrcode.image.svg
from PIL import Image
from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
SLIDES = WEB / "slides"
IMG = SLIDES / "img"
PDF = SLIDES / "moonat_slides.pdf"
LIVE_URL = "https://shmonat.github.io/Moonat-Navigator/"
N_SLIDES = 7
AI_NOTE = "AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team."
JPEG_NOTE = (
    "Real render of the Moonat app, captured by scripts/slides/build_slides.py. Tooling: " + AI_NOTE
)

INIT_SCRIPT = """
window.__draws = 0;
const __drawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (...a) { window.__draws++; return __drawImage.apply(this, a); };
try { localStorage.setItem("moonat-theme", "dark"); localStorage.setItem("moonat-intro", "off"); } catch (e) { /* blocked */ }
"""

# Places: the Malapert massif crest near the south pole, and the Apollo 15 landing site (web/data/sites.json).
MALAPERT = (-85.96775, -2.28748)
APOLLO15 = (26.1322, 3.6339)

# NASA photo AS15-88-11863 (Apollo 15, Scott salutes, Hadley Delta behind; public domain), and the camera fitted to its
# skyline in docs/validation/real_photos.md: heading 164.4 deg, pitch -4.9 deg, horizontal field of view 46.4 deg.
PHOTO_ID = "AS15-88-11863"
PHOTO_HEADING_DEG = 164.4
PHOTO_PITCH_DEG = -4.9
PHOTO_HFOV_DEG = 46.4
# The part of the photo the slide shows: the top 60 % (sky, Hadley Delta, Scott, the flag and the LM). Its vertical
# centre is about 9.5 deg above the camera axis, so Moonat's camera looks at pitch + 9.5 deg.
PHOTO_BAND = 0.60
PHOTO_BAND_CENTRE_DEG = 9.5
PHOTO_SIZE = (960, 604)  # px; the photo band's aspect (3904 x 0.6 * 4095)


def raw_photo() -> Path | None:
    """The NASA photo in the shared raw-data folder (MOONAT_DATA_DIR, this checkout, or the main checkout)."""
    roots = [
        os.environ.get("MOONAT_DATA_DIR", ""),
        ROOT / "data" / "raw",
        ROOT.parents[2] / "data" / "raw",
    ]
    for r in roots:
        if r and (Path(r) / "photos" / f"{PHOTO_ID}.jpg").is_file():
            return Path(r) / "photos" / f"{PHOTO_ID}.jpg"
    return None


# ------------------------------------------------------------------------------------------------
# Share-link hashes (format of encodeHash in web/js/app/state.js)


def b64url(obj) -> str:
    raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def link_hash(rows: list, body: str = "sun", layers: str = "", t_s: int = 0, view: str = "") -> str:
    """'#...' for the scenarios `rows` ([label, lat, lon, start, end|0, site_id|0, color(, route)]); `view`: "az,el,fov"."""
    parts = []
    if view:
        parts.append(f"v={view}")
    if body == "earth":
        parts.append("b=earth")
    if t_s > 0:
        parts.append(f"t={t_s}")
    if layers:
        parts.append(f"ml={layers}")
    parts.append("s=" + b64url(rows))
    return "#" + "&".join(parts)


def shot_plan() -> list[dict]:
    """The screenshots. Each item: a page state (`hash`, or a `story` key clicked in the globe's search list, then
    `clicks`), the window (`viewport` in CSS px, `dsf` device scale factor, `mobile`) and one or more `crops`:
    (file name, region, saved size). Regions: 'view' (the whole window), 'sky' (the first sky view), 'globe', 'grid'
    (every sky view), 'photo' (the first sky view's picture, framed like the NASA photo) or 'el:<css selector>'."""
    # 18 Aug 2030, 09:00 UTC: Sun 3.9 deg up in the north-west, Earth 8.6 deg up in the north (moonat.ephem.direct).
    malapert = [
        ["Malapert massif", *MALAPERT, "2030-08-18T09:00:00Z", "2030-09-01T09:00:00Z", 0, 0]
    ]
    rover_route = [-89.4395, -137.1934, "viper", 0.2, 15, 15, 0, 0]
    rover = [["VIPER-class: pole to ridge", -90, 0, "2027-10-15T00:00:00Z", 0, 0, 0, rover_route]]
    apollo15 = [["Apollo 15, Hadley Delta", *APOLLO15, "1971-08-01T18:30:00Z", 0, "apollo15", 0]]
    return [
        # Slide 3: the opening view, in a smaller window so the app's text reads larger.
        {
            "hash": "",
            "viewport": (1280, 720),
            "dsf": 2,
            "crops": [("app", "view", (1600, 900))],
        },
        # Slide 2 (pins on the globe) and slide 6 (the six-view compare grid): "Compare all Apollo landings".
        {
            "story": "apollo-all",
            "viewport": (1600, 900),
            "dsf": 1.5,
            "wait": 4,
            "crops": [("pins", "globe", (900, 760)), ("compare", "grid", (760, 480))],
        },
        # Slide 4: a polar sky at low Sun, with the Sun, the Earth and the LOLA skyline in one frame.
        {
            "hash": link_hash(malapert, view="337,7,95"),
            "viewport": (1920, 1080),
            "crops": [("sky", "sky", (1280, 720))],
        },
        # Slide 5: the "South pole ridge" story in Both mode (Sun and Earth data together).
        {
            "story": "pole",
            "clicks": ['#body-toggle button[data-body="both"]'],
            "viewport": (1600, 900),
            "dsf": 1.5,
            "crops": [("both", "el:#sec-both", (900, 0))],
        },
        # Slide 5: Moonat's sky at the Apollo 15 site, framed like the NASA photo AS15-88-11863.
        {
            "hash": link_hash(
                apollo15,
                view=f"{PHOTO_HEADING_DEG},{PHOTO_PITCH_DEG + PHOTO_BAND_CENTRE_DEG:.1f},60",
            ),
            "viewport": (1600, 1000),
            "dsf": 1.5,
            "photo_view": True,
            "crops": [("apollo15", "photo", PHOTO_SIZE)],
        },
        # Slide 6: the rover trip, with the trip panel and the route on the globe.
        {
            "hash": link_hash(rover),
            "viewport": (1600, 1300),
            "dsf": 1.25,
            "wait": 4,
            "ready_text": "Fastest route",
            "crops": [("rover", "view", (1600, 1300))],
        },
        # Slide 6: the driver's view, two hours into the drive.
        {
            "hash": link_hash(rover, t_s=7200),
            "viewport": (1600, 900),
            "ready_text": "Fastest route",
            "clicks": ["text=Driver's view"],
            "wait": 3,
            "crops": [("driver", "sky", (760, 480))],
        },
        # Slide 6: map layers at the south pole: shadowed regions, sunlit ground and contour lines.
        {
            "hash": link_hash(malapert, layers="psr.sun.ct"),
            "viewport": (1600, 1200),
            "zoom": 3,
            "pole_y": 0.615,
            "crops": [("layers", "globe", (760, 480))],
        },
        # Slide 7: the app on a phone.
        {
            "hash": "",
            "viewport": (390, 844),
            "dsf": 2,
            "mobile": True,
            "crops": [("phone", "view", (585, 1266))],
        },
    ]


# ------------------------------------------------------------------------------------------------
# QR code


def make_qr() -> Path:
    img = qrcode.make(LIVE_URL, image_factory=qrcode.image.svg.SvgPathImage, border=2)
    buf = io.BytesIO()
    img.save(buf)
    svg = buf.getvalue().decode("utf-8")
    svg = re.sub(
        r"(<svg\b)",
        f"<!-- {AI_NOTE} QR code to {LIVE_URL} (qrcode package). -->\n\\1",
        svg,
        count=1,
    )
    out = IMG / "qr.svg"
    out.write_text(svg, encoding="utf-8")
    return out


# ------------------------------------------------------------------------------------------------
# Browser helpers


def serve(directory: Path) -> tuple[str, ThreadingHTTPServer]:
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(directory)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{httpd.server_address[1]}/", httpd


class Watch:
    """Requests in flight on a page."""

    def __init__(self, page: Page):
        self.pending: set = set()
        page.on("request", lambda r: self.pending.add(r))
        page.on("requestfinished", lambda r: self.pending.discard(r))
        page.on("requestfailed", lambda r: self.pending.discard(r))


def settle(page: Page, watch: Watch, quiet_s: float = 2.0, timeout: float = 90.0) -> None:
    """Wait until no request is in flight, the app's busy badge is hidden and the canvases stop redrawing."""
    t0 = time.time()
    quiet_since = None
    last_draws = -1
    while time.time() - t0 < timeout:
        busy = page.evaluate(
            "(() => { const b = document.getElementById('busy'); return !!b && !b.hidden; })()"
        )
        draws = page.evaluate("window.__draws || 0")
        if watch.pending or busy or draws != last_draws:
            quiet_since = None
        elif quiet_since is None:
            quiet_since = time.time()
        elif time.time() - quiet_since >= quiet_s:
            return
        last_draws = draws
        time.sleep(0.25)
    print(f"  warning: page did not settle in {timeout:.0f} s", file=sys.stderr)


def box(page: Page, selectors: list[str]) -> dict | None:
    """Bounding box (viewport px) of the first visible element among `selectors`."""
    for sel in selectors:
        b = page.evaluate(
            """(sel) => { const e = document.querySelector(sel); if (!e) return null;
              const r = e.getBoundingClientRect(); return r.width > 50 && r.height > 50 ? {x: r.x, y: r.y, w: r.width, h: r.height} : null; }""",
            sel,
        )
        if b:
            return b
    return None


HIDE_FIXED_JS = """(sel) => { const target = document.querySelector(sel);
  for (const e of document.querySelectorAll("body *")) { const p = getComputedStyle(e).position;
    if ((p === "fixed" || p === "sticky") && !e.contains(target)) e.style.visibility = "hidden"; } }"""

SKY_CANVAS_JS = """() => { const card = document.querySelector('#sky-grid .sky-card'); if (!card) return null;
  let best = null;
  for (const c of card.querySelectorAll('canvas')) { const r = c.getBoundingClientRect();
    if (!best || r.width * r.height > best.w * best.h) best = {x: r.x, y: r.y, w: r.width, h: r.height}; }
  return best; }"""


def crop_rect(page: Page, crop: str, vw: int, vh: int, dsf: float) -> tuple[int, int, int, int]:
    """Crop (left, top, right, bottom) in screenshot px for 'view' | 'sky' | 'globe' | 'grid' | 'photo'; the whole
    view when nothing matches."""
    full = (0, 0, int(vw * dsf), int(vh * dsf))
    if crop == "sky":
        b = box(page, ["#sky-grid .sky-card", "#sky-panel", "#sky-stage"])
    elif crop == "globe":
        b = box(page, ["#map", "#map-block"])
    elif crop == "grid":
        b = box(page, ["#sky-grid", "#sky-panel"])
    elif crop == "photo":
        b = page.evaluate(SKY_CANVAS_JS)
    else:
        return full
    if not b:
        return full
    left, top = max(0, int(b["x"] * dsf)), max(0, int(b["y"] * dsf))
    return (
        left,
        top,
        min(full[2], int((b["x"] + b["w"]) * dsf)),
        min(full[3], int((b["y"] + b["h"]) * dsf)),
    )


def photo_hfov(page: Page) -> float | None:
    """Horizontal field of view (deg) that makes the sky view's picture, centre-cropped to the photo band's aspect,
    span the photo's 46.4 deg (rectilinear camera: tan(half-angle) scales with the width)."""
    b = page.evaluate(SKY_CANVAS_JS)
    if not b or b["h"] < 50:
        return None
    band_aspect = PHOTO_SIZE[0] / PHOTO_SIZE[1]
    canvas_aspect = b["w"] / b["h"]
    t = math.tan(math.radians(PHOTO_HFOV_DEG / 2)) * max(1.0, canvas_aspect / band_aspect)
    return 2 * math.degrees(math.atan(t))


def photo_band() -> Path | None:
    """The NASA photo's top band (PHOTO_BAND of its height, full width) -> web/slides/img/as15-88-11863.jpg."""
    src = raw_photo()
    if not src:
        print(
            f"  note: {PHOTO_ID}.jpg not found in the raw-data folder; keeping the slide's copy",
            file=sys.stderr,
        )
        return None
    img = Image.open(src).convert("RGB")
    band = img.crop((0, 0, img.width, round(img.height * PHOTO_BAND)))
    out = IMG / f"{PHOTO_ID.lower()}.jpg"
    band.resize(PHOTO_SIZE, Image.LANCZOS).save(
        out,
        "JPEG",
        quality=84,
        optimize=True,
        progressive=True,
        comment=f"NASA photo {PHOTO_ID} (public domain), top {PHOTO_BAND:.0%} of the frame. {AI_NOTE}".encode(),
    )
    return out


def fit_crop(
    img: Image.Image, rect: tuple[int, int, int, int], size: tuple[int, int]
) -> Image.Image:
    """Crop `img` to the largest box of aspect size[0]:size[1] centred in `rect` (inside the image), then resize."""
    left, top, right, bottom = rect
    w, h = right - left, bottom - top
    aspect = size[0] / size[1]
    if w / h > aspect:  # too wide: trim the sides
        nw = int(h * aspect)
        left += (w - nw) // 2
        w = nw
    else:  # too tall: trim the top and bottom
        nh = int(w / aspect)
        top += (h - nh) // 2
        h = nh
    return img.crop((left, top, left + w, top + h)).resize(size, Image.LANCZOS)


def save_jpeg(img: Image.Image, path: Path, quality: int = 80) -> None:
    img.convert("RGB").save(
        path, "JPEG", quality=quality, optimize=True, progressive=True, comment=JPEG_NOTE.encode()
    )


def capture(site: str, headed: bool, only: set[str] | None = None) -> None:
    site = site if site.endswith("/") else site + "/"
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="msedge",
            headless=not headed,
            args=[
                "--ignore-gpu-blocklist",
                "--enable-gpu-rasterization",
                "--hide-scrollbars",
                "--force-color-profile=srgb",
            ],
        )
        for item in shot_plan():
            if only and not only & {c[0] for c in item["crops"]}:
                continue
            vw, vh = item["viewport"]
            dsf = item.get("dsf", 1)
            ctx = browser.new_context(
                viewport={"width": vw, "height": vh},
                color_scheme="dark",
                device_scale_factor=dsf,
                is_mobile=item.get("mobile", False),
                has_touch=item.get("mobile", False),
            )
            page = ctx.new_page()
            page.add_init_script(INIT_SCRIPT)
            errors: list[str] = []
            page.on("pageerror", lambda e, errors=errors: errors.append(str(e)))
            watch = Watch(page)
            t0 = time.time()
            names = ", ".join(c[0] for c in item["crops"])
            for attempt in range(3):
                page.goto(site + item.get("hash", ""), wait_until="load", timeout=90000)
                time.sleep(3.0)
                if item.get("story"):
                    # A story: the globe's search box lists them; click the row by its key.
                    settle(page, watch, timeout=30)
                    page.click("#globe-search")
                    page.focus("#globe-search")
                    page.locator(f'.gs-story[data-story="{item["story"]}"]').first.click(
                        timeout=10000
                    )
                    time.sleep(2.0)
                if not item.get("ready_text"):
                    settle(page, watch)
                    break
                # Wait for visible text that the page shows once its work is done (the rover's planned route); the
                # live terrain service is sometimes slow, so load the page again if it does not come.
                try:
                    page.get_by_text(item["ready_text"]).first.wait_for(
                        state="visible", timeout=60000
                    )
                    settle(page, watch, timeout=30)
                    break
                except Exception:  # noqa: BLE001 - not ready: try again
                    print(
                        f"  {names}: '{item['ready_text']}' not shown (attempt {attempt + 1})",
                        file=sys.stderr,
                    )
            if item.get("photo_view"):
                # Frame the sky view like the photo: set the field of view from the picture's measured aspect.
                hfov = photo_hfov(page)
                if hfov:
                    page.goto(
                        site + item["hash"].replace(",60&", f",{hfov:.1f}&"), wait_until="load"
                    )
                    page.reload(wait_until="load")
                    time.sleep(3.0)
                    settle(page, watch)
            for sel in item.get("clicks", []):
                try:
                    page.locator(sel).first.click(timeout=10000)
                    time.sleep(1.0)
                    settle(page, watch, quiet_s=1.5, timeout=30)
                except Exception:  # noqa: BLE001 - the control is missing: shoot the page as it is
                    print(f"  note: could not click {sel}", file=sys.stderr)
            # The globe's turn and zoom to the place (WebGL, not counted by settle).
            time.sleep(item.get("wait", 0))
            rect = None
            if item.get("zoom"):
                # The globe's "South pole" button (visible text), then wheel zoom about the pole, which sits at
                # `pole_y` of the globe box's height in that view.
                try:
                    page.get_by_role("button", name="South pole", exact=True).first.click(
                        timeout=5000
                    )
                    time.sleep(1.5)
                except Exception:  # noqa: BLE001 - no such button: zoom the view as it is
                    print(
                        "  note: no 'South pole' button; zooming the globe as it opened",
                        file=sys.stderr,
                    )
                g = box(page, ["#map", "#map-block"])
                if g:
                    cx, cy = g["x"] + g["w"] / 2, g["y"] + g["h"] * item.get("pole_y", 0.5)
                    page.mouse.move(cx, cy)
                    for _ in range(item["zoom"]):
                        page.mouse.wheel(0, -240)
                        time.sleep(0.4)
                    page.mouse.move(5, vh - 5)
                    settle(page, watch, quiet_s=1.5, timeout=30)
                    size = item["crops"][0][2]
                    half_h = g["w"] * size[1] / size[0] / 2
                    rect = tuple(
                        int(v * dsf)
                        for v in (
                            g["x"],
                            max(g["y"], cy - half_h),
                            g["x"] + g["w"],
                            min(g["y"] + g["h"], cy + half_h),
                        )
                    )
            page.evaluate("window.scrollTo(0, 0)")
            time.sleep(0.5)
            img = Image.open(io.BytesIO(page.screenshot()))
            for name, crop, size in item["crops"]:
                if crop.startswith("el:"):
                    # Hide the sticky page header (and other fixed bars) so they do not cover the element.
                    page.evaluate(HIDE_FIXED_JS, crop[3:])
                    shot = Image.open(io.BytesIO(page.locator(crop[3:]).first.screenshot()))
                    r = (0, 0, shot.width, shot.height)
                else:
                    shot = img
                    r = rect or crop_rect(page, crop, vw, vh, dsf)
                if not size[1]:  # height from the crop's own aspect
                    size = (size[0], round(size[0] * (r[3] - r[1]) / (r[2] - r[0])))
                out = IMG / f"{name}.jpg"
                save_jpeg(fit_crop(shot, r, size), out)
                print(
                    f"  {name:10s} {size[0]}x{size[1]} {out.stat().st_size / 1024:6.0f} kB  {time.time() - t0:5.1f} s"
                    + (f"  page errors: {errors[:2]}" if errors else "")
                )
            ctx.close()
        browser.close()


# ------------------------------------------------------------------------------------------------
# Deck checks and PDF

CHECK_JS = """(mode) => {
  const out = [];
  const slides = [...document.querySelectorAll('.slide')];
  slides.forEach((s, i) => {
    if (mode === 'stage') { show(i, { scroll: false }); }
    const r = s.getBoundingClientRect();
    const foot = s.querySelector('.foot');
    const fr = foot ? foot.getBoundingClientRect() : null;
    if (mode === 'stage' && s.scrollHeight > s.clientHeight + 1) out.push(`slide ${i + 1}: content ${s.scrollHeight} px tall > ${s.clientHeight}`);
    for (const e of s.querySelectorAll('*')) {
      if (e.closest('defs, symbol') || e.tagName === 'use') continue;
      const b = e.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      if (b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1) {
        out.push(`slide ${i + 1}: <${e.tagName.toLowerCase()} class="${e.className.baseVal ?? e.className}"> outside the slide`);
      }
      if (fr && !foot.contains(e) && b.bottom > fr.top + 1 && b.top < fr.top) {
        out.push(`slide ${i + 1}: <${e.tagName.toLowerCase()} class="${e.className.baseVal ?? e.className}"> runs into the footer`);
      }
      if (mode === 'phone' && b.right > innerWidth + 1) out.push(`slide ${i + 1}: <${e.tagName.toLowerCase()}> wider than the phone`);
    }
  });
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} px)`);
  return { n: slides.length, problems: [...new Set(out)].slice(0, 30) };
}"""


def wait_images(page: Page) -> None:
    page.wait_for_function(
        "[...document.images].every(i => i.complete && i.naturalWidth > 0)", timeout=20000
    )


def check_and_pdf(headed: bool, shots_dir: Path | None = None) -> bool:
    base, httpd = serve(WEB)
    ok = True
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge", headless=not headed)
            for mode, vp in (("stage", (1920, 1080)), ("phone", (390, 844))):
                ctx = browser.new_context(
                    viewport={"width": vp[0], "height": vp[1]}, device_scale_factor=1
                )
                page = ctx.new_page()
                page.goto(base + "slides/", wait_until="load")
                wait_images(page)
                res = page.evaluate(CHECK_JS, mode)
                if shots_dir:
                    shots_dir.mkdir(parents=True, exist_ok=True)
                    if mode == "stage":
                        for i in range(res["n"]):
                            page.evaluate(f"show({i}, {{ scroll: false }})")
                            page.screenshot(path=str(shots_dir / f"slide{i + 1}_1920.png"))
                    else:
                        page.screenshot(path=str(shots_dir / "phone_390_full.png"), full_page=True)
                status = "ok" if not res["problems"] and res["n"] == N_SLIDES else "PROBLEMS"
                print(f"  {mode} {vp[0]}x{vp[1]}: {res['n']} slides, {status}")
                for line in res["problems"]:
                    print(f"    {line}")
                ok = ok and status == "ok"
                ctx.close()
            ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
            page = ctx.new_page()
            page.goto(base + "slides/", wait_until="load")
            wait_images(page)
            page.emulate_media(media="print")
            page.pdf(
                path=str(PDF),
                width="1920px",
                height="1080px",
                print_background=True,
                prefer_css_page_size=True,
            )
            ctx.close()
            browser.close()
    finally:
        httpd.shutdown()
    pages = len(re.findall(rb"/Type\s*/Page(?![s\w])", PDF.read_bytes()))
    print(f"  PDF {PDF.relative_to(ROOT)}: {pages} pages, {PDF.stat().st_size / 1024:.0f} kB")
    return ok and pages == N_SLIDES


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "site_url",
        nargs="?",
        default=LIVE_URL,
        help="the Moonat site to screenshot (default: the live site)",
    )
    ap.add_argument(
        "--skip-shots", action="store_true", help="keep the screenshots in web/slides/img/"
    )
    ap.add_argument("--headed", action="store_true", help="show the browser window")
    ap.add_argument("--only", help="comma-separated screenshot names to retake (e.g. rover,driver)")
    ap.add_argument(
        "--slide-shots", type=Path, help="also save each slide as PNG here (for review)"
    )
    args = ap.parse_args()

    IMG.mkdir(parents=True, exist_ok=True)
    print(f"QR code: {make_qr().relative_to(ROOT)}")
    if not args.skip_shots:
        print(f"Screenshots of {args.site_url}:")
        band = photo_band()
        if band:
            print(f"  {band.name} (NASA photo, top band)")
        capture(args.site_url, args.headed, set(args.only.split(",")) if args.only else None)
    print("Deck check and PDF:")
    ok = check_and_pdf(args.headed, args.slide_shots)
    total = sum(f.stat().st_size for f in SLIDES.rglob("*") if f.is_file())
    print(f"Deck folder: {total / 1024 / 1024:.2f} MB")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
