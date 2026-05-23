/* graph.js — D3 force sim, 4 layout modes, hover/click, lasso */
import { AppState, toggleSelection } from './state.js';
import { computePairwiseSimilarity, mdsPositions } from './scoring.js';

let _destinations = [], _traits = [], _edges = [];
let _svg, _g, _simulation;
let _nodeData = [], _linkData = [];
let _onDestinationClick, _onTraitClick, _onSelectionChange;

/* D3 selections */
let _linkSel, _nodeSel, _labelSel;
let _width = 0, _height = 0;
let _currentLayout = 'web';
let _zoom;
let _currentTransform = d3.zoomIdentity;

/* Theme color map */
const THEME_COLORS = {
  nature: '#8aa17b', urban: '#b5a394', cultural: '#c97d6f',
  aquatic: '#7da3b5', adventure: '#a96f6f', culinary: '#c9a96e', wellness: '#9d8fa8',
};

function getTraitColor(trait) {
  if (trait.tier === 'theme') return THEME_COLORS[trait.id] || '#6b6760';
  if (trait.tier === 'sub-theme') {
    const parent = _traits.find(t => t.id === trait.parent);
    return parent ? (THEME_COLORS[parent.id] || '#6b6760') : '#6b6760';
  }
  // specific: find parent chain
  let t = trait;
  for (let i = 0; i < 3; i++) {
    const p = _traits.find(x => x.id === t.parent);
    if (!p) break;
    if (p.tier === 'theme') return THEME_COLORS[p.id] || '#6b6760';
    t = p;
  }
  return '#6b6760';
}

function getNodeRadius(node) {
  if (node.type === 'dest') {
    const edgeCount = _edges.filter(e => e.destination === node.id).length;
    return 28 + Math.min(edgeCount * 1.2, 14);
  }
  if (node.tier === 'theme') return 22;
  if (node.tier === 'sub-theme') return 14;
  return 9;
}

/* ── Init ─────────────────────────────────────────────────────────── */
export function initGraph({ destinations, traits, edges, onDestinationClick, onTraitClick, onSelectionChange }) {
  _destinations = destinations;
  _traits = traits;
  _edges = edges;
  _onDestinationClick = onDestinationClick;
  _onTraitClick = onTraitClick;
  _onSelectionChange = onSelectionChange;

  const container = document.getElementById('graph-container');
  _width = container.clientWidth;
  _height = container.clientHeight;

  _svg = d3.select('#graph-canvas')
    .attr('width', _width)
    .attr('height', _height);

  /* Defs: image patterns + gradient for trait-trait edges */
  const defs = _svg.append('defs');

  destinations.forEach(dest => {
    defs.append('pattern')
      .attr('id', `img-${dest.id}`)
      .attr('width', 1).attr('height', 1)
      .attr('patternContentUnits', 'objectBoundingBox')
      .append('image')
      .attr('href', dest.image.url.replace('w=800&h=600', 'w=120&h=120'))
      .attr('width', 1).attr('height', 1)
      .attr('preserveAspectRatio', 'xMidYMid slice');
  });

  /* Zoom */
  _zoom = d3.zoom()
    .scaleExtent([0.15, 4])
    .on('zoom', e => {
      _currentTransform = e.transform;
      _g.attr('transform', e.transform);
      _updateLabelVisibility(e.transform.k);
    });
  _svg.call(_zoom);

  /* Click on background = deselect */
  _svg.on('click', (e) => {
    if (e.target === _svg.node() || e.target.closest('g') === _g.node()) {
      if (e.target.tagName === 'svg' || e.target.tagName === 'rect') {
        AppState.selected = [];
        AppState.activeTrait = null;
        _updateHighlight();
        _onSelectionChange();
      }
    }
  });

  /* Lasso */
  _initLasso();

  _g = _svg.append('g');

  _buildGraphData();
  _initSimulation();
  _renderElements();

  /* Resize observer */
  new ResizeObserver(() => {
    _width = container.clientWidth;
    _height = container.clientHeight;
    _svg.attr('width', _width).attr('height', _height);
    _simulation.force('center', d3.forceCenter(_width / 2, _height / 2));
    _simulation.alpha(0.3).restart();
  }).observe(container);
}

