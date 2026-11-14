// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// DOM overlay of the sky view: time and Sun/Earth readout, compass ticks along the bottom edge, planet and body
// labels, and a constellation toggle. The view itself is always a black sky, so the HUD uses light text in both
// page themes.

import { isoUtc, signed1 } from './math.js';

const CSS = `
.moonat-sky{position:relative;overflow:hidden;background:#000;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
.moonat-sky.dragging{cursor:grabbing}
.moonat-sky canvas{display:block;width:100%;height:100%}
.moonat-sky-frame{position:absolute;top:0;bottom:0;left:0;width:100%}
.moonat-sky-frame.tall{box-shadow:0 0 0 1px rgba(160,185,225,.28)}
.moonat-sky-edge{position:absolute;top:8px;transform:translateX(-50%);pointer-events:auto;cursor:pointer;color:#cfe0ff;background:rgba(20,26,38,.55);border:1px solid rgba(160,185,225,.35);border-radius:999px;padding:2px 10px;font:inherit;font-size:11.5px;white-space:nowrap;text-shadow:none}
.moonat-sky-edge:hover{background:rgba(60,95,160,.75);color:#fff}
.moonat-sky-hud{position:absolute;inset:0;pointer-events:none;color:#e8edf5;font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;text-shadow:0 0 3px #000,0 0 6px #000}
.moonat-sky-info{position:absolute;left:10px;top:8px;font-variant-numeric:tabular-nums;white-space:pre}
.moonat-sky-info b{font-weight:600;color:#fff}
.moonat-sky-info .dim{color:#9fb0c8}
.moonat-sky-note{position:absolute;right:10px;bottom:30px;color:#ffcf8a;font-size:11px;text-align:right;max-width:60%}
.moonat-sky-bar{position:absolute;right:8px;top:8px;display:flex;gap:6px}
.moonat-sky-btn{pointer-events:auto;cursor:pointer;background:rgba(20,26,38,.7);color:#dbe6f7;border:1px solid rgba(160,185,225,.45);border-radius:6px;padding:3px 8px;font:inherit}
.moonat-sky-btn[aria-pressed="true"]{background:rgba(60,95,160,.75);color:#fff}
.moonat-sky-compass{position:absolute;left:0;right:0;bottom:0;height:24px;background:linear-gradient(transparent,rgba(0,0,0,.55))}
.moonat-sky-tick{position:absolute;bottom:2px;transform:translateX(-50%);text-align:center;color:#b9c7dc;font-size:10px;font-variant-numeric:tabular-nums}
.moonat-sky-tick::before{content:"";display:block;margin:0 auto 1px;width:1px;height:5px;background:#b9c7dc}
.moonat-sky-tick.major{color:#fff;font-weight:700;font-size:12px}
.moonat-sky-tick.major::before{height:8px;background:#fff}
.moonat-sky-cap{position:absolute;transform:translateX(-50%);color:#e8edf5;font-size:11px;white-space:nowrap;text-align:center}
.moonat-sky-label{position:absolute;transform:translate(8px,-50%);color:#cfe0ff;font-size:11px;white-space:nowrap}
.moonat-sky-label.left{transform:translate(calc(-100% - 8px),-50%)}
.moonat-sky-label.below{transform:translate(-50%,0)}
`;

const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

