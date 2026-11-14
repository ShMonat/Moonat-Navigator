// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The one adapter to the sky renderer (contract C8 `sky-view`, web/js/sky/index.js, three.js).
// If WebGL is not available (old devices, blocked GPU), a light 2D canvas view with the same API is used instead.

let modPromise = null;

function loadReal() {
  if (!modPromise) {
    modPromise = import("../sky/index.js")
      .then((m) => (typeof m.createSkyView === "function" ? m : null))
      .catch((err) => {
        console.warn("[moonat] 3D sky view failed to load, using the 2D view:", err && err.message);
        return null;
      });
  }
  return modPromise;
}

let fallbackPromise = null;
function loadFallback() {
  if (!fallbackPromise) fallbackPromise = import("./sky_fallback.js");
  return fallbackPromise;
}

let webglOk = null;
function hasWebGL() {
  if (webglOk === null) {
    try {
      const c = document.createElement("canvas");
      webglOk = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webglOk = false;
    }
  }
  return webglOk;
}

/** Create a sky view (C8 API: update, lookAt, setFov, resize, dispose). Resolves to { view, mode: "3d" | "2d" }. */
export async function makeSkyView(container, opts) {
  const real = hasWebGL() ? await loadReal() : null;
  if (real) {
    try {
      const view = await real.createSkyView(container, opts);
      return { view, mode: "3d" };
    } catch (err) {
      console.warn("[moonat] 3D sky view failed, using the 2D view:", err);
      container.replaceChildren();
    }
  }
  const fb = await loadFallback();
  return { view: await fb.createSkyView(container, opts), mode: "2d" };
}

const skyPatches = new WeakMap();
/**
 * The sky view's in-memory patch ({ meta, data }) for a terrainAt patch (C9: C4 fields + z_up_m), or null.
 * The same input object always gives the same output object, so the Sky tab can tell when the terrain changed.
 */
export function skyPatch(p) {
  if (!p || !p.z_up_m) return null;
  if (!skyPatches.has(p)) {
    const { z_up_m, ...meta } = p;
    skyPatches.set(p, { meta, data: z_up_m });
  }
  return skyPatches.get(p);
}

const patchCache = new Map();
/** C4 terrain patch base URL for a catalog site, or null when there is no patch file. */
export function terrainPatchUrl(siteId) {
  if (!siteId) return Promise.resolve(null);
  if (!patchCache.has(siteId)) {
    const base = `data/terrain/${encodeURIComponent(siteId)}`;
    patchCache.set(siteId, fetch(`${base}.json`, { method: "HEAD" }).then((r) => (r.ok ? base : null)).catch(() => null));
  }
  return patchCache.get(siteId);
}
