/* panel.js — tab controller + all 5 tab views */
import { AppState, METRIC_KEYS, METRIC_LABELS, INVERTED_METRICS, PRESETS,
         defaultWeights, loadTrips, saveTrip, applyTrip, pushStateToURL,
         savePreferencesToLS } from './state.js';
import { getRankedDestinations, getMetricMedians, getWhyRanks,
         getTopContributors } from './scoring.js';
import { renderMiniCompare, openFullCompare } from './compare.js';
import { centerOn, refreshHighlight } from './graph.js';

let _destinations = [], _traits = [], _edges = [];
let _onWeightChange, _onFilterChange, _onSelectDestination;

/* FLIP animation for leaderboard */
const _flipPositions = new Map();

export function initPanel({ destinations, traits, edges, onWeightChange, onFilterChange, onSelectDestination }) {
  _destinations = destinations;
  _traits = traits;
  _edges = edges;
  _onWeightChange = onWeightChange;
  _onFilterChange = onFilterChange;
  _onSelectDestination = onSelectDestination;

  _initTabBar();
  _buildRankTab();
  _buildBrowseTab();
  _renderBrowseContent();

  // Share button
  document.getElementById('share-btn')?.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}${location.hash}`;
    navigator.clipboard?.writeText(url).then(() => {
      const btn = document.getElementById('share-btn');
      if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = '⤴', 1500); }
    });
  });
}

/* ── Tab Bar ─────────────────────────────────────────────────────── */
function _initTabBar() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      switchTab(btn.dataset.tab);
    });
  });
}

export function switchTab(tabId) {
  AppState.activeTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `pane-${tabId}`));
  pushStateToURL();

  if (tabId === 'rank') renderRankTab();
  if (tabId === 'compare') renderCompareTab();
  if (tabId === 'browse') _renderBrowseContent();
}

export function updateTabAvailability() {
  const hasSelection = AppState.selected.length > 0;
  const hasMulti = AppState.selected.length > 1;
  const hasTrait = !!AppState.activeTrait;

  const detailsBtn = document.querySelector('[data-tab="details"]');
  const compareBtn = document.querySelector('[data-tab="compare"]');
  const traitBtn = document.querySelector('[data-tab="trait"]');

  if (detailsBtn) detailsBtn.disabled = !hasSelection;
  if (compareBtn) compareBtn.disabled = !hasMulti;
  if (traitBtn) traitBtn.disabled = !hasTrait;

  // Auto-switch to appropriate tab
  if (AppState.activeTrait && AppState.activeTab !== 'trait') switchTab('trait');
  else if (hasMulti && AppState.activeTab === 'details') switchTab('compare');
  else if (hasSelection && AppState.activeTab === 'browse') switchTab('details');
}

/* ── Browse Tab ─────────────────────────────────────────────────── */
function _buildBrowseTab() {
  const pane = document.getElementById('pane-browse');
  pane.innerHTML = `
    <div class="search-wrap">
      <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input type="text" id="search-input" placeholder="Search destinations & traits…" autocomplete="off">
      <div class="autocomplete-list" id="autocomplete-list"></div>
    </div>

    <button class="surprise-btn" id="surprise-btn">
      🎲 Surprise me
    </button>

    <div class="section" style="margin-top:20px">
      <div class="section-label">Saved Trips</div>
      <div id="saved-trips-list"></div>
      <button class="btn-ghost" id="save-trip-btn" style="width:100%;margin-top:8px;font-size:0.8rem">
        + Save current setup as trip
      </button>
    </div>

    <div class="section" style="margin-top:20px">
      <div class="section-label">Top Destinations (current weights)</div>
      <div id="browse-top-list"></div>
    </div>
  `;

  _initSearch();
  _initSurprise();
  _initSaveTrip();
}

function _renderBrowseContent() {
  _renderSavedTrips();
  _renderBrowseTopList();
}

function _initSearch() {
  const input = document.getElementById('search-input');
  const list = document.getElementById('autocomplete-list');
  if (!input || !list) return;

  const allItems = [
    ..._destinations.map(d => ({ label: d.name, sub: `${d.region.subdivision}, ${d.region.country}`, type: 'dest', id: d.id })),
    ..._traits.map(t => ({ label: `${t.icon} ${t.label}`, sub: t.description.slice(0,50)+'…', type: 'trait', id: t.id })),
  ];

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    list.innerHTML = '';
    if (!q) { list.classList.remove('visible'); return; }

    const matches = allItems.filter(item =>
      item.label.toLowerCase().includes(q) || (item.sub && item.sub.toLowerCase().includes(q))
    ).slice(0, 8);

    if (!matches.length) { list.classList.remove('visible'); return; }
    list.classList.add('visible');
    matches.forEach(item => {
      const div = document.createElement('div');
      div.className = 'autocomplete-item';
      div.innerHTML = `<strong style="color:var(--text-primary)">${item.label}</strong><span style="color:var(--text-muted);font-size:0.72rem">${item.sub}</span>`;
      div.addEventListener('click', () => {
        input.value = '';
        list.classList.remove('visible');
        if (item.type === 'dest') {
          AppState.selected = [item.id];
          refreshHighlight();
          _onSelectDestination(item.id);
          centerOn(item.id);
          switchTab('details');
        } else {
          AppState.activeTrait = item.id;
          refreshHighlight();
          switchTab('trait');
        }
        updateTabAvailability();
      });
      list.appendChild(div);
    });
  });

  document.addEventListener('click', e => {
    if (!list.contains(e.target) && e.target !== input) list.classList.remove('visible');
  });
}

function _initSurprise() {
  document.getElementById('surprise-btn')?.addEventListener('click', () => {
    const ranked = getRankedDestinations().filter(r => !r.filtered);
    if (!ranked.length) return;
    // Weighted random: higher score = higher probability
    const total = ranked.reduce((s, r) => s + r.score, 0);
    let rand = Math.random() * total;
    let pick = ranked[0];
    for (const r of ranked) {
      rand -= r.score;
      if (rand <= 0) { pick = r; break; }
    }
    AppState.selected = [pick.dest.id];
    refreshHighlight();
    _onSelectDestination(pick.dest.id);
    centerOn(pick.dest.id);
    switchTab('details');
    updateTabAvailability();
  });
}

function _initSaveTrip() {
  document.getElementById('save-trip-btn')?.addEventListener('click', () => {
    const name = prompt('Name this trip setup:');
    if (name?.trim()) {
      saveTrip(name.trim());
      _renderSavedTrips();
    }
  });
}

function _renderSavedTrips() {
  const container = document.getElementById('saved-trips-list');
  if (!container) return;
  const trips = loadTrips();
  if (!trips.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem">No saved trips yet.</div>';
    return;
  }
  container.innerHTML = trips.map(t => `
    <div class="saved-trip-item" data-trip-id="${t.id}">
      <div>
        <div class="saved-trip-name">${t.name}</div>
        <div class="saved-trip-meta">${new Date(t.savedAt).toLocaleDateString()}</div>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </div>
  `).join('');

  container.querySelectorAll('.saved-trip-item').forEach(el => {
    el.addEventListener('click', () => {
      const trip = trips.find(t => t.id === parseInt(el.dataset.tripId));
      if (trip) {
        applyTrip(trip);
        _updateSliders();
        _onWeightChange();
        _onFilterChange();
        renderRankTab();
      }
    });
  });
}

function _renderBrowseTopList() {
  const container = document.getElementById('browse-top-list');
  if (!container) return;
  const ranked = getRankedDestinations().filter(r => !r.filtered).slice(0, 5);
  container.innerHTML = ranked.map((r, i) => `
    <div class="lb-item" data-id="${r.dest.id}" style="cursor:pointer">
      <span class="lb-rank">${i+1}</span>
      <img class="lb-thumb" src="${r.dest.image.url.replace('w=800&h=600','w=80&h=80')}" alt="${r.dest.name}" loading="lazy">
      <div class="lb-info">
        <div class="lb-name">${r.dest.name}</div>
        <div class="lb-region">${r.dest.region.continent}</div>
      </div>
      <div class="lb-score-col">
        <span class="lb-score-num">${r.score.toFixed(2)}</span>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.lb-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      AppState.selected = [id];
      refreshHighlight();
      _onSelectDestination(id);
      centerOn(id);
      switchTab('details');
      updateTabAvailability();
    });
  });
}

