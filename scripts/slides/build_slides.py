# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Rebuild the 7-slide presentation (web/slides/): QR code, app screenshots, layout check and PDF.

    uv run python scripts/slides/build_slides.py https://shmonat.github.io/Moonat-Navigator/

1. QR code to the live app -> web/slides/img/qr.svg (qrcode package).
2. Screenshots of the site given (real renders, the installed Microsoft Edge via Playwright) -> web/slides/img/*.jpg.
   Each state is reached by a share-link hash (web/js/app/state.js), so no story button or panel layout is needed.
3. Layout check of the local deck at 1920x1080 and 390x844: nothing outside its slide, nothing under the footer.
4. PDF of the local deck, one slide per page -> web/slides/moonat_slides.pdf (7 pages).

Options: --skip-shots (keep the screenshots, redo QR, check and PDF), --headed (show the browser).
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import re
import sys
import threading
import time
from datetime import UTC, datetime, timedelta
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

# Sites (web/data/sites.json): StarHab home base and the Beresheet crash point.
STARHAB = (-85.96775, -2.28748)
BERESHEET = (32.5956, 19.3496)
SYNODIC = timedelta(days=29.530589)


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


def iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def shot_plan() -> list[dict]:
    """The screenshots: name, hash, what to crop ('view' | 'sky' | 'globe' | 'left') and the saved size."""
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    # 18 Aug 2030, 09:00 UTC: Sun 3.9 deg up in the north-west, Earth 8.6 deg up in the north (moonat.ephem.direct).
    starhab = [
        [
            "StarHab (home base)",
            *STARHAB,
            "2030-08-18T09:00:00Z",
            "2030-09-01T09:00:00Z",
            "starhab",
            0,
        ]
    ]
    rover = [
        [
            "VIPER-class: pole to ridge",
            -90,
            0,
            "2027-10-15T00:00:00Z",
            0,
            0,
            0,
            [-89.4395, -137.1934, "viper", 0.2, 15, 15, 0, 0],
        ]
    ]
    beresheet = [["Beresheet crash site", *BERESHEET, iso(now), iso(now + SYNODIC), "beresheet", 0]]
    return [
        {"name": "app", "hash": "", "crop": "view", "size": (1600, 900)},
        {
            "name": "starhab",
            "hash": link_hash(starhab, view="337,7,95"),
            "crop": "sky",
            "size": (1280, 720),
        },
        {
            "name": "layers",
            "hash": link_hash(starhab, layers="psr.sun"),
            "crop": "globe",
            "size": (760, 480),
            "zoom": 3,
            "pole_y": 0.615,
        },
        {"name": "rover", "hash": link_hash(rover), "crop": "globe", "size": (760, 480)},
        {
            "name": "beresheet",
            "hash": link_hash(beresheet),
            "crop": "sky",
            "size": (760, 480),
            "viewport": (1280, 800),
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


def crop_rect(page: Page, crop: str, vw: int, vh: int) -> tuple[int, int, int, int]:
    """Crop (left, top, right, bottom) for 'view' | 'sky' | 'globe' | 'left'; the whole view when nothing matches."""
    full = (0, 0, vw, vh)
    if crop == "sky":
        b = box(page, ["#sky-grid .sky-card", "#sky-panel", "#sky-stage"])
    elif crop == "globe":
        b = box(page, ["#map", "#map-block"])
    elif crop == "left":
        b = box(page, ["#inputs"])
    else:
        return full
    if not b:
        return full
    left, top = max(0, int(b["x"])), max(0, int(b["y"]))
    return (left, top, min(vw, int(b["x"] + b["w"])), min(vh, int(b["y"] + b["h"])))


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


def capture(site: str, headed: bool) -> None:
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
            vw, vh = item.get(
                "viewport", (1920, 1080) if item["crop"] in ("view", "sky") else (1600, 1200)
            )
            ctx = browser.new_context(
                viewport={"width": vw, "height": vh}, color_scheme="dark", device_scale_factor=1
            )
            page = ctx.new_page()
            page.add_init_script(INIT_SCRIPT)
            errors: list[str] = []
            page.on("pageerror", lambda e, errors=errors: errors.append(str(e)))
            watch = Watch(page)
            t0 = time.time()
            page.goto(site + item["hash"], wait_until="load")
            time.sleep(3.0)
            settle(page, watch)
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
                    half_h = g["w"] * item["size"][1] / item["size"][0] / 2
                    rect = (
                        int(g["x"]),
                        int(max(g["y"], cy - half_h)),
                        int(g["x"] + g["w"]),
                        int(min(g["y"] + g["h"], cy + half_h)),
                    )
            page.evaluate("window.scrollTo(0, 0)")
            time.sleep(0.5)
            png = page.screenshot()
            img = Image.open(io.BytesIO(png))
            rect = rect or crop_rect(page, item["crop"], vw, vh)
            out = IMG / f"{item['name']}.jpg"
            save_jpeg(fit_crop(img, rect, item["size"]), out)
            print(
                f"  {item['name']:10s} {out.stat().st_size / 1024:6.0f} kB  {time.time() - t0:5.1f} s"
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
    ap.add_argument(
        "--slide-shots", type=Path, help="also save each slide as PNG here (for review)"
    )
    args = ap.parse_args()

    IMG.mkdir(parents=True, exist_ok=True)
    print(f"QR code: {make_qr().relative_to(ROOT)}")
    if not args.skip_shots:
        print(f"Screenshots of {args.site_url}:")
        capture(args.site_url, args.headed)
    print("Deck check and PDF:")
    ok = check_and_pdf(args.headed, args.slide_shots)
    total = sum(f.stat().st_size for f in SLIDES.rglob("*") if f.is_file())
    print(f"Deck folder: {total / 1024 / 1024:.2f} MB")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
