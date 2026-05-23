/* compare.js — radar chart, trait overlap, metric diff, verdict */
import { METRIC_KEYS, METRIC_LABELS, INVERTED_METRICS } from './state.js';
import { scoreDestination } from './scoring.js';

let _edges = [], _traits = [];

export function initCompare(edges, traits) {
  _edges = edges;
  _traits = traits;
}

/* Palette for up to 4 destinations */
const DEST_COLORS = ['#c9a96e', '#7da3b5', '#8aa17b', '#c97d6f'];

/* ── Fullscreen Compare Overlay ─────────────────────────────────── */
export function openFullCompare(destinations, weights) {
  const overlay = document.getElementById('compare-overlay');
  overlay.innerHTML = _buildOverlayHTML(destinations, weights);
  overlay.classList.add('visible');

  overlay.querySelector('#close-compare').addEventListener('click', () => {
    overlay.classList.remove('visible');
    overlay.innerHTML = '';
  });

  // Render radar after DOM inserted
  _renderRadar(destinations);
  _animateRadarIn();
}

function _buildOverlayHTML(dests, weights) {
  const destCards = dests.map((d, i) => `
    <div class="compare-dest-card" style="border-top: 3px solid ${DEST_COLORS[i]}">
      <img src="${d.image.url.replace('w=800&h=600','w=400&h=240')}" alt="${d.name}" loading="lazy">
      <div class="compare-dest-card-body">
        <div class="compare-dest-card-name">${d.name}</div>
        <div class="compare-dest-card-region">${d.region.subdivision}, ${d.region.country}</div>
      </div>
    </div>
  `).join('');

  const traitOverlap = _buildTraitOverlapHTML(dests);
  const metricDiff = _buildMetricDiffHTML(dests, weights);
  const verdict = _buildVerdictHTML(dests, weights);

  return `
    <div id="compare-overlay-inner">
      <div id="compare-overlay-header">
        <h2 style="font-family:'Fraunces',serif;font-size:1.75rem;color:#f4f1e8;">
          Comparing ${dests.length} Destinations
        </h2>
        <button id="close-compare" class="close-overlay-btn" aria-label="Close compare">✕</button>
      </div>

      <div class="compare-dest-row">${destCards}</div>

      <div class="section">
        <div class="section-label">Metric Radar</div>
        <div id="radar-container">
          <svg id="radar-svg" viewBox="-10 -10 420 420" width="400" height="400"></svg>
        </div>
        <div style="display:flex;gap:16px;justify-content:center;margin-top:12px;flex-wrap:wrap;">
          ${dests.map((d,i)=>`
            <span style="display:flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--text-secondary);">
              <span style="width:12px;height:12px;border-radius:2px;background:${DEST_COLORS[i]};display:inline-block;"></span>
              ${d.name}
            </span>
          `).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-label">Trait Overlap</div>
        ${traitOverlap}
      </div>

      <div class="section">
        <div class="section-label">Metric Comparison</div>
        ${metricDiff}
      </div>

      <div class="section">
        <div class="section-label">Verdict</div>
        <div class="verdict-text">${verdict}</div>
      </div>
    </div>
  `;
}

