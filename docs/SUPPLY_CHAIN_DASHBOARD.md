# Supply Chain Analysis (SPLC) Dashboard

A Bloomberg-terminal-style dashboard mapping a target company's suppliers, customers, and competitors, with quantified revenue/COGS exposure per relationship. Lives at **`/supply-chain`** (nav label "Supply Chain").

Currently ships with **mock data only** for five tickers (`AAPL`, `NVDA`, `TSLA`, `MSFT`, `AMD`) — see [Backend Integration Path](#backend-integration-path) for how to wire a real data source without touching any rendering component.

---

## Contents

- [Route & navigation](#route--navigation)
- [File map](#file-map)
- [Data flow](#data-flow)
- [Data model](#data-model)
- [State management — `SupplyChainContext`](#state-management--supplychaincontext)
- [API layer — `api/supplyChain.js`](#api-layer--apisupplychainjs)
- [Backend integration path](#backend-integration-path)
- [Graph rendering](#graph-rendering)
- [Matrix table view](#matrix-table-view)
- [Inspector panel](#inspector-panel)
- [Top control bar](#top-control-bar)
- [CSV export](#csv-export)
- [Styling & theming](#styling--theming)
- [Filtering logic](#filtering-logic)
- [Known limitations](#known-limitations)
- [Running / testing locally](#running--testing-locally)

---

## Route & navigation

| Route | Component | Nav label |
|---|---|---|
| `/supply-chain` | `pages/SupplyChainAnalysisPage.jsx` | "Supply Chain" |

Registered like every other page in the app:

- `frontend/src/App.jsx` — lazy-loaded route: `const SupplyChainAnalysisPage = lazy(() => import('./pages/SupplyChainAnalysisPage'))`, `<Route path="/supply-chain" element={<SupplyChainAnalysisPage />} />`
- `frontend/src/components/Layout/Layout.jsx` — nav item: `{ path: '/supply-chain', label: 'Supply Chain' }`

No feature flag gates it (unlike Themes/Assistant); it's always in the nav.

---

## File map

```text
frontend/src/
├── pages/
│   └── SupplyChainAnalysisPage.jsx     # Route entry point, layout shell, loading/error states
├── contexts/
│   └── SupplyChainContext.jsx          # All cross-component state (ticker, filters, selection, view mode)
├── api/
│   └── supplyChain.js                  # Data-access layer — mock today, swap point for a real backend
├── data/
│   └── mockSupplyChainData.js          # Hardcoded datasets for AAPL/NVDA/TSLA/MSFT/AMD
├── styles/
│   └── supplyChain.css                 # Scoped Tailwind entry + Bloomberg amber theme tokens
└── components/SupplyChain/
    ├── TopControlBar.jsx               # Search, exposure slider, category toggles, view toggle, CSV export
    ├── SupplyChainGraph.jsx            # SVG network graph canvas: pan/zoom/drag, edges, nodes
    ├── GraphNode.jsx                   # Single company node (circle + labels)
    ├── GraphEdge.jsx                   # Directed edge between a counterparty and the target
    ├── GraphTooltip.jsx                # Hover tooltip (exposure breakdown)
    ├── MatrixTableView.jsx             # Sortable flat-table alternative to the graph
    ├── InspectorPanel.jsx              # Right sidebar — selected node detail / target overview
    ├── badges.jsx                      # ExposureBadge, RiskBadge, CategoryChip, PerformanceValue
    ├── graphLayout.js                  # Pure layout math (arc/row positioning, node/edge sizing)
    └── exportCsv.js                    # Client-side CSV generation + download
```

14 new files, 3 edited (`App.jsx`, `Layout.jsx`, plus the new page importing the new CSS). No new npm dependencies.

---

## Data flow

```text
SupplyChainAnalysisPage
  └─ SupplyChainProvider (React Context, wraps the whole page)
       │
       │  useQuery(['supplyChainMap', ticker], () => getSupplyChainMap(ticker))
       ▼
     api/supplyChain.js ──(USE_MOCK_DATA=true)──► data/mockSupplyChainData.js
       │                  ──(USE_MOCK_DATA=false)──► GET /v1/supply-chain/{ticker}  [not implemented yet]
       ▼
     dataset { ticker, name, sector, marketCapUsdB, oneYearPerformancePct,
                suppliers[], customers[], competitors[] }
       │
       ├─ allCounterparties = flatten(suppliers, customers, competitors) + category tag
       ├─ filteredCounterparties = allCounterparties
       │     .filter(categoryVisibility[entry.category])
       │     .filter(entry.category === 'competitors' || exposure >= exposureThreshold)
       │
       ├──► SupplyChainGraph   (viewMode === 'graph')
       ├──► MatrixTableView    (viewMode === 'matrix')
       └──► InspectorPanel     (always visible, driven by selectedNodeId)
```

`filteredCounterparties` is computed once in the context and consumed identically by the graph, the matrix table, and CSV export — filtering logic lives in exactly one place ([Filtering logic](#filtering-logic)).

---

## Data model

Each ticker's dataset (`SUPPLY_CHAIN_DATASETS[ticker]` in `mockSupplyChainData.js`):

```ts
{
  ticker: string;
  name: string;
  sector: string;
  marketCapUsdB: number;
  oneYearPerformancePct: number;
  suppliers: SupplyChainCounterparty[];
  customers: SupplyChainCounterparty[];
  competitors: SupplyChainCounterparty[];
}
```

`SupplyChainCounterparty`:

| Field | Type | Populated for | Notes |
|---|---|---|---|
| `id` | string | all | Ticker, used as the graph node id |
| `ticker` | string | all | |
| `name` | string | all | |
| `relationshipType` | string | all | Human label, e.g. `"Sole-Source Chip Foundry (A-series / M-series SoCs)"` |
| `revenueExposurePct` | number | suppliers, customers | Suppliers: % of *supplier's own* revenue tied to the target. Customers: % of *target's* revenue from that customer |
| `cogsExposurePct` | number | suppliers only | % of the target's COGS this vendor supplies |
| `annualValueUsdM` | number \| null | suppliers, customers | Competitors carry `null` — no flow relationship |
| `dataSource` | string | all | e.g. `"SEC Form 10-K, Item 1 (Customer Concentration)"`, `"Trade Shipment Manifest"`, `"Analyst Estimate"` |
| `marketCapUsdB` | number | all | |
| `sector` | string | all | |
| `oneYearPerformancePct` | number | all | Signed |
| `riskScore` | `'Low' \| 'Medium' \| 'High'` | all | Supply-chain disruption risk |

`category` (`'suppliers' \| 'customers' \| 'competitors'`) is **not** stored on the raw record — it's tagged on when the context flattens `dataset.suppliers/customers/competitors` into `allCounterparties`.

### Exposure tiering

`mockSupplyChainData.js` also exports the tiering used everywhere a badge or node color needs to reflect exposure magnitude:

```js
EXPOSURE_TIERS = { HIGH: 20, MEDIUM: 8 }  // >= 20% high, >= 8% medium, else low

exposureTierFor(pct) → 'high' | 'medium' | 'low' | 'unknown'
```

Retuning the thresholds here changes node fill color, matrix badge color, and tooltip color everywhere at once.

---

## State management — `SupplyChainContext`

`frontend/src/contexts/SupplyChainContext.jsx`. Plain React Context + `useState`/`useMemo` — no external store, scoped to this one page (matches the rest of the app's convention: React Query owns server state, Context owns page/global UI state).

| State | Setter | Default | Purpose |
|---|---|---|---|
| `selectedTicker` | `selectTicker(ticker)` | `initialTicker` prop (`"AAPL"`) | Drives the React Query key |
| `selectedNodeId` | `setSelectedNodeId(id)` | `'__target__'` | `'__target__'` or a counterparty's `id` |
| `exposureThreshold` | `setExposureThreshold(n)` | `5` (`DEFAULT_EXPOSURE_THRESHOLD`) | 0–60, from the slider |
| `categoryVisibility` | `toggleCategory(key)` | `{ suppliers: true, customers: true, competitors: true }` | Checkbox toggles |
| `viewMode` | `setViewMode(mode)` | `'graph'` | `'graph' \| 'matrix'` |

Derived values (all `useMemo`d off the above):

- `dataset`, `isLoading`, `isError`, `error` — straight from `useQuery` (`queryKey: ['supplyChainMap', selectedTicker]`, `staleTime: 5 * 60_000`, `retry: false`)
- `allCounterparties` — flattened `suppliers`/`customers`/`competitors` with a `category` tag added
- `filteredCounterparties` — `allCounterparties` after threshold + visibility filtering (see [Filtering logic](#filtering-logic))
- `selectedNode` — either a synthetic `{ id: '__target__', category: 'target', ...dataset }` object, or the matching entry from `allCounterparties`
- `supportedTickers` — `getSupportedTickers()` from the API layer (currently `['AAPL','NVDA','TSLA','MSFT','AMD']`)

`selectTicker(ticker)` resets `selectedNodeId` back to `'__target__'` so switching tickers doesn't leave the inspector pointed at a node from the old dataset.

Consumed via the `useSupplyChain()` hook, which throws if called outside `<SupplyChainProvider>` (same pattern as `useRuntime`/`useMarket` elsewhere in the app).

---

## API layer — `api/supplyChain.js`

```js
const USE_MOCK_DATA = true;        // flip to false once a real endpoint exists
const MOCK_LATENCY_MS = 220;       // simulated network latency, exercises loading states

async function getSupplyChainMap(ticker) { ... }   // -> dataset shape above
function getSupportedTickers() { ... }              // -> string[]
```

`getSupplyChainMap` is the **only** function every component talks to — nothing imports `mockSupplyChainData.js` directly except this file and the context (for `getSupportedTickers`). When `USE_MOCK_DATA` is true it awaits a fake delay and returns from `SUPPLY_CHAIN_DATASETS`, throwing a descriptive error for unsupported tickers. When false, it calls `apiClient.get(`/v1/supply-chain/${ticker}`)`.

---

## Backend integration path

No backend endpoint exists yet. To wire one in:

1. Implement `GET /v1/supply-chain/{ticker}` in `backend/app/api/v1/` (follow the existing router pattern — see `options.py` or `gex.py`) returning **exactly** the [data model](#data-model) shape.
2. Suggested data sources (documented in both `mockSupplyChainData.js`'s header and `supplyChain.js`'s doc comment):
   - **SEC EDGAR** full-text search + 10-K Item 1 / Item 1A parsing for customer-concentration disclosures (`"one customer accounted for X% of net sales"`).
   - **Financial Modeling Prep** company-notes / revenue-segmentation endpoints for supplier/customer graphs.
   - A dedicated supply-chain vendor (FactSet Revere, Sentieo, or Bloomberg SPLC itself) for dollar-value estimates and disruption-risk scoring.
   - 8-K / investor-day disclosures for one-off dollar-value estimates.
3. In `frontend/src/api/supplyChain.js`, set `USE_MOCK_DATA = false` (or delete the mock branch). No other file changes — every component reads through `getSupplyChainMap()`.
4. Optionally replace `getSupportedTickers()` with a real coverage endpoint or the app's existing ticker-search API (see `TickerSearch` component) once the backend can serve more than 5 tickers.

---

## Graph rendering

### Why not react-flow / d3 / visx

The spec's layout is **structured**, not organic: suppliers on a left arc, customers on a right arc, competitors on a top/bottom row, target dead center. A deterministic layout function renders that predictably; a force simulation would fight it. Building a small bespoke SVG renderer also avoided adding a new dependency to a production app and kept full control over exact Bloomberg-style theming. No new npm packages were added for this feature.

### Layout math — `graphLayout.js`

Virtual canvas: `1200 × 820` units (`CANVAS_WIDTH`, `CANVAS_HEIGHT`), independent of screen pixels — the SVG `<g>` transform (below) maps it to the actual viewport.

- **`arcColumn(count, side)`** — used for both suppliers (`side = -1`, left) and customers (`side = +1`, right). Nodes are spaced evenly down a vertical span (capped at 600px, `145px` per node), then bulge horizontally toward the center using a parabola (`(1 - t²) * arcBulge`, `t` normalized to `-1..1`, `arcBulge = 55`) so the arc reads as a gentle curve rather than a flat column, with the *middle* node bulging most.
- **`topBottomRow(count)`** — competitors split `ceil(n/2)` top / remainder bottom, each row spaced evenly across a 680px span centered on the canvas midpoint. Rows sit at `y = 78` (top) and `y = CANVAS_HEIGHT - 78` (bottom).
- **`nodeRadiusFor(entry)`** — target: fixed 48px. Competitors: fixed 27px (no exposure %, so no scaling basis). Suppliers/customers: `clamp(19 + exposure * 0.55, 19, 46)`.
- **`edgeWidthFor(entry)`** — `clamp(1.5 + exposure * 0.16, 1.5, 8)`, same exposure value driving node radius.

`computeGraphLayout({ suppliers, customers, competitors })` re-runs on every filter change (threshold/category toggles), so the whole map re-flows live — this is the "dynamic recalculation" called for in the spec, achieved via deterministic re-layout rather than physics.

### Node & edge rendering

- **`GraphNode.jsx`** — an SVG `<g>` with a `<circle>` + two/three `<text>` labels (ticker, truncated company name, exposure %). Fill color: target uses a radial gradient (`#splc-target-gradient`, defined once in `SupplyChainGraph`'s `<defs>`); suppliers/customers fill by exposure tier (`#00c853` high / `#ffb300` medium / `#3a4150` low); competitors render unfilled/dark with a dashed stroke to visually read as "peer, not a flow node." The target gets the `.splc-target-glow` CSS class (a two-layer amber `drop-shadow`). Selected nodes get a thicker stroke + an extra ring circle.
- **`GraphEdge.jsx`** — a quadratic Bézier `<path>` (not a straight line) between a counterparty and the target, bowed perpendicular to the direct line by `min(28, length * 0.08)` px, purely so overlapping edges stay visually separable. `direction: 'in'` (supplier → target) points the arrowhead at the target end; `direction: 'out'` (target → customer) points it at the customer end. Arrowheads are SVG `<marker>` defs (`#splc-arrow-supplier` amber, `#splc-arrow-customer` sky-blue), stroke width from `edgeWidthFor`. Competitors have **no edges** — they're peers, not a flow relationship.
- **`GraphTooltip.jsx`** — fixed-position `<div>` following the last hovered mouse coordinates (`clientX + 16, clientY + 16`). Content varies by category per the spec: suppliers show both "% of Supplier's Revenue from Target" and "% of Target's COGS Supplied"; customers show only "% of Target's Revenue from Customer"; competitors show just the relationship label.

### Pan / zoom / drag (`SupplyChainGraph.jsx`)

No graph library, so this is hand-rolled pointer-event math:

- **Container sizing** — a `ResizeObserver` on the container `<div>` tracks `containerSize`. On first successful measurement (or when the ticker changes), `fitTransform(containerSize)` computes a scale that fits the full 1200×820 canvas in the viewport (`min(w/1200, h/820) * 0.92`, clamped to `[0.35, 2.5]`) and centers it. This effect deliberately does **not** re-fire on every subsequent resize (only on the `width>0 && height>0` boolean flipping, or ticker change) — see the `eslint-disable` comment in the code — so an in-progress pan/zoom survives incidental layout shifts.
- **Coordinate model** — the `<svg>` has no `viewBox`, so its user-unit space is 1:1 with CSS pixels. A single `<g transform="translate(x,y) scale(s)">` wraps everything; `transform = { x, y, scale }` is the only state pan/zoom touches. Because there's no `viewBox` scaling, converting a mouse-movement delta in screen pixels into canvas-space movement is just `delta / scale`.
- **Panning** — `pointerdown` on the background (`handleBackgroundPointerDown`) records a `dragRef = { mode: 'pan', startClientX, startClientY, startPanX, startPanY }`. A single `window`-level `pointermove`/`pointerup` listener pair (attached once in a `useEffect` with `[]` deps) reads `dragRef.current` on every move and updates `transform.x/y` directly by the raw client-pixel delta (no scale division — panning moves the transform's own translation, which is already in screen-pixel terms).
- **Node dragging** — `pointerdown` on a node (`GraphNode`'s `onPointerDown` → `handleNodeDragStart`) calls `e.stopPropagation()` (so it doesn't also start a background pan) and records `dragRef = { mode: 'node', id, startClientX, startClientY, startX, startY, scale: transform.scale }`. The same global `pointermove` listener, on `mode === 'node'`, computes `dx = (clientX - startClientX) / drag.scale`, `dy = (clientY - startClientY) / drag.scale` and writes an **absolute** override into `positionOverrides[id] = { x: startX + dx, y: startY + dy }`. Overrides take precedence over the computed layout position for that node's id and persist across filter changes (but not ticker changes — cleared in the same effect that re-fits the view).
- **Zoom** — a *native* (non-React-synthetic) `wheel` listener is attached via `useEffect` with `{ passive: false }`, specifically so `e.preventDefault()` reliably stops page scroll (React's synthetic `onWheel` isn't guaranteed non-passive across browsers). Zoom is anchored to the cursor: `newScale = clamp(scale * (deltaY < 0 ? 1.12 : 1/1.12), 0.35, 2.5)`, then `x/y` are recomputed so the point currently under the cursor stays fixed on screen (`newX = cursorX - (cursorX - x) * (newScale/scale)`, same for `y`).
- **Zoom buttons / Fit** — bottom-right floating control (`+` / `−` / `Fit`) reuses the same cursor-anchored math, anchored to the container's own center instead of a cursor position; `Fit` calls `fitTransform` again and clears `positionOverrides`.
- **Background click** — clicking empty canvas (not a node — nodes call `stopPropagation()` on their own `onClick`) resets `selectedNodeId` to `'__target__'`, returning the Inspector to the target overview.

---

## Matrix table view

`MatrixTableView.jsx` — the "Structured Data Matrix Table" alternate view (`viewMode === 'matrix'`). Renders the same `filteredCounterparties` as the graph, as a plain sortable `<table>` (not `@tanstack/react-table` — row counts here are small (~15–20), and the rest of the app's dense tables, e.g. `ScannerTable.jsx`, use plain HTML tables too).

Columns: Ticker, Company, Type (category chip), Relationship, Exposure (badge), Est. Annual $M, Mkt Cap $B, 1Y Perf, Risk. Clicking a column header toggles sort (`{ key, direction }` state); clicking a row sets `selectedNodeId`, keeping the Inspector panel in sync regardless of which view is active.

---

## Inspector panel

`InspectorPanel.jsx` — right sidebar, always visible, driven entirely by `selectedNode` from context.

- **No selection / no dataset** — placeholder text.
- **`selectedNode.category === 'target'`** — renders `TargetOverview`: the target's own Market Cap/Sector/1Y Performance, plus aggregate stats computed from `allCounterparties` (supplier/customer/competitor counts, total estimated annual flow, count of `riskScore === 'High'` dependencies).
- **Any counterparty** — Company Name & Ticker header, Relationship Type, a "Quantified Dependency" section (% exposure, COGS-supplied % for suppliers, estimated annual $ value, data source), and a "Key Financial Summary" section (Market Cap, Sector, 1Y Performance, Risk badge). Competitors skip the Quantified Dependency section (no flow relationship) and show only their data source under "Peer Comparison."

---

## Top control bar

`TopControlBar.jsx` — everything in spec section 2B, in one row:

- **Ticker search** — free-text input with a filtered dropdown (prefix match against `supportedTickers`), `Enter` commits the first suggestion, `Escape` closes it. Below it, marquee quick-select chips for all 5 supported tickers (spec explicitly asked for pre-loaded marquee stocks to be one click away).
- **Exposure threshold slider** — native `<input type="range">`, 0–60, with a live `%` readout and a "Reset" link that appears once the value diverges from the default (5%).
- **Category toggles** — three checkboxes (Suppliers/Customers/Competitors), each calling `toggleCategory(key)`.
- **View toggle** — segmented Graph/Matrix control.
- **Export CSV** — disabled until a dataset is loaded; calls `exportCounterpartiesToCsv`.

---

## CSV export

`exportCsv.js` — pure client-side, no backend round-trip (the filtered dataset is already fully in memory). Builds a CSV string (`Ticker, Company, Category, Relationship, Revenue Exposure %, COGS Exposure %, Est. Annual $M, Market Cap $B, 1Y Performance %, Risk Score, Data Source`) from the current `filteredCounterparties`, with standard CSV field escaping (`"` doubling, quoting on comma/quote/newline), and triggers a browser download via a `Blob` + temporary `<a download>` element. Filename: `{TICKER}_supply_chain_map.csv`.

---

## Styling & theming

`styles/supplyChain.css` — Tailwind v4, **scoped to this page only**, following the exact pattern established by `styles/commandCenter.css` for `OptionsCommandCenterPage`:

```css
@import 'tailwindcss/theme.css';
@import 'tailwindcss/utilities.css';
```

Deliberately **excludes Tailwind's preflight** (base reset) — preflight rewrites default element styling globally and would visibly break every other MUI-based page in the app the moment it loaded, since MUI ships its own baseline via `CssBaseline`. Only `SupplyChainAnalysisPage.jsx` imports this stylesheet, so Tailwind utility classes exist there and nowhere else. `vite.config.js`'s `tailwindcss()` plugin only processes files that import a Tailwind stylesheet, so this has zero effect on the rest of the app's build.

### Theme tokens (`@theme` block)

| Token | Value | Usage |
|---|---|---|
| `--color-splc-bg` | `#0f1218` | Page/canvas background |
| `--color-splc-panel` | `#12151c` | Control bar, table background |
| `--color-splc-panel-raised` | `#171b24` | Cards, dropdowns, tooltip background |
| `--color-splc-border` | `#2a2f3a` | Dividers, table/panel borders |
| `--color-splc-amber` | `#ff9900` | Primary accent, suppliers, active selections |
| `--color-splc-orange` | `#ff5500` | Target node accent, export button |
| `--color-splc-text` | `#e1e4ea` | Primary data text |
| `--color-splc-muted` | `#6c727f` | Secondary labels |
| `--color-splc-high` / `-medium` / `-low` | `#00c853` / `#ffb300` / `#8a93a3` | Exposure-tier badges & node fills |
| `--color-splc-risk-high` / `-medium` / `-low` | `#ff3d57` / `#ffb300` / `#00c853` | Disruption risk badges |
| `--font-splc-mono` | JetBrains Mono → Roboto Mono → Fira Code → system mono | All financial/ticker data |
| `--font-splc-sans` | Inter → system sans | Node company-name labels, section headers |

No web font is loaded for JetBrains Mono/Inter — the stack falls back to whichever of those (or a system equivalent) is already installed, then to generic monospace/sans-serif, to avoid adding a network font dependency for this feature.

Two hand-written CSS classes supplement the Tailwind utilities: `.splc-target-glow` (two-layer amber `drop-shadow` on the target node) and `.splc-scrollbar` (styled WebKit scrollbar for the Inspector panel and matrix table).

---

## Filtering logic

Lives entirely in `SupplyChainContext.jsx`'s `filteredCounterparties` memo, so the graph, matrix table, and CSV export can never disagree:

```js
allCounterparties.filter((entry) => {
  if (!categoryVisibility[entry.category]) return false;
  if (entry.category === 'competitors') return true;   // no exposure % to threshold against
  const exposure = entry.revenueExposurePct ?? entry.cogsExposurePct ?? 0;
  return exposure >= exposureThreshold;
});
```

Competitors are filtered only by their category checkbox — they carry no exposure percentage, so the threshold slider never hides/shows them.

---

## Known limitations

- **Mock data only** — 5 tickers, hardcoded. See [Backend integration path](#backend-integration-path).
- **Not yet manually browser-tested** — built and verified via production build (`vite build` succeeds), ESLint (clean), and a standalone Node script confirming `computeGraphLayout` produces finite positions for all 5 datasets. Interactive behavior (pan/zoom-toward-cursor feel, node-drag smoothness, tooltip positioning near viewport edges) has not been eyeballed in an actual browser — worth a manual pass via `npm run dev`.
- **No physics/force simulation** — layout is deterministic (arcs/rows), per spec's structured-layout requirement; nodes don't repel/collide, so a very large counterparty count (well beyond the ~5–10 per category in the mock data) could visually crowd a column.
- **CSV export only** — spec's "data export button" is implemented as CSV; no PDF/PNG snapshot export.
- **No route in `docs/LIVE_APP_GUIDE.md`** — that user-facing guide is screenshot-driven and doesn't yet cover several other recent pages (Options Analytics, Command Center) either; adding this page there would need actual screenshots.

---

## Running / testing locally

```bash
cd frontend
npm install       # first time only
npm run dev        # http://localhost:5173/supply-chain
npm run build       # production build sanity check
npm run lint         # eslint
```

No backend/database dependency for this page — it works fully offline against the mock dataset.
