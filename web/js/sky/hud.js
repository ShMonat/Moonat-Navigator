// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
//
// DOM overlay of the sky view: time and Sun/Earth readout ("full", or "minimal": the time and at most one status line),
// compass ticks along the bottom edge, planet and body labels, the body markers (math.js bodyMarker: a label for a hidden
// body's dashed outline, edge arrows toward a body out of the frame) and the view-option buttons. The view itself is
// always a black sky, so the HUD uses light text with a dark halo in both page themes.

import { isoUtc, signed1, DEG, placeOnEdge } from './math.js';
import { compassPair, hiddenPhrase, eclipsePctText, eclipseStatus } from './words.js';

const CSS = `
.moonat-sky{position:relative;overflow:hidden;background:#000;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
.moonat-sky.dragging{cursor:grabbing}
.moonat-sky canvas{display:block;width:100%;height:100%}
.moonat-sky-frame{position:absolute;top:0;bottom:0;left:0;width:100%}
.moonat-sky-frame.tall{box-shadow:0 0 0 1px rgba(160,185,225,.22),0 0 30px 8px rgba(0,0,0,.6)}
.moonat-sky canvas.moonat-sky-bands{position:absolute;inset:0;display:none;pointer-events:none;filter:blur(10px) brightness(.62) saturate(1.1);transform:scale(1.04)}
.moonat-sky canvas.moonat-sky-bands.on{display:block}
.moonat-sky-edge{position:absolute;display:flex;align-items:center;gap:4px;box-sizing:border-box;height:20px;margin:0;padding:0 8px 0 5px;pointer-events:auto;cursor:pointer;color:#d3e2fb;background:rgba(8,12,20,.42);border:1px solid rgba(160,185,225,.32);border-radius:999px;font:inherit;font-size:11px;line-height:1;white-space:nowrap;text-shadow:0 0 3px #000}
.moonat-sky-edge.e-right{padding:0 5px 0 8px}
.moonat-sky-edge.hid{border-style:dashed}
.moonat-sky-edge::after{content:"";position:absolute;inset:-8px -4px}
.moonat-sky-edge:hover,.moonat-sky-edge:focus-visible{background:rgba(60,95,160,.72);border-color:rgba(200,215,245,.7);color:#fff}
.moonat-sky-edge svg{flex:none;width:10px;height:10px;overflow:visible}
.moonat-sky-edge path{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.moonat-sky-label.ghost{color:rgba(178,208,255,.9);font-size:10.5px}
.moonat-sky-illus{pointer-events:auto;cursor:help;color:#9fb0c8;font-size:10px;border-bottom:1px dotted rgba(159,176,200,.6)}
.moonat-sky-illus.open{color:#c9d5e6;border-bottom:0;white-space:normal}
.moonat-sky-bar[hidden]{display:none}
.moonat-sky-hud{position:absolute;inset:0;pointer-events:none;color:#e8edf5;font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;text-shadow:0 0 3px #000,0 0 6px #000}
.moonat-sky-tl{position:absolute;left:10px;top:8px;display:flex;flex-direction:column;align-items:flex-start;gap:8px;max-width:calc(100% - 20px)}
.moonat-sky-info{font-variant-numeric:tabular-nums;white-space:pre}
.moonat-sky-info b{font-weight:600;color:#fff}
.moonat-sky-info .dim{color:#9fb0c8}
.moonat-sky-badge{max-width:300px;padding:7px 10px;border-radius:9px;background:rgba(14,20,32,.78);border:1px solid rgba(160,185,225,.4);color:#e8edf5;font-size:12.5px;line-height:1.4;text-shadow:none;white-space:normal}
.moonat-sky-badge b{color:#fff}
.moonat-sky-note{position:absolute;right:10px;bottom:30px;color:#ffcf8a;font-size:11px;text-align:right;max-width:60%}
.moonat-sky-bar{position:absolute;right:8px;top:8px;display:flex;gap:6px}
.moonat-sky-btn{pointer-events:auto;cursor:pointer;background:rgba(20,26,38,.7);color:#dbe6f7;border:1px solid rgba(160,185,225,.45);border-radius:6px;padding:3px 8px;font:inherit}
.moonat-sky-btn[aria-pressed="true"]{background:rgba(60,95,160,.75);color:#fff}
.moonat-sky-btn .i{display:none}
.moonat-sky-compass{position:absolute;left:0;right:0;bottom:0;height:24px;background:linear-gradient(transparent,rgba(0,0,0,.55))}
.moonat-sky-tick{position:absolute;bottom:2px;transform:translateX(-50%);text-align:center;color:#b9c7dc;font-size:10px;font-variant-numeric:tabular-nums}
.moonat-sky-tick::before{content:"";display:block;margin:0 auto 1px;width:1px;height:5px;background:#b9c7dc}
.moonat-sky-tick.major{color:#fff;font-weight:700;font-size:12px}
.moonat-sky-tick.major::before{height:8px;background:#fff}
.moonat-sky-cap{position:absolute;transform:translateX(-50%);color:#e8edf5;font-size:11px;white-space:nowrap;text-align:center}
.moonat-sky-label{position:absolute;transform:translate(8px,-50%);color:#cfe0ff;font-size:11px;white-space:nowrap}
.moonat-sky-label.left{transform:translate(calc(-100% - 8px),-50%)}
.moonat-sky-label.below{transform:translate(-50%,0)}
.moonat-sky-label.const{transform:translate(-50%,-50%);color:rgba(150,178,225,.62);font-size:10.5px;font-style:italic;letter-spacing:.02em}
`;