/* ── Details Tab ─────────────────────────────────────────────────── */
export function renderDetailsTab(destId) {
  const dest = _destinations.find(d => d.id === destId);
  if (!dest) return;

  const pane = document.getElementById('pane-details');
  const medians = getMetricMedians();
  const { top3, bottom2, suggestion, rank } = getWhyRanks(dest, AppState.weights);

  const costDots = Array.from({length:5},(_,i)=>
    `<span class="cost-dot ${i < dest.cost_tier ? 'filled' : ''}"></span>`
  ).join('');

  const metricRows = METRIC_KEYS.map(k => {
    const v = dest.metrics[k] || 0;
    const pct = (v / 5) * 100;
    const medPct = (medians[k] / 5) * 100;
    const label = METRIC_LABELS[k] + (INVERTED_METRICS.has(k) ? ' ↺' : '');
    return `
      <div class="metric-row">
        <span class="metric-label">${label}</span>
        <div class="metric-bar-wrap">
          <div class="metric-bar-fill" style="width:${pct}%"></div>
          <div class="metric-median-dot" style="left:${medPct}%" title="Dataset median"></div>
        </div>
        <span class="metric-val mono">${v.toFixed(1)}</span>
      </div>`;
  }).join('');

  const topContribRows = top3.map(c => `
    <div class="why-bar">
      <span class="why-bar-label">${METRIC_LABELS[c.key]}</span>
      <div class="why-bar-track">
        <div class="why-bar-fill positive" style="width:${Math.min(100,(c.contribution/0.5)*100)}%"></div>
      </div>
      <span class="why-bar-val">${c.contribution.toFixed(3)}</span>
    </div>`).join('');

  const bottomRows = bottom2.map(c => `
    <div class="why-bar">
      <span class="why-bar-label">${METRIC_LABELS[c.key]}</span>
      <div class="why-bar-track">
        <div class="why-bar-fill negative" style="width:${Math.min(100,(c.contribution/0.5)*100)}%"></div>
      </div>
      <span class="why-bar-val">${c.contribution.toFixed(3)}</span>
    </div>`).join('');

  const suggestionHTML = suggestion ? `
    <div class="suggestion-text">
      Adjust <em>${METRIC_LABELS[suggestion]}</em> weight upward to see ${dest.name} rise further in the ranking.
    </div>` : '';

  const seasons = [
    ...dest.best_seasons.map(s => `<span class="chip active">${s}</span>`),
    ...dest.shoulder_seasons.map(s => `<span class="chip" title="Shoulder">${s}</span>`),
  ].join('');

  const sigExps = dest.signature_experiences.map((e,i) =>
    `<div style="display:flex;gap:10px;margin-bottom:10px">
      <span style="color:var(--accent-primary);font-family:'JetBrains Mono',monospace;font-size:0.8rem;flex-shrink:0">${i+1}.</span>
      <span style="color:var(--text-secondary);font-size:0.88rem">${e}</span>
    </div>`
  ).join('');

  const caveats = dest.caveats.map(c =>
    `<div style="display:flex;gap:8px;margin-bottom:8px">
      <span style="color:var(--negative);flex-shrink:0">⚠</span>
      <span style="color:var(--text-secondary);font-size:0.85rem">${c}</span>
    </div>`
  ).join('');

  pane.innerHTML = `
    <div class="hero-image-wrap">
      <img src="${dest.image.url.replace('w=800&h=600','w=800&h=400')}" alt="${dest.image.alt}" loading="lazy">
      <span class="hero-credit">${dest.image.credit}</span>
    </div>

    <div class="display-m" style="margin-bottom:8px">${dest.name}</div>

    <div class="info-strip">
      <div class="info-chip">🗺️ ${dest.region.subdivision}, ${dest.region.country}</div>
      <div class="info-chip"><div class="cost-dots">${costDots}</div> Cost</div>
      <div class="info-chip">✈️ ${dest.access.nearest_major_airport}</div>
      ${dest.elevation_m > 100 ? `<div class="info-chip">⛰️ ${dest.elevation_m.toLocaleString()}m</div>` : ''}
    </div>

    <div style="margin-bottom:16px">
      <div class="section-label">Best Seasons</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${seasons}</div>
    </div>

    <div class="score-display">
      <div class="score-number" id="dest-score-num">${_scoreString(dest)}</div>
      <div class="score-label">Weighted Score — Rank #${rank}</div>
    </div>

    <div class="section">
      <p style="color:var(--text-secondary);font-size:var(--type-body-s);line-height:1.7;margin-bottom:16px">${dest.summary}</p>
    </div>

    <div class="section">
      <div class="section-label">Signature Experiences</div>
      ${sigExps}
    </div>

    <div class="section">
      <div class="section-label">Metrics</div>
      ${metricRows}
    </div>

    <div class="why-section">
      <div class="section-label">Why it ranks #${rank}</div>
      <div class="section-label" style="color:var(--positive);margin-bottom:6px">Top contributors</div>
      ${topContribRows}
      <div class="section-label" style="color:var(--negative);margin-top:12px;margin-bottom:6px">Weakest dimensions</div>
      ${bottomRows}
      ${suggestionHTML}
    </div>

    ${caveats ? `
    <div class="section" style="margin-top:20px">
      <div class="section-label">Caveats</div>
      ${caveats}
    </div>` : ''}

    <div style="margin-top:20px;display:flex;gap:8px">
      <button class="btn-ghost" id="btn-add-to-compare" style="flex:1">
        + Add to Compare
      </button>
    </div>
  `;

  document.getElementById('btn-add-to-compare')?.addEventListener('click', () => {
    if (!AppState.selected.includes(destId)) {
      if (AppState.selected.length < 4) AppState.selected.push(destId);
    }
    if (AppState.selected.length > 1) switchTab('compare');
    updateTabAvailability();
  });
}

