/* main.js — bootstrap, state wiring, event coordination */
import { AppState, defaultWeights, decodeState, loadPreferencesFromLS, pushStateToURL } from './state.js';
import { initScoring } from './scoring.js';
import { initGraph, setLayout, refreshHighlight, centerOn } from './graph.js';
import { initCompare } from './compare.js';
import { initPanel, switchTab, updateTabAvailability, renderDetailsTab,
         renderTraitTab, renderRankTab, renderCompareTab } from './panel.js';

/* ── Load inline data ─────────────────────────────────────────────── */
function loadData(scriptId) {
  const el = document.getElementById(scriptId);
  if (!el) throw new Error(`Data script #${scriptId} not found`);
  return JSON.parse(el.textContent);
}

/* ── Main Bootstrap ───────────────────────────────────────────────── */
async function boot() {
  const destinations = loadData('data-destinations');
  const traits = loadData('data-traits');
  const edges = loadData('data-edges');

  /* Initialize weights from defaults then apply stored/URL state */
  AppState.weights = defaultWeights();
  loadPreferencesFromLS();
  if (location.hash) decodeState(location.hash);

  /* Init subsystems */
  initScoring(destinations, edges);
  initCompare(edges, traits);

  initPanel({
    destinations,
    traits,
    edges,
    onWeightChange: () => {
      refreshHighlight();
      if (AppState.activeTab === 'compare') renderCompareTab();
    },
    onFilterChange: () => {
      refreshHighlight();
    },
    onSelectDestination: (destId) => {
      renderDetailsTab(destId);
    },
  });

  initGraph({
    destinations,
    traits,
    edges,
    onDestinationClick: (node, result) => {
      if (result === 'removed' && AppState.selected.length === 0) {
        switchTab('browse');
      } else {
        renderDetailsTab(node.id);
        if (AppState.selected.length > 1) renderCompareTab();
      }
      updateTabAvailability();
      pushStateToURL();
    },
    onTraitClick: (trait) => {
      renderTraitTab(trait.id);
      updateTabAvailability();
      pushStateToURL();
    },
    onSelectionChange: () => {
      updateTabAvailability();
      pushStateToURL();
      if (AppState.activeTab === 'rank') renderRankTab();
    },
  });

  /* Layout toolbar */
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.addEventListener('click', () => setLayout(btn.dataset.layout));
  });

  /* Set initial layout active state */
  document.querySelectorAll('.layout-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.layout === AppState.layoutMode)
  );
  if (AppState.layoutMode !== 'web') setLayout(AppState.layoutMode);

  /* Restore state from URL */
  if (AppState.selected.length > 0) {
    updateTabAvailability();
    renderDetailsTab(AppState.selected[0]);
    if (AppState.selected.length > 1) renderCompareTab();
  }
  if (AppState.activeTrait) {
    updateTabAvailability();
    renderTraitTab(AppState.activeTrait);
  }
  if (AppState.activeTab !== 'browse') switchTab(AppState.activeTab);

  /* Handle browser back/forward */
  window.addEventListener('hashchange', () => {
    AppState.selected = [];
    AppState.activeTrait = null;
    AppState.layoutMode = 'web';
    AppState.activeTab = 'browse';
    AppState.weights = defaultWeights();
    decodeState(location.hash);
    refreshHighlight();
    updateTabAvailability();
    renderRankTab();
  });

  /* Keyboard nav */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const overlay = document.getElementById('compare-overlay');
      if (overlay?.classList.contains('visible')) {
        overlay.classList.remove('visible');
        overlay.innerHTML = '';
        return;
      }
      AppState.selected = [];
      AppState.activeTrait = null;
      refreshHighlight();
      switchTab('browse');
      updateTabAvailability();
    }
  });
}

/* ── DOMContentLoaded ─────────────────────────────────────────────── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot().catch(console.error);
}