export function createHud(container, { onLookAt = null, onToggleConstellations, constellationsOn, hasConstellations, onExposureMode, exposureMode = 'eye', onToggleCloseUp, closeUpOn = true }) {
  if (!document.getElementById('moonat-sky-css')) {
    const st = document.createElement('style');
    st.id = 'moonat-sky-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.className = 'moonat-sky-hud';
  root.innerHTML = '<div class="moonat-sky-info"></div><div class="moonat-sky-note"></div><div class="moonat-sky-compass"></div>';
  container.appendChild(root);
  const info = root.querySelector('.moonat-sky-info'), note = root.querySelector('.moonat-sky-note'), compass = root.querySelector('.moonat-sky-compass');
  const labels = document.createElement('div');
  root.appendChild(labels);
  labels.addEventListener('pointerdown', (e) => { if (e.target.closest('.moonat-sky-edge')) e.stopPropagation(); });
  labels.addEventListener('click', (e) => {
    const b = e.target.closest('.moonat-sky-edge');
    if (b && onLookAt) onLookAt(b.dataset.body);
  });
  const bar = document.createElement('div');
  bar.className = 'moonat-sky-bar';
  root.appendChild(bar);
  const addButton = (text, title, pressed, onClick) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'moonat-sky-btn'; b.textContent = text; b.title = title;
    b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', () => onClick(b));
    bar.appendChild(b);
    return b;
  };
  // Exposure: "eye" keeps stars visible in daylight (for orientation); "camera" exposes for the sunlit ground.
  const exposureBtn = addButton(`Exposure: ${exposureMode}`, 'Eye: stars stay visible in daylight. Camera: exposed for the sunlit ground, so stars vanish while the Sun is up.', exposureMode === 'camera', (b) => {
    const mode = b.getAttribute('aria-pressed') === 'true' ? 'eye' : 'camera';
    b.setAttribute('aria-pressed', String(mode === 'camera'));
    b.textContent = `Exposure: ${mode}`;
    barBox = { w: -1 };
    onExposureMode(mode);
  });
  const closeUpBtn = addButton('Close-up', 'Show or hide the magnified inset of the Earth (and of the Sun while terrain partly hides it)', closeUpOn, (b) => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    onToggleCloseUp(on);
  });
  const caps = document.createElement('div');
  root.appendChild(caps);
  if (hasConstellations) {
    addButton('Constellations', 'Show or hide constellation lines', constellationsOn, (b) => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      onToggleConstellations(on);
    });
  }
  // During an eclipse (C6 sun.eclipse_frac > 0): "Earth eclipses the Sun · 63 % covered".
  const eclipseLine = (sun) => {
    const e = sun.eclipse_frac ?? 0;
    if (!(e > 0)) return '';
    const p = e * 100;
    const pct = e >= 1 ? '100' : p > 99 || p < 1 ? (Math.floor(p * 10) / 10).toFixed(1) : String(Math.round(p));
    const hidden = sun.vis_frac != null && sun.vis_frac <= 0.001 ? '  <span class="dim">(Sun below the horizon)</span>' : '';
    return `
<span style="color:#ffb27a">Earth eclipses the Sun · ${pct} % covered</span>${hidden}`;
  };
  // Signed values with a true minus sign; positives get a figure space so the columns line up.
  let barBox = { w: -1 };
  const fmt = (x, n = 1) => { const t = signed1(x, n); return t.startsWith('−') ? t : ' ' + t; };

  /**
   * @param s        C6 skyState or null
   * @param view     { az, el, hfov } of the camera (deg)
   * @param project  (enuUnit) -> { x, y, visible } in CSS pixels
   * @param marks    [{ name, enu, hidden, dx, body, edgeText }] labels to place
   * @param noteText [string] notes for the lower right corner
   * @param avoid    [{ x0, y0, x1, y1 }] boxes (CSS px) that labels must not cover, e.g. the close-up insets
   */
  function update(s, view, project, marks, noteText, avoid = []) {
    if (s) {
      const vis = (b) => (b.vis_frac >= 0.999 ? '' : b.vis_frac <= 0.001 ? '  <span class="dim">below the horizon</span>' : `  <span class="dim">${Math.round(b.vis_frac * 100)}% visible</span>`);
      info.innerHTML = `<b>${isoUtc(s.t_ms).replace('T', ' ').replace('Z', ' UTC')}</b>\n`
        + `Sun    el ${fmt(s.sun.el_deg)}°  az ${s.sun.az_deg.toFixed(1)}°${vis(s.sun)}\n`
        + `Earth  el ${fmt(s.earth.el_deg)}°  az ${s.earth.az_deg.toFixed(1)}°${vis(s.earth)}`
        + (s.earth.phase_frac != null ? `  <span class="dim">${Math.round(s.earth.phase_frac * 100)}% lit</span>` : '')
        + eclipseLine(s.sun);
    }
    note.innerHTML = (noteText || []).join('<br>');
    // Compass: azimuth ticks placed where that azimuth, at the elevation of the view centre, falls on screen.
    // Tick step: the finest of 1, 2, 5, 10, 15, 30, 45 deg whose labels stay at least ~64 px apart.
    let html = '';
    const w = container.clientWidth, c = Math.cos(view.el * Math.PI / 180) || 1e-3;
    const pxPerDeg = (w / view.hfov) * c;
    const step = [1, 2, 5, 10, 15, 30, 45].find((s) => s * pxPerDeg >= 64) ?? 45;
    const span = Math.min(180, (view.hfov / 2) / c + step);
    for (let az = Math.ceil((view.az - span) / step) * step; az <= view.az + span; az += step) {
      const a = ((az % 360) + 360) % 360, e = view.el * Math.PI / 180, ar = a * Math.PI / 180;
      const p = project([Math.sin(ar) * Math.cos(e), Math.cos(ar) * Math.cos(e), Math.sin(e)]);
      if (!p.visible || p.x < 8 || p.x > w - 8) continue;
      const card = CARDINALS[a];
      html += `<div class="moonat-sky-tick${card ? ' major' : ''}" style="left:${p.x.toFixed(1)}px">${card || a + '°'}</div>`;
    }
    compass.innerHTML = html;
    // Boxes labels must stay off: the button bar (measured again only when the view's width changes) and the
    // caller's (close-up insets).
    if (barBox.w !== w) {
      const rr = root.getBoundingClientRect(), rb = bar.getBoundingClientRect();
      barBox = { w, x0: rb.left - rr.left - 4, y0: rb.top - rr.top - 4, x1: rb.right - rr.left + 4, y1: rb.bottom - rr.top + 4 };
    }
    const boxes = [...avoid, barBox];
    const hits = (x0, y0, x1, y1) => boxes.some((b) => x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0);
    let lh = '';
    for (const m of marks) {
      if (m.hidden) continue;
      const p = project(m.enu);
      if (p.visible) {
        // Right of the body by default; to its left, or below it, when that would cover a button or an inset.
        const dx = m.dx || 0, lw = 6.6 * m.name.length + 6;
        let x = p.x + dx, y = p.y, cls = '';
        if (hits(x + 8, y - 8, x + 8 + lw, y + 8)) {
          if (!hits(p.x - dx - 8 - lw, y - 8, p.x - dx - 8, y + 8)) { x = p.x - dx; cls = ' left'; }
          else { x = p.x; y = p.y + Math.max(8, dx - 6) + 4; cls = ' below'; }
        }
        lh += `<div class="moonat-sky-label${cls}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${m.name}</div>`;
      } else if (p.above && m.edgeText && m.body) {
        // The body is above the frame: a marker on the top edge, at its azimuth, that turns the view up to it.
        // It steps left of the button bar (or below it, in a narrow view) rather than cover a button.
        const lw = 7 * m.edgeText.length + 22;
        let x = Math.min(w - 60, Math.max(60, p.x)), top = 8;
        if (hits(x - lw / 2, top, x + lw / 2, top + 22)) {
          if (barBox.x0 - lw / 2 - 4 >= lw / 2 + 4) x = barBox.x0 - lw / 2 - 4;
          else top = barBox.y1 + 2;
        }
        lh += `<button type="button" class="moonat-sky-edge" data-body="${m.body}" style="left:${x.toFixed(1)}px;top:${top}px" title="Look up at the ${m.name}">${m.edgeText}</button>`;
      }
    }
    labels.innerHTML = lh;
  }

  /** Make the exposure button show a mode that was set through the API. */
  function setExposureMode(mode) {
    exposureBtn.setAttribute('aria-pressed', String(mode === 'camera'));
    exposureBtn.textContent = `Exposure: ${mode}`;
    barBox = { w: -1 };
  }

  /** Captions under the close-up insets: [{ x, y, text }] in CSS pixels (x = centre, y = top of the caption). */
  function setCaptions(list) {
    caps.innerHTML = list.map((c) => `<div class="moonat-sky-cap" style="left:${c.x.toFixed(1)}px;top:${c.y.toFixed(1)}px">${c.text}</div>`).join('');
  }
  const setCloseUp = (on) => closeUpBtn.setAttribute('aria-pressed', String(on));

  return { update, setExposureMode, setCaptions, setCloseUp, dispose: () => root.remove() };
}