function _scoreString(dest) {
  const { getRankedDestinations: rr } = (typeof window !== 'undefined') ? window.AtlasScoring || {} : {};
  const ranked = getRankedDestinations();
  const r = ranked.find(x => x.dest.id === dest.id);
  return r ? r.score.toFixed(2) : '—';
}

/* ── Rank Tab ────────────────────────────────────────────────────── */
function _buildRankTab() {
  const pane = document.getElementById('pane-rank');
  const METRIC_INPUTS = METRIC_KEYS.map(k => `
    <div class="slider-row">
      <label class="slider-label" for="slider-${k}">
        ${METRIC_LABELS[k]}
        ${INVERTED_METRICS.has(k) ? '<span class="inverted-note">↺ inv.</span>' : ''}
      </label>
      <div class="slider-wrap">
        <input type="range" id="slider-${k}" min="0" max="10" step="1" value="${AppState.weights[k] || 5}">
      </div>
      <span class="slider-val" id="sliderval-${k}">${AppState.weights[k] || 5}</span>
    </div>`).join('');

  const presetBtns = Object.entries(PRESETS).map(([key, preset]) => `
    <button class="preset-btn" data-preset="${key}">${preset.label}</button>
  `).join('');

  const continents = [...new Set(_destinations.map(d=>d.region.continent))];
  const continentChips = continents.map(c =>
    `<span class="chip active" data-filter="region" data-value="${c}">${c}</span>`
  ).join('');

  const traitChips = _traits.filter(t=>t.tier==='specific').map(t =>
    `<span class="chip" data-filter="must" data-value="${t.id}">${t.icon} ${t.label}</span>`
  ).join('');

  pane.innerHTML = `
    <div class="section">
      <div class="section-label">Quick Profiles</div>
      <div class="preset-grid">${presetBtns}</div>
    </div>

    <div class="section">
      <div class="section-label">Preference Weights</div>
      ${METRIC_INPUTS}
    </div>

    <div class="section">
      <div class="section-label">Filters</div>

      <div class="filter-section">
        <div class="section-label">Cost Tier</div>
        <div class="slider-row">
          <span class="slider-label">Min</span>
          <div class="slider-wrap"><input type="range" id="filter-cost-min" min="1" max="5" step="1" value="1"></div>
          <span class="slider-val" id="filterval-cost-min">1</span>
        </div>
        <div class="slider-row">
          <span class="slider-label">Max</span>
          <div class="slider-wrap"><input type="range" id="filter-cost-max" min="1" max="5" step="1" value="5"></div>
          <span class="slider-val" id="filterval-cost-max">5</span>
        </div>
      </div>

      <div class="filter-section">
        <div class="section-label">Region</div>
        <div class="filter-chips" id="region-chips">${continentChips}</div>
      </div>

      <div class="filter-section">
        <div class="section-label">Traveling in Season</div>
        <div class="filter-chips">
          ${['spring','summer','fall','winter'].map(s =>
            `<span class="chip" data-filter="season" data-value="${s}">${s.charAt(0).toUpperCase()+s.slice(1)}</span>`
          ).join('')}
          <span class="chip active" data-filter="season" data-value="">Any</span>
        </div>
      </div>

      <div class="filter-section">
        <div class="section-label">Max Flight Difficulty</div>
        <div class="slider-row">
          <div class="slider-wrap"><input type="range" id="filter-flight" min="1" max="5" step="1" value="5"></div>
          <span class="slider-val" id="filterval-flight">5</span>
        </div>
      </div>

      <div class="filter-section">
        <div class="section-label">Must Have Traits</div>
        <div class="filter-chips" id="must-trait-chips" style="max-height:100px;overflow-y:auto">${traitChips}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-label">Ranking</div>
      <div id="leaderboard"></div>
    </div>
  `;

  _initSliders();
  _initPresets();
  _initFilters();
  renderRankTab();
}

