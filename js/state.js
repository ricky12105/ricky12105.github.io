/* state.js — URL hash encode/decode + localStorage */

const LS_PREFIX = 'atlas.';
const HASH_UPDATE_DEBOUNCE = 300;

let _hashUpdateTimer = null;

export const AppState = {
  selected: [],        // array of destination ids (max 4)
  weights: {},         // { metricKey: 0-10 }
  filters: {
    costMin: 1,
    costMax: 5,
    regions: [],       // empty = all
    season: null,      // 'spring' | 'summer' | 'fall' | 'winter' | null
    maxFlightAccess: 5,
    mustHaveTraits: [],
    excludeTraits: [],
  },
  layoutMode: 'web',   // 'web' | 'radial' | 'constellation' | 'similarity'
  activeTab: 'browse',
  activeTrait: null,
};

/* ── Default Weights ──────────────────────────────────────────────── */
export const METRIC_KEYS = [
  'food_scene', 'cultural_depth', 'outdoor_access', 'nightlife',
  'shopping', 'family_friendly', 'romance', 'adventure',
  'off_season_viability', 'photography', 'crowd_pressure', 'value_for_money',
];
export const METRIC_LABELS = {
  food_scene:          'Food Scene',
  cultural_depth:      'Cultural Depth',
  outdoor_access:      'Outdoor Access',
  nightlife:           'Nightlife',
  shopping:            'Shopping',
  family_friendly:     'Family Friendly',
  romance:             'Romance',
  adventure:           'Adventure',
  off_season_viability:'Off-Season',
  photography:         'Photography',
  crowd_pressure:      'Avoid Crowds',
  value_for_money:     'Value / Money',
};
export const INVERTED_METRICS = new Set(['crowd_pressure']);

export function defaultWeights() {
  const w = {};
  METRIC_KEYS.forEach(k => { w[k] = 5; });
  return w;
}

/* ── Presets ──────────────────────────────────────────────────────── */
export const PRESETS = {
  honeymoon: {
    label: '💍 Honeymoon',
    weights: { food_scene:8, cultural_depth:6, outdoor_access:5, nightlife:4,
               shopping:5, family_friendly:2, romance:10, adventure:4,
               off_season_viability:5, photography:8, crowd_pressure:7, value_for_money:4 },
  },
  adventure: {
    label: '⛰️ Adventure',
    weights: { food_scene:4, cultural_depth:4, outdoor_access:10, nightlife:2,
               shopping:2, family_friendly:3, romance:4, adventure:10,
               off_season_viability:5, photography:7, crowd_pressure:6, value_for_money:5 },
  },
  backpacker: {
    label: '🎒 Solo Backpacker',
    weights: { food_scene:8, cultural_depth:8, outdoor_access:6, nightlife:6,
               shopping:3, family_friendly:2, romance:3, adventure:6,
               off_season_viability:6, photography:6, crowd_pressure:5, value_for_money:9 },
  },
  family: {
    label: '👨‍👩‍👧 Family',
    weights: { food_scene:6, cultural_depth:5, outdoor_access:7, nightlife:1,
               shopping:4, family_friendly:10, romance:3, adventure:5,
               off_season_viability:6, photography:5, crowd_pressure:7, value_for_money:7 },
  },
  foodie: {
    label: '🍽️ Foodie',
    weights: { food_scene:10, cultural_depth:7, outdoor_access:3, nightlife:5,
               shopping:4, family_friendly:3, romance:5, adventure:3,
               off_season_viability:6, photography:5, crowd_pressure:4, value_for_money:6 },
  },
  neutral: {
    label: '↺ Reset',
    weights: null, // signals defaultWeights()
  },
};

/* ── URL Hash Encoding ────────────────────────────────────────────── */
const SHORT = {
  selected: 's', weights: 'w', layoutMode: 'l', activeTab: 't', activeTrait: 'tr',
  costMin: 'cm', costMax: 'cx', regions: 'r', season: 'sn',
  maxFlightAccess: 'mf', mustHaveTraits: 'mh', excludeTraits: 'ex',
};

export function encodeState() {
  const p = new URLSearchParams();
  const s = AppState;
  if (s.selected.length) p.set(SHORT.selected, s.selected.join(','));
  if (s.layoutMode !== 'web') p.set(SHORT.layoutMode, s.layoutMode);
  if (s.activeTab !== 'browse') p.set(SHORT.activeTab, s.activeTab);
  if (s.activeTrait) p.set(SHORT.activeTrait, s.activeTrait);

  const w = s.weights;
  const def = defaultWeights();
  const changedW = METRIC_KEYS.filter(k => w[k] !== def[k]);
  if (changedW.length) {
    p.set(SHORT.weights, changedW.map(k => `${k.slice(0,3)}:${w[k]}`).join(','));
  }

  const f = s.filters;
  if (f.costMin !== 1) p.set(SHORT.costMin, f.costMin);
  if (f.costMax !== 5) p.set(SHORT.costMax, f.costMax);
  if (f.regions.length) p.set(SHORT.regions, f.regions.join(','));
  if (f.season) p.set(SHORT.season, f.season);
  if (f.maxFlightAccess !== 5) p.set(SHORT.maxFlightAccess, f.maxFlightAccess);
  if (f.mustHaveTraits.length) p.set(SHORT.mustHaveTraits, f.mustHaveTraits.join(','));
  if (f.excludeTraits.length) p.set(SHORT.excludeTraits, f.excludeTraits.join(','));

  return p.toString();
}

