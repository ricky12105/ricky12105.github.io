/* scoring.js — weighted scoring, filtering, ranking */
import { AppState, METRIC_KEYS, INVERTED_METRICS } from './state.js';

let _destinations = [];
let _edges = [];

export function initScoring(destinations, edges) {
  _destinations = destinations;
  _edges = edges;
}

/* ── Normalize weights to probability simplex ─────────────────────── */
function normalizeWeights(weights) {
  const sum = METRIC_KEYS.reduce((s, k) => s + (weights[k] || 0), 0);
  if (sum === 0) return Object.fromEntries(METRIC_KEYS.map(k => [k, 1 / METRIC_KEYS.length]));
  return Object.fromEntries(METRIC_KEYS.map(k => [k, (weights[k] || 0) / sum]));
}

/* ── Score a single destination ───────────────────────────────────── */
export function scoreDestination(dest, weights) {
  const norm = normalizeWeights(weights);
  let total = 0;
  for (const key of METRIC_KEYS) {
    let val = dest.metrics[key] ?? 0;
    if (INVERTED_METRICS.has(key)) val = 5 - val; // invert crowd_pressure
    total += norm[key] * val;
  }
  return total;
}

/* ── Contribution breakdown for "why it ranks here" ──────────────── */
export function getContributions(dest, weights) {
  const norm = normalizeWeights(weights);
  return METRIC_KEYS.map(key => {
    let val = dest.metrics[key] ?? 0;
    if (INVERTED_METRICS.has(key)) val = 5 - val;
    return { key, contribution: norm[key] * val, rawVal: dest.metrics[key] ?? 0, weight: weights[key] };
  }).sort((a, b) => b.contribution - a.contribution);
}

/* ── Build per-destination trait sets for filtering ──────────────── */
function getDestTraits(destId, minWeight = 0.4) {
  return new Set(
    _edges
      .filter(e => e.destination === destId && e.weight >= minWeight)
      .map(e => e.trait)
  );
}

/* ── Filter + Score + Rank ────────────────────────────────────────── */
export function getRankedDestinations() {
  const { weights, filters } = AppState;

  const ranked = _destinations.map(dest => {
    const score = scoreDestination(dest, weights);
    const traitSet = getDestTraits(dest.id);

    // Hard filters
    let filtered = false;
    let offPeak = false;

    if (dest.cost_tier < filters.costMin || dest.cost_tier > filters.costMax) filtered = true;
    if (filters.regions.length && !filters.regions.includes(dest.region.continent)) filtered = true;
    if (filters.maxFlightAccess < dest.access.flight_access_score) filtered = true;
    if (filters.mustHaveTraits.length) {
      const hasAll = filters.mustHaveTraits.every(t => traitSet.has(t));
      if (!hasAll) filtered = true;
    }
    if (filters.excludeTraits.length) {
      const hasAny = filters.excludeTraits.some(t => traitSet.has(t));
      if (hasAny) filtered = true;
    }

    // Season penalty (0.7x, not hard filter)
    let effectiveScore = score;
    if (filters.season) {
      const inBest = dest.best_seasons.some(s => s.toLowerCase().includes(filters.season));
      const inShoulder = dest.shoulder_seasons.some(s => s.toLowerCase().includes(filters.season));
      if (!inBest && !inShoulder) {
        effectiveScore *= 0.7;
        offPeak = true;
      }
    }

    return { dest, score: effectiveScore, rawScore: score, filtered, offPeak };
  });

  return ranked.sort((a, b) => {
    if (a.filtered && !b.filtered) return 1;
    if (!a.filtered && b.filtered) return -1;
    return b.score - a.score;
  });
}

/* ── Dataset medians for metric bars ─────────────────────────────── */
let _medianCache = null;
export function getMetricMedians() {
  if (_medianCache) return _medianCache;
  _medianCache = {};
  for (const key of METRIC_KEYS) {
    const vals = _destinations.map(d => d.metrics[key] ?? 0).sort((a,b)=>a-b);
    const mid = Math.floor(vals.length / 2);
    _medianCache[key] = vals.length % 2 ? vals[mid] : (vals[mid-1]+vals[mid])/2;
  }
  return _medianCache;
}

