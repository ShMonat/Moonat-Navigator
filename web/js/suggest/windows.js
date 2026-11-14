// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Window search for the suggested dates (pure functions, no physics). The inputs are evenly spaced samples of a
// quantity in 0..1 (the Sun's visible flux share, the Earth's visible disk share, or the smaller of the two).
// A window of W samples starting at index s covers samples s … s+W−1 (left Riemann sum of the time average).

/** Weight of the front-loaded mean in the window objective. Small, so it only decides near-ties (see windowScores). */
export const FRONT_WEIGHT = 1e-3;

/**
 * Scores of every window of W samples over v (0..1 values). O(N) with prefix sums.
 * Returns {mean, objective}, Float64Arrays of length N − W + 1 (empty when W > N):
 *   mean[s]  = (1/W) Σ_k v[s+k]                          (the time average: the window's score);
 *   front[s] = (1/W) Σ_k v[s+k] · (1 − k/W)              (the same with early samples weighted more);
 *   objective[s] = mean[s] + lambda · front[s].
 * The front term breaks ties between windows with the same mean in favour of light (or contact) early in the
 * window. Near the lunar equator a 14.77-day window holds the whole lunar day for a range of starts; the tie-break
 * moves the start to sunrise. With lambda = 1e-3 it can cost at most 0.001 of the mean.
 */
export function windowScores(v, W, lambda = FRONT_WEIGHT) {
  const N = v.length;
  const M = N - W + 1;
  if (!(W >= 1) || M < 1) return { mean: new Float64Array(0), objective: new Float64Array(0) };
  const P = new Float64Array(N + 1), Q = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    P[i + 1] = P[i] + v[i];
    Q[i + 1] = Q[i] + i * v[i];
  }
  const mean = new Float64Array(M), objective = new Float64Array(M);
  for (let s = 0; s < M; s++) {
    const A = P[s + W] - P[s];
    const B = Q[s + W] - Q[s] - s * A; // Σ_k k · v[s+k]
    mean[s] = A / W;
    objective[s] = mean[s] + (lambda * (A - B / W)) / W;
  }
  return { mean, objective };
}

/** Objectives closer than this count as equal in pickWindows (prefix-sum rounding is ~1e-15). */
export const TIE_EPS = 1e-9;

/**
 * Best non-overlapping windows (greedy): take the start with the highest objective (the earliest of those within
 * TIE_EPS of the highest, so float noise on a plateau of fully lit windows cannot move the pick), block every start
 * whose window would overlap it, repeat. Stops after maxPicks or when no start with a positive objective is left.
 * Returns [{s, mean}] in pick order (best first).
 */
export function pickWindows({ mean, objective }, W, maxPicks = 60) {
  const M = objective.length;
  const blocked = new Uint8Array(M);
  const picks = [];
  while (picks.length < maxPicks) {
    let best = -1, bv = 0;
    for (let s = 0; s < M; s++) if (!blocked[s] && objective[s] > bv) { bv = objective[s]; best = s; }
    if (best < 0) break;
    for (let s = 0; s < best; s++) if (!blocked[s] && objective[s] >= bv - TIE_EPS) { best = s; break; }
    picks.push({ s: best, mean: mean[best] });
    const lo = Math.max(0, best - W + 1), hi = Math.min(M - 1, best + W - 1);
    for (let s = lo; s <= hi; s++) blocked[s] = 1;
  }
  return picks;
}

/**
 * Ranking of picks ({s, mean, …}): higher mean first, but picks within `tol` of a better one count as equal and are
 * listed soonest first (smaller s). Example: 24 equatorial lunar days that differ by 1e-4 come out in date order.
 */
export function rankPicks(picks, tol = 0.005) {
  const sorted = [...picks].sort((a, b) => b.mean - a.mean || a.s - b.s);
  const out = [];
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].mean >= sorted[i].mean - tol) j++;
    out.push(...sorted.slice(i, j).sort((a, b) => a.s - b.s));
    i = j;
  }
  return out;
}

/** Longest run of consecutive samples with v > 0 in [a, b): {start, len} (sample indices; len 0 if none). */
export function longestRun(v, a, b) {
  let best = 0, bestStart = a, cur = 0, curStart = a;
  for (let i = a; i < b; i++) {
    if (v[i] > 0) {
      if (cur === 0) curStart = i;
      cur++;
      if (cur > best) { best = cur; bestStart = curStart; }
    } else {
      cur = 0;
    }
  }
  return { start: bestStart, len: best };
}

/** Number of samples with v > 0 in [a, b). */
export function countPositive(v, a, b) {
  let n = 0;
  for (let i = a; i < b; i++) if (v[i] > 0) n++;
  return n;
}

/** Mean of v over [a, b) (0 for an empty range). */
export function meanOf(v, a, b) {
  let s = 0;
  for (let i = a; i < b; i++) s += v[i];
  return b > a ? s / (b - a) : 0;
}

/**
 * Skyline crossings of a disk from its sampled visible fraction v (0..1).
 * A rise goes from fully hidden (v ≤ 0) to fully visible (v ≥ full) through partial values, a set the reverse;
 * a graze (hidden → partial → hidden, or visible → partial → visible) is not a crossing.
 * Returns [{dir: "rise" | "set", i0, i1, iMid}]: i0 = the last sample in the old state, i1 = the first sample in
 * the new state, iMid = the sample just after the last crossing of v = 0.5 between them (half the disk visible).
 */
export function skylineCrossings(v, full = 0.999) {
  const out = [];
  let state = null, last = -1;
  for (let i = 0; i < v.length; i++) {
    const s = v[i] <= 0 ? 'down' : v[i] >= full ? 'up' : null;
    if (s === null) continue;
    if (state !== null && s !== state) {
      const dir = s === 'up' ? 'rise' : 'set';
      let mid = i;
      for (let k = i; k > last; k--) {
        const a = v[k - 1], b = v[k];
        if (dir === 'rise' ? a < 0.5 && b >= 0.5 : a >= 0.5 && b < 0.5) { mid = k; break; }
      }
      out.push({ dir, i0: last, i1: i, iMid: mid });
    }
    state = s;
    last = i;
  }
  return out;
}