/* ── Build graph data ─────────────────────────────────────────────── */
function _buildGraphData() {
  _nodeData = [
    ..._destinations.map(d => ({ ...d, type: 'dest', _r: getNodeRadius({ type: 'dest', id: d.id }) })),
    ..._traits.map(t => ({ ...t, type: 'trait', _r: getNodeRadius(t) })),
  ];

  _linkData = [
    ..._edges.map(e => ({
      source: e.destination,
      target: e.trait,
      weight: e.weight,
      evidence: e.evidence || '',
      kind: 'dest-trait',
    })),
    // trait parent edges (lighter)
    ..._traits
      .filter(t => t.parent)
      .map(t => ({ source: t.id, target: t.parent, weight: 0.5, evidence: '', kind: 'trait-parent' })),
  ];
}

/* ── Simulation ───────────────────────────────────────────────────── */
function _initSimulation() {
  _simulation = d3.forceSimulation(_nodeData)
    .force('link', d3.forceLink(_linkData).id(d => d.id).distance(d => {
      if (d.kind === 'dest-trait') return 130 + (1 - d.weight) * 80;
      return 60;
    }).strength(d => d.kind === 'dest-trait' ? 0.3 : 0.2))
    .force('charge', d3.forceManyBody().strength(d => d.type === 'dest' ? -500 : -120))
    .force('center', d3.forceCenter(_width / 2, _height / 2))
    .force('collide', d3.forceCollide().radius(d => d._r + 6))
    .alphaDecay(0.02)
    .on('tick', _onTick);
}

/* ── Render ───────────────────────────────────────────────────────── */
function _renderElements() {
  /* Links */
  _linkSel = _g.append('g').attr('class', 'links').selectAll('line')
    .data(_linkData, d => `${d.source.id||d.source}-${d.target.id||d.target}`)
    .join('line')
    .attr('class', d => d.kind === 'dest-trait' ? 'link-dest-trait' : 'link-trait-trait')
    .attr('stroke', d => {
      if (d.kind === 'dest-trait') {
        const trait = _traits.find(t => t.id === (d.target.id || d.target));
        return trait ? getTraitColor(trait) : '#3d3949';
      }
      return '#2a2734';
    })
    .attr('stroke-width', d => d.kind === 'dest-trait' ? d.weight * 2.5 : 1);

  /* Nodes */
  _nodeSel = _g.append('g').attr('class', 'nodes').selectAll('circle')
    .data(_nodeData, d => d.id)
    .join('circle')
    .attr('r', d => d._r)
    .attr('class', d => d.type === 'dest' ? 'node-dest'
      : `node-trait tier-${d.tier === 'sub-theme' ? 'sub' : d.tier === 'theme' ? 'theme' : 'specific'}`)
    .attr('fill', d => {
      if (d.type === 'dest') return `url(#img-${d.id})`;
      return '#0e0d12';
    })
    .attr('stroke', d => {
      if (d.type === 'dest') return '#c9a96e';
      return getTraitColor(d);
    })
    .on('click', _handleNodeClick)
    .on('mouseenter', _handleNodeMouseEnter)
    .on('mouseleave', _handleNodeMouseLeave)
    .call(d3.drag()
      .on('start', _dragStart)
      .on('drag', _dragged)
      .on('end', _dragEnd));

  /* Labels */
  _labelSel = _g.append('g').attr('class', 'labels').selectAll('text')
    .data(_nodeData, d => d.id)
    .join('text')
    .attr('class', d => d.type === 'dest' ? 'node-label-dest' : 'node-label-trait')
    .attr('dy', d => {
      if (d.type === 'dest') return d._r + 14;
      return d._r + 11;
    })
    .attr('font-size', d => {
      if (d.type === 'dest') return '13px';
      if (d.tier === 'theme') return '11px';
      return '9px';
    })
    .text(d => d.type === 'dest' ? d.name : `${d.icon} ${d.label}`)
    .style('opacity', d => d.type === 'dest' ? 1 : d.tier === 'theme' ? 0.7 : 0);
}

function _onTick() {
  _linkSel
    .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  _nodeSel.attr('cx', d => d.x).attr('cy', d => d.y);
  _labelSel.attr('x', d => d.x).attr('y', d => d.y);
}

function _updateLabelVisibility(k) {
  _labelSel.style('opacity', d => {
    if (d.type === 'dest') return k > 0.3 ? 1 : 0;
    if (d.tier === 'theme') return k > 0.5 ? 0.7 : 0;
    if (d.tier === 'sub-theme') return k > 0.9 ? 0.6 : 0;
    return k > 1.5 ? 0.5 : 0;
  });
}