/* ── Radar Chart ─────────────────────────────────────────────────── */
function _renderRadar(dests) {
  const svgEl = document.getElementById('radar-svg');
  if (!svgEl) return;

  const svg = d3.select(svgEl);
  const cx = 200, cy = 200, r = 160;
  const keys = METRIC_KEYS;
  const N = keys.length;
  const angle = (i) => (i / N) * 2 * Math.PI - Math.PI / 2;

  // Grid circles
  [0.25, 0.5, 0.75, 1].forEach(frac => {
    svg.append('circle')
      .attr('cx', cx).attr('cy', cy)
      .attr('r', r * frac)
      .attr('fill', 'none')
      .attr('stroke', '#2a2734')
      .attr('stroke-width', 0.5);
  });

  // Axes
  keys.forEach((k, i) => {
    const a = angle(i);
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    svg.append('line')
      .attr('x1', cx).attr('y1', cy)
      .attr('x2', x).attr('y2', y)
      .attr('stroke', '#2a2734').attr('stroke-width', 0.5);

    const lx = cx + (r + 18) * Math.cos(a);
    const ly = cy + (r + 18) * Math.sin(a);
    svg.append('text')
      .attr('x', lx).attr('y', ly)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('class', 'radar-axis-label')
      .text(METRIC_LABELS[k] || k);
  });

  // Polygons for each destination
  dests.forEach((dest, di) => {
    const points = keys.map((k, i) => {
      let v = (dest.metrics[k] || 0) / 5;
      if (INVERTED_METRICS.has(k)) v = 1 - v;
      const a = angle(i);
      return [cx + r * v * Math.cos(a), cy + r * v * Math.sin(a)];
    });
    const pointStr = points.map(p => p.join(',')).join(' ');
    svg.append('polygon')
      .attr('points', pointStr)
      .attr('fill', DEST_COLORS[di])
      .attr('stroke', DEST_COLORS[di])
      .attr('class', 'radar-polygon')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.8)
      .attr('fill-opacity', 0)
      .transition().duration(600)
      .attr('fill-opacity', 0.15);

    // Dots on vertices
    points.forEach(([px, py]) => {
      svg.append('circle')
        .attr('cx', px).attr('cy', py).attr('r', 3)
        .attr('fill', DEST_COLORS[di])
        .attr('class', 'radar-point');
    });
  });
}

function _animateRadarIn() {}

/* ── Trait Overlap ───────────────────────────────────────────────── */
function _getTraitSet(destId, minW = 0.4) {
  return new Set(_edges.filter(e => e.destination === destId && e.weight >= minW).map(e => e.trait));
}

function _traitLabel(traitId) {
  const t = _traits.find(x => x.id === traitId);
  return t ? `${t.icon} ${t.label}` : traitId;
}

function _buildTraitOverlapHTML(dests) {
  if (dests.length < 2) return '<p style="color:var(--text-muted)">Select 2+ destinations to see overlap.</p>';

  const sets = dests.map(d => _getTraitSet(d.id));

  // Shared by all
  const allShared = [...sets[0]].filter(t => sets.every(s => s.has(t)));

  // Unique to each
  const unique = sets.map((s, i) =>
    [...s].filter(t => sets.filter((_,j)=>j!==i).every(other => !other.has(t)))
  );

  const sharedChips = allShared.map(t => `<span class="trait-chip" style="border-color:var(--accent-dim)">${_traitLabel(t)}</span>`).join('');
  const uniqueCols = dests.map((d, i) => `
    <div class="overlap-col">
      <div class="overlap-col-title" style="color:${DEST_COLORS[i]}">${d.name} only</div>
      ${unique[i].map(t => `<span class="trait-chip">${_traitLabel(t)}</span>`).join('') || '<span style="color:var(--text-muted);font-size:0.75rem">—</span>'}
    </div>
  `).join('');

  return `
    <div style="margin-bottom:12px">
      <div class="overlap-col-title">Shared by all</div>
      <div>${sharedChips || '<span style="color:var(--text-muted);font-size:0.75rem">No universal traits</span>'}</div>
    </div>
    <div class="overlap-grid">${uniqueCols}</div>
  `;
}

