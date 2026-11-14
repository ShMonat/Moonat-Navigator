// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Tests for the sky view's body markers (web/js/sky/math.js bodyMarker and helpers, words.js offsetText): projection
// to the screen, edge arrows, the left/right decision, the offset text and the placement that keeps the arrows off
// the buttons.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGE_INSET, cameraCoords, projectDir, azTurn, angularSeparation, rayToEdge, bodyMarker, placeOnEdge, azElToEnu, verticalFovDeg, DEG,
} from '../js/sky/math.js';
import { offsetText, ghostText } from '../js/sky/words.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);
const W = 1920, H = 1080;
const body = (az, el, r = 0.95) => ({ az_deg: az, el_deg: el, ang_radius_deg: r, enu: azElToEnu(az, el) });

test('cameraCoords: the view axis, right and up of a camera at azimuth 90, elevation 30', () => {
  const [x0, y0, z0] = cameraCoords(azElToEnu(90, 30), 90, 30);
  close(x0, 0, 1e-12); close(y0, 0, 1e-12); close(z0, 1, 1e-12);
  // Facing east, south (az 180) is to the right, at the same height as the horizon below the axis.
  const [x1, , z1] = cameraCoords([0, -1, 0], 90, 30);
  close(x1, 1, 1e-12); close(z1, 0, 1e-12);
  // The zenith is up and in front for a camera pitched up.
  const [, y2, z2] = cameraCoords([0, 0, 1], 90, 30);
  close(y2, Math.cos(30 * DEG), 1e-12); close(z2, Math.sin(30 * DEG), 1e-12);
});

test('projectDir: pinhole projection with square pixels (known values)', () => {
  const view = { az: 90, el: 0, hfov: 90 };   // f = 500 px for a 1000 px wide frame
  let p = projectDir(azElToEnu(90, 20), view, 1000, 500);
  close(p.x, 500, 1e-9); close(p.y, 250 - 500 * Math.tan(20 * DEG), 1e-9); assert.equal(p.front, true);
  p = projectDir(azElToEnu(135, 0), view, 1000, 500);   // half the horizontal field to the right: the right edge
  close(p.x, 1000, 1e-9); close(p.y, 250, 1e-9);
  // Half the vertical field up (math.js verticalFovDeg) lands on the top edge.
  const v = { az: 200, el: 10, hfov: 70 }, vf = verticalFovDeg(70, W / H);
  p = projectDir(azElToEnu(200, 10 + vf / 2), v, W, H);
  close(p.x, W / 2, 1e-9); close(p.y, 0, 1e-9);
  // Behind the camera: no screen position.
  p = projectDir(azElToEnu(20, 0), { az: 200, el: 0, hfov: 70 }, W, H);
  assert.equal(p.front, false); assert.ok(Number.isNaN(p.x));
});

test('azTurn: signed and wrapped at north; exactly behind counts as right', () => {
  assert.equal(azTurn(10, 350), 20);
  assert.equal(azTurn(350, 10), -20);
  assert.equal(azTurn(180, 0), 180);
  assert.equal(azTurn(0, 180), 180);
  assert.equal(azTurn(-90, 90), 180);
  close(azTurn(258.6, 258.6), 0, 1e-12);
  close(angularSeparation(0, 0, 90, 0), 90, 1e-9);
  close(angularSeparation(10, 89, 190, 89), 2, 1e-9);   // over the zenith
});

test('rayToEdge: the first inset edge the ray from the centre meets', () => {
  let a = rayToEdge(1, 0, W, H);
  assert.equal(a.edge, 'right'); close(a.x, W - EDGE_INSET.right, 1e-9); close(a.y, H / 2, 1e-9);
  a = rayToEdge(0, 1, W, H);
  assert.equal(a.edge, 'bottom'); close(a.y, H - EDGE_INSET.bottom, 1e-9);
  a = rayToEdge(-1, -1, W, H);   // 45° up-left in a wide frame: the top edge first
  assert.equal(a.edge, 'top'); close(a.y, EDGE_INSET.top, 1e-9); close(a.x, W / 2 - (H / 2 - EDGE_INSET.top), 1e-9);
});

test('offsetText: azimuth turn on the sides, elevation change at the top and bottom', () => {
  assert.equal(offsetText('right', 35.2, 3, 35), '35° right');
  assert.equal(offsetText('left', -120.6, 3, 120), '121° left');
  assert.equal(offsetText('top', 10, 44.2, 45), '44° up');
  assert.equal(offsetText('bottom', 0, -55, 55), '55° down');
  // A body over the zenith side (on the top edge although lower than the view centre): the great-circle angle.
  assert.equal(offsetText('top', 180, -10, 50.4), '50° up');
  assert.equal(offsetText('right', 0.2, 0, 3.4), '3° right');
  assert.equal(ghostText('Earth', 'below', -7.46), 'Earth · below the horizon (−7.5°)');
  assert.equal(ghostText('Sun', 'terrain', 2.1), 'Sun · behind terrain');
});

