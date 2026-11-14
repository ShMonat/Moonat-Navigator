# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Browser check of live terrain for custom points (web/js/app/terrain_live.js, contract C9).

Opens the site in Microsoft Edge (Playwright, channel "msedge") at 1920 x 1080 for two points that are not in the
catalog, waits for the scenario card to report real NASA Moon Trek terrain, opens the Sky tab in focus mode and saves
a screenshot of each (docs/figures/terrain_live_<name>.png). Then it opens the first point again with trek.nasa.gov
blocked (DNS mapped to a closed local port, which also covers the Web Worker's requests), checks the coarse fallback
and saves the same view (terrain_live_<name>_fallback.png). Console errors and Moon Trek traffic are reported.

Needs the site served locally, e.g. ``uv run python -m http.server -d web 8015``.
Usage: ``uv run python scripts/check_terrain_live.py [--base http://localhost:8015] [--headful]``
"""

from __future__ import annotations

import argparse
import base64
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIG = ROOT / "docs" / "figures"
POINTS = [
    # name, label, lat, lon, start (UTC), framing. Southern highlands, on the floor of Tycho 9.8 km north of its central
    # peak (13.4 deg high, due south): Sun 18 deg up in the east-north-east; the view turns south to the side-lit peak.
    (
        "highland",
        "Tycho floor (southern highlands)",
        -43.0,
        -11.36,
        "2027-01-18T04:00:00Z",
        "sun-then-right",
    ),
    # Near Shackleton, not a catalog site: Sun 1.5 deg up in the north, Earth 2.1 deg up in the south-west.
    ("pole", "South pole ridge", -89.3, 130.0, "2027-01-12T18:00:00Z", "earth"),
]


def hash_for(label: str, lat: float, lon: float, start: str) -> str:
    rows = [[label, lat, lon, start, 0, 0, 0]]
    s = (
        base64.urlsafe_b64encode(json.dumps(rows, separators=(",", ":")).encode())
        .decode()
        .rstrip("=")
    )
    return f"#tab=sky&s={s}"


def frame(page, how: str) -> None:
    """Open focus mode and point the camera."""
    page.locator(".sky-focus-btn").first.click()
    page.wait_for_timeout(1200)
    if how == "sun-then-right":
        page.locator("#btn-look-sun").click()
        page.wait_for_timeout(600)
        box = page.locator(".sky-card.is-focus .sky-view canvas").first.bounding_box()
        y = box["y"] + box["height"] * 0.35
        for _ in range(2):  # drag the sky to the left: the view turns right (toward the south)
            page.mouse.move(box["x"] + box["width"] * 0.85, y)
            page.mouse.down()
            page.mouse.move(box["x"] + box["width"] * 0.15, y, steps=12)
            page.mouse.up()
        page.wait_for_timeout(300)
    page.wait_for_timeout(1500)


def run_point(browser, base: str, point: tuple, suffix: str = "") -> dict:
    name, label, lat, lon, start, how = point
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    errors, trek = [], []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    ctx = page.context
    ctx.on(
        "requestfinished", lambda r: trek.append(r) if "ImageServer/exportImage" in r.url else None
    )
    t0 = time.time()
    page.goto(base + "/" + hash_for(label, lat, lon, start))
    meta = page.locator(".scen-meta").first
    status = ""
    for _ in range(400):
        status = meta.text_content() or ""
        if "Real terrain" in status or "Approximate horizon" in status:
            break
        page.wait_for_timeout(100)
    t_status = time.time() - t0
    page.wait_for_timeout(1500)  # the recompute and the sky view's terrain swap
    sizes = []
    for r in trek:
        resp = r.response()
        if resp:
            sizes.append(len(resp.body()))
    info = {
        "point": name + suffix,
        "lat_lon": [lat, lon],
        "status": status.split("·")[-1].strip(),
        "sky_note": (page.locator(".sky-card-foot .note").first.text_content() or "").strip(),
        "seconds_to_status": round(t_status, 2),
        "workers": len(page.workers),
        "moon_trek_requests": len(trek),
        "moon_trek_bytes": sum(sizes),
        "console_errors": errors,
    }
    frame(page, how)
    path = FIG / f"terrain_live_{name}{suffix}.png"
    page.screenshot(path=str(path))
    info["screenshot"] = str(path.relative_to(ROOT)).replace("\\", "/")
    page.close()
    return info


def rapid_edits(browser, base: str) -> dict:
    """Retype the latitude 4 times, 0.8 s apart: earlier points must be cancelled, only the last one completes."""
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    errors, done, aborted = [], [], []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    ctx = page.context
    ctx.on("requestfinished", lambda r: done.append(r.url) if "exportImage" in r.url else None)
    ctx.on("requestfailed", lambda r: aborted.append(r.url) if "exportImage" in r.url else None)
    page.goto(base + "/" + hash_for("Rapid edits", 10.0, -30.0, "2027-01-15T10:00:00Z"))
    page.wait_for_timeout(1500)
    lat = page.locator('[name="lat_deg"]').first
    for v in ("10.2", "10.4", "10.6", "10.8"):
        lat.fill(v)
        page.wait_for_timeout(800)
    meta = page.locator(".scen-meta").first
    for _ in range(300):
        if "Real terrain" in (meta.text_content() or ""):
            break
        page.wait_for_timeout(100)
    page.wait_for_timeout(500)
    info = {
        "point": "rapid_edits",
        "status": (meta.text_content() or "").split("·")[-1].strip(),
        "exportImage_completed": len(done),
        "exportImage_cancelled": len(aborted),
        "console_errors": errors,
    }
    page.close()
    return info


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8015")
    ap.add_argument("--headful", action="store_true")
    a = ap.parse_args()
    out = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=not a.headful)
        for pt in POINTS:
            out.append(run_point(browser, a.base, pt))
            print(json.dumps(out[-1]), flush=True)
        out.append(rapid_edits(browser, a.base))
        print(json.dumps(out[-1]), flush=True)
        browser.close()
        blocked = p.chromium.launch(
            channel="msedge",
            headless=not a.headful,
            args=["--host-resolver-rules=MAP trek.nasa.gov 127.0.0.1:9"],
        )
        out.append(run_point(blocked, a.base, POINTS[0], suffix="_fallback"))
        print(json.dumps(out[-1]), flush=True)
        blocked.close()
    (ROOT / "outputs").mkdir(exist_ok=True)
    (ROOT / "outputs" / "terrain_live_check.json").write_text(
        json.dumps(out, indent=1), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
