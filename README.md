# Destination Atlas

A lexical graph for comparing and ranking travel destinations.

## Open It

**Easiest:** Open `index.html` directly in any modern browser — works offline, no server needed.

**For development** (enables full ES module dev tools):
```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## What It Does

- **Explore** — 31 destinations connected to 55+ traits in a navigable force-directed graph
- **Compare** — select 2–4 destinations for side-by-side radar chart, trait overlap, and metric diff
- **Rank** — adjust preference weights and watch the leaderboard re-sort live with FLIP animation
- **Understand** — "Why it ranks here" breakdown for every destination under current weights

## Layout Modes

| Mode | What it shows |
|---|---|
| **Web** | Free-form force-directed layout; traits cluster near theme parents |
| **Radial** | Destinations arranged by continent around the viewport center |
| **Constellation** | Destinations gravitate toward dominant theme gravitational wells |
| **Similarity** | Destinations positioned by semantic similarity (MDS projection) |

## Interaction

- **Click** destination node → open Details tab
- **Shift+click** or **Cmd+click** → add to multi-select (up to 4)
- **Shift+drag** → lasso-select multiple destinations
- **Click** trait node → open Trait tab with ranked affinity list
- **Click** empty canvas → deselect all
- **Esc** → clear selection / close comparison overlay

## Data

```
data/
  destinations.json   31 destinations with full schema including metrics, images, caveats
  traits.json         55 traits in a 3-tier hierarchy (themes → sub-themes → specific)
  edges.json          ~300 weighted destination↔trait edges with evidence strings
```

To add a destination: add a record to `destinations.json`, add edges to `edges.json`, then re-run the `index.html` generator or paste the data into the inline script blocks.

## Architecture

```
index.html            shell + inline JSON data (works without a server)
styles.css            design system (brass-on-dark palette, Fraunces/Inter typography)
js/
  main.js             bootstrap, event wiring
  state.js            URL hash + localStorage state management
  scoring.js          weighted scoring, filtering, ranking, MDS projection
  graph.js            D3 force simulation, 4 layout modes, hover/click/lasso
  compare.js          radar chart, trait overlap, metric diff, verdict synthesis
  panel.js            tab controller, all 5 tab views, FLIP animation
```

## Extending the Dataset

1. Add destination records to `data/destinations.json` (follow the existing schema)
2. Add edges to `data/edges.json` linking to trait IDs in `data/traits.json`
3. To add new traits: add to `data/traits.json` with correct `parent` reference
4. Regenerate `index.html` inline data using:
   ```sh
   python3 -c "
   import json
   for name in ['destinations','traits','edges']:
       data = open(f'data/{name}.json').read()
       print(f'Replace #data-{name} content with this JSON')
   "
   ```