/* ── Click handling ───────────────────────────────────────────────── */
function _handleNodeClick(event, d) {
  event.stopPropagation();
  if (d.type === 'dest') {
    const addMode = event.shiftKey || event.metaKey || event.ctrlKey;
    const result = toggleSelection(d.id, addMode);
    _updateHighlight();
    _onDestinationClick(d, result);
    _onSelectionChange();
  } else {
    AppState.activeTrait = AppState.activeTrait === d.id ? null : d.id;
    _updateHighlight();
    _onTraitClick(d);
    _onSelectionChange();
  }
}

/* ── Tooltip ──────────────────────────────────────────────────────── */
const _tooltip = document.getElementById('graph-tooltip');

function _handleNodeMouseEnter(event, d) {
  const { clientX, clientY } = event;
  _tooltip.innerHTML = _buildTooltipHTML(d);
  _tooltip.classList.add('visible');
  _positionTooltip(clientX, clientY);
  _highlightHover(d);
}

function _handleNodeMouseLeave() {
  _tooltip.classList.remove('visible');
  if (!AppState.selected.length && !AppState.activeTrait) _resetHighlight();
  else _updateHighlight();
}

function _positionTooltip(x, y) {
  const tt = _tooltip;
  const margin = 12;
  let tx = x + margin, ty = y + margin;
  if (tx + 240 > window.innerWidth) tx = x - 240 - margin;
  if (ty + 150 > window.innerHeight) ty = y - 150 - margin;
  tt.style.left = `${tx}px`;
  tt.style.top = `${ty}px`;
}

function _buildTooltipHTML(d) {
  if (d.type === 'dest') {
    const costDots = Array.from({length:5}, (_,i) =>
      `<span class="cost-dot ${i < d.cost_tier ? 'filled' : ''}"></span>`
    ).join('');
    return `<div class="tooltip-name">${d.name}</div>
            <div class="tooltip-sub">${d.region.subdivision}, ${d.region.country}</div>
            <div class="cost-tier-dots">${costDots}</div>`;
  }
  // trait or edge node
  const destCount = _edges.filter(e => e.trait === d.id).length;
  return `<div class="tooltip-name">${d.icon} ${d.label}</div>
          <div class="tooltip-sub">${d.tier} — ${d.description.slice(0,80)}${d.description.length>80?'…':''}</div>
          <div class="tooltip-weight mono">${destCount} destination${destCount!==1?'s':''}</div>`;
}

function _buildEdgeTooltipHTML(d) {
  return `<div class="tooltip-name">Weight: ${d.weight.toFixed(2)}</div>
          <div class="tooltip-evidence">${d.evidence}</div>`;
}

/* ── Highlight logic ─────────────────────────────────────────────── */
function _highlightHover(d) {
  if (d.type === 'dest') {
    const connectedIds = new Set([d.id]);
    _linkData.forEach(l => {
      if ((l.source.id||l.source) === d.id || (l.target.id||l.target) === d.id) {
        connectedIds.add(l.source.id||l.source);
        connectedIds.add(l.target.id||l.target);
      }
    });
    _nodeSel.style('opacity', n => connectedIds.has(n.id) ? 1 : 0.12);
    _linkSel.style('opacity', l => {
      const s = l.source.id||l.source, t = l.target.id||l.target;
      return (s===d.id || t===d.id) ? 1 : 0.05;
    });
    _labelSel.style('opacity', n => connectedIds.has(n.id) ? 1 : 0.05);
  } else {
    const connDests = new Set(_edges.filter(e=>e.trait===d.id).map(e=>e.destination));
    _nodeSel.style('opacity', n => n.id===d.id || connDests.has(n.id) ? 1 : 0.12);
    _linkSel
      .style('opacity', l => {
        const t = l.target.id||l.target;
        return t === d.id ? 1 : 0.05;
      })
      .attr('stroke-width', l => {
        const t = l.target.id||l.target;
        return t === d.id ? (l.weight || 0.5) * 4 : l.kind === 'dest-trait' ? (l.weight||0.5)*2.5 : 1;
      });
  }
}

