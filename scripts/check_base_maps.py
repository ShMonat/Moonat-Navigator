# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Browser check of the globe's base maps, grid and contour lines (Edge via Playwright).

Run with a local server (any free port):
    uv run python -m http.server -d web 8794 --bind 127.0.0.1
    uv run python scripts/check_base_maps.py --url http://127.0.0.1:8794

Desktop 1920 x 1080 in both themes and a phone 390 x 844 (touch): each base map at the near side and the south
pole; contours at both poles and the near side; the grid off; a share-link round trip and an old link; the
playback frame rate (south pole story, 1 day/s) with and without contours. Every run fails on a console error
or warning. Screenshots: outputs/base_maps/.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_daylight as cd  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
STYLE_JS = """() => { const g = document.querySelector('#map .globe');
  return { base: g.dataset.base, grid: g.dataset.grid, contours: g.dataset.contours,
    conLoaded: g.dataset.contoursLoaded === 'true', layers: g.dataset.layers || '', hash: location.hash,
    gridLabels: getComputedStyle(g.querySelector('.globe-grid')).display,
    radios: [...document.querySelectorAll('input[data-base]')].filter((r) => r.checked).map((r) => r.value),
    gridBox: document.querySelector('input[data-grid]').checked,
    conBox: document.querySelector('input[data-contours]').checked }; }"""


def style(r) -> dict:
    return r.page.evaluate(STYLE_JS)


def panel(r, on: bool) -> None:
    hidden = r.page.evaluate("() => document.getElementById('globe-layers').hidden")
    if hidden == on:
        r.page.click(".globe-layers-btn")
        time.sleep(0.3)


def base(r, bid: str) -> None:
    panel(r, True)
    r.page.click(f'.glayers-base-opt[data-base="{bid}"]')
    cd.wait_for(
        r.page, f"() => document.querySelector('#map .globe')?.dataset.base === '{bid}'", 30
    )
    time.sleep(1.5)  # the caps


def preset(r, key: str) -> None:
    panel(r, False)
    r.page.click(f'.globe-preset[data-preset="{key}"]')
    time.sleep(2.0)


def scen_desktop(p, url, out, theme):
    print(f"Desktop 1920 x 1080, {theme}")
    r = cd.Run(p, f"desktop-{theme}", out, theme)
    r.page.set_viewport_size({"width": 1920, "height": 1080})
    r.open(url + "/")
    s = style(r)
    r.check(
        s["base"] == "imagery" and s["grid"] == "on" and s["contours"] == "off",
        f"default style {s}",
    )
    r.check("ml=" not in s["hash"], "the default style writes nothing to the link")
    t = theme[0]
    panel(r, True)
    r.shot(f"{t}_panel_imagery", full=True)
    for bid in ("elevation", "plain"):
        base(r, bid)
        r.shot(f"{t}_panel_{bid}", full=True) if bid == "elevation" else None
        preset(r, "near")
        r.shot(f"{t}_{bid}_near")
        preset(r, "south")
        r.shot(f"{t}_{bid}_south")
    base(r, "imagery")
    preset(r, "south")
    r.shot(f"{t}_imagery_south")
    preset(r, "near")
    r.shot(f"{t}_imagery_near")
    # Contours on, over the Elevation base and over the imagery.
    panel(r, True)
    r.page.click('input[data-contours="on"]')
    cd.wait_for(
        r.page, "() => document.querySelector('#map .globe')?.dataset.contoursLoaded === 'true'", 30
    )
    for key in ("near", "south", "north", "far"):
        preset(r, key)
        r.shot(f"{t}_contours_imagery_{key}")
    base(r, "elevation")
    for key in ("south", "near"):
        preset(r, key)
        r.shot(f"{t}_contours_elevation_{key}")
    # Grid off.
    panel(r, True)
    r.page.click('input[data-grid="on"]')
    time.sleep(0.5)
    s = style(r)
    r.check(s["grid"] == "off" and s["gridLabels"] == "none", "grid lines and labels off")
    panel(r, False)
    r.shot(f"{t}_grid_off_near")
    # Share-link round trip.
    time.sleep(0.6)  # the debounced link
    s = style(r)
    print(f"  link: {s['hash'][:90]}")
    r.check("ml=ct.elev.nogrid" in s["hash"], "the link holds contours, Elevation and grid off")
    r2 = cd.Run(p, f"link-{theme}", out, theme)
    r2.page.set_viewport_size({"width": 1920, "height": 1080})
    r2.open(url + "/" + s["hash"])
    cd.wait_for(
        r2.page, "() => document.querySelector('#map .globe')?.dataset.base === 'elevation'", 30
    )
    s2 = style(r2)
    r2.check(
        s2["base"] == "elevation"
        and s2["grid"] == "off"
        and s2["contours"] == "on"
        and s2["radios"] == ["elevation"]
        and not s2["gridBox"]
        and s2["conBox"],
        f"the link reopens the same style {s2['base']}/{s2['grid']}/{s2['contours']}",
    )
    time.sleep(1.5)
    r2.shot(f"{t}_link_reopened")
    r2.close()
    r.close()


def scen_old_link(p, url, out):
    print("Old link (ml=psr.noday, from before the base maps)")
    r = cd.Run(p, "old-link", out)
    r.open(url + "/#ml=psr.noday")
    time.sleep(1.0)
    s = style(r)
    r.check(
        s["base"] == "imagery"
        and s["grid"] == "on"
        and s["contours"] == "off"
        and s["layers"] == "psr",
        f"old link: imagery, grid on, contours off, PSR on ({s['base']}, {s['grid']}, {s['contours']}, {s['layers']})",
    )
    r.close()


