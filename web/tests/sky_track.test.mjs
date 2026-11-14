// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Camera tracking (web/js/sky/track.js, C8 extra setTrack): the easing and aim maths.
// Run: node --test web/tests/sky_track.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  azDelta, wrapAz, easeFactor, feedForward, easeToward, aimAtFov, parseTrackTarget, TRACK_TAU_MS,
} from '../js/sky/track.js';
import { DEG, fitPhotoView } from '../js/sky/math.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('azDelta takes the shortest turn, through north when that is shorter', () => {
  assert.equal(azDelta(350, 10), 20);
  assert.equal(azDelta(10, 350), -20);
  assert.equal(azDelta(0, 180), 180);   // exactly behind: a turn to the right
  assert.equal(azDelta(90, 270), 180);
  assert.equal(azDelta(720.5, 0.5), 0);
  assert.equal(wrapAz(-30), 330);
  assert.equal(wrapAz(725), 5);
});

test('easeFactor is exponential: independent of the frame rate', () => {
  close(easeFactor(TRACK_TAU_MS), 1 - Math.exp(-1), 1e-12);
  assert.equal(easeFactor(0), 0);
  assert.equal(easeFactor(-5), 0);
  assert.equal(easeFactor(16, 0), 1);
  // Two steps of dt leave the same offset as one step of 2 dt.
  const k1 = easeFactor(16), k2 = easeFactor(32);
  close((1 - k1) * (1 - k1), 1 - k2, 1e-12);
});

test('easeToward: 63 % of the way after tau, 95 % after 3 tau, on any frame rate', () => {
  const run = (frameMs) => {
    let v = { az: 0, el: 10, hfov: 70 };
    const target = { az: 40, el: 30, hfov: 35 };
    for (let t = 0; t < 3 * TRACK_TAU_MS - 1e-9; t += frameMs) v = easeToward(v, target, frameMs);
    return v;
  };
  for (const frameMs of [8, 16.7, 50]) {
    const v = run(frameMs);
    close(v.az, 40 * (1 - Math.exp(-3)), 0.05, `az at ${frameMs} ms frames`);
    close(v.el, 10 + 20 * (1 - Math.exp(-3)), 0.05, `el at ${frameMs} ms frames`);
    // FOV on a log scale: halfway in log after ln2-worth... here 95 % of the log ratio.
    close(Math.log(v.hfov / 70), Math.log(0.5) * (1 - Math.exp(-3)), 1e-3, `fov at ${frameMs} ms frames`);
  }
  const one = easeToward({ az: 0, el: 0, hfov: 60 }, { az: 10, el: 0, hfov: 60 }, TRACK_TAU_MS);
  close(one.az, 10 * (1 - Math.exp(-1)), 1e-9);
});

test('easeToward turns the short way round north and settles exactly on the target', () => {
  let v = { az: 350, el: 5, hfov: 60 };
  const target = { az: 20, el: 5, hfov: 60 };
  const first = easeToward(v, target, 100);
  assert.ok(first.az > 350 || first.az < 20, `went the long way: ${first.az}`);
  let n = 0;
  while (!v.settled && n < 1000) { v = easeToward(v, target, 16); n++; }
  assert.ok(v.settled, 'never settled');
  assert.deepEqual([v.az, v.el, v.hfov], [20, 5, 60]);
  assert.ok(n * 16 < 12 * TRACK_TAU_MS, `settling took ${n * 16} ms`);
  // A camera already on target is settled at once (no needless frames).
  assert.ok(easeToward({ az: 20, el: 5, hfov: 60 }, target, 16).settled);
});

test('feed-forward: a fast body is followed without lag, a framing jump is left to the easing', () => {
  // The Sun circling the pole at 1 month per second: 6° of azimuth per 60 fps frame.
  let view = { az: 100, el: 12, hfov: 70 };
  let prev = { az: 100, el: 12, hfov: 70 };
  for (let i = 1; i <= 120; i++) {
    const target = { az: wrapAz(100 + 6 * i), el: 12, hfov: 70 };
    view = feedForward(view, prev, target, { az: 6, el: 0 });
    view = easeToward(view, target, 1000 / 60);
    prev = target;
  }
  close(azDelta(view.az, prev.az), 0, 1e-9, 'lag after two seconds');
  // Without feed-forward the same camera would trail by about rate × tau (0.36°/ms × 350 ms ≈ 126°).
  let lagging = { az: 100, el: 12, hfov: 70 };
  for (let i = 1; i <= 120; i++) lagging = easeToward(lagging, { az: wrapAz(100 + 6 * i), el: 12, hfov: 70 }, 1000 / 60);
  assert.ok(Math.abs(azDelta(lagging.az, prev.az)) > 60, 'the test should show the lag that feed-forward removes');

  // A change of framing regime (the body sets behind the skyline: the pitch rule jumps by 6°) while the body barely
  // moves is NOT fed forward: the camera eases instead of jumping.
  const v0 = { az: 50, el: 13.3, hfov: 70 };
  const ff = feedForward(v0, { az: 50, el: 13.3, hfov: 70 }, { az: 50.1, el: 7.5, hfov: 70 }, { az: 0.1, el: -0.05 });
  close(ff.az, 50.1, 1e-12, 'azimuth follows the body');
  assert.equal(ff.el, 13.3, 'the pitch jump is not fed forward');
  // A direction target (no body motion) is never fed forward.
  assert.deepEqual(feedForward(v0, v0, { az: 90, el: 0, hfov: 70 }, null), v0);
});