function _initSliders() {
  METRIC_KEYS.forEach(k => {
    const slider = document.getElementById(`slider-${k}`);
    const val = document.getElementById(`sliderval-${k}`);
    if (!slider) return;
    slider.addEventListener('input', () => {
      AppState.weights[k] = parseInt(slider.value);
      if (val) val.textContent = slider.value;
      savePreferencesToLS();
      _onWeightChange();
      pushStateToURL();
      renderRankTab();
      // Update score in details tab if visible
      if (AppState.activeTab === 'details' && AppState.selected.length) {
        renderDetailsTab(AppState.selected[0]);
      }
    });
  });

  // Cost filter sliders
  ['cost-min', 'cost-max', 'flight'].forEach(id => {
    const el = document.getElementById(`filter-${id}`);
    const valEl = document.getElementById(`filterval-${id}`);
    if (!el) return;
    el.addEventListener('input', () => {
      if (valEl) valEl.textContent = el.value;
      if (id === 'cost-min') AppState.filters.costMin = parseInt(el.value);
      else if (id === 'cost-max') AppState.filters.costMax = parseInt(el.value);
      else if (id === 'flight') AppState.filters.maxFlightAccess = parseInt(el.value);
      savePreferencesToLS();
      _onFilterChange();
      renderRankTab();
    });
  });
}