/* ── Metric Diff Table ───────────────────────────────────────────── */
function _buildMetricDiffHTML(dests, weights) {
  const rows = METRIC_KEYS.map(k => {
    const vals = dests.map(d => d.metrics[k] || 0);
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const range = max - min;

    const cells = vals.map((v, i) => {
      const isBest = v === max;
      const isWorst = v === min && range > 0;
      const cls = isBest ? 'diff-cell-best diff-cell-mono' : isWorst ? 'diff-cell-worst diff-cell-mono' : 'diff-cell-mono';
      return `<td class="${cls}">${v.toFixed(1)}</td>`;
    }).join('');

    const label = METRIC_LABELS[k] + (INVERTED_METRICS.has(k) ? ' ↺' : '');
    return `<tr>
      <td style="color:var(--text-secondary)">${label}</td>
      ${cells}
      <td class="diff-cell-mono" style="color:var(--text-muted)">${range.toFixed(1)}</td>
    </tr>`;
  }).join('');

  const headers = dests.map((d,i) =>
    `<th style="color:${DEST_COLORS[i]}">${d.name}</th>`
  ).join('');

  return `
    <table class="diff-table">
      <thead>
        <tr>
          <th>Metric</th>${headers}<th>Range</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/* ── Deterministic Verdict Synthesis ────────────────────────────── */
function _buildVerdictHTML(dests, weights) {
  if (dests.length < 2) return 'Select at least 2 destinations to generate a verdict.';

  const scores = dests.map(d => ({ dest: d, score: scoreDestination(d, weights) }))
    .sort((a,b) => b.score - a.score);

  const winner = scores[0].dest;
  const loser = scores[scores.length - 1].dest;

  // Find metric leaders
  const leaders = {};
  METRIC_KEYS.forEach(k => {
    const vals = dests.map(d => ({ d, v: d.metrics[k] || 0 }));
    vals.sort((a,b) => b.v - a.v);
    if (vals[0].v > vals[1].v + 0.5) leaders[k] = vals[0].d.name;
  });

  const leaderPhrases = Object.entries(leaders).slice(0, 3).map(([k, name]) =>
    `<em>${name}</em> leads on ${METRIC_LABELS[k].toLowerCase()}`
  );

  const valuePick = dests.reduce((best, d) =>
    d.metrics.value_for_money > best.metrics.value_for_money ? d : best
  );

  const adventurePick = dests.reduce((best, d) =>
    d.metrics.adventure > best.metrics.adventure ? d : best
  );

  let text = `Across ${dests.length === 2 ? 'these two' : `these ${dests.length}`}, `;

  if (leaderPhrases.length) {
    text += leaderPhrases.join('; ') + '. ';
  }

  if (winner.id !== loser.id) {
    text += `Under current weights, <em>${winner.name}</em> scores highest overall`;
    if (scores[0].score - scores[scores.length-1].score > 0.3) {
      text += ` by a meaningful margin`;
    }
    text += '. ';
  }

  if (valuePick.id !== winner.id) {
    text += `<em>${valuePick.name}</em> is the value pick — highest value-for-money among the group. `;
  }

  if (adventurePick.metrics.adventure > 4.0) {
    text += `For adventure-seekers, <em>${adventurePick.name}</em> stands apart.`;
  }

  return text;
}

/* ── Mini Compare (side panel) ──────────────────────────────────── */
export function renderMiniCompare(containerEl, dests, weights) {
  if (!dests.length) {
    containerEl.innerHTML = `
      <div class="compare-placeholder">
        Shift-click or lasso destinations on the map to compare up to 4.
      </div>`;
    return;
  }

  const thumbs = dests.map((d, i) => `
    <div class="compare-thumb-item">
      <img src="${d.image.url.replace('w=800&h=600','w=80&h=80')}" alt="${d.name}">
      <span class="compare-thumb-name">${d.name}</span>
      <button class="compare-thumb-remove" data-id="${d.id}" aria-label="Remove ${d.name}">✕</button>
    </div>
  `).join('');

  const scoreRows = dests.map((d, i) => {
    const s = scoreDestination(d, weights);
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="width:10px;height:10px;border-radius:2px;background:${DEST_COLORS[i]};flex-shrink:0;display:inline-block;"></span>
      <span style="font-size:0.8rem;color:var(--text-secondary);flex:1;">${d.name}</span>
      <span class="mono" style="color:var(--accent-primary)">${s.toFixed(2)}</span>
    </div>`;
  }).join('');

  containerEl.innerHTML = `
    <div class="section">
      <div class="section-label">Selected</div>
      <div class="compare-thumbs">${thumbs}</div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="section-label" style="margin-bottom:8px">Scores (current weights)</div>
      ${scoreRows}
    </div>
    <div style="display:flex;gap:8px">
      <button id="btn-open-full-compare" class="btn-primary" style="flex:1">
        Open Full Comparison
      </button>
    </div>
  `;
}
