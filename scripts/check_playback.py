# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Check the timelapse playback in the real page (Playwright + the installed Microsoft Edge) and save its figures.

Scenarios: Apollo 11 with Track Earth (a drag pauses it, the button resumes it), the south pole with Track Sun over a
month at 1 day/s, missions of 1, 5 and 10 years at the Shackleton rim at 1 month/s (series and chart timings from the
page's performance marks), the eclipse story with Track Sun, and the phone layout (390 x 844, touch). Every scenario
fails on a console error or warning. Figures: docs/figures/playback_*.png (1920 x 1080 and 390 x 844, both themes).

Run with a local server (any port; the default matches the command below):
    uv run python -m http.server -d web 8025 --bind 127.0.0.1
    uv run python scripts/check_playback.py [--url http://127.0.0.1:8025] [--only apollo11 years5 ...]
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIG = ROOT / "docs" / "figures"
PROFILE = ROOT / "outputs" / "playback" / ".edge-profile"
SHACK = ["Shackleton rim", -89.4395, -137.1934, "shackleton_rim"]
YEAR_MS = 365.25 * 86400e3

STATE_JS = """() => {
  const b = document.getElementById('btn-track');
  return {
    clock: document.getElementById('sky-clock').textContent,
    speed: document.getElementById('sky-speed').selectedOptions[0]?.textContent,
    track: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'),
    edges: [...document.querySelectorAll('.moonat-sky-edge')].map((e) => e.dataset.body),
  };
}"""
READY_JS = """() => { const c = [...document.querySelectorAll('#sky-grid .sky-card')];
  return c.length > 0 && c.every((x) => !x.querySelector('.sky-loading') && x.querySelector('canvas')
    && x.querySelector('.sky-card-foot').textContent.trim().length > 0); }"""
CHARTS_JS = """() => !!document.querySelector('#compare-body:not([hidden]) .body-section:not([hidden]) .chart.js-plotly-plot')"""
CURSOR_JS = """() => { const c = document.querySelector('.body-section:not([hidden]) .chart.js-plotly-plot');
  const l = (c?.layout?.shapes || []).filter((s) => s.type === 'line' && s.yref === 'paper'); return l.length ? l[l.length - 1].x0 : null; }"""
MEASURES_JS = """() => performance.getEntriesByType('measure').filter((m) => m.name.startsWith('moonat:'))
  .map((m) => [m.name, Math.round(m.duration)])"""

failures: list[str] = []


def link(rows, body="sun") -> str:
    s = base64.urlsafe_b64encode(json.dumps(rows).encode()).decode().rstrip("=")
    return "#" + ("b=earth&" if body == "earth" else "") + f"s={s}"


def shack_rows(t0: str, t1: str, label: str = SHACK[0]):
    return [[label, SHACK[1], SHACK[2], t0, t1, SHACK[3], 0]]


def wait_for(page, js: str, timeout: float = 60.0) -> float:
    t0 = time.time()
    while time.time() - t0 < timeout and not page.evaluate(js):
        time.sleep(0.1)
    return time.time() - t0


class Run:
    """One Edge page, with its console errors and warnings collected."""

    def __init__(self, p, name: str, theme: str = "dark", phone: bool = False):
        self.name = name
        size = {"width": 390, "height": 844} if phone else {"width": 1920, "height": 1080}
        self.ctx = p.chromium.launch_persistent_context(
            str(PROFILE),
            channel="msedge",
            headless=True,
            viewport=size,
            color_scheme=theme,
            device_scale_factor=2 if phone else 1,
            is_mobile=phone,
            has_touch=phone,
            args=[
                "--ignore-gpu-blocklist",
                "--enable-gpu-rasterization",
                "--force-color-profile=srgb",
            ],
        )
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
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

    def state(self):
        return self.page.evaluate(STATE_JS)

    def check(self, ok: bool, what: str) -> None:
        print(f"  {'ok ' if ok else 'FAIL'} {what}")
        if not ok:
            failures.append(f"{self.name}: {what}")

    def shot(self, name: str) -> None:
        """Save the window as docs/figures/<name>.png."""
        self.page.screenshot(path=str(FIG / f"{name}.png"))
        print(f"  saved docs/figures/{name}.png")

    def drag(self) -> None:
        box = self.page.locator(".sky-view .moonat-sky-frame canvas").first.bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        self.page.mouse.move(x, y)
        self.page.mouse.down()
        self.page.mouse.move(x + 250, y, steps=8)
        self.page.mouse.up()

    def close(self) -> None:
        bad = [e for e in self.errors if "was preloaded" not in e]
        self.check(
            not bad,
            f"no console errors or warnings ({len(bad)})"
            + "".join(f"\n       {e}" for e in bad[:8]),
        )
        self.ctx.close()


def scen_apollo11(p, url):
    print("Apollo 11, Track Earth at 1 h/s")
    r = Run(p, "apollo11")
    r.page.goto(url + "/", wait_until="load")
    wait_for(r.page, READY_JS)
    r.page.click("#btn-track")
    st = r.state()
    r.check(
        st["track"].endswith("Track Earth") and st["pressed"] == "true",
        f"button: {st['track']!r} pressed={st['pressed']}",
    )
    r.page.click("#btn-play")
    lost = 0
    for i in range(12):
        time.sleep(0.5)
        lost += "earth" in r.state()["edges"]
        if i == 7:
            r.shot("playback_apollo11_track_earth")
    r.check(
        lost == 0,
        f"the Earth stays framed while playing (out of frame {lost} of 12 samples), at {r.state()['clock']}",
    )
    r.drag()
    st = r.state()
    r.check(
        st["pressed"] == "mixed" and "paused" in st["track"],
        f"a drag pauses tracking: {st['track']!r}",
    )
    r.page.click("#btn-track")
    time.sleep(1.2)
    st = r.state()
    r.check(st["pressed"] == "true" and "earth" not in st["edges"], "the button resumes tracking")
    r.page.click("#btn-track")
    r.check(r.state()["pressed"] == "false", "pressed again: off")
    r.close()


def scen_pole(p, url, theme):
    print(f"South pole, a month, Track Sun at 1 day/s ({theme})")
    r = Run(p, f"pole-{theme}", theme)
    r.page.goto(
        url + "/" + link(shack_rows("2027-01-19T00:00:00Z", "2027-02-18T00:00:00Z")),
        wait_until="load",
    )
    wait_for(r.page, READY_JS)
    wait_for(r.page, CHARTS_JS)
    r.check(r.state()["speed"] == "1 day / s", f"default speed for 30 days: {r.state()['speed']}")
    r.page.click("#btn-track")
    r.page.click("#btn-play")
    lost, cur = 0, []
    for i in range(16):
        time.sleep(0.5)
        lost += "sun" in r.state()["edges"]
        cur.append(r.page.evaluate(CURSOR_JS))
        if i == 9:
            r.shot(f"playback_pole_track_sun_{theme}")
    r.check(
        lost == 0,
        f"the Sun stays framed (out of frame {lost} of 16 samples), at {r.state()['clock']}",
    )
    moving = [c for c in cur if isinstance(c, (int, float))]
    r.check(
        len(moving) > 8 and all(b > a for a, b in zip(moving, moving[1:], strict=False)),
        f"chart cursor follows playback: {[round(c, 1) for c in moving[::4]]} d",
    )
    r.close()


def scen_years(p, url, years, theme="dark", shots=False):
    print(f"Shackleton rim, {years} years, Track Sun at 1 month/s ({theme})")
    r = Run(p, f"years{years}-{theme}", theme)
    t_end = f"{2030 + years}-01-01T00:00:00Z"
    t0 = time.time()
    r.page.goto(
        url + "/" + link(shack_rows("2030-01-01T00:00:00Z", t_end, f"Shackleton rim, {years} y")),
        wait_until="load",
    )
    sky = wait_for(r.page, READY_JS, 90)
    wait_for(r.page, CHARTS_JS, 90)
    time.sleep(0.8)
    total = time.time() - t0
    m = dict(r.page.evaluate(MEASURES_JS))
    series = next((v for k, v in m.items() if k.startswith("moonat:series")), None)
    samples = next((k.split()[-1] for k in m if k.startswith("moonat:series")), "?")
    print(
        f"  timing: series {series} ms ({samples} samples, ephemeris years included), charts {m.get('moonat:charts')} ms, "
        f"sky on screen {sky:.1f} s, charts on screen {total:.1f} s after navigation"
    )
    r.check(series is not None and series < 5000, "series computed in under 5 s")
    card = r.page.evaluate("() => document.getElementById('cards-sun').innerText").replace(
        "\n", " | "
    )
    print(f"  sun card: {card[:300]}")
    r.check(
        "longest darkness" in card and "%" in card, "card shows % sunlit and the longest darkness"
    )
    ecard = r.page.evaluate("() => document.getElementById('cards-earth').innerText")
    r.check("longest Earth blackout" in ecard, "Earth card shows the longest blackout")
    r.page.select_option("#sky-speed", label="1 month / s")
    r.page.click("#btn-track")
    r.page.click("#btn-play")
    waits = []
    for i in range(10):
        time.sleep(0.5)
        waits.append(
            r.page.evaluate(
                "() => new Promise((ok) => { const a = performance.now(); requestAnimationFrame(() => ok(performance.now() - a)); })"
            )
        )
        if shots and i == 6:
            r.shot(f"playback_years{years}_sky_{theme}")
    r.page.click("#btn-play")
    clock, cursor = r.state()["clock"], r.page.evaluate(CURSOR_JS)
    print(
        f"  after 5 s at 1 month/s: {clock}; chart cursor at {cursor:.0f} d; frame waits {sorted(round(w) for w in waits)} ms"
    )
    r.check(max(waits) < 120, "playback stays fluid (every frame wait < 120 ms)")
    if shots:
        r.page.evaluate("document.getElementById('cards-sun').scrollIntoView({ block: 'start' })")
        time.sleep(0.8)
        r.shot(f"playback_years{years}_charts_{theme}")
    r.close()


def scen_eclipse(p, url):
    print("Eclipse story, Track Sun at 10 min/s")
    r = Run(p, "eclipse")
    r.page.goto(url + "/", wait_until="load")
    wait_for(r.page, READY_JS)
    r.page.click('[data-qs="eclipse"]')
    wait_for(
        r.page,
        "() => /Blue Ghost/.test(document.querySelector('#sky-grid .mcard-title')?.textContent || '')",
    )
    wait_for(r.page, READY_JS)
    r.check(r.state()["speed"] == "10 min / s", f"default speed: {r.state()['speed']}")
    r.page.click("#btn-track")
    r.page.click("#btn-play")
    lost = 0
    for i in range(10):
        time.sleep(0.5)
        lost += "sun" in r.state()["edges"]
        if i == 5:
            r.shot("playback_eclipse_track_sun")
    r.check(
        lost == 0,
        f"the eclipsed Sun stays framed (out of frame {lost} of 10), at {r.state()['clock']}",
    )
    r.close()


def scen_phone(p, url, theme):
    print(f"Phone 390 x 844 ({theme}), 5 years, Track")
    r = Run(p, f"phone-{theme}", theme, phone=True)
    r.page.goto(
        url + "/" + link(shack_rows("2030-01-01T00:00:00Z", "2035-01-01T00:00:00Z")),
        wait_until="load",
    )
    # On a phone the sky is below the fold, and its view is built when it scrolls into sight.
    wait_for(r.page, "() => !!document.querySelector('#sky-grid .sky-card')", 90)
    r.page.evaluate("document.getElementById('sky-controls').scrollIntoView({ block: 'center' })")
    r.check(wait_for(r.page, READY_JS, 90) < 30, "the sky view is drawn once scrolled into sight")
    r.page.evaluate("document.getElementById('sky-controls').scrollIntoView({ block: 'center' })")
    r.page.tap("#btn-track")
    r.page.select_option("#sky-speed", label="1 month / s")
    r.page.tap("#btn-play")
    time.sleep(2.5)
    r.page.tap("#btn-play")
    time.sleep(0.4)
    box = r.page.evaluate("""() => Object.fromEntries(['sky-controls', 'btn-play', 'sky-slider', 'sky-clock', 'sky-speed', 'btn-track']
      .map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return [id, [Math.round(b.left), Math.round(b.right), Math.round(b.height)]]; }))""")
    width = r.page.evaluate("() => document.documentElement.scrollWidth")
    print(f"  layout (left, right, height): {box}, page width {width}")
    r.check(
        width <= 390 and box["sky-controls"][1] <= 390 - 8,
        "no sideways scroll; the bar fits the screen",
    )
    r.check(
        all(box[k][2] >= 40 for k in ("btn-play", "sky-speed", "btn-track")),
        "touch targets at least 40 px high",
    )
    r.check(r.state()["pressed"] == "true", f"Track on: {r.state()['track']!r}")
    r.shot(f"playback_phone_{theme}")
    r.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--url", default="http://127.0.0.1:8025")
    ap.add_argument(
        "--only", nargs="*", default=None, help="apollo11 pole years1 years5 years10 eclipse phone"
    )
    args = ap.parse_args()
    want = set(args.only or ["apollo11", "pole", "years1", "years5", "years10", "eclipse", "phone"])
    url = args.url.rstrip("/")
    FIG.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        if "apollo11" in want:
            scen_apollo11(p, url)
        if "pole" in want:
            for theme in ("dark", "light"):
                scen_pole(p, url, theme)
        for years in (1, 10):
            if f"years{years}" in want:
                scen_years(p, url, years)
        if "years5" in want:
            for theme in ("dark", "light"):
                scen_years(p, url, 5, theme, shots=True)
        if "eclipse" in want:
            scen_eclipse(p, url)
        if "phone" in want:
            for theme in ("dark", "light"):
                scen_phone(p, url, theme)
    print("\nAll checks passed." if not failures else "\nFAILED:\n  " + "\n  ".join(failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
