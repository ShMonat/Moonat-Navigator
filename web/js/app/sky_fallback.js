// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// 2D canvas view of the lunar sky with the same API as C8 createSkyView, used only when WebGL is not available.
// Projection: plain cylindrical (x = azimuth, y = elevation, same degrees-per-pixel on both axes), centred on a look
// direction. It draws the Sun, the Earth with its phase, then the terrain horizon on top (so terrain hides them).

const R2D = 180 / Math.PI;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export async function createSkyView(container, { site, fovDeg = 60 } = {}) {
  const canvas = document.createElement("canvas");
  container.append(canvas);
  const ctx = canvas.getContext("2d");
  const horizon = site && site.horizon;
  let fov = Math.max(fovDeg, 125); // the flat preview needs a wider field than the 3D view
  let az0 = 0;
  let el0 = 20;
  let state = null;
  let first = true;
  let raf = 0;

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);

  function size() {
    const w = container.clientWidth || 640;
    const h = container.clientHeight || Math.round((w * 9) / 16);
    return { w, h };
  }

  function resize() {
    const { w, h } = size();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    schedule();
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  const horizonEl = (az) => {
    if (!horizon || !horizon.el_deg) return 0;
    const n = horizon.el_deg.length;
    const step = horizon.az_step_deg || 360 / n;
    const x = (((az % 360) + 360) % 360) / step;
    const i = Math.floor(x) % n;
    const f = x - Math.floor(x);
    return horizon.el_deg[i] * (1 - f) + horizon.el_deg[(i + 1) % n] * f;
  };

  function project(az, el, w, h) {
    const k = w / fov;
    let da = (((az - az0) % 360) + 540) % 360 - 180;
    return { x: w / 2 + da * k, y: h / 2 - (el - el0) * k, k };
  }

  /** Point at (az, el) while keeping the horizon in frame when the target allows it. */
  function frame(az, el) {
    const { w, h } = size();
    const vfov = (fov * h) / w;
    az0 = az;
    el0 = Math.max(el - vfov / 2 + 8, vfov / 2 - 10);
    clampEl();
    schedule();
  }

  function clampEl() {
    const { w, h } = size();
    const vfov = (fov * h) / w;
    el0 = Math.max(vfov / 2 - 12, Math.min(90 - vfov / 2 + 10, el0));
  }

  function draw() {
    const { w, h } = size();
    const k = w / fov;
    ctx.clearRect(0, 0, w, h);
    const sunUp = state && state.sun.el_deg > -1;

    // Sky.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#000000");
    g.addColorStop(1, sunUp ? "#0a0d14" : "#05060a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    drawStars(w, h);

    if (state) {
      drawSun(w, h);
      drawEarth(w, h);
    }

    // Terrain: fill from the horizon profile to the bottom.
    ctx.beginPath();
    const stepPx = 3;
    for (let x = 0; x <= w + stepPx; x += stepPx) {
      const az = az0 + (x - w / 2) / k;
      const y = h / 2 - (horizonEl(az) - el0) * k;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(w + stepPx, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const yH = h / 2 + el0 * k;
    const gg = ctx.createLinearGradient(0, Math.max(0, yH - 10), 0, h);
    gg.addColorStop(0, sunUp ? "#77746c" : "#2a2a2e");
    gg.addColorStop(1, sunUp ? "#3b3a36" : "#121214");
    ctx.fillStyle = gg;
    ctx.fill();
    ctx.strokeStyle = sunUp ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Compass ticks along the flat horizon line.
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (let a = 0; a < 360; a += 15) {
      const p = project(a, 0, w, h);
      if (p.x < -20 || p.x > w + 20) continue;
      const major = a % 45 === 0;
      const yt = Math.max(p.y, h / 2 - (horizonEl(a) - el0) * k) + 4;
      ctx.fillStyle = major ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)";
      ctx.fillRect(p.x - 0.5, yt, 1, major ? 7 : 4);
      if (major && yt + 20 < h) ctx.fillText(COMPASS[a / 45], p.x, yt + 19);
    }

    if (state) {
      labelBody(state.sun, "Sun", "#ffd257", w, h);
      labelBody(state.earth, "Earth", "#8cc4ff", w, h);
    }

    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText("2D view (no WebGL)", w - 8, h - 8);
  }

  // Deterministic faint star field, fixed in the sky (a preview, not a star catalog).
  const stars = [];
  {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 420; i++) stars.push([rnd() * 360, Math.asin(rnd()) * R2D, rnd()]);
  }
  function drawStars(w, h) {
    for (const [az, el, m] of stars) {
      const p = project(az, el, w, h);
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
      ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.5 * m * m})`;
      ctx.fillRect(p.x, p.y, m > 0.9 ? 1.6 : 1, m > 0.9 ? 1.6 : 1);
    }
  }

  function drawSun(w, h) {
    const s = state.sun;
    const p = project(s.az_deg, s.el_deg, w, h);
    const r = Math.max(5, s.ang_radius_deg * p.k);
    const glow = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 7);
    glow.addColorStop(0, "rgba(255,240,200,0.55)");
    glow.addColorStop(1, "rgba(255,240,200,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 7, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = "#fff6dc";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    ctx.fill();
  }

  function drawEarth(w, h) {
    const e = state.earth;
    const p = project(e.az_deg, e.el_deg, w, h);
    const r = Math.max(8, e.ang_radius_deg * p.k);
    // Screen direction toward the Sun: project a point a little way from Earth along sun_dir_enu.
    let theta = 0;
    if (Array.isArray(e.enu) && Array.isArray(e.sun_dir_enu)) {
      const q = [0, 1, 2].map((i) => e.enu[i] + 0.02 * e.sun_dir_enu[i]);
      const n = Math.hypot(q[0], q[1], q[2]);
      const az = Math.atan2(q[0], q[1]) * R2D;
      const el = Math.asin(q[2] / n) * R2D;
      const p2 = project(az, el, w, h);
      theta = Math.atan2(p2.y - p.y, p2.x - p.x);
    }
    const kf = Math.max(0, Math.min(1, e.phase_frac));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(theta);
    ctx.fillStyle = "#141a26";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.fill();
    if (kf > 0.002) {
      const lit = ctx.createRadialGradient(r * 0.3, -r * 0.2, r * 0.1, 0, 0, r);
      lit.addColorStop(0, "#9fd0ff");
      lit.addColorStop(1, "#2f6fc4");
      ctx.fillStyle = lit;
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.ellipse(0, 0, Math.abs(2 * kf - 1) * r, r, 0, Math.PI / 2, -Math.PI / 2, kf <= 0.5);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(140,196,255,0.35)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 0.5, 0, 2 * Math.PI);
    ctx.stroke();
  }

  /** Label a body next to it, or with an arrow at the frame edge when it is out of view. */
  function labelBody(b, name, color, w, h) {
    const p = project(b.az_deg, b.el_deg, w, h);
    const txt = `${name} ${b.el_deg < 0 && b.el_deg.toFixed(1) !== "-0.0" ? "−" : ""}${Math.abs(b.el_deg).toFixed(1)}°`;
    ctx.font = "600 12px system-ui, sans-serif";
    const m = 16;
    const inside = p.x > m && p.x < w - m && p.y > m && p.y < h - m;
    const hidden = b.vis_frac <= 0;
    if (inside) {
      ctx.textAlign = "left";
      ctx.fillStyle = color;
      ctx.fillText(hidden ? `${txt} (hidden)` : txt, p.x + 12, p.y - 10);
      return;
    }
    const cx = Math.max(m, Math.min(w - m, p.x));
    const cy = Math.max(m, Math.min(h - m, p.y));
    const ang = Math.atan2(p.y - h / 2, p.x - w / 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.textAlign = cx > w / 2 ? "right" : "left";
    ctx.fillStyle = color;
    const tx = cx + (cx > w / 2 ? -12 : 12);
    const ty = cy + (cy > h / 2 ? -8 : 16);
    ctx.fillText(txt, tx, ty);
  }

  // Drag to look around, wheel to zoom.
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, az: az0, el: el0 };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const k = size().w / fov;
    az0 = drag.az - (e.clientX - drag.x) / k;
    el0 = drag.el + (e.clientY - drag.y) / k;
    clampEl();
    schedule();
  });
  const end = () => (drag = null);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    fov = Math.max(20, Math.min(180, fov * Math.exp(e.deltaY * 0.001)));
    clampEl();
    schedule();
  }, { passive: false });

  resize();

  return {
    update(skyState) {
      state = skyState;
      if (first) {
        first = false;
        frame(state.earth.az_deg, Math.max(state.earth.el_deg, 5));
      }
      schedule();
    },
    lookAt(az, el) {
      frame(az, el);
    },
    setFov(d) {
      fov = d;
      clampEl();
      schedule();
    },
    resize,
    dispose() {
      ro.disconnect();
      cancelAnimationFrame(raf);
      canvas.remove();
    },
  };
}
