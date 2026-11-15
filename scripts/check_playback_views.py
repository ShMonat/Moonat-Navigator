# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Change the view while a timelapse plays, in the real page (Playwright + the installed Microsoft Edge).

The rover story plays at 1 h/s; each step changes something (the Sun | Earth switch, Follow, Driver's view, a drag, a
zoom, full screen, the "..." options, the speed, the slider, another story, the theme, the window size). After each
step it checks: no console error, the camera is finite, the view is not blank, the playback still runs at the chosen
speed (one loop, not two) unless the step stops it on purpose, and the camera buttons say what the views do.

    uv run python -m http.server -d web 8139 --bind 127.0.0.1
    uv run python scripts/check_playback_views.py --url http://127.0.0.1:8139 [--phone]
"""

from __future__ import annotations

import argparse
import sys
import time

from playwright.sync_api import sync_playwright

READY_JS = """() => { const c = [...document.querySelectorAll('#sky-grid .sky-card')];
  return c.length > 0 && c.every((x) => !x.querySelector('.sky-loading') && x.querySelector('canvas')
    && x.querySelector('.sky-card-foot').textContent.trim().length > 0)
    && !document.getElementById('btn-driver').hidden; }"""

PROBE_JS = """async () => {
  const m = await import('./js/app/sky_panel.js');
  const d0 = m.skyDebug();
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 1200));
  const d1 = m.skyDebug();
  const rate = (d1.offsetMs - d0.offsetMs) / ((performance.now() - t0) / 1000);
  const v = d1.views[0]?.view;
  const cam = v?.getView ? v.getView() : null;
  const tr = v?.getTrack ? v.getTrack() : null;
  // Aim: the camera's azimuth off the followed body (Follow) or off the direction of travel (Driver's view), the
  // largest of a few frames (deg).
  let aimOff = 0;
  for (let k = 0; k < 10; k++) {
    await new Promise((r) => requestAnimationFrame(r));
    const w = m.skyDebug().views[0], c = w?.view?.getView?.(), t = w?.view?.getTrack?.();
    if (!c || !t || !t.mode || t.paused) continue;
    const want = t.mode === 'body' ? (t.body === 'sun' ? w.sun_az : w.earth_az) : w.heading_deg;
    if (want == null) continue;
    aimOff = Math.max(aimOff, Math.abs(((c.az_deg - want) % 360 + 540) % 360 - 180));
  }
  // Blank view: every sampled pixel of the drawn canvas the same.
  const cv = document.querySelector('#sky-grid .sky-card .moonat-sky-frame canvas');
  let distinct = 0;
  if (cv && cv.width > 0) {
    const g = cv.getContext('2d');
    const seen = new Set();
    for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
      const p = g.getImageData(Math.floor(cv.width * i / 12), Math.floor(cv.height * j / 12), 1, 1).data;
      seen.add(p.join(','));
    }
    distinct = seen.size;
  }
  return {
    playing: d1.playing, rate, speed: Number(document.getElementById('sky-speed').value), trackMode: d1.trackMode,
    cam, track: tr, distinct, views: d1.views.length, aimOff,
    follow: document.getElementById('btn-follow').getAttribute('aria-pressed'),
    driver: document.getElementById('btn-driver').getAttribute('aria-pressed'),
    driverHidden: document.getElementById('btn-driver').hidden,
    full: document.body.classList.contains('sky-full'),
  };
}"""


def open_story(page, key: str) -> None:
    """Open a story: its chip (older pages) or its entry in the search dropdown (focus #globe-search)."""
    chip = page.locator(f'#quickstarts [data-qs="{key}"]')
    if chip.count():
        chip.first.click()
        return
    page.locator("#globe-search").click()
    page.locator(f'.gs-story[data-story="{key}"]').first.click()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8139")
    ap.add_argument("--phone", action="store_true")
    a = ap.parse_args()
    failures: list[str] = []
    with sync_playwright() as p:
        size = {"width": 390, "height": 844} if a.phone else {"width": 1920, "height": 1080}
        browser = p.chromium.launch(
            channel="msedge",
            headless=True,
            args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
        )
        ctx = browser.new_context(
            viewport=size,
            is_mobile=a.phone,
            has_touch=a.phone,
            device_scale_factor=3 if a.phone else 1,
        )
        page = ctx.new_page()
        page.add_init_script('try { localStorage.setItem("moonat-intro", "off"); } catch (e) {}')
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on(
            "console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None
        )
        page.goto(a.url + "/", wait_until="load")
        time.sleep(1.0)

        def ready(timeout: float = 180) -> None:
            t0 = time.time()
            while time.time() - t0 < timeout and not page.evaluate(READY_JS):
                time.sleep(0.2)

        def js(code: str):
            return page.evaluate(code)

        def play(speed: int = 3600000) -> None:
            js(f"""() => {{ const s = document.getElementById('sky-speed'); s.value = '{speed}';
              s.dispatchEvent(new Event('change', {{ bubbles: true }})); }}""")
            if not page.evaluate(
                "async () => (await import('./js/app/sky_panel.js')).skyDebug().playing"
            ):
                js("() => document.getElementById('btn-play').click()")

        def canvas_center():
            box = page.locator("#sky-grid .sky-card .moonat-sky-frame canvas").first.bounding_box()
            return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

        def check(step: str, expect_playing: bool = True, aim_tol: float = 3.0, **want) -> dict:
            n0 = len(errors)
            r = page.evaluate(PROBE_JS)
            bad = []
            if errors[n0:] or (step == "start" and errors):
                bad.append(f"console: {errors[-1][:160]}")
            cam = r["cam"]
            if not cam or not all(
                isinstance(cam[k], (int, float)) for k in ("az_deg", "el_deg", "fov_deg")
            ):
                bad.append(f"camera not finite: {cam}")
            # Follow frames the body exactly; the driver's view eases (0.35 s) toward a heading that wiggles with the path.
            if r["aimOff"] > (aim_tol if r["trackMode"] == "body" else 30.0):
                bad.append(f"aim {r['aimOff']:.1f} deg off the followed body or the way ahead")
            if (
                r["distinct"] < 2
            ):  # one colour everywhere (a dark view of shadowed ground can show only 2)
                bad.append(f"view looks blank ({r['distinct']} distinct pixels)")
            if expect_playing:
                if not r["playing"]:
                    bad.append("playback stopped")
                elif not (0.6 < r["rate"] / r["speed"] < 1.4):
                    bad.append(f"playback rate {r['rate'] / r['speed']:.2f} x the speed")
            for k, v in want.items():
                if r.get(k) != v:
                    bad.append(f"{k} = {r.get(k)!r}, expected {v!r}")
            status = "ok  " if not bad else "FAIL"
            print(
                f"{status} {step}: playing={r['playing']} rate={r['rate'] / max(1, r['speed']):.2f} track={r['trackMode']} "
                f"follow={r['follow']} driver={r['driver']} cam={ {k: round(v, 2) for k, v in (cam or {}).items()} } "
                f"pixels={r['distinct']} aimOff={r['aimOff']:.1f}"
                + "".join(f"\n     - {b}" for b in bad)
            )
            if bad:
                failures.append(f"{step}: {'; '.join(bad)}")
            return r

        open_story(page, "rover")
        ready()
        time.sleep(1.5)
        page.locator(".sky-card").first.scroll_into_view_if_needed()
        play()
        time.sleep(0.5)
        check("start")

        # Sun | Earth switch (the shared setSkyBody logic), with Follow off and on.
        js("() => document.querySelector('#body-toggle [data-body=\"sun\"]').click()")
        check("switch to Sun, free look")
        js("() => document.getElementById('btn-follow').click()")
        check("Follow on", trackMode="body", follow="true")
        js("() => document.querySelector('#body-toggle [data-body=\"earth\"]').click()")
        check("switch to Earth while following", trackMode="body", follow="true")
        js("() => document.querySelector('#body-toggle [data-body=\"sun\"]').click()")
        check("switch back to Sun while following", trackMode="body", follow="true")
        # "Both" (the data of both bodies): Follow keeps the last aimed body. Absent on older pages.
        both = '#body-toggle [data-body="both"]'
        if js(f"() => !!document.querySelector('{both}')"):
            js(f"() => document.querySelector('{both}').click()")
            check("switch to Both while following", trackMode="body", follow="true")
            js("() => document.querySelector('#body-toggle [data-body=\"sun\"]').click()")

        # A drag pauses Follow; the button resumes it; a second press turns it off.
        x, y = canvas_center()
        if a.phone:
            page.touchscreen.tap(x, y)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 200, y + 30, steps=6)
        page.mouse.up()
        check("drag while following", trackMode="body", follow="mixed")
        js("() => document.getElementById('btn-follow').click()")
        check("Follow pressed again: resumes", trackMode="body", follow="true")

        # Zoom while following keeps following.
        page.mouse.move(x, y)
        page.keyboard.down("Control")
        page.mouse.wheel(0, -400)
        page.keyboard.up("Control")
        check("zoom while following", trackMode="body", follow="true")

        # Driver's view replaces Follow; off again; on again.
        js("() => document.getElementById('btn-driver').click()")
        check("Driver's view on", trackMode="ahead", driver="true", follow="false")
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - 150, y, steps=6)
        page.mouse.up()
        check("drag in Driver's view", trackMode="ahead", driver="mixed")
        js("() => document.getElementById('btn-driver').click()")
        check("Driver's view pressed again: resumes", trackMode="ahead", driver="true")
        js("() => document.getElementById('btn-driver').click()")
        check("Driver's view off", trackMode=None, driver="false")

        # A body's edge arrow, pressed with the pointer while the time runs, turns the view to that body.
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - 700 if not a.phone else x - 300, y + 150, steps=8)
        page.mouse.up()
        time.sleep(0.3)
        edge = page.locator("#sky-grid .sky-card .moonat-sky-edge").first
        bb = edge.bounding_box() if edge.count() else None
        if bb:
            body = edge.get_attribute("data-body")
            # A press held for 150 ms, as a person presses (the arrow is drawn again in every frame meanwhile).
            page.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
            page.mouse.down()
            time.sleep(0.15)
            page.mouse.up()
            time.sleep(0.2)
            off = page.evaluate(
                """async (body) => { const m = await import('./js/app/sky_panel.js'); const w = m.skyDebug().views[0];
                const want = body === 'sun' ? w.sun_az : w.earth_az;
                return Math.abs(((w.view.getView().az_deg - want) % 360 + 540) % 360 - 180); }""",
                body,
            )
            ok = off < 3
            print(
                f"{'ok  ' if ok else 'FAIL'} edge arrow of the {body} pressed while playing: camera {off:.1f} deg off it"
            )
            if not ok:
                failures.append(f"edge arrow: camera {off:.1f} deg off the {body}")
        else:
            print("skip edge arrow: no body out of the frame")
        js("() => document.getElementById('btn-driver').click()")
        check("Driver's view on again", trackMode="ahead", driver="true")

        # Full screen on and off (the button and Esc).
        js("() => document.querySelector('#sky-grid .sky-card .sky-fs-btn').click()")
        time.sleep(0.4)
        check("full screen on", full=True)
        page.keyboard.press("Escape")
        time.sleep(0.4)
        check("full screen off (Esc)", full=False)
        js("() => document.querySelector('#sky-grid .sky-card .sky-fs-btn').click()")
        time.sleep(0.3)
        js("() => document.querySelector('#sky-grid .sky-card .sky-exit-btn').click()")
        time.sleep(0.3)
        check("full screen on and off (button)", full=False)

        # The "..." options.
        opts = js(
            "() => [...document.querySelectorAll('#sky-grid .sky-card')][0].querySelectorAll('.sky-opt').length"
        )
        names = js(
            "() => [...[...document.querySelectorAll('#sky-grid .sky-card')][0].querySelectorAll('.sky-opt')].map((b) => b.dataset.opt)"
        )
        assert len(names) == opts
        for opt in names:
            js("() => document.querySelector('#sky-grid .sky-card .sky-opts-btn').click()")
            js(
                f"() => document.querySelector('#sky-grid .sky-card .sky-opt[data-opt=\"{opt}\"]').click()"
            )
            check(f"option {opt} toggled")
            js("() => document.querySelector('#sky-grid .sky-card .sky-opts-btn').click()")
            js(
                f"() => document.querySelector('#sky-grid .sky-card .sky-opt[data-opt=\"{opt}\"]').click()"
            )
        js("() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")

        # Back to the start, so the trip does not end during the next steps.
        js("""() => { const s = document.getElementById('sky-slider'); s.value = '0';
          s.dispatchEvent(new Event('input', { bubbles: true })); }""")
        js("() => document.getElementById('btn-play').click()")

        # Speed changes.
        for sp in (600000, 21600000, 3600000):
            js(f"""() => {{ const s = document.getElementById('sky-speed'); s.value = '{sp}';
              s.dispatchEvent(new Event('change', {{ bubbles: true }})); }}""")
            check(f"speed {sp // 60000} min/s")

        # Back to the start, so the trip does not end during the next steps.
        js("""() => { const s = document.getElementById('sky-slider'); s.value = '0';
          s.dispatchEvent(new Event('input', { bubbles: true })); }""")
        js("() => document.getElementById('btn-play').click()")

        # Theme and window size.
        js("() => document.getElementById('btn-theme').click()")
        check("theme toggled")
        js("() => document.getElementById('btn-theme').click()")
        if not a.phone:
            page.set_viewport_size({"width": 1280, "height": 720})
            time.sleep(0.4)
            check("window resized to 1280 x 720")
            page.set_viewport_size({"width": 1920, "height": 1080})
            time.sleep(0.4)
            check("window resized back")
        else:
            page.set_viewport_size({"width": 844, "height": 390})
            time.sleep(0.5)
            check("phone landscape")
            page.set_viewport_size({"width": 390, "height": 844})
            time.sleep(0.5)
            check("phone portrait again")

        # Scrubbing stops the playback on purpose; play resumes with one loop.
        js("""() => { const s = document.getElementById('sky-slider'); s.value = '400';
          s.dispatchEvent(new Event('input', { bubbles: true })); }""")
        check("slider scrubbed (stops)", expect_playing=False, trackMode="ahead")
        js("() => document.getElementById('btn-play').click()")
        check("play again after scrubbing", trackMode="ahead")
        js("() => document.getElementById('btn-play').click()")
        js("() => document.getElementById('btn-play').click()")
        check("pause and play quickly")

        # Another story while playing, then back to the rover.
        open_story(page, "apollo11")
        time.sleep(3)
        check("switched to Apollo 11 (new set stops)", expect_playing=False, driverHidden=True)
        js("() => document.getElementById('btn-play').click()")
        check("Apollo 11 playing")
        open_story(page, "rover")
        ready()
        time.sleep(1.5)
        play()
        check("back to the rover, playing")

        browser.close()
    print(f"\n{len(failures)} failures")
    for f in failures:
        print(" -", f)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