function _initPresets() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.preset;
      const preset = PRESETS[key];
      if (!preset) return;

      const targetWeights = preset.weights || defaultWeights();
      _animateSliders(targetWeights);

      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function _animateSliders(targetWeights) {
  const duration = 400;
  const start = performance.now();
  const startWeights = { ...AppState.weights };

  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t; // ease-in-out

    METRIC_KEYS.forEach(k => {
      const from = startWeights[k];
      const to = targetWeights[k] ?? 5;
      AppState.weights[k] = from + (to - from) * ease;
      const slider = document.getElementById(`slider-${k}`);
      const valEl = document.getElementById(`sliderval-${k}`);
      if (slider) slider.value = AppState.weights[k];
      if (valEl) valEl.textContent = Math.round(AppState.weights[k]);
    });

    if (t < 1) requestAnimationFrame(step);
    else {
      METRIC_KEYS.forEach(k => {
        AppState.weights[k] = targetWeights[k] ?? 5;
        const slider = document.getElementById(`slider-${k}`);
        const valEl = document.getElementById(`sliderval-${k}`);
        if (slider) slider.value = AppState.weights[k];
        if (valEl) valEl.textContent = AppState.weights[k];
      });
      savePreferencesToLS();
      _onWeightChange();
      pushStateToURL();
      renderRankTab();
    }
  }
  requestAnimationFrame(step);
}