test('bodyMarker: left/right decision, across north and behind the camera', () => {
  const view = { az: 350, el: 0, hfov: 70 };
  let m = bodyMarker({ name: 'Sun', body: body(60, 0, 0.26), view, width: W, height: H });
  assert.equal(m.kind, 'edge'); assert.equal(m.edge, 'right'); assert.equal(m.text, 'Sun · 70° right');
  close(m.y, H / 2, 1e-6); close(m.angle, 0, 1e-9);
  m = bodyMarker({ name: 'Sun', body: body(280, 0, 0.26), view, width: W, height: H });
  assert.equal(m.edge, 'left'); assert.equal(m.text, 'Sun · 70° left');
  // Behind the camera and above it: still a side arrow (the turn), not "up" over the zenith.
  m = bodyMarker({ name: 'Earth', body: body(180, 30), view: { az: 0, el: 10, hfov: 70 }, width: W, height: H });
  assert.equal(m.edge, 'right'); assert.equal(m.text, 'Earth · 180° right');
  assert.ok(m.y < H / 2, 'points up a little');
  m = bodyMarker({ name: 'Earth', body: body(200, 20), view: { az: 0, el: 10, hfov: 70 }, width: W, height: H });
  assert.equal(m.edge, 'left'); assert.equal(m.text, 'Earth · 160° left');
});

test('bodyMarker: Apollo 11 Earth above the frame (up arrow), far-side Earth below it (down arrow)', () => {
  // Apollo 11: Earth 59.2° up; the camera looks at the horizon under it.
  let m = bodyMarker({ name: 'Earth', body: body(258.6, 59.2), view: { az: 258.6, el: 15, hfov: 70 }, width: W, height: H });
  assert.equal(m.kind, 'edge'); assert.equal(m.edge, 'top'); assert.equal(m.text, 'Earth · 44° up');
  close(m.x, W / 2, 1e-6); close(m.y, EDGE_INSET.top, 1e-9); close(m.angle, -Math.PI / 2, 1e-9);
  // Far side (Chang'e 4): Earth 45° below the horizontal plane, straight ahead and down.
  m = bodyMarker({ name: 'Earth', body: body(180, -45), view: { az: 180, el: 10, hfov: 70 }, width: W, height: H, hidden: 'below' });
  assert.equal(m.edge, 'bottom'); assert.equal(m.text, 'Earth · 55° down');
  close(m.y, H - EDGE_INSET.bottom, 1e-9); close(m.angle, Math.PI / 2, 1e-9);
  // Phone portrait frame: the same Earth still goes to the top edge.
  m = bodyMarker({ name: 'Earth', body: body(258.6, 59.2), view: { az: 270, el: 20, hfov: 70 }, width: 390, height: 300 });
  assert.equal(m.edge, 'top'); assert.ok(m.x > 0 && m.x < 195, 'left of centre: the Earth is 11° to the left');
});

test('bodyMarker: a hidden body in the frame gets a dashed outline at its true place and size', () => {
  const view = { az: 140, el: 0, hfov: 70 }, f = W / 2 / Math.tan(35 * DEG);
  let m = bodyMarker({ name: 'Earth', body: body(141, -2), view, width: W, height: H, hidden: 'below' });
  assert.equal(m.kind, 'ghost'); assert.equal(m.text, 'Earth · below the horizon (−2.0°)');
  // Independent check: camera coordinates of (az 141, el −2) seen from (140, 0).
  const xc = Math.cos(2 * DEG) * Math.sin(DEG), yc = Math.sin(-2 * DEG), zc = Math.cos(2 * DEG) * Math.cos(DEG);
  close(m.x, W / 2 + (f * xc) / zc, 1e-6); close(m.y, H / 2 - (f * yc) / zc, 1e-6);
  close(m.r, (f * Math.tan(0.95 * DEG)) / zc, 1e-6);
  m = bodyMarker({ name: 'Earth', body: body(141, 1), view, width: W, height: H, hidden: 'terrain' });
  assert.equal(m.kind, 'ghost'); assert.equal(m.text, 'Earth · behind terrain');
  m = bodyMarker({ name: 'Earth', body: body(141, 1), view, width: W, height: H });
  assert.equal(m.kind, 'in');
});

test('placeOnEdge: arrows step off the phone button corner and stay inside the frame', () => {
  const w = 110, h = 20, width = 390, height = 320;
  const bar = { x0: 4, y0: 252, x1: 130, y1: 296 };   // the HUD buttons at the bottom left in a narrow view
  const hits = (b) => b.x0 < bar.x1 && b.x1 > bar.x0 && b.y0 < bar.y1 && b.y1 > bar.y0;
  // Bottom edge, anchored near the left: slides right of the bar.
  let b = placeOnEdge({ edge: 'bottom', x: 60, y: 290, w, h, width, height, boxes: [bar] });
  assert.ok(!hits(b)); assert.ok(b.x0 >= bar.x1 && b.x0 < bar.x1 + 8); close(b.y1, height - EDGE_INSET.bottom, 1e-9);
  // Left edge, anchored low: slides up above the bar.
  b = placeOnEdge({ edge: 'left', x: 8, y: 280, w, h, width, height, boxes: [bar] });
  assert.ok(!hits(b)); assert.ok(b.y1 <= bar.y0 && b.y1 > bar.y0 - 8); close(b.x0, EDGE_INSET.left, 1e-9);
  // Nothing in the way: centred on the anchor, flush with the edge.
  b = placeOnEdge({ edge: 'top', x: 200, y: 8, w, h, width, height, boxes: [bar] });
  close((b.x0 + b.x1) / 2, 200, 1e-9); close(b.y0, EDGE_INSET.top, 1e-9);
  // Right edge near a corner: clamped inside the frame.
  b = placeOnEdge({ edge: 'right', x: 382, y: 2, w, h, width, height });
  close(b.x1, width - EDGE_INSET.right, 1e-9); close(b.y0, EDGE_INSET.top, 1e-9);
  // The whole edge taken: steps inward.
  b = placeOnEdge({ edge: 'top', x: 200, y: 8, w, h, width, height, boxes: [{ x0: 0, y0: 0, x1: width, y1: 40 }] });
  assert.ok(b.y0 >= 40);
});