def pole_zoom(r, pole: str) -> None:
    """The Layers panel's pole button: the whole area poleward of 80 deg (zoom 5)."""
    panel(r, True)
    r.page.click(f'.glayers-pole:has-text("{pole.capitalize()} pole")')
    panel(r, False)
    time.sleep(2.5)


def scen_zoom(p, url, out, theme):
    print(f"Contours at the poles, zoomed to the 80 deg caps, {theme}")
    r = cd.Run(p, f"zoom-{theme}", out, theme)
    r.page.set_viewport_size({"width": 1920, "height": 1080})
    r.open(url + "/")
    t = theme[0]
    panel(r, True)
    r.page.click('input[data-contours="on"]')
    cd.wait_for(
        r.page, "() => document.querySelector('#map .globe')?.dataset.contoursLoaded === 'true'", 30
    )
    for bid in ("imagery", "elevation", "plain"):
        base(r, bid)
        for pole in ("south", "north"):
            pole_zoom(r, pole)
            r.shot(f"{t}_contours_{bid}_{pole}_cap")
    r.close()


def scen_deep(p, url, out):
    """Deep zoom near the south pole (wheel), Elevation and contours on, then Plain and Imagery."""
    print("Deep zoom at the south pole, contours on")
    r = cd.Run(p, "deep", out)
    r.page.set_viewport_size({"width": 1920, "height": 1080})
    r.open(url + "/")
    panel(r, True)
    r.page.click('input[data-contours="on"]')
    cd.wait_for(
        r.page, "() => document.querySelector('#map .globe')?.dataset.contoursLoaded === 'true'", 30
    )
    base(r, "elevation")
    pole_zoom(r, "south")
    box = r.page.locator("#map canvas").first.bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    r.page.mouse.move(cx, cy)
    for _ in range(40):
        r.page.mouse.wheel(0, -400)
        time.sleep(0.05)
    time.sleep(2.0)
    r.shot("d_deep_elevation_contours_south")
    for bid in ("plain", "imagery"):
        base(r, bid)
        panel(r, False)
        r.shot(f"d_deep_{bid}_contours_south")
    r.close()


def scen_phone(p, url, out, theme):
    print(f"Phone 390 x 844, {theme}")
    r = cd.Run(p, f"phone-{theme}", out, theme, phone=True)
    r.open(url + "/")
    t = theme[0]
    r.page.locator("#map").scroll_into_view_if_needed()
    base(r, "elevation")
    r.shot(f"{t}_phone_panel_elevation", full=True)
    r.page.click('input[data-contours="on"]')
    cd.wait_for(
        r.page, "() => document.querySelector('#map .globe')?.dataset.contoursLoaded === 'true'", 30
    )
    preset(r, "south")
    r.shot(f"{t}_phone_elevation_contours_south")
    r.close()


def scen_fps(p, url, out):
    print("Playback at 1 day/s (south pole story, south pole view): contours off and on")
    r = cd.Run(p, "fps", out)
    r.page.set_viewport_size({"width": 1920, "height": 1080})
    r.open(url + "/")
    r.story("pole")
    preset(r, "south")
    r.page.select_option("#sky-speed", label="1 day / s")

    def fps() -> dict:
        r.page.evaluate(
            "() => { const s = document.getElementById('sky-slider'); s.value = '0';"
            " s.dispatchEvent(new Event('input', { bubbles: true })); }"
        )
        r.page.click("#btn-play")
        time.sleep(0.5)
        res = r.page.evaluate(cd.FPS_JS, 3000)
        r.page.click("#btn-play")
        return res

    off = fps()
    panel(r, True)
    r.page.click('input[data-contours="on"]')
    cd.wait_for(
        r.page, "() => document.querySelector('#map .globe')?.dataset.contoursLoaded === 'true'", 30
    )
    panel(r, False)
    on = fps()
    print(
        f"  contours off {off['fps']:.1f} fps (longest frame {off['worst']:.0f} ms), "
        f"on {on['fps']:.1f} fps (longest {on['worst']:.0f} ms)"
    )
    r.check(on["fps"] > 0.8 * off["fps"], "contours cost under 20 % of the frame rate")
    r.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8794")
    ap.add_argument("--out", default=str(ROOT / "outputs" / "base_maps"))
    ap.add_argument("--only", nargs="*")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    url = a.url.rstrip("/")
    runs = {
        "desktop": lambda p: scen_desktop(p, url, out, "dark"),
        "desktop-light": lambda p: scen_desktop(p, url, out, "light"),
        "zoom": lambda p: scen_zoom(p, url, out, "dark"),
        "zoom-light": lambda p: scen_zoom(p, url, out, "light"),
        "old-link": lambda p: scen_old_link(p, url, out),
        "deep": lambda p: scen_deep(p, url, out),
        "phone": lambda p: scen_phone(p, url, out, "dark"),
        "phone-light": lambda p: scen_phone(p, url, out, "light"),
        "fps": lambda p: scen_fps(p, url, out),
    }
    with sync_playwright() as p:
        for name, fn in runs.items():
            if not a.only or name in a.only:
                fn(p)
    print("\nFAILURES:\n  " + "\n  ".join(cd.failures) if cd.failures else "\nall checks passed")
    return 1 if cd.failures else 0


if __name__ == "__main__":
    sys.exit(main())
