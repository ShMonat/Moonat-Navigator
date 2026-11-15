// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// AI mode's agent loop: a manual tool-use loop over the Claude Messages API (official SDK @anthropic-ai/sdk, loaded by
// web/js/ai/sdk.js). The model reads the mission, states requirements, calls Moonat's tools (web/js/ai/tools.js) and
// ends with final_recommendation. It never computes physics itself.
// The client is injected, so the Node tests drive this loop with a scripted fake client (no key, no network).

import { TOOL_DEFS, MAX_EVALUATIONS, MAX_TOOL_CALLS } from "./tools.js";

export const MODEL = "claude-opus-5-5";
export const EFFORT = "medium";
export const MAX_TOKENS = 16000;
/** Server-side refusal fallback (routes a declined request to Anthropic's recommended model, inside the same call). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Model turns per run before the loop gives up ("too many steps"). */
export const MAX_TURNS = 16;
/** Claude Opus 5.5 list prices, USD per million tokens (cache writes 1.25x input, cache reads $0.20). */
export const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

export const SYSTEM_PROMPT = `You are the mission-siting assistant inside Moonat, a NASA Space Apps 2026 web app. Moonat computes where the Sun and the Earth are in the sky from any point on the Moon (JPL DE421 ephemeris, validated against JPL Horizons) and whether the local terrain hides them (NASA LRO LOLA heights). The user describes a lunar mission; you choose where (and when) it should go.

How to work:
1. Call set_requirements first, once. Turn the mission into explicit, checkable requirements: region, start and end dates, minimum sunlight, minimum Earth contact (or that the Earth must stay hidden), the longest tolerable night and Earth blackout, and mobility. Where the user is vague, choose a sensible value and list it as an assumption. Moonat's ephemeris covers 1966-1976 and 2013-2040 only: clip later dates to 2040 and say so.
2. Call find_candidate_sites to get real places: catalog sites and NASA's most-sunlit polar spots. You may also evaluate a well-known place from your own knowledge by its coordinates; say that its coordinates are approximate.
3. Call evaluate_site for the most promising places over the mission window (at most ${MAX_EVALUATIONS}; prefer places at least 2 km apart and of different kinds, so the comparison is informative). For flexible or short missions, suggest_dates finds the best window at a place.
4. Call final_recommendation last, with 1 to 5 sites ranked best first, each with its window and the evaluation_id its numbers come from. Explain the main trade-off.

Rules:
- Never compute, estimate or recall illumination, Earth visibility, dates or any other physics yourself. Every number you state must come from a tool result in this conversation. If you do not have a number, say so.
- Numbers are for an eye 2 m above the ground; masts are not modelled. If the mission has a mast or antenna, say the 2 m numbers are conservative near the poles.
- At most ${MAX_TOOL_CALLS} tool calls in total. Do not repeat an evaluation you already have.
- Write plain, simple English for a general audience. No emoji. Keep each "why" to one to three sentences.`;

/** An error of the run itself (not of the HTTP call): kind "refusal" | "max_tokens" | "too_many_steps" | "no_answer". */
export class AgentError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "AgentError";
    this.kind = kind;
  }
}

/** The request parameters of one turn (everything but `messages` is the same on every turn: a stable cache prefix). */
export function requestParams(messages) {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { effort: EFFORT },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    cache_control: { type: "ephemeral" },
    system: SYSTEM_PROMPT,
    tools: TOOL_DEFS,
    messages,
  };
}

/**
 * The content of an assistant turn as it must be sent back: after a mid-output fallback, the thinking, tool-use and
 * unpaired server-tool blocks before the last `fallback` block are left out (the fallback block itself stays where it
 * was); everything else is echoed unchanged.
 */
export function echoContent(content) {
  const last = content.map((b) => b.type).lastIndexOf("fallback");
  if (last < 0) return content;
  const drop = new Set(["thinking", "redacted_thinking", "tool_use", "server_tool_use"]);
  return content.filter((b, i) => i >= last || !drop.has(b.type));
}

/** Token use of a response, summed over its attempts (usage.iterations when a fallback ran). */
export function usageOf(msg) {
  const u = msg?.usage || {};
  const parts = Array.isArray(u.iterations) && u.iterations.length ? u.iterations : [u];
  const sum = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  for (const p of parts) {
    sum.input += p.input_tokens || 0;
    sum.output += p.output_tokens || 0;
    sum.cacheWrite += p.cache_creation_input_tokens || 0;
    sum.cacheRead += p.cache_read_input_tokens || 0;
  }
  return sum;
}

/** Cost in USD of summed usage at the Opus 5.5 list prices (an estimate: a fallback model may be priced differently). */
export function costUsd(u) {
  return (u.input * PRICE.input + u.output * PRICE.output + u.cacheWrite * PRICE.cacheWrite + u.cacheRead * PRICE.cacheRead) / 1e6;
}

/**
 * Plain-words explanation of a failed run: { kind, message }. `sdk` is the SDK module (its typed error classes);
 * without it (tests) the HTTP status decides.
 */