/* ── Cosine similarity between two destinations ───────────────────── */
function cosine(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (const k of METRIC_KEYS) {
    const av = a.metrics[k] || 0;
    const bv = b.metrics[k] || 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

/* Jaccard similarity on trait sets */
function jaccard(aId, bId) {
  const setA = getDestTraits(aId, 0.4);
  const setB = getDestTraits(bId, 0.4);
  if (!setA.size && !setB.size) return 0;
  let inter = 0;
  setA.forEach(t => { if (setB.has(t)) inter++; });
  const union = setA.size + setB.size - inter;
  return union ? inter / union : 0;
}

export function computePairwiseSimilarity() {
  const dests = _destinations;
  const n = dests.length;
  const sim = Array.from({length: n}, () => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j) { sim[i][j] = 1; continue; }
      const s = 0.5 * cosine(dests[i], dests[j]) + 0.5 * jaccard(dests[i].id, dests[j].id);
      sim[i][j] = sim[j][i] = s;
    }
  }
  return sim;
}

/* Simple classical MDS: derive 2D positions from similarity matrix */
export function mdsPositions(simMatrix) {
  const n = simMatrix.length;
  // Convert similarity to distance
  const D2 = Array.from({length:n}, (_,i) => Array.from({length:n}, (_,j) => {
    return Math.max(0, 1 - simMatrix[i][j]);
  }));
  // Double centering
  const rowMean = D2.map(row => row.reduce((s,v)=>s+v,0)/n);
  const colMean = Array.from({length:n}, (_,j) => D2.reduce((s,row)=>s+row[j],0)/n);
  const totalMean = rowMean.reduce((s,v)=>s+v,0)/n;
  const B = Array.from({length:n}, (_,i) =>
    Array.from({length:n}, (_,j) =>
      -0.5 * (D2[i][j] - rowMean[i] - colMean[j] + totalMean)
    )
  );
  // Power iteration for top 2 eigenvectors (simplified)
  function powerIter(mat, iters=80) {
    let v = Array.from({length:n}, () => Math.random()-0.5);
    for (let it=0; it<iters; it++) {
      const nv = mat.map(row => row.reduce((s,val,j)=>s+val*v[j],0));
      const mag = Math.sqrt(nv.reduce((s,x)=>s+x*x,0));
      v = nv.map(x=>x/mag);
    }
    const eig = v.reduce((s,vi,i)=>s+vi*mat[i].reduce((ss,bij,j)=>ss+bij*v[j],0),0);
    return { vec: v, val: eig };
  }
  const e1 = powerIter(B);
  // Deflate
  const B2 = B.map((row,i)=>row.map((val,j)=>val-e1.val*e1.vec[i]*e1.vec[j]));
  const e2 = powerIter(B2);
  const s1 = Math.sqrt(Math.abs(e1.val));
  const s2 = Math.sqrt(Math.abs(e2.val));
  return _destinations.map((_,i) => ({
    x: e1.vec[i] * s1,
    y: e2.vec[i] * s2,
  }));
}

/* ── Top sparkline metrics for leaderboard ──────────────────────── */
export function getTopContributors(dest, weights, count = 3) {
  return getContributions(dest, weights).slice(0, count);
}

/* ── Why-it-ranks explanation ─────────────────────────────────────── */
export function getWhyRanks(dest, weights) {
  const contribs = getContributions(dest, weights);
  const top3 = contribs.slice(0, 3);
  const bottom2 = [...contribs].reverse().slice(0, 2);

  // Find a suggestion: metric where adjusting weight would have big impact
  const ranked = getRankedDestinations().filter(r => !r.filtered);
  const myRank = ranked.findIndex(r => r.dest.id === dest.id);
  const myScore = ranked[myRank]?.score || 0;

  // Which metric, if bumped by 2 in user weight, would gain the most?
  let bestSuggestion = null;
  let bestGain = 0;
  for (const k of METRIC_KEYS) {
    const val = INVERTED_METRICS.has(k) ? 5 - dest.metrics[k] : dest.metrics[k];
    const testWeights = { ...weights, [k]: Math.min(10, (weights[k] || 5) + 2) };
    const newScore = scoreDestination(dest, testWeights);
    if (newScore - myScore > bestGain) {
      bestGain = newScore - myScore;
      bestSuggestion = k;
    }
  }

  return { top3, bottom2, suggestion: bestSuggestion, rank: myRank + 1 };
}