function _updateSliders() {
  METRIC_KEYS.forEach(k => {
    const slider = document.getElementById(`slider-${k}`);
    const valEl = document.getElementById(`sliderval-${k}`);
    if (slider) slider.value = AppState.weights[k];
    if (valEl) valEl.textContent = AppState.weights[k];
  });
}

function _initFilters() {
  // Region chips
  document.getElementById('region-chips')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip[data-filter="region"]');
    if (!chip) return;
    chip.classList.toggle('active');
    const active = [...document.querySelectorAll('.chip[data-filter="region"].active')]
      .map(c => c.dataset.value);
    const allRegions = [...new Set(_destinations.map(d=>d.region.continent))];
    AppState.filters.regions = active.length === allRegions.length ? [] : active;
    savePreferencesToLS();
    _onFilterChange();
    renderRankTab();
  });

  // Season chips (single select)
  document.addEventListener('click', e => {
    const chip = e.target.closest('.chip[data-filter="season"]');
    if (!chip) return;
    document.querySelectorAll('.chip[data-filter="season"]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    AppState.filters.season = chip.dataset.value || null;
    savePreferencesToLS();
    _onFilterChange();
    renderRankTab();
  });

  // Must-have traits
  document.getElementById('must-trait-chips')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip[data-filter="must"]');
    if (!chip) return;
    chip.classList.toggle('active');
    AppState.filters.mustHaveTraits = [...document.querySelectorAll('.chip[data-filter="must"].active')]
      .map(c => c.dataset.value);
    savePreferencesToLS();
    _onFilterChange();
    renderRankTab();
  });
}

/* ── FLIP leaderboard re-sort ──────────────────────────────────── */
export function renderRankTab() {
  const lb = document.getElementById('leaderboard');
  if (!lb) return;

  const ranked = getRankedDestinations();

  // FIRST: record positions
  lb.querySelectorAll('.lb-item[data-id]').forEach(el => {
    _flipPositions.set(el.dataset.id, el.getBoundingClientRect());
  });

  // Build new HTML
  lb.innerHTML = ranked.map((r, i) => {
    const sel = AppState.selected.includes(r.dest.id);
    const topContribs = getTopContributors(r.dest, AppState.weights, 3);
    const sparkBars = topContribs.map(c => {
      const pct = Math.min(100, (c.contribution / 0.3) * 100);
      return `<div class="sparkline-bar" style="height:${pct}%;max-height:14px;min-height:3px;background:var(--accent-primary);opacity:0.7"></div>`;
    }).join('');

    const dimmed = r.filtered ? 'opacity:0.35;' : r.offPeak ? 'opacity:0.6;' : '';
    const offPeakBadge = r.offPeak ? '<span style="font-size:0.65rem;color:var(--text-muted);margin-left:4px">off-peak</span>' : '';

    return `
      <div class="lb-item${sel?' selected':''}" data-id="${r.dest.id}" style="${dimmed}">
        <span class="lb-rank">#${i+1}</span>
        <img class="lb-thumb" src="${r.dest.image.url.replace('w=800&h=600','w=80&h=80')}" alt="${r.dest.name}" loading="lazy">
        <div class="lb-info">
          <div class="lb-name">${r.dest.name}${offPeakBadge}</div>
          <div class="lb-region">${r.dest.region.continent}${r.filtered?' · filtered':''}</div>
        </div>
        <div class="lb-score-col">
          <span class="lb-score-num">${r.score.toFixed(2)}</span>
          <div class="lb-sparkline" style="align-items:flex-end;height:14px">${sparkBars}</div>
        </div>
      </div>`;
  }).join('');

  // LAST: measure new positions + PLAY
  requestAnimationFrame(() => {
    lb.querySelectorAll('.lb-item[data-id]').forEach(el => {
      const id = el.dataset.id;
      const prev = _flipPositions.get(id);
      if (!prev) return;
      const curr = el.getBoundingClientRect();
      const dy = prev.top - curr.top;
      if (Math.abs(dy) < 1) return;

      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReduced) return;

      el.style.transform = `translateY(${dy}px)`;
      el.style.transition = 'none';
      requestAnimationFrame(() => {
        el.style.transition = 'transform 400ms cubic-bezier(0.4,0,0.2,1)';
        el.style.transform = '';
      });
    });

    lb.querySelectorAll('.lb-item[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        AppState.selected = [id];
        refreshHighlight();
        _onSelectDestination(id);
        switchTab('details');
        updateTabAvailability();
      }, { once: true });
    });
  });
}