export function decodeState(hash) {
  const q = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!q) return;
  const p = new URLSearchParams(q);

  if (p.has(SHORT.selected)) {
    AppState.selected = p.get(SHORT.selected).split(',').filter(Boolean);
  }
  if (p.has(SHORT.layoutMode)) AppState.layoutMode = p.get(SHORT.layoutMode);
  if (p.has(SHORT.activeTab)) AppState.activeTab = p.get(SHORT.activeTab);
  if (p.has(SHORT.activeTrait)) AppState.activeTrait = p.get(SHORT.activeTrait);

  if (p.has(SHORT.weights)) {
    const wStr = p.get(SHORT.weights);
    wStr.split(',').forEach(pair => {
      const [abbr, val] = pair.split(':');
      const key = METRIC_KEYS.find(k => k.slice(0,3) === abbr);
      if (key) AppState.weights[key] = parseFloat(val);
    });
  }

  const f = AppState.filters;
  if (p.has(SHORT.costMin)) f.costMin = parseInt(p.get(SHORT.costMin));
  if (p.has(SHORT.costMax)) f.costMax = parseInt(p.get(SHORT.costMax));
  if (p.has(SHORT.regions)) f.regions = p.get(SHORT.regions).split(',').filter(Boolean);
  if (p.has(SHORT.season)) f.season = p.get(SHORT.season);
  if (p.has(SHORT.maxFlightAccess)) f.maxFlightAccess = parseInt(p.get(SHORT.maxFlightAccess));
  if (p.has(SHORT.mustHaveTraits)) f.mustHaveTraits = p.get(SHORT.mustHaveTraits).split(',').filter(Boolean);
  if (p.has(SHORT.excludeTraits)) f.excludeTraits = p.get(SHORT.excludeTraits).split(',').filter(Boolean);
}

export function pushStateToURL() {
  if (_hashUpdateTimer) clearTimeout(_hashUpdateTimer);
  _hashUpdateTimer = setTimeout(() => {
    const encoded = encodeState();
    history.replaceState(null, '', encoded ? `#${encoded}` : location.pathname);
  }, HASH_UPDATE_DEBOUNCE);
}

export function getShareURL() {
  const encoded = encodeState();
  const base = `${location.origin}${location.pathname}`;
  return encoded ? `${base}#${encoded}` : base;
}

/* ── LocalStorage ─────────────────────────────────────────────────── */
export function savePreferencesToLS() {
  try {
    localStorage.setItem(`${LS_PREFIX}preferences.last`, JSON.stringify({
      weights: AppState.weights,
      filters: AppState.filters,
    }));
  } catch (_) {}
}

export function loadPreferencesFromLS() {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}preferences.last`);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.weights) Object.assign(AppState.weights, saved.weights);
    if (saved.filters) Object.assign(AppState.filters, saved.filters);
  } catch (_) {}
}

export function saveTrip(name) {
  try {
    const key = `${LS_PREFIX}trips`;
    const trips = JSON.parse(localStorage.getItem(key) || '[]');
    const trip = {
      id: Date.now(),
      name,
      savedAt: new Date().toISOString(),
      weights: { ...AppState.weights },
      filters: { ...AppState.filters },
      selected: [...AppState.selected],
    };
    trips.unshift(trip);
    localStorage.setItem(key, JSON.stringify(trips.slice(0, 5)));
    return trips;
  } catch (_) { return []; }
}

export function loadTrips() {
  try {
    return JSON.parse(localStorage.getItem(`${LS_PREFIX}trips`) || '[]');
  } catch (_) { return []; }
}

export function applyTrip(trip) {
  if (trip.weights) Object.assign(AppState.weights, trip.weights);
  if (trip.filters) Object.assign(AppState.filters, trip.filters);
  if (trip.selected) AppState.selected = [...trip.selected];
}

/* ── Selection Helpers ────────────────────────────────────────────── */
export function toggleSelection(destId, addMode = false) {
  const idx = AppState.selected.indexOf(destId);
  if (idx !== -1) {
    AppState.selected.splice(idx, 1);
    return 'removed';
  }
  if (addMode) {
    if (AppState.selected.length < 4) {
      AppState.selected.push(destId);
      return 'added';
    }
    return 'full';
  }
  AppState.selected = [destId];
  return 'set';
}