function _updateHighlight() {
  if (!AppState.selected.length && !AppState.activeTrait) { _resetHighlight(); return; }
  const sel = new Set(AppState.selected);
  const connectedToSel = new Set(AppState.selected);

  _linkData.forEach(l => {
    const s = l.source.id||l.source, t = l.target.id||l.target;
    if (sel.has(s)) connectedToSel.add(t);
    if (sel.has(t)) connectedToSel.add(s);
  });

  if (AppState.activeTrait) {
    const trDests = _edges.filter(e=>e.trait===AppState.activeTrait).map(e=>e.destination);
    trDests.forEach(id => connectedToSel.add(id));
    connectedToSel.add(AppState.activeTrait);
  }

  _nodeSel.style('opacity', n => connectedToSel.has(n.id) ? 1 : 0.12);
  _linkSel.style('opacity', l => {
    const s = l.source.id||l.source, t = l.target.id||l.target;
    return (connectedToSel.has(s) && connectedToSel.has(t)) ? 0.8 : 0.05;
  });
  _labelSel.style('opacity', n => connectedToSel.has(n.id) ? 1 : 0.05);
}

function _resetHighlight() {
  _nodeSel.style('opacity', 1);
  _linkSel.style('opacity', null);
  _labelSel.style('opacity', null);
  _linkSel.attr('stroke-width', d => d.kind==='dest-trait' ? (d.weight||0.5)*2.5 : 1);
  _updateLabelVisibility(_currentTransform.k);
}

/* ── Drag ─────────────────────────────────────────────────────────── */
function _dragStart(event, d) {
  if (!event.active) _simulation.alphaTarget(0.3).restart();
  d.fx = d.x; d.fy = d.y;
}
function _dragged(event, d) { d.fx = event.x; d.fy = event.y; }
function _dragEnd(event, d) {
  if (!event.active) _simulation.alphaTarget(0);
  d.fx = null; d.fy = null;
}

/* ── Layout Modes ─────────────────────────────────────────────────── */
export function setLayout(mode) {
  _currentLayout = mode;
  document.querySelectorAll('.layout-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.layout === mode);
  });

  _simulation.stop();

  if (mode === 'web') {
    _nodeData.forEach(n => { n.fx = null; n.fy = null; });
    _simulation
      .force('link', d3.forceLink(_linkData).id(d=>d.id).distance(d=>130+(1-d.weight)*80).strength(d=>d.kind==='dest-trait'?0.3:0.2))
      .force('charge', d3.forceManyBody().strength(d=>d.type==='dest'?-500:-120))
      .force('center', d3.forceCenter(_width/2, _height/2))
      .force('radial', null)
      .alpha(0.8).restart();

  } else if (mode === 'radial') {
    const continents = [...new Set(_destinations.map(d=>d.region.continent))];
    const cAngles = {};
    continents.forEach((c, i) => { cAngles[c] = (i / continents.length) * 2 * Math.PI; });
    const rBase = Math.min(_width, _height) * 0.35;

    _nodeData.forEach(n => {
      if (n.type === 'dest') {
        const angle = cAngles[n.region.continent] + (Math.random()-0.5)*0.5;
        n.fx = _width/2 + rBase * Math.cos(angle);
        n.fy = _height/2 + rBase * Math.sin(angle);
      } else {
        n.fx = null; n.fy = null;
      }
    });

    _simulation
      .force('link', d3.forceLink(_linkData).id(d=>d.id).distance(60).strength(0.1))
      .force('charge', d3.forceManyBody().strength(-80))
      .force('center', null)
      .force('radial', null)
      .alpha(0.8).restart();

  } else if (mode === 'constellation') {
    const themes = _traits.filter(t=>t.tier==='theme');
    const themeAngles = {};
    themes.forEach((t,i) => { themeAngles[t.id] = (i/themes.length)*2*Math.PI; });
    const rTheme = Math.min(_width, _height) * 0.38;

    // Position theme nodes at fixed positions
    _nodeData.forEach(n => {
      if (n.type === 'trait' && n.tier === 'theme') {
        n.fx = _width/2 + rTheme * Math.cos(themeAngles[n.id]);
        n.fy = _height/2 + rTheme * Math.sin(themeAngles[n.id]);
      } else {
        n.fx = null; n.fy = null;
      }
    });

    // Destinations gravitate to dominant theme
    _simulation
      .force('link', d3.forceLink(_linkData).id(d=>d.id).distance(80).strength(0.2))
      .force('charge', d3.forceManyBody().strength(d=>d.type==='dest'?-200:-80))
      .force('center', d3.forceCenter(_width/2, _height/2))
      .force('radial', null)
      .alpha(0.8).restart();

  } else if (mode === 'similarity') {
    // Hide trait nodes in similarity mode
    _nodeSel.style('display', d => d.type === 'trait' ? 'none' : null);
    _linkSel.style('display', 'none');
    _labelSel.style('display', d => d.type === 'trait' ? 'none' : null);

    const simMatrix = computePairwiseSimilarity();
    const positions = mdsPositions(simMatrix);
    const maxX = Math.max(...positions.map(p=>Math.abs(p.x)));
    const maxY = Math.max(...positions.map(p=>Math.abs(p.y)));
    const scaleX = (_width * 0.38) / (maxX || 1);
    const scaleY = (_height * 0.38) / (maxY || 1);

    _destinations.forEach((dest, i) => {
      const node = _nodeData.find(n => n.id === dest.id);
      if (node) {
        node.fx = _width/2 + positions[i].x * scaleX;
        node.fy = _height/2 + positions[i].y * scaleY;
      }
    });

    _simulation.alpha(0.8).restart();
    return; // skip restoring node visibility
  }

  // Restore visibility when leaving similarity mode
  if (_currentLayout !== 'similarity') {
    _nodeSel.style('display', null);
    _linkSel.style('display', null);
    _labelSel.style('display', null);
  }
}

