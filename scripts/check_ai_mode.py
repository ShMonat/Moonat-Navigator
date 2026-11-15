# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Check AI mode in the real page (Playwright + the installed Microsoft Edge), without a real API key.

The Claude API is replaced by a scripted fake: Playwright answers the SDK's requests to api.anthropic.com with
prepared Messages API responses (set_requirements, then find_candidate_sites + evaluate_site, then
final_recommendation), so the real SDK, the real agent loop and the real browser physics run end to end. Checked, at
1920 x 1080 and 390 x 844 in the dark and light themes:
  - the page does not load AI mode (web/js/ai/, web/css/ai.css, the SDK) before the button is pressed;
  - the panel, the example chips, the key storage (session by default, local when remembered, Forget clears both);
  - the request (model, effort, adaptive thinking, the refusal fallback, strict tools, the key header);
  - the log, the result cards with the tool's numbers, "Add all to the map" (places added with the suggested times);
  - the error paths: 401, 429, a refusal and a cut-off answer (max_tokens), in plain words;
  - one real request with an invalid key to api.anthropic.com: the real 401 (CORS, SDK) is shown in plain words;
  - no console errors (the fake 401/429 responses' own network lines aside).
Screenshots: outputs/ai_mode/*.png (or --out).

    uv run python scripts/check_ai_mode.py            # serves web/ on a free port itself
"""

from __future__ import annotations

import argparse
import functools
import json
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FAKE_KEY = "sk-ant-api03-moonat-test-key-not-real-0000000000000000"
API = "https://api.anthropic.com/v1/messages**"
CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-expose-headers": "*",
}

failures: list[str] = []


def message(content, stop_reason="tool_use", usage=None):
    return {
        "id": "msg_fake",
        "type": "message",
        "role": "assistant",
        "model": "claude-opus-5-5",
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": usage
        or {
            "input_tokens": 3000,
            "output_tokens": 400,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        },
    }


def tool(i, name, inp):
    return {"type": "tool_use", "id": f"toolu_{i}", "name": name, "input": inp}


WIN = {"start_utc": "2030-01-01T00:00:00Z", "end_utc": "2032-01-01T00:00:00Z"}
SCRIPT = [
    message(
        [
            {"type": "thinking", "thinking": "", "signature": "sig"},
            tool(
                1,
                "set_requirements",
                {
                    "mission_summary": "A crewed base at the south pole for 2030-2031.",
                    "region": "south_pole",
                    **WIN,
                    "min_sun_pct": 70,
                    "min_earth_pct": 80,
                    "max_night_days": 10,
                    "max_blackout_days": 2,
                    "earth_must_be_hidden": False,
                    "mobility": "Fixed site",
                    "assumptions": ["A 2-year test window", "Eye height 2 m"],
                },
            ),
        ]
    ),
    message(
        [
            tool(
                2,
                "find_candidate_sites",
                {"region": "south_pole", "min_sunlit_pct": 80, "kinds": [], "max_results": 12},
            ),
            tool(
                3,
                "evaluate_site",
                {
                    "name": "StarHab (Malapert crest)",
                    "site_id": "starhab",
                    "lat_deg": -85.96775,
                    "lon_deg": -2.28748,
                    **WIN,
                },
            ),
            tool(
                4,
                "evaluate_site",
                {
                    "name": "Connecting ridge",
                    "site_id": "connecting_ridge",
                    "lat_deg": -89.45,
                    "lon_deg": -137.3,
                    **WIN,
                },
            ),
        ],
        usage={
            "input_tokens": 500,
            "output_tokens": 600,
            "cache_creation_input_tokens": 4000,
            "cache_read_input_tokens": 3000,
        },
    ),
    message(
        [
            {"type": "text", "text": "Here is my recommendation."},
            tool(
                5,
                "final_recommendation",
                {
                    "summary": "The Malapert crest gives the best balance of sunlight and Earth contact; the connecting ridge has more Sun but loses the Earth for days.",
                    "assumptions": ["Fixed site", "Eye height 2 m"],
                    "sites": [
                        {
                            "name": "StarHab (Malapert crest)",
                            "site_id": "starhab",
                            "lat_deg": -85.96775,
                            "lon_deg": -2.28748,
                            **WIN,
                            "evaluation_id": "E1",
                            "why": "Most Earth contact with good sunlight.",
                            "metrics": {
                                "sun_pct": 1,
                                "earth_pct": 1,
                                "longest_night_days": 1,
                                "longest_blackout_days": 1,
                            },
                        },
                        {
                            "name": "Connecting ridge",
                            "site_id": "connecting_ridge",
                            "lat_deg": -89.45,
                            "lon_deg": -137.3,
                            **WIN,
                            "evaluation_id": "E2",
                            "why": "More sunlight, long Earth blackouts.",
                            "metrics": {
                                "sun_pct": 1,
                                "earth_pct": 1,
                                "longest_night_days": 1,
                                "longest_blackout_days": 1,
                            },
                        },
                    ],
                },
            ),
        ],
        stop_reason="tool_use",
    ),
]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass


def serve(web: Path) -> tuple[ThreadingHTTPServer, int]:
    """Serve web/ on a free local port in a background thread (a threaded server: the page loads in parallel)."""
    handler = functools.partial(QuietHandler, directory=str(web))

    class Server(ThreadingHTTPServer):
        request_queue_size = 256  # the page opens many module requests at once
        daemon_threads = True

    srv = Server(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def wait_for(page, js: str, timeout: float = 60.0) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if page.evaluate(js):
            return True
        time.sleep(0.15)
    return False


class Run:
    def __init__(self, p, name, out, theme="dark", phone=False):
        self.name, self.out = name, out
        self.browser = p.chromium.launch(
            channel="msedge",
            headless=True,
            args=["--ignore-gpu-blocklist", "--force-color-profile=srgb"],
        )
        size = {"width": 390, "height": 844} if phone else {"width": 1920, "height": 1080}
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
        self.requests: list[str] = []
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        self.page.on(
            "console",
            lambda m: (
                self.errors.append(f"{m.type}: {m.text}")
                if m.type in ("error", "warning")
                else None
            ),
        )
        self.page.on("request", lambda r: self.requests.append(r.url))
        self.page.on(
            "response",
            lambda r: self.errors.append(f"http {r.status}: {r.url}") if r.status == 404 else None,
        )

    def check(self, ok, what):
        print(f"  {'ok ' if ok else 'FAIL'} {what}")
        if not ok:
            failures.append(f"{self.name}: {what}")

    def shot(self, name):
        path = self.out / f"{self.name}_{name}.png"
        self.page.screenshot(path=str(path))
        print(f"  saved {path}")

    def close(self, allow=()):
        bad = [
            e for e in self.errors if "was preloaded" not in e and not any(a in e for a in allow)
        ]
        self.check(
            not bad, f"no console errors ({len(bad)})" + "".join(f"\n       {e}" for e in bad[:8])
        )
        self.ctx.close()
        self.browser.close()


def fake_api(page, script, seen):
    """Answer the SDK's Messages API calls from `script` (dicts, or (status, body) for an HTTP error)."""
    queue = list(script)

    def handle(route):
        req = route.request
        if req.method == "OPTIONS":
            route.fulfill(status=204, headers=CORS)
            return
        seen.append({"headers": req.all_headers(), "body": json.loads(req.post_data or "{}")})
        nxt = (
            queue.pop(0)
            if queue
            else (500, {"type": "error", "error": {"type": "api_error", "message": "script ended"}})
        )
        status, body = nxt if isinstance(nxt, tuple) else (200, nxt)
        hdr = {**CORS, "content-type": "application/json", "request-id": "req_fake"}
        if status == 429:
            hdr["retry-after-ms"] = "20"
        route.fulfill(status=status, headers=hdr, body=json.dumps(body))

    page.route(API, handle)


def open_panel(r, url):
    page = r.page
    page.goto(url, wait_until="load")
    wait_for(
        page,
        "() => !!document.querySelector('input.scen-label') && !!document.querySelector('#map canvas')",
        60,
    )
    time.sleep(1.5)
    before = [u for u in r.requests if "/js/ai/" in u or "ai.css" in u or "anthropic-ai" in u]
    r.check(not before, f"nothing of AI mode loads before the button is pressed ({len(before)})")
    box = page.locator("#btn-ai").bounding_box()
    vw = page.viewport_size["width"]
    r.check(
        box is not None and box["x"] >= 0 and box["x"] + box["width"] <= vw,
        "the AI mode button fits in the header",
    )
    path = r.out / f"{r.name}_header.png"
    page.screenshot(path=str(path), clip={"x": 0, "y": 0, "width": vw, "height": 80})
    print(f"  saved {path}")
    page.click("#btn-ai")
    ok = wait_for(
        page,
        "() => !!document.querySelector('#ai-dialog[open]') && getComputedStyle(document.querySelector('#ai-dialog')).maxWidth === '780px'",
        20,
    )
    r.check(ok, "the panel opens with its own styles")


def check_panel(r):
    page = r.page
    chips = page.locator(".ai-examples .chip")
    r.check(chips.count() == 3, "three example chips")
    chips.nth(2).click()
    val = page.input_value("#ai-mission")
    r.check("far-side radio telescope" in val, "a chip fills the mission box")
    r.check(
        "the numbers come from Moonat's validated physics" in page.inner_text("#ai-dialog"),
        "the AI label is shown",
    )
    r.check(
        "about $0.10" in page.inner_text(".ai-note")
        and page.locator('.ai-note a[href="https://console.anthropic.com/"]').count() == 1,
        "cost note and Console link",
    )
    # Key storage: this tab by default, this device when remembered, Forget clears both.
    page.fill("#ai-key", FAKE_KEY)
    page.dispatch_event("#ai-key", "change")
    st = page.evaluate(
        "() => [sessionStorage.getItem('moonat.ai.anthropicKey'), localStorage.getItem('moonat.ai.anthropicKey')]"
    )
    r.check(
        st == [FAKE_KEY, None],
        f"key kept in sessionStorage only ({st[0] is not None}, {st[1] is not None})",
    )
    page.check("#ai-remember")
    st = page.evaluate(
        "() => [sessionStorage.getItem('moonat.ai.anthropicKey'), localStorage.getItem('moonat.ai.anthropicKey')]"
    )
    r.check(st == [None, FAKE_KEY], "Remember moves it to localStorage")
    page.click("#ai-forget")
    st = page.evaluate(
        "() => [sessionStorage.getItem('moonat.ai.anthropicKey'), localStorage.getItem('moonat.ai.anthropicKey'), document.querySelector('#ai-key').value]"
    )
    r.check(st == [None, None, ""], "Forget key clears both stores and the field")
    r.check(FAKE_KEY not in page.evaluate("() => location.href"), "the key is not in the address")


def run_fake(r, seen):
    page = r.page
    page.fill(
        "#ai-mission",
        "A crewed base for 10 years from 2030 that needs maximum sunlight and continuous Earth contact.",
    )
    page.fill("#ai-key", FAKE_KEY)
    page.click("#ai-go")
    ok = wait_for(page, "() => !document.querySelector('#ai-result').hidden", 90)
    r.check(ok, "the scripted run ends with the result")
    if not ok:
        print("   log:", page.inner_text("#ai-log"), "| error:", page.inner_text("#ai-error"))
        return
    body = seen[0]["body"] if seen else {}
    hdr = seen[0]["headers"] if seen else {}
    r.check(len(seen) == 3, f"three requests to the API ({len(seen)})")
    r.check(
        body.get("model") == "claude-opus-5-5"
        and body.get("output_config") == {"effort": "medium"}
        and body.get("thinking") == {"type": "adaptive"},
        "model claude-opus-5-5, effort medium, adaptive thinking",
    )
    r.check(
        body.get("fallbacks") == "default"
        and "server-side-fallback-2026-07-01" in hdr.get("anthropic-beta", ""),
        "server-side refusal fallback on",
    )
    r.check(
        all(t.get("strict") for t in body.get("tools", [])) and len(body.get("tools", [])) == 5,
        "five strict tools",
    )
    # SDK 1.x sends an API key as "Authorization: Bearer <key>" (API version 2026-10-21).
    r.check(
        hdr.get("authorization") == f"Bearer {FAKE_KEY}"
        and hdr.get("anthropic-dangerous-direct-browser-access") == "true",
        "the key goes only in the Authorization header, with direct browser access on",
    )
    third = seen[2]["body"]["messages"][-1]["content"] if len(seen) > 2 else []
    evals = [
        json.loads(x["content"]) for x in third if x.get("tool_use_id") in ("toolu_3", "toolu_4")
    ]
    r.check(
        len(evals) == 2 and all(e.get("evaluation_id") for e in evals),
        "the evaluations went back to the model",
    )
    log = page.inner_text("#ai-log")
    r.check(
        "Requirements set" in log
        and "Found " in log
        and "StarHab (Malapert crest): Sun " in log
        and "Connecting ridge: Sun " in log,
        "the log names each step with its numbers",
    )
    r.check(
        not page.locator("#ai-req").is_hidden() and "Fixed site" in page.inner_text("#ai-req"),
        "requirements are shown",
    )
    cards = page.locator(".ai-card")
    r.check(cards.count() == 2, "two ranked cards")
    first = cards.nth(0).inner_text()
    e1 = evals[0] if evals else {}
    r.check(
        f"{round(e1.get('sun_visible_pct', -9))} %" in first and "1 %" not in first.split("Why")[0],
        f"card 1 shows the tool's Sun % ({e1.get('sun_visible_pct')}), not the model's copy",
    )
    r.check("Real" not in first and "Terrain: NASA LOLA" in first, "card shows the terrain source")
    r.check(
        "about $" in page.inner_text("#ai-usage"),
        "usage and cost shown: " + page.inner_text("#ai-usage"),
    )
    time.sleep(0.8)
    page.evaluate("() => document.querySelector('#ai-result').scrollIntoView({ block: 'start' })")
    time.sleep(0.3)
    r.shot("result")
    page.click(".ai-addall")
    time.sleep(1.0)
    r.check(
        not page.evaluate("() => document.querySelector('#ai-dialog').open"),
        "Add all closes the panel",
    )
    labels = page.evaluate(
        "() => [...document.querySelectorAll('input.scen-label')].map((x) => x.value)"
    )
    rows = page.evaluate("""() => { const m = /[#&]s=([^&]+)/.exec(location.hash); if (!m) return [];
      const b = m[1].replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(b + '==='.slice((b.length + 3) % 4));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))); }""")
    ai_rows = [x for x in rows if x[0] in ("StarHab (Malapert crest)", "Connecting ridge")]
    r.check(
        len(ai_rows) == 2
        and all(
            x[3].startswith("2030-01-01") and str(x[4]).startswith("2032-01-01") for x in ai_rows
        ),
        f"both sites are places with the suggested dates ({labels})",
    )
    time.sleep(2.5)
    r.shot("map")


def run_errors(r, seen):
    page = r.page
    page.fill("#ai-mission", "A rover at the south pole.")
    page.fill("#ai-key", FAKE_KEY)
    cases = [
        (
            (
                401,
                {
                    "type": "error",
                    "error": {"type": "authentication_error", "message": "invalid x-api-key"},
                },
            ),
            "401",
        ),
        (
            (429, {"type": "error", "error": {"type": "rate_limit_error", "message": "slow down"}}),
            "rate limit",
        ),
        (message([], stop_reason="refusal"), "declined"),
        (message([tool(9, "set_requirements", {})], stop_reason="max_tokens"), "cut off"),
    ]
    for resp, want in cases:
        page.unroute(API)
        script = [resp] * 3 if isinstance(resp, tuple) and resp[0] == 429 else [resp]
        fake_api(page, script, seen)
        page.click("#ai-go")
        ok = wait_for(
            page,
            "() => !document.querySelector('#ai-error').hidden && !document.querySelector('#ai-go').disabled",
            60,
        )
        text = page.inner_text("#ai-error") if ok else ""
        r.check(ok and want in text, f"error in plain words for {want}: {text[:90]}")
    r.shot("error")


def run_live_401(r):
    page = r.page
    page.unroute(API)
    page.fill("#ai-mission", "A rover at the south pole.")
    page.fill("#ai-key", FAKE_KEY)
    page.click("#ai-go")
    ok = wait_for(
        page,
        "() => !document.querySelector('#ai-error').hidden && !document.querySelector('#ai-go').disabled",
        60,
    )
    text = page.inner_text("#ai-error") if ok else ""
    r.check(
        ok and "401" in text,
        f"the real API answers an invalid key with 401, shown in plain words: {text[:80]}",
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "outputs" / "ai_mode"))
    ap.add_argument(
        "--no-live",
        action="store_true",
        help="skip the one real request (invalid key) to api.anthropic.com",
    )
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    srv, port = serve(ROOT / "web")
    url = f"http://127.0.0.1:{port}/"
    print(f"serving web/ at {url}")
    try:
        with sync_playwright() as p:
            for theme in ("dark", "light"):
                for phone in (False, True):
                    name = f"{'phone' if phone else 'desktop'}_{theme}"
                    print(f"[{name}]")
                    r = Run(p, name, out, theme, phone)
                    seen: list[dict] = []
                    fake_api(r.page, SCRIPT, seen)
                    open_panel(r, url)
                    r.shot("panel")
                    check_panel(r)
                    run_fake(r, seen)
                    allow = ()
                    if theme == "dark" and not phone:
                        page = r.page
                        page.click("#btn-ai")
                        run_errors(r, seen)
                        allow = ("status of 401", "status of 429", "status of 500")
                        if not a.no_live:
                            run_live_401(r)
                    r.close(allow)
    finally:
        srv.shutdown()
    print("\nFAILURES:" if failures else "\nall checks passed")
    for f in failures:
        print("  -", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
