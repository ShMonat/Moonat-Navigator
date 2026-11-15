# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Measure how smooth the timelapse playback looks in the real page (Playwright + the installed Microsoft Edge).

For each frame of a few seconds of playback it records what a viewer sees: the frame interval, the scenario time
shown, the first view's camera (azimuth, elevation, field of view) and, for a rover trip, the distance driven. It
reports the frame-interval spread and the "step jitter" of each quantity: mean |step_i - step_(i-1)| / mean |step_i|
(0 for perfectly even steps; a quantity that moves in bursts scores high), and backward steps (non-monotonic).

Run with a local server (any free port):
    uv run python -m http.server -d web 8137 --bind 127.0.0.1
    uv run python scripts/check_playback_smooth.py --url http://127.0.0.1:8137 [--case rover1h rover10m apollo]
        [--runs 2] [--phone] [--driver] [--seconds 8] [--profile]
"""

from __future__ import annotations

import argparse
import json
import statistics as st
import time

from playwright.sync_api import sync_playwright

READY_JS = """() => { const c = [...document.querySelectorAll('#sky-grid .sky-card')];
  return c.length > 0 && c.every((x) => !x.querySelector('.sky-loading') && x.querySelector('canvas')
    && x.querySelector('.sky-card-foot').textContent.trim().length > 0); }"""

SAMPLER_JS = """async () => {
  const m = await import('./js/app/sky_panel.js');
  const ride = await import('./js/rover/sky_ride.js');
  // Camera azimuth in one fixed frame (a point near the pole), so a rover's turning local frame does not count as a turn.
  const REF = { lat_deg: -89, lon_deg: 0 };
  window.__smp = [];
  window.__smpOn = true;
  const f = (ts) => {
    if (!window.__smpOn) return;
    const d = m.skyDebug();
    const v = d.views[0];
    const cam = v && v.view && v.view.getView ? v.view.getView() : null;
    const az = cam ? cam.az_deg - (v.site ? ride.frameTurnDeg(REF, v.site) : 0) : null;
    window.__smp.push([ts, d.offsetMs, az, cam ? cam.el_deg : null, cam ? cam.fov_deg : null,
      v ? v.distance_m : null, d.playing]);
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}"""

CASES = {
    "rover1h": {"qs": "rover", "speed": 3600e3},
    "rover10m": {"qs": "rover", "speed": 600e3},
    "apollo": {"qs": "apollo11", "speed": 3600e3, "follow": True},
}


def open_story(page, key: str) -> None:
    """Open a story: its chip (older pages) or its entry in the search dropdown (focus #globe-search)."""
    chip = page.locator(f'#quickstarts [data-qs="{key}"]')
    if chip.count():
        chip.first.click()
        return
    page.locator("#globe-search").click()
    page.locator(f'.gs-story[data-story="{key}"]').first.click()


def jitter(xs: list[float]) -> float | None:
    """mean |x_i - x_(i-1)| / mean |x_i| of a list of steps (None when they are all zero)."""
    if len(xs) < 3:
        return None
    m = st.fmean(abs(x) for x in xs)
    if m == 0:
        return None
    return st.fmean(abs(b - a) for a, b in zip(xs, xs[1:], strict=False)) / m


def wrap(d: float) -> float:
    return (d + 540) % 360 - 180


def analyse(smp: list[list]) -> dict:
    smp = [s for s in smp if s[6]]
    ts = [s[0] for s in smp]
    dt = [b - a for a, b in zip(ts, ts[1:], strict=False)]
    off = [s[1] for s in smp]
    d_off = [b - a for a, b in zip(off, off[1:], strict=False)]
    out = {
        "frames": len(dt),
        "fps": round(len(dt) / ((ts[-1] - ts[0]) / 1000), 1) if len(ts) > 1 else 0,
        "dt_med": round(st.median(dt), 1),
        "dt_p95": round(sorted(dt)[int(0.95 * (len(dt) - 1))], 1),
        "dt_max": round(max(dt), 1),
        "over25": sum(d > 25 for d in dt),
        "over50": sum(d > 50 for d in dt),
        "dt_jitter": round(jitter(dt) or 0, 3),
        "sim_jitter": round(jitter(d_off) or 0, 3),
        "sim_back": sum(d < 0 for d in d_off),
        "sim_still": sum(d == 0 for d in d_off),
    }
    # Per unit of wall time: a quantity shown at an even rate has step_i / dt_i constant.
    if all(s[2] is not None for s in smp):
        daz = [wrap(b[2] - a[2]) for a, b in zip(smp, smp[1:], strict=False)]
        dfov = [b[4] - a[4] for a, b in zip(smp, smp[1:], strict=False)]
        rate = [a / t for a, t in zip(daz, dt, strict=False) if t > 0]
        out["yaw_jitter"] = round(jitter(daz) or 0, 3)
        out["yaw_rate_jitter"] = round(jitter(rate) or 0, 3)
        out["yaw_max_step"] = round(max(abs(x) for x in daz), 3)
        out["yaw_reversals"] = sum(
            1
            for a, b in zip(daz, daz[1:], strict=False)
            if a * b < 0 and abs(a) > 1e-3 and abs(b) > 1e-3
        )
        out["fov_max_step"] = round(max(abs(x) for x in dfov), 3)
    if all(s[5] is not None for s in smp):
        dd = [b[5] - a[5] for a, b in zip(smp, smp[1:], strict=False)]
        out["dist_jitter"] = round(jitter(dd) or 0, 3)
        out["dist_back"] = sum(d < -1e-6 for d in dd)
        out["dist_m"] = round(smp[-1][5] - smp[0][5], 1)
    return out


def run_case(
    p, url: str, case: str, phone: bool, driver: bool, seconds: float, profile: bool
) -> dict:
    c = CASES[case]
    size = {"width": 390, "height": 844} if phone else {"width": 1920, "height": 1080}
    browser = p.chromium.launch(
        channel="msedge",
        headless=True,
        args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
    )
    ctx = browser.new_context(
        viewport=size, is_mobile=phone, has_touch=phone, device_scale_factor=3 if phone else 1
    )
    page = ctx.new_page()
    page.add_init_script('try { localStorage.setItem("moonat-intro", "off"); } catch (e) {}')
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on(
        "console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None
    )
    page.goto(url + "/", wait_until="load")
    time.sleep(1.0)
    open_story(page, c["qs"])
    t0 = time.time()
    ready = (
        READY_JS
        if c["qs"] != "rover"
        else f"() => ({READY_JS})() && !document.getElementById('btn-driver').hidden"
    )
    while time.time() - t0 < 180 and not page.evaluate(ready):
        time.sleep(0.2)
    time.sleep(2.0)
    page.evaluate(f"""() => {{ const s = document.getElementById('sky-speed'); s.value = '{int(c["speed"])}';
      s.dispatchEvent(new Event('change', {{ bubbles: true }})); }}""")
    if driver:
        page.evaluate("() => document.getElementById('btn-driver').click()")
    if c.get("follow"):
        page.evaluate(
            "() => { const b = document.getElementById('btn-follow'); if (b.getAttribute('aria-pressed') !== 'true') b.click(); }"
        )
    page.locator(".sky-card").first.scroll_into_view_if_needed()
    time.sleep(0.5)
    cdp = None
    if profile:
        cdp = ctx.new_cdp_session(page)
        cdp.send("Profiler.enable")
        cdp.send("Profiler.setSamplingInterval", {"interval": 200})
    page.evaluate(SAMPLER_JS)
    page.evaluate("() => document.getElementById('btn-play').click()")
    if cdp:
        cdp.send("Profiler.start")
    time.sleep(seconds)
    prof = cdp.send("Profiler.stop")["profile"] if cdp else None
    page.evaluate("() => { window.__smpOn = false; }")
    smp = page.evaluate("() => window.__smp")
    res = analyse(smp)
    res["errors"] = len(errors)
    if errors:
        res["first_error"] = errors[0][:200]
    if prof:
        res["profile"] = top_self(prof)
    browser.close()
    return res


def top_self(prof: dict, n: int = 18) -> list:
    """Self time (ms) by function and file, the n largest."""
    nodes = {nd["id"]: nd for nd in prof["nodes"]}
    dts = prof.get("timeDeltas", [])
    self_ms: dict[str, float] = {}
    for sid, d in zip(prof.get("samples", []), dts, strict=False):
        cf = nodes[sid]["callFrame"]
        key = f"{cf['functionName'] or '(anon)'} {cf['url'].rsplit('/', 1)[-1]}:{cf['lineNumber'] + 1}"
        self_ms[key] = self_ms.get(key, 0) + d / 1000
    return sorted(((round(v, 1), k) for k, v in self_ms.items()), reverse=True)[:n]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8137")
    ap.add_argument("--case", nargs="*", default=["rover1h", "rover10m"])
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--phone", action="store_true")
    ap.add_argument("--driver", action="store_true")
    ap.add_argument("--seconds", type=float, default=8)
    ap.add_argument("--profile", action="store_true")
    a = ap.parse_args()
    with sync_playwright() as p:
        for case in a.case:
            for i in range(a.runs):
                r = run_case(p, a.url, case, a.phone, a.driver, a.seconds, a.profile)
                prof = r.pop("profile", None)
                print(
                    json.dumps(
                        {"case": case, "phone": a.phone, "driver": a.driver, "run": i + 1, **r}
                    )
                )
                if prof:
                    for ms, k in prof:
                        print(f"    {ms:8.1f} ms  {k}")


if __name__ == "__main__":
    main()