/* ── Lasso Select ─────────────────────────────────────────────────── */
function _initLasso() {
  let lasso = null;
  let lassoActive = false;

  _svg.on('mousedown.lasso', (e) => {
    if (!e.shiftKey) return;
    e.preventDefault();
    lassoActive = true;
    lasso = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY };
    _svg.select('#lasso-rect').remove();
    _svg.append('rect')
      .attr('id', 'lasso-rect')
      .attr('x', lasso.x0).attr('y', lasso.y0)
      .attr('width', 0).attr('height', 0);
  });

  _svg.on('mousemove.lasso', (e) => {
    if (!lassoActive || !lasso) return;
    lasso.x1 = e.offsetX; lasso.y1 = e.offsetY;
    const x = Math.min(lasso.x0, lasso.x1);
    const y = Math.min(lasso.y0, lasso.y1);
    const w = Math.abs(lasso.x1 - lasso.x0);
    const h = Math.abs(lasso.y1 - lasso.y0);
    _svg.select('#lasso-rect').attr('x',x).attr('y',y).attr('width',w).attr('height',h);
  });

  _svg.on('mouseup.lasso', (e) => {
    if (!lassoActive || !lasso) return;
    lassoActive = false;
    _svg.select('#lasso-rect').remove();

    const x = Math.min(lasso.x0, lasso.x1);
    const y = Math.min(lasso.y0, lasso.y1);
    const w = Math.abs(lasso.x1 - lasso.x0);
    const h = Math.abs(lasso.y1 - lasso.y0);

    if (w < 5 || h < 5) { lasso = null; return; }

    const captured = [];
    _nodeData.forEach(n => {
      if (n.type !== 'dest') return;
      const [nx, ny] = [n.x, n.y].map((v, i) => {
        const s = _currentTransform.k;
        const txy = i === 0 ? _currentTransform.x : _currentTransform.y;
        return v * s + txy;
      });
      if (nx >= x && nx <= x+w && ny >= y && ny <= y+h) captured.push(n.id);
    });

    // Add up to 4
    const toAdd = captured.slice(0, 4 - AppState.selected.length);
    toAdd.forEach(id => {
      if (!AppState.selected.includes(id)) AppState.selected.push(id);
    });
    AppState.selected = AppState.selected.slice(0, 4);

    _updateHighlight();
    _onSelectionChange();
    lasso = null;
  });
}

/* ── Highlight edge on edge hover ─────────────────────────────────── */
export function highlightEdge(sourceId, targetId) {
  _linkSel.classed('highlighted', d => {
    const s = d.source.id||d.source, t = d.target.id||d.target;
    return (s===sourceId && t===targetId) || (s===targetId && t===sourceId);
  });
}

/* ── External refresh ─────────────────────────────────────────────── */
export function refreshHighlight() {
  _updateHighlight();
}

export function centerOn(destId) {
  const node = _nodeData.find(n => n.id === destId);
  if (!node) return;
  _svg.transition().duration(600)
    .call(_zoom.transform, d3.zoomIdentity.translate(_width/2 - node.x, _height/2 - node.y).scale(1));
}
