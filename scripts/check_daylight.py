# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Check the globe's day and night in the real page (Playwright + the installed Microsoft Edge) and save screenshots.

Scenarios: Apollo 11 at landing (dark and light themes), the eclipse story (partial phase and totality), the south
pole story with the polar layers on, a playback of the south pole story at 1 day/s in the south pole view (two
frames about 1 s apart, and the frame rate with the shading on and off), the Layers switch and the share link
("ml=noday"), and the phone (390 x 844, touch). Every scenario fails on a console error or warning. Screenshots:
outputs/daylight/*.png (or --out).

Run with a local server (any free port):
    uv run python -m http.server -d web 8765 --bind 127.0.0.1
    uv run python scripts/check_daylight.py --url http://127.0.0.1:8765
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

READY_JS = """() => { const c = [...document.querySelectorAll('#sky-grid .sky-card')];
  return c.length > 0 && c.every((x) => !x.querySelector('.sky-loading') && x.querySelector('canvas')
    && x.querySelector('.sky-card-foot').textContent.trim().length > 0); }"""
GLOBE_JS = """() => { const g = document.querySelector('#map .globe');
  return !!g && g.dataset.loaded === 'true' && !!g.dataset.daylight; }"""
STATE_JS = """() => { const g = document.querySelector('#map .globe'); const c = document.querySelector('.globe-daylight');
  return { daylight: g?.dataset.daylight, caption: c && !c.hidden ? c.textContent : null, hash: location.hash,
    clock: document.getElementById('sky-clock').textContent,
    foot: document.querySelector('#sky-grid .sky-card .sky-card-foot')?.innerText.replace(/\\n/g, ' | ') }; }"""
# Animation frames per second over `ms` (requestAnimationFrame count), and the longest frame (ms).
FPS_JS = """(ms) => new Promise((ok) => { const t0 = performance.now(); let n = 0, last = t0, worst = 0;
  const f = (t) => { n++; worst = Math.max(worst, t - last); last = t;
    if (t - t0 < ms) requestAnimationFrame(f); else ok({ fps: (n - 1) * 1000 / (t - t0), worst }); };
  requestAnimationFrame(f); })"""

failures: list[str] = []


def wait_for(page, js: str, timeout: float = 60.0) -> float:
    t0 = time.time()
    while time.time() - t0 < timeout and not page.evaluate(js):
        time.sleep(0.1)
    return time.time() - t0


class Run:
    """One Edge page, with its console errors and warnings collected."""

    def __init__(self, p, name: str, out: Path, theme: str = "dark", phone: bool = False):
        self.name, self.out = name, out
        self.browser = p.chromium.launch(
            channel="msedge",
            headless=True,
            args=[
                "--ignore-gpu-blocklist",
                "--enable-gpu-rasterization",
                "--force-color-profile=srgb",
            ],
        )
        size = {"width": 390, "height": 844} if phone else {"width": 1600, "height": 1000}
        self.ctx = self.browser.new_context(
            viewport=size,
            color_scheme=theme,
            device_scale_factor=2 if phone else 1,
            is_mobile=phone,
            has_touch=phone,
        )
        self.page = self.ctx.new_page()
        self.page.add_init_script(
            f'try {{ localStorage.setItem("moonat-theme", "{theme}"); localStorage.setItem("moonat-intro", "off"); }} catch (e) {{}}'
        )
        self.errors: list[str] = []
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        self.page.on(
            "console",
            lambda m: (
                self.errors.append(f"{m.type}: {m.text}")
                if m.type in ("error", "warning")
                else None
            ),
        )

    def open(self, url: str) -> None:
        self.page.goto(url, wait_until="load")
        wait_for(self.page, READY_JS, 90)
        wait_for(self.page, GLOBE_JS, 90)
        time.sleep(1.0)

    def story(self, key: str) -> None:
        # The stories are the first group of the globe's search list (focus the box, then click the story's row).
        self.page.click("#globe-search")
        self.page.click(f'.gs-story[data-story="{key}"]')
        time.sleep(0.5)
        wait_for(self.page, READY_JS, 90)
        time.sleep(2.5)  # the globe's fly-to

    def state(self) -> dict:
        return self.page.evaluate(STATE_JS)

    def check(self, ok: bool, what: str) -> None:
        print(f"  {'ok ' if ok else 'FAIL'} {what}")
        if not ok:
            failures.append(f"{self.name}: {what}")

    def shot(self, name: str, full: bool = False) -> None:
        path = self.out / f"{name}.png"
        if full:
            self.page.screenshot(path=str(path))
        else:
            self.page.locator("#map").screenshot(path=str(path))
        print(f"  saved {path}")

    def close(self) -> None:
        bad = [e for e in self.errors if "was preloaded" not in e]
        self.check(
            not bad,
            f"no console errors or warnings ({len(bad)})"
            + "".join(f"\n       {e}" for e in bad[:8]),
        )
        self.ctx.close()
        self.browser.close()


def scen_apollo11(p, url, out, theme):
    print(f"Apollo 11 at landing ({theme})")
    r = Run(p, f"apollo11-{theme}", out, theme)
    r.open(url + "/")
    st = r.state()
    r.check(st["daylight"] == "on", f"globe shading on: {st['daylight']}")
    r.check(
        st["caption"] == "Daylight at 20 Jul 1969, 20:17 UTC (Apollo 11)",
        f"caption: {st['caption']!r}",
    )
    print(f"  sky card: {st['foot']}")
    r.shot(f"daylight_apollo11_{theme}")
    r.close()


def scen_eclipse(p, url, out):
    print("Eclipse story (Blue Ghost, 14 March 2025)")
    r = Run(p, "eclipse", out)
    r.open(url + "/")
    r.story("eclipse")
    st = r.state()
    r.check(st["daylight"] == "shadow", f"the Earth's shadow is drawn: {st['daylight']}")
    print(f"  caption: {st['caption']!r}; sky card: {st['foot']}")
    r.shot("daylight_eclipse_partial")
    # Totality: 07:00 UTC, 150 min into the 350 min window.
    r.page.evaluate(
        "() => { const s = document.getElementById('sky-slider'); s.value = String(Math.round(1000 * 150 / 350));"
        " s.dispatchEvent(new Event('input', { bubbles: true })); }"
    )
    time.sleep(1.5)
    st = r.state()
    print(f"  caption: {st['caption']!r}; sky card: {st['foot']}")
    r.check("07:00" in (st["caption"] or ""), "the caption follows the slider")
    r.shot("daylight_eclipse_totality")
    r.close()


def scen_pole(p, url, out):
    print("South pole story, polar layers on")
    r = Run(p, "pole", out)
    r.open(url + "/")
    r.story("pole")
    r.page.click(".globe-layers-btn")
    r.page.click('input[data-layer="psr"]')
    time.sleep(2.5)  # the fly to the pole, if any, and the layer images
    r.page.click('input[data-layer="sun"]')
    r.page.click('.glayers-pole:has-text("South pole")')  # the whole layer area
    r.page.click(".glayers-close")
    wait_for(
        r.page, "() => document.querySelector('#map .globe').dataset.layersLoaded === 'true'", 30
    )
    time.sleep(2.0)
    st = r.state()
    print(f"  caption: {st['caption']!r}")
    r.check(
        st["daylight"] == "on" and "ml=psr.sun" in st["hash"],
        f"shading on with the layers; link {st['hash'][:40]}",
    )
    r.shot("daylight_pole_layers")
    r.close()


def scen_playback(p, url, out):
    print("Playback at 1 day/s (south pole story, south pole view)")
    r = Run(p, "playback", out)
    r.open(url + "/")
    r.story("pole")
    r.page.click('.globe-preset[data-preset="south"]')
    time.sleep(1.5)
    r.page.select_option("#sky-speed", label="1 day / s")
    r.page.click("#btn-play")
    time.sleep(1.0)
    a = r.state()
    r.shot("daylight_playback_t0")
    time.sleep(1.0)
    b = r.state()
    r.shot("daylight_playback_t1")
    print(f"  frame 1: {a['caption']!r} ({a['clock']}); frame 2: {b['caption']!r} ({b['clock']})")
    r.check(a["caption"] != b["caption"], "the caption moves with the playback")
    r.page.click("#btn-play")

    def fps() -> dict:
        """Frame rate over 3 s of playback from the start, after a 0.5 s warm-up."""
        r.page.evaluate(
            "() => { const s = document.getElementById('sky-slider'); s.value = '0';"
            " s.dispatchEvent(new Event('input', { bubbles: true })); }"
        )
        r.page.click("#btn-play")
        time.sleep(0.5)
        res = r.page.evaluate(FPS_JS, 3000)
        r.page.click("#btn-play")
        return res

    on = fps()
    # The same playback with the shading off (the Layers switch), for comparison.
    r.page.click(".globe-layers-btn")
    r.page.click('input[data-daylight="on"]')
    r.page.click(".glayers-close")
    time.sleep(0.4)
    off = fps()
    print(
        f"  frame rate while playing: shading on {on['fps']:.1f} fps (longest frame {on['worst']:.0f} ms), "
        f"off {off['fps']:.1f} fps (longest {off['worst']:.0f} ms)"
    )
    # The absolute rate depends on the machine and its load; the shading must not lower it.
    r.check(
        on["fps"] > off["fps"] - 3,
        f"the shading costs no frame rate ({on['fps']:.1f} vs {off['fps']:.1f} fps)",
    )
    st = r.state()
    r.check(
        st["daylight"] == "off" and st["caption"] is None,
        f"switch off: shading {st['daylight']}, no caption",
    )
    time.sleep(0.6)
    r.check("ml=noday" in r.page.evaluate("() => location.hash"), "the share link says ml=noday")
    # A link with "noday" opens with the shading off; without it, on.
    r.page.goto(url + "/" + r.page.evaluate("() => location.hash"), wait_until="load")
    r.page.reload(wait_until="load")
    wait_for(r.page, READY_JS, 90)
    wait_for(r.page, GLOBE_JS, 90)
    time.sleep(0.8)
    r.check(r.state()["daylight"] == "off", "a link with ml=noday opens with the shading off")
    r.page.click(".globe-layers-btn")
    r.page.click('input[data-daylight="on"]')
    time.sleep(1.0)
    st = r.state()
    r.check(
        st["daylight"] in ("on", "shadow") and "noday" not in st["hash"],
        f"switched on again: shading {st['daylight']}, link {st['hash'][:24]}",
    )
    r.close()


def scen_phone(p, url, out):
    print("Phone (390 x 844, touch)")
    r = Run(p, "phone", out, phone=True)
    r.open(url + "/")
    st = r.state()
    r.check(st["caption"] is not None, f"caption: {st['caption']!r}")
    # The caption must not cover the tool buttons or the search box.
    boxes = r.page.evaluate(
        """() => { const b = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
          return { cap: b(document.querySelector('.globe-daylight')),
                   tools: [...document.querySelectorAll('.globe-tools .globe-btn')].filter((e) => e.offsetParent).map(b),
                   search: b(document.querySelector('.gsearch-box')) }; }"""
    )

    def overlap(a, b):
        return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]

    r.check(
        not any(overlap(boxes["cap"], t) for t in boxes["tools"] + [boxes["search"]]),
        f"caption clear of the tools and the search box: {[round(x) for x in boxes['cap']]}",
    )
    r.shot("daylight_phone", full=True)
    r.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8765")
    ap.add_argument("--out", default=str(ROOT / "outputs" / "daylight"))
    ap.add_argument("--only", nargs="*")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    url = a.url.rstrip("/")
    runs = {
        "apollo11": lambda p: scen_apollo11(p, url, out, "dark"),
        "apollo11-light": lambda p: scen_apollo11(p, url, out, "light"),
        "eclipse": lambda p: scen_eclipse(p, url, out),
        "pole": lambda p: scen_pole(p, url, out),
        "playback": lambda p: scen_playback(p, url, out),
        "phone": lambda p: scen_phone(p, url, out),
    }
    with sync_playwright() as p:
        for name, fn in runs.items():
            if not a.only or name in a.only:
                fn(p)
    print("\nFAILURES:\n  " + "\n  ".join(failures) if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