/* ── Compare Tab ────────────────────────────────────────────────── */
export function renderCompareTab() {
  const pane = document.getElementById('pane-compare');
  const dests = AppState.selected.map(id => _destinations.find(d => d.id === id)).filter(Boolean);
  renderMiniCompare(pane, dests, AppState.weights);

  // Wire up open-full button
  pane.querySelector('#btn-open-full-compare')?.addEventListener('click', () => {
    openFullCompare(dests, AppState.weights);
  });

  pane.querySelectorAll('.compare-thumb-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      AppState.selected = AppState.selected.filter(s => s !== id);
      refreshHighlight();
      renderCompareTab();
      updateTabAvailability();
    });
  });
}

/* ── Trait Tab ──────────────────────────────────────────────────── */
export function renderTraitTab(traitId) {
  const pane = document.getElementById('pane-trait');
  const trait = _traits.find(t => t.id === traitId);
  if (!trait) return;

  const parentTrait = trait.parent ? _traits.find(t => t.id === trait.parent) : null;
  const relatedTraits = (trait.related || []).map(id => _traits.find(t => t.id === id)).filter(Boolean);

  const traitEdges = _edges
    .filter(e => e.trait === traitId)
    .sort((a, b) => b.weight - a.weight);

  const destRows = traitEdges.map(e => {
    const dest = _destinations.find(d => d.id === e.destination);
    if (!dest) return '';
    return `
      <div class="trait-dest-row" data-id="${dest.id}">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          <img src="${dest.image.url.replace('w=800&h=600','w=60&h=60')}" alt="${dest.name}"
               style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0">
          <span class="trait-dest-row-name">${dest.name}</span>
        </div>
        <div class="trait-weight-bar-wrap">
          <div class="trait-weight-bar" style="width:${e.weight*100}%"></div>
        </div>
        <span class="trait-weight-val">${e.weight.toFixed(2)}</span>
      </div>`;
  }).join('');

  const relatedHTML = relatedTraits.map(t =>
    `<span class="trait-chip" data-trait-id="${t.id}" style="cursor:pointer">${t.icon} ${t.label}</span>`
  ).join('');

  pane.innerHTML = `
    <div style="text-align:center;padding:24px 0;margin-bottom:16px">
      <div style="font-size:3rem;margin-bottom:8px">${trait.icon}</div>
      <div class="display-m">${trait.label}</div>
      <div style="color:var(--text-muted);font-size:0.78rem;margin-top:4px;text-transform:uppercase;letter-spacing:0.08em">
        ${trait.tier}${parentTrait ? ` — under ${parentTrait.icon} ${parentTrait.label}` : ''}
      </div>
    </div>

    <div class="card">
      <p style="color:var(--text-secondary);font-size:var(--type-body-s);line-height:1.6">${trait.description}</p>
      ${trait.synonyms?.length ? `
        <div style="margin-top:10px;font-size:0.75rem;color:var(--text-muted)">
          Also: ${trait.synonyms.join(', ')}
        </div>` : ''}
    </div>

    ${relatedTraits.length ? `
    <div class="section">
      <div class="section-label">Related Traits</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${relatedHTML}</div>
    </div>` : ''}

    <div class="section">
      <div class="section-label">Destinations — Ranked by Affinity</div>
      ${destRows || '<div style="color:var(--text-muted)">No destinations with this trait.</div>'}
    </div>
  `;

  pane.querySelectorAll('.trait-dest-row[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      AppState.selected = [id];
      refreshHighlight();
      _onSelectDestination(id);
      centerOn(id);
      switchTab('details');
      updateTabAvailability();
    });
  });

  pane.querySelectorAll('[data-trait-id]').forEach(el => {
    el.addEventListener('click', () => {
      AppState.activeTrait = el.dataset.traitId;
      refreshHighlight();
      renderTraitTab(el.dataset.traitId);
    });
  });
}