const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

/**
 * skylineAt(az_deg) -> elevation (deg) of the terrain horizon in that direction, so a hidden body can be called
 * "hidden behind terrain (skyline +5.2°)" or "below the horizon" (wording rule in words.js).
 */
export function createHud(container, { onLookAt = null, onToggleConstellations, constellationsOn, hasConstellations, onExposureMode, exposureMode = 'eye', onToggleCloseUp, closeUpOn = true, skylineAt = null, level: level0 = 'full', buttons = true }) {
  let level = level0 === 'minimal' ? 'minimal' : 'full';
  if (!document.getElementById('moonat-sky-css')) {
    const st = document.createElement('style');
    st.id = 'moonat-sky-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.className = 'moonat-sky-hud';
  root.innerHTML = '<div class="moonat-sky-tl"><div class="moonat-sky-info"></div><div class="moonat-sky-badge" hidden></div></div><div class="moonat-sky-note"></div><div class="moonat-sky-compass"></div>';
  container.appendChild(root);
  const info = root.querySelector('.moonat-sky-info'), badge = root.querySelector('.moonat-sky-badge'), note = root.querySelector('.moonat-sky-note'), compass = root.querySelector('.moonat-sky-compass');
  const topLeft = root.querySelector('.moonat-sky-tl');
  const labels = document.createElement('div');
  root.appendChild(labels);
  // A body's edge arrow is drawn again in each frame of a playing timelapse, so the button under the pointer at the
  // release may be a new one and no "click" follows: a press and a release on the arrow of the same body turn the view.
  // The keyboard (Enter or Space: a click without a pointer) works as usual.
  let pressedBody = null;
  labels.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.moonat-sky-edge');
    pressedBody = b ? b.dataset.body : null;
    if (b) e.stopPropagation();
  });
  labels.addEventListener('pointerup', (e) => {
    const b = e.target.closest('.moonat-sky-edge');
    const body = pressedBody;
    pressedBody = null;
    if (b && body === b.dataset.body && onLookAt) onLookAt(body);
  });
  labels.addEventListener('click', (e) => {
    const b = e.target.closest('.moonat-sky-edge');
    if (b && e.detail === 0 && onLookAt) onLookAt(b.dataset.body);
  });
  const bar = document.createElement('div');
  bar.className = 'moonat-sky-bar';
  bar.hidden = !buttons;
  root.appendChild(bar);
  // Each button has a glyph and a word; narrow views (app CSS) show only the glyph. The accessible name is the word.
  // Line icons for the toggle buttons (the app's icon style, web/js/app/icons.js: currentColor, 1em; no emoji).
  const svg = (body) => `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-.14em">${body}</svg>`;
  const setLabel = (b, text) => { b.querySelector('.t').textContent = text; b.setAttribute('aria-label', text); };
  const addButton = (text, title, pressed, onClick, icon = '') => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'moonat-sky-btn'; b.title = title;
    b.innerHTML = `<span class="i" aria-hidden="true">${icon}</span><span class="t"></span>`;
    setLabel(b, text);
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
    setLabel(b, `Exposure: ${mode}`);
    barBox = { w: -1 };
    onExposureMode(mode);
  }, svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>'));
  const closeUpBtn = addButton('Close-up', 'Show or hide the magnified inset of the Earth (and of the Sun while terrain partly hides it)', closeUpOn, (b) => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    onToggleCloseUp(on);
  }, '◎');
  const caps = document.createElement('div');
  root.appendChild(caps);
  // The "ring illustrative" note of a close-up caption: the tooltip says why; a tap (no tooltips on touch screens)
  // opens the same sentence in place, and another tap closes it.
  let capList = [], noteOpen = false;
  caps.addEventListener('pointerdown', (e) => { if (e.target.closest('.moonat-sky-illus')) e.stopPropagation(); });
  caps.addEventListener('click', (e) => {
    if (!e.target.closest('.moonat-sky-illus')) return;
    noteOpen = !noteOpen;
    setCaptions(capList);
  });
  let constellationsBtn = null;
  if (hasConstellations) {
    constellationsBtn = addButton('Constellations', 'Show or hide the constellation lines and the names of well-known ones', constellationsOn, (b) => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      onToggleConstellations(on);
    }, svg('<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>'));
  }
  const skyline = (b) => (skylineAt ? skylineAt(b.az_deg) : null);
  // During an eclipse (C6 sun.eclipse_frac > 0): "Earth eclipses the Sun · 63% covered".
  const eclipseLine = (sun) => {
    const e = sun.eclipse_frac ?? 0;
    if (!(e > 0)) return '';
    const pct = eclipsePctText(e);
    const why = hiddenPhrase(sun, skyline(sun));
    const hidden = why ? `  <span class="dim">(Sun ${why})</span>` : '';
    return `
<span style="color:#ffb27a">Earth eclipses the Sun · ${pct}% covered</span>${hidden}`;
  };
  // Signed values with a true minus sign; positives get a figure space so the columns line up.
  let barBox = { w: -1 };
  // While a timelapse plays the HUD is redrawn every frame: an element's HTML is written only when it changed, and the
  // boxes of the readout and the note are measured again (a forced layout) only when their shape or the size changed.
  const shown = new Map();
  const setHtml = (el, html) => {
    if (shown.get(el) === html) return;
    shown.set(el, html);
    el.innerHTML = html;
  };
  const boxCache = new Map();
  const shapeOf = (html) => html.replace(/[0-9]/g, '0');   // tabular figures: new digits keep the box
  const cachedBox = (el, key) => {
    const c = boxCache.get(el);
    if (c && c.key === key) return c.box;
    const box = boxOf(el);
    boxCache.set(el, { key, box });
    return box;
  };
  const fmt = (x, n = 1) => { const t = signed1(x, n); return t.startsWith('−') ? t : ' ' + t; };

  /**
   * @param s        C6 skyState or null
   * @param view     { az, el, hfov } of the camera (deg)
   * @param project  (enuUnit) -> { x, y, visible } in CSS pixels
   * @param marks    [{ name, enu, hidden, dx, must }] labels to place (must: placed even where it collides)
   * @param noteText [string] notes for the lower right corner
   * @param avoid    [{ x0, y0, x1, y1 }] boxes (CSS px) that labels must not cover, e.g. the close-up insets
   * @param badgeHtml a message box under the readout (e.g. "Earth is below your feet" on the far side), or ''
   * @param bodies   body markers of the Sun and the Earth (math.js bodyMarker, plus { body: "sun" | "earth", title,
   *                 hidden }): a label beside a hidden body's dashed outline ("ghost"), an arrow button on the frame
   *                 edge for a body out of the frame ("edge"; a click calls onLookAt(body)). Nothing covers a body's disk.
   * Marks with `faint: true` are constellation names: centred, dim, and dropped where they would cover something.
   */
  function update(s, view, project, marks, noteText, avoid = [], badgeHtml = '', bodies = []) {
    if (s && level === 'minimal') {
      // Minimal: the time and at most one short status line (the full numbers live in the page, e.g. a card footer).
      const st = eclipseStatus(s.sun);
      setHtml(info, `<b>${isoUtc(s.t_ms).replace('T', ' ').replace('Z', ' UTC')}</b>${st ? `\n<span style="color:#ffb27a">${st}</span>` : ''}`);
    } else if (s) {
      // Plain words with the precise numbers: "height" is the elevation above the flat horizon, "direction" the compass
      // point and the azimuth (clockwise from north).
      // A second, indented line says what hides a body (or how much of it shows) and the Earth's phase.
      const status = (b, extra = '') => {
        const why = b.vis_frac >= 0.999 ? '' : hiddenPhrase(b, skyline(b)) || `${Math.round(b.vis_frac * 100)}% visible`;
        const t = [why, extra].filter(Boolean).join(' · ');
        return t ? `\n       <span class="dim">${t}</span>` : '';
      };
      const [cs, ce] = compassPair(s.sun.az_deg, s.earth.az_deg);
      const dir = (c, az) => `direction ${c} ${az.toFixed(1)}°`;
      setHtml(info, `<b>${isoUtc(s.t_ms).replace('T', ' ').replace('Z', ' UTC')}</b>\n`
        + `Sun    height ${fmt(s.sun.el_deg)}°  ${dir(cs, s.sun.az_deg)}${status(s.sun)}\n`
        + `Earth  height ${fmt(s.earth.el_deg)}°  ${dir(ce, s.earth.az_deg)}`
        + status(s.earth, s.earth.phase_frac != null ? `${Math.round(s.earth.phase_frac * 100)}% lit` : '')
        + eclipseLine(s.sun));
    }
    if (badge.hidden !== !badgeHtml) badge.hidden = !badgeHtml;
    if (badgeHtml) setHtml(badge, badgeHtml);
    const noteHtml = (noteText || []).join('<br>');
    setHtml(note, noteHtml);
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
    setHtml(compass, html);
    // Boxes labels and arrows must stay off: the button bar (measured again only when the view's width changes), the
    // caller's (close-up insets), the readout with its badge, the note, and the disks of the Sun and the Earth.
    if (barBox.w !== w) {
      barBox = { w, ...boxOf(bar) };
    }
    const boxes = [...avoid];
    const size = `${w}x${container.clientHeight}`;
    const tlBox = cachedBox(topLeft, `${size}|${shapeOf(shown.get(info) ?? '')}|${badgeHtml}`);
    const noteBox = noteText?.length ? cachedBox(note, `${size}|${noteHtml}`) : null;
    for (const b of [barBox, tlBox, noteBox]) if (b && b.x1 - b.x0 > 8) boxes.push(b);
    for (const b of bodies) {
      if (b.kind === 'in' || b.kind === 'ghost') boxes.push({ x0: b.x - b.r - 4, y0: b.y - b.r - 4, x1: b.x + b.r + 4, y1: b.y + b.r + 4 });
    }
    const hits = (x0, y0, x1, y1) => boxes.some((b) => x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0);
    let lh = '';
    // Right of the body by default; to its left, or below it, when that would cover a button, an inset, a disk or
    // another label, or run past the frame's edge. A planet's label that fits nowhere is left out (`must`: kept anyway).
    const bad = (x0, y0, x1, y1) => x0 < 2 || x1 > w - 2 || y0 < 0 || hits(x0, y0, x1, y1);
    const label = (p, dx, name, extra = '', must = false) => {
      const lw = 6.6 * name.length + 6;
      let x = p.x + dx, y = p.y, cls = extra, box = [x + 8, y - 8, x + 8 + lw, y + 8];
      if (bad(...box)) {
        if (!bad(p.x - dx - 8 - lw, y - 8, p.x - dx - 8, y + 8)) { x = p.x - dx; cls += ' left'; box = [x - 8 - lw, y - 8, x - 8, y + 8]; }
        else {
          x = Math.min(w - 4 - lw / 2, Math.max(4 + lw / 2, p.x));
          y = p.y + Math.max(8, dx - 6) + 4;
          cls += ' below';
          box = [x - lw / 2, y, x + lw / 2, y + 16];
          if (!must && bad(...box)) return;
        }
      }
      boxes.push({ x0: box[0], y0: box[1], x1: box[2], y1: box[3] });
      lh += `<div class="moonat-sky-label${cls}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${name}</div>`;
    };
    // A hidden body in the frame first: its label beside the dashed outline (drawn into the canvas by the view).
    for (const b of bodies) if (b.kind === 'ghost') label(b, b.r + 6, b.text, ' ghost', true);
    for (const m of marks) {
      if (m.hidden || m.faint) continue;
      const p = project(m.enu);
      if (p.visible) label(p, m.dx || 0, m.name, '', !!m.must);
    }
    // A body out of the frame: an arrow on that edge, slid along it off the boxes; a click turns the view to the body.
    const h = container.clientHeight;
    for (const b of bodies) {
      if (b.kind !== 'edge') continue;
      const bx = placeOnEdge({ edge: b.edge, x: b.x, y: b.y, w: Math.round(6.1 * b.text.length + 30), h: 20, width: w, height: h, boxes });
      boxes.push(bx);
      const arrow = `<svg viewBox="-5 -5 10 10" aria-hidden="true" style="transform:rotate(${(b.angle / DEG).toFixed(1)}deg)"><path d="M-2.5,-4 L2.5,0 L-2.5,4"/></svg>`;
      const pos = b.edge === 'left' ? `left:${bx.x0.toFixed(1)}px` : b.edge === 'right' ? `right:${(w - bx.x1).toFixed(1)}px`
        : `left:${((bx.x0 + bx.x1) / 2).toFixed(1)}px;transform:translateX(-50%)`;
      lh += `<button type="button" class="moonat-sky-edge e-${b.edge}${b.hidden ? ' hid' : ''}" data-body="${b.body}" style="${pos};top:${bx.y0.toFixed(1)}px" title="${b.title || ''}">`
        + (b.edge === 'right' ? `<span>${b.text}</span>${arrow}` : `${arrow}<span>${b.text}</span>`) + '</button>';
    }
    // Constellation names: centred on the lines, faint, and left out where they would cover anything above.
    for (const m of marks) {
      if (m.hidden || !m.faint) continue;
      const p = project(m.enu), lw = 6 * m.name.length;
      if (p.visible && p.y > 20 && p.x - lw / 2 > 4 && p.x + lw / 2 < w - 4 && !hits(p.x - lw / 2, p.y - 8, p.x + lw / 2, p.y + 8)) {
        lh += `<div class="moonat-sky-label const" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px">${m.name}</div>`;
      }
    }
    setHtml(labels, lh);
  }

  /** Bounding box of an element relative to the HUD (CSS px), with a 4 px margin; null when it is not shown. */
  function boxOf(el) {
    const rb = el.getBoundingClientRect();
    if (!rb.width || !rb.height) return null;
    const rr = root.getBoundingClientRect();
    return { x0: rb.left - rr.left - 4, y0: rb.top - rr.top - 4, x1: rb.right - rr.left + 4, y1: rb.bottom - rr.top + 4 };
  }

  /** Make the exposure button show a mode that was set through the API. */
  function setExposureMode(mode) {
    exposureBtn.setAttribute('aria-pressed', String(mode === 'camera'));
    setLabel(exposureBtn, `Exposure: ${mode}`);
    barBox = { w: -1 };
  }

  /**
   * Captions under the close-up insets: [{ x, y, text, maxW?, note? }] in CSS pixels (x = centre, y = top of the
   * caption). note: { text, title }, a small second line with a tooltip (e.g. "ring illustrative" during an eclipse).
   */
  function setCaptions(list) {
    capList = list;
    setHtml(caps, list.map((c) => {
      const n = c.note ? `<br><span class="moonat-sky-illus${noteOpen ? ' open' : ''}" role="note" title="${c.note.title}">${noteOpen ? c.note.title : c.note.text}</span>` : '';
      return `<div class="moonat-sky-cap" style="left:${c.x.toFixed(1)}px;top:${c.y.toFixed(1)}px${c.maxW ? `;max-width:${Math.round(c.maxW)}px;white-space:normal` : ''}">${c.text}${n}</div>`;
    }).join(''));
  }
  const setCloseUp = (on) => closeUpBtn.setAttribute('aria-pressed', String(on));
  const setConstellations = (on) => constellationsBtn?.setAttribute('aria-pressed', String(on));
  /** "full" (time, Sun and Earth heights and directions, phase, eclipse) or "minimal" (time and at most one status line). */
  const setLevel = (l) => { level = l === 'minimal' ? 'minimal' : 'full'; };
  /** Show or hide the HUD's own option buttons (a page can offer the same options in its own menu). */
  const setButtons = (on) => { bar.hidden = !on; barBox = { w: -1 }; };

  return { update, setExposureMode, setCaptions, setCloseUp, setConstellations, setLevel, setButtons, dispose: () => root.remove() };
}