test('feed-forward follows a rising body in pitch and field of view (photo rule widening)', () => {
  const view = { az: 0, el: 20, hfov: 70 };
  const out = feedForward(view, { az: 0, el: 20, hfov: 70 }, { az: 0, el: 21, hfov: 71.5 }, { az: 0, el: 1 });
  assert.equal(out.el, 21);
  assert.equal(out.hfov, 71.5);
});

test('aimAtFov keeps the body in a zoomed frame, by the C8 rules at that field', () => {
  const aspect = 16 / 9;
  const yOf = (el, pitch, hfov) => Math.tan((el - pitch) * DEG) / (Math.tan((hfov * DEG) / 2) / aspect);
  // A low body fits the photo rule: the horizon sits 20 % above the bottom edge (y = −0.6).
  const low = aimAtFov({ bodyElDeg: 5, bodyRadiusDeg: 0.9, horizonElDeg: 0, aspect, hfovDeg: 50 });
  close(yOf(0, low, 50), -0.6, 1e-9, 'horizon height');
  close(low, fitPhotoView({ bodyElDeg: 5, bodyRadiusDeg: 0.9, horizonElDeg: 0, aspect, hfovDeg: 50, maxHfovDeg: 50 }).el_deg, 1e-12);
  // A high body (Apollo 11's Earth, 59° up) zoomed in to 30°: the body stays in the frame, the horizon leaves it.
  const high = aimAtFov({ bodyElDeg: 59, bodyRadiusDeg: 0.95, horizonElDeg: 0.3, aspect, hfovDeg: 30 });
  assert.ok(yOf(59 + 0.95, high, 30) < 1 && yOf(59 - 0.95, high, 30) > -1, `Earth out of frame at pitch ${high}`);
  assert.ok(yOf(0.3, high, 30) < -1, 'the horizon cannot fit too');
  // A body below the skyline: the horizon one third of the frame height above the bottom edge (y = −1/3).
  const hidden = aimAtFov({ bodyElDeg: -3, bodyRadiusDeg: 0.9, horizonElDeg: 1, aspect, hfovDeg: 40 });
  close(yOf(1, hidden, 40), -1 / 3, 1e-9, 'skyline height for a hidden body');
});

test('parseTrackTarget: bodies, directions, and off', () => {
  assert.deepEqual(parseTrackTarget('sun'), { kind: 'body', body: 'sun' });
  assert.deepEqual(parseTrackTarget('earth'), { kind: 'body', body: 'earth' });
  assert.deepEqual(parseTrackTarget({ az_deg: -90, el_deg: -4 }), { kind: 'dir', az: 270, el: -4 });
  assert.equal(parseTrackTarget(null), null);
  assert.equal(parseTrackTarget('moon'), null);
  assert.equal(parseTrackTarget({ az_deg: NaN, el_deg: 0 }), null);
});

test('a direction target updated every frame (rover look-ahead) is followed smoothly, and a heading change eases', () => {
  // The app turns the direction 0.2° per frame (fed forward: up to 0.5° per update, as setTrack does for directions),
  // then the route turns by 40° at a waypoint (eased).
  let v = { az: 10, el: -5, hfov: 70 }, dir = { az: 10, el: -5, hfov: 70 };
  const steps = [];
  for (let i = 0; i < 90; i++) {
    const prev = dir;
    dir = { ...dir, az: i === 30 ? dir.az + 40 : dir.az + 0.2 };
    const prevAz = v.az;
    v = easeToward(feedForward(v, prev, dir, { az: 0, el: 0 }), dir, 1000 / 60);
    steps.push(Math.abs(azDelta(prevAz, v.az)));
    if (i === 29) close(azDelta(v.az, dir.az), 0, 1e-6, 'no lag on a smooth turn');
  }
  // The 40° corner is spread over many frames: no single frame turns more than k·40° (k = easeFactor of one frame).
  assert.ok(Math.max(...steps) <= easeFactor(1000 / 60) * 40 + 0.5, `largest step ${Math.max(...steps)}°`);
  // One second after the corner: 40° · exp(−1000 / 350) ≈ 2.3° left.
  close(azDelta(v.az, dir.az), 0, 2.5, 'caught up after the corner');
});