export function explainError(err, sdk = null) {
  const is = (cls) => !!(sdk && sdk[cls] && err instanceof sdk[cls]);
  if (err instanceof AgentError) return { kind: err.kind, message: err.message };
  if (err?.name === "AbortError" || is("APIUserAbortError")) return { kind: "stopped", message: "Stopped." };
  const status = err?.status;
  if (is("AuthenticationError") || status === 401) {
    return { kind: "bad_key", message: "Anthropic did not accept this API key (401). Check that you pasted the whole key (it starts with sk-ant-) and that it is active in the Anthropic Console." };
  }
  if (is("PermissionDeniedError") || status === 403) {
    return { kind: "forbidden", message: "This API key is not allowed to use Claude Opus 5.5 (403). Check the key's workspace and limits in the Anthropic Console." };
  }
  if (is("RateLimitError") || status === 429) {
    return { kind: "rate_limit", message: "Too many requests for this key right now (429, rate limit). Wait a minute and try again." };
  }
  if (is("APIConnectionError") || (err && status === undefined && /fetch|network|connection/i.test(err.name || ""))) {
    return { kind: "network", message: "Could not reach api.anthropic.com. Check your internet connection (or a browser extension that blocks it) and try again." };
  }
  if (is("BadRequestError") || status === 400) {
    return { kind: "bad_request", message: `Anthropic refused the request as invalid (400): ${err?.error?.error?.message || err?.message || "no details"}.` };
  }
  if (typeof status === "number" && status >= 500) {
    return { kind: "server", message: `Anthropic's service is busy or failing (${status}). Try again in a minute.` };
  }
  if (typeof status === "number") return { kind: "api", message: `The Claude API returned an error (${status}): ${err?.message || ""}` };
  return { kind: "unknown", message: `Something went wrong: ${err?.message || err}` };
}

/**
 * Run one mission. opts:
 *   client: an Anthropic client (or a fake with beta.messages.create(params, { signal }));
 *   tools: createTools(...) result; mission: the user's text; signal: AbortSignal (optional);
 *   onEvent(e): progress events
 *     { type: "turn", n }                         a request to Claude is about to go out
 *     { type: "requirements", input }             set_requirements
 *     { type: "tool", name, input }               a tool is about to run
 *     { type: "result", name, input, result }     its result (result.error on a tool error)
 *     { type: "usage", usage, cost }              running token use and cost after each turn
 *     { type: "note", text }                      text the model wrote at the end without recommending
 * Resolves to { final, evaluations, usage, cost, turns } (final: the final_recommendation input); rejects with an
 * AgentError (refusal, max_tokens, too_many_steps, no_answer) or the SDK's error.
 */
export async function runMission({ client, tools, mission, signal, onEvent = () => {} }) {
  const messages = [{ role: "user", content: `Mission: ${String(mission).trim()}` }];
  const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let turns = 0;
  while (true) {
    if (signal?.aborted) throw Object.assign(new Error("Stopped."), { name: "AbortError" });
    if (turns >= MAX_TURNS) throw new AgentError("too_many_steps", `The model took more than ${MAX_TURNS} steps without a final answer, so the run was stopped. Try a shorter, more specific mission.`);
    turns++;
    onEvent({ type: "turn", n: turns });
    const msg = await client.beta.messages.create(requestParams(messages), { signal });
    const u = usageOf(msg);
    for (const k of Object.keys(usage)) usage[k] += u[k];
    onEvent({ type: "usage", usage: { ...usage }, cost: costUsd(usage) });

    // Check the stop reason before using the content.
    if (msg.stop_reason === "refusal") {
      const cat = msg.stop_details?.category ? ` (category: ${msg.stop_details.category})` : "";
      throw new AgentError("refusal", `Claude declined this request${cat}. Try describing the mission differently.`);
    }
    if (msg.stop_reason === "max_tokens") {
      throw new AgentError("max_tokens", "Claude's answer was cut off (it reached the output limit). Try a shorter or more specific mission.");
    }
    const content = Array.isArray(msg.content) ? msg.content : [];
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: echoContent(content) });
      continue;
    }
    const calls = content.filter((b) => b.type === "tool_use");
    if (!calls.length) {
      const text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (text) onEvent({ type: "note", text });
      throw new AgentError("no_answer", text ? "Claude answered without a ranked list (see its note above)." : "Claude ended without an answer. Try again or rephrase the mission.");
    }
    messages.push({ role: "assistant", content: echoContent(content) });

    const results = [];
    let final = null;
    for (const call of calls) {
      const input = call.input && typeof call.input === "object" ? call.input : {};
      if (call.name === "final_recommendation") {
        final = input;
        continue;
      }
      if (call.name === "set_requirements") onEvent({ type: "requirements", input });
      else onEvent({ type: "tool", name: call.name, input });
      let result;
      try {
        result = await tools.run(call.name, input);
      } catch (err) {
        result = { error: `The tool failed: ${err?.message || err}` };
      }
      if (call.name !== "set_requirements") onEvent({ type: "result", name: call.name, input, result });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(result),
        ...(result && result.error ? { is_error: true } : {}),
      });
      if (signal?.aborted) throw Object.assign(new Error("Stopped."), { name: "AbortError" });
    }
    if (final) {
      return { final, evaluations: tools.evaluations, usage, cost: costUsd(usage), turns };
    }
    messages.push({ role: "user", content: results });
  }
}
