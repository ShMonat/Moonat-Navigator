// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// The official Anthropic TypeScript/JavaScript SDK, loaded only when AI mode runs (an ES module from jsDelivr, exact
// version), and the user's API key: kept in sessionStorage by default, in localStorage only when the user ticks
// "Remember on this device", and sent only to api.anthropic.com by the SDK. The key is never logged and never put in
// a link.

export const SDK_VERSION = "1.3.0";
export const SDK_URL = `https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@${SDK_VERSION}/+esm`;
/** The storage key under which the API key is kept (sessionStorage, or localStorage when remembered). */
export const KEY_NAME = "moonat.ai.anthropicKey";

let sdkPromise = null;

/** The SDK module (cached). `importFn` lets tests replace the network import. */
export function loadSdk(importFn = (u) => import(u)) {
  if (!sdkPromise) {
    sdkPromise = importFn(SDK_URL).catch((err) => {
      sdkPromise = null;
      throw err;
    });
  }
  return sdkPromise;
}

/**
 * A client for the user's key: the SDK's Anthropic class with dangerouslyAllowBrowser (the key is the user's own and
 * goes straight from this browser to api.anthropic.com), 2 automatic retries on 429/5xx and a 5-minute timeout.
 * Resolves to { client, sdk }.
 */
export async function makeClient(apiKey, importFn) {
  const sdk = await loadSdk(importFn);
  const Anthropic = sdk.default || sdk.Anthropic;
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 300e3 });
  return { client, sdk };
}

function safe(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Default storages of the page (null where the browser blocks them). */
export function pageStores() {
  return {
    session: safe(() => globalThis.sessionStorage),
    local: safe(() => globalThis.localStorage),
  };
}

/** The saved key: { key, remembered } (remembered: it is in localStorage); key "" when none. */
export function readKey(stores = pageStores()) {
  const local = safe(() => stores.local?.getItem(KEY_NAME)) || "";
  if (local) return { key: local, remembered: true };
  return { key: safe(() => stores.session?.getItem(KEY_NAME)) || "", remembered: false };
}

/**
 * Keep the key for this tab (sessionStorage) or, with `remember`, on this device (localStorage); the other store is
 * cleared, so the key lives in one place only. An empty key forgets it.
 */
export function saveKey(key, remember, stores = pageStores()) {
  const k = String(key || "").trim();
  if (!k) return forgetKey(stores);
  safe(() => (remember ? stores.local : stores.session)?.setItem(KEY_NAME, k));
  safe(() => (remember ? stores.session : stores.local)?.removeItem(KEY_NAME));
}

/** Remove the key from both stores. */
export function forgetKey(stores = pageStores()) {
  safe(() => stores.session?.removeItem(KEY_NAME));
  safe(() => stores.local?.removeItem(KEY_NAME));
}

/** A key that looks like an Anthropic API key (a shape check only; the API decides). */
export function looksLikeKey(key) {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(String(key || "").trim());
}
