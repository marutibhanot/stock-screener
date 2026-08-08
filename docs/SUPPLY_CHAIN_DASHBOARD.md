# Supply Chain Analysis (SPLC) Dashboard

A Bloomberg-terminal-style dashboard mapping a target company's suppliers, customers, and competitors, with quantified revenue/COGS exposure per relationship. Lives at **`/supply-chain`** (nav label "Supply Chain").

Backed by a real endpoint, `GET /v1/splc?ticker={SYMBOL}&minExposure={PERCENTAGE}` (`backend/app/api/v1/splc.py`), which currently serves an **in-memory mock dataset** for five tickers (`AAPL`, `NVDA`, `TSLA`, `MSFT`, `AMD`) — see [Backend Integration Path](#backend-integration-path) for how to swap that dataset for a real data source without touching the router, the frontend adapter, or any rendering component.

---

## Contents

- [Route & navigation](#route--navigation)
- [File map](#file-map)
- [Data flow](#data-flow)
- [Data model](#data-model)
- [State management — `SupplyChainContext`](#state-management--supplychaincontext)
- [API layer — `api/supplyChain.js`](#api-layer--apisupplychainjs)
- [Backend integration path](#backend-integration-path)
- [Loading, error & empty states](#loading-error--empty-states)
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
backend/app/api/v1/
├── splc.py                             # GET /v1/splc?ticker&minExposure -- the live endpoint
└── splc_mock_data.py                   # In-memory mock dataset (contract field names), swap point for real sourcing

frontend/src/
├── pages/
│   └── SupplyChainAnalysisPage.jsx     # Route entry point, layout shell, terminal-style loading/error/notice states
├── contexts/
│   └── SupplyChainContext.jsx          # All cross-component state (ticker, filters, selection, view mode)
├── api/
│   └── supplyChain.js                  # Data-access layer -- calls GET /v1/splc, adapts contract shape -> internal shape
├── data/
│   └── mockSupplyChainData.js          # Offline-dev fallback dataset (USE_MOCK_DATA=true path) + exposure-tier logic
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

16 new files (14 frontend, 2 backend), 4 edited (`App.jsx`, `Layout.jsx`, `router.py`, plus the new page importing the new CSS). No new npm or pip dependencies.

---

## Data flow

```text
SupplyChainAnalysisPage
  └─ SupplyChainProvider (React Context, wraps the whole page)
       │
       │  useQuery(['supplyChainMap', ticker], () => getSupplyChainMap(ticker))
       ▼
     api/supplyChain.js ──(USE_MOCK_DATA=true, offline dev)──► data/mockSupplyChainData.js
       │                  ──(USE_MOCK_DATA=false, default)───► GET /v1/splc?ticker={SYMBOL}
       │                                                          (backend/app/api/v1/splc.py
       │                                                           → splc_mock_data.py today)
       ▼
     transformSplcResponse() adapts the wire contract (symbol, marketCap,
     revenueExposurePercent, estimatedValueUSD, disclosureSource, ...) onto
     the internal shape below
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

Two shapes exist, deliberately kept distinct at the API boundary (`api/supplyChain.js`'s `transformSplcResponse`/`transformCounterparty`):

- **Wire contract** — what `GET /v1/splc` actually returns: `{ target: TargetCompany, suppliers: SupplierNode[], customers: CustomerNode[], competitors: CompetitorNode[] }`, using `symbol`/`marketCap` (raw USD)/`revenueExposurePercent`/`cogsExposurePercent`/`estimatedValueUSD` (raw USD)/`disclosureSource`/`overlapSector` (competitors only) field names. See `backend/app/api/v1/splc_mock_data.py` for the exact per-record shape.
- **Internal shape** — what every component (`GraphNode`, `MatrixTableView`, `InspectorPanel`, ...) actually reads, below. The adapter divides `marketCap`/`estimatedValueUSD` by 1e9/1e6 into the `...UsdB`/`...UsdM` units the UI displays.

Each ticker's internal dataset (also the exact shape of `SUPPLY_CHAIN_DATASETS[ticker]` in `mockSupplyChainData.js`, used verbatim on the `USE_MOCK_DATA=true` offline path):

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
EXPOSURE_TIERS = { HIGH: 15, MEDIUM: 5 }  // >15% high, 5-15% medium, <5% low

exposureTierFor(pct) → 'high' | 'medium' | 'low' | 'unknown'
```

Colors: high `#00c853` (green), medium `#ff9900` (amber — same token as the brand accent), low `#6c727f` (muted gray — same token as secondary label text). These exact thresholds/hex values come from the dashboard's "Dynamic Line Colors" spec and are mirrored in three places that can't share a single source at runtime: `styles/supplyChain.css`'s `--color-splc-high/-medium/-low` tokens (matrix badges, notice banners), `GraphNode.jsx`'s `TIER_FILL` (node fill — SVG can't read CSS custom properties the way Tailwind classes can), and `GraphEdge.jsx`'s `TIER_COLOR` (edge/arrowhead color). Retuning `EXPOSURE_TIERS` alone is enough to change *which* tier something falls into everywhere; changing the actual colors means updating all three constants together.

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
const USE_MOCK_DATA = false;       // true = offline dev against mockSupplyChainData.js
const MOCK_LATENCY_MS = 220;       // simulated network latency on the mock path

class SplcTickerNotFoundError extends Error { ... }  // thrown on HTTP 404, distinguished from network errors

function transformCounterparty(node) { ... }  // wire contract -> internal shape, per counterparty
function transformSplcResponse(apiResponse) { ... }  // wire contract -> internal shape, whole response

async function getSupplyChainMap(ticker) { ... }   // -> internal dataset shape (data model section)
function getSupportedTickers() { ... }              // -> string[]
```

`getSupplyChainMap` is the **only** function every component talks to. On the live path (`USE_MOCK_DATA = false`, the default) it calls `apiClient.get('/v1/splc', { params: { ticker } })` and runs the response through `transformSplcResponse`; a `404` is caught and re-thrown as `SplcTickerNotFoundError` so `SupplyChainAnalysisPage.jsx` can tell "ticker not covered" apart from "network/server failure" (`error instanceof SplcTickerNotFoundError`) and show the right terminal-style message for each. On the mock path it awaits a fake delay and returns straight from `SUPPLY_CHAIN_DATASETS` (already in the internal shape, no transform needed), throwing the same `SplcTickerNotFoundError` for unsupported tickers so both paths behave identically from the caller's perspective.

`minExposure` is deliberately **not** sent from this call — see [Filtering logic](#filtering-logic) for why the dashboard always fetches the full map and filters client-side.

---

## Backend integration path

`GET /v1/splc` exists today (`backend/app/api/v1/splc.py`), backed by an in-memory mock dataset (`splc_mock_data.py`). To point it at a real data source:

1. Rewrite `get_splc_dataset(symbol)` and `supported_symbols()` in `backend/app/api/v1/splc_mock_data.py` to actually fetch/compute a result matching the same per-record shape (see that file's module docstring and the [data model](#data-model)'s "wire contract" description) instead of looking up `SPLC_DATASETS`. Nothing in `splc.py` (the router), `api/supplyChain.js` (the frontend adapter), or any rendering component needs to change as long as the shape matches.
2. Suggested data sources:
   - **SEC EDGAR** full-text search + 10-K Item 1 / Item 1A parsing for customer-concentration disclosures (`"one customer accounted for X% of net sales"`).
   - **Financial Modeling Prep** company-notes / revenue-segmentation endpoints for supplier/customer graphs.
   - A dedicated supply-chain vendor (FactSet Revere, Sentieo, or Bloomberg SPLC itself) for dollar-value estimates and disruption-risk scoring.
   - 8-K / investor-day disclosures for one-off dollar-value estimates.
3. Drop the 5-ticker limit: once `get_splc_dataset`/`supported_symbols` cover an open-ended universe, replace `getSupportedTickers()` in `frontend/src/api/supplyChain.js` (currently hardcoded to the 5 mock tickers) with a real coverage/search call — see the existing `TickerSearch` component for a pattern already used elsewhere in the app.
4. `frontend/src/data/mockSupplyChainData.js` and `USE_MOCK_DATA` can stay indefinitely as an offline-dev fallback (flip it to `true` to work on the frontend without the backend running) — there's no need to delete it once real sourcing lands.

### Auth

`_include("splc", prefix="/splc", tags=["splc"])` in `router.py` doesn't pass `protected=False`, so it inherits the default `protected=True` — `GET /v1/splc` requires an authenticated server session when `SERVER_AUTH_ENABLED` is on, same as `cache`/`fundamentals`/`operations` and every other non-public router. (Some sibling options routers — `max_pain`/`gex`/`options`/`options-command-center` — currently override this to `protected=False`; that's an existing, separately-tracked state on those routers, not a pattern to copy here.)

---

## Loading, error & empty states

`SupplyChainAnalysisPage.jsx` renders one of four states in the main content area, matching the backend-integration spec's terminal-styled status text:

| Condition | UI |
|---|---|
| `isLoading` | `[FETCHING SPLC DATA FOR {TICKER}... BUILDING NETWORK GRAPH]` in amber |
| `isError && error instanceof SplcTickerNotFoundError` | `[ERROR: TICKER NOT FOUND IN SEC / SPLC DATABASE]` in red — no retry button, since retrying the same ticker just 404s again |
| `isError` (any other error) | `[ERROR: NETWORK FAILURE FETCHING SPLC DATA]` in red, plus a **Retry** button calling `refetch()` (exposed by `SupplyChainContext` straight from React Query) |
| Loaded, but `dataset.suppliers.length === 0 && dataset.customers.length === 0` | A non-blocking amber notice banner above the graph/table: `[NOTICE: No >10% revenue/supplier dependencies reported under SEC S-K disclosures]`. The dashboard still renders (target + competitors, if any) — this doesn't replace the whole view like the other three states. |

None of the 5 mock tickers currently trigger the empty-disclosure notice (all have at least a few suppliers/customers); it's there for whatever ticker coverage expands to later.

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

- **`GraphNode.jsx`** — an SVG `<g>` with a `<circle>` + two/three `<text>` labels (ticker, truncated company name, exposure %). Fill color: target uses a radial gradient (`#splc-target-gradient`, defined once in `SupplyChainGraph`'s `<defs>`); suppliers/customers fill by exposure tier (`#00c853` high / `#ff9900` medium / `#6c727f` low — see [Exposure tiering](#exposure-tiering)); competitors render unfilled/dark with a dashed stroke to visually read as "peer, not a flow node." Stroke (ring) color is still category-based (`suppliers`/`target` amber, `customers` sky-blue, `competitors` muted) — position/direction already says which side of the graph a node is on, so the stroke ring is free to carry that redundant category signal while the fill communicates exposure magnitude. The target gets the `.splc-target-glow` CSS class (a two-layer amber `drop-shadow`). Selected nodes get a thicker stroke + an extra ring circle.
- **`GraphEdge.jsx`** — a quadratic Bézier `<path>` (not a straight line) between a counterparty and the target, bowed perpendicular to the direct line by `min(28, length * 0.08)` px, purely so overlapping edges stay visually separable. `direction: 'in'` (supplier → target) points the arrowhead at the target end; `direction: 'out'` (target → customer) points it at the customer end. Line/arrowhead **color is exposure-tier-based**, not category-based (`#splc-arrow-high`/`-medium`/`-low` marker defs in `SupplyChainGraph.jsx`, matching `TIER_COLOR` — the same green/amber/gray scale as node fill) — direction and node position already distinguish supplier vs. customer, so color is free to carry the exposure-magnitude signal per the "Dynamic Line Colors" spec. Stroke width still comes from `edgeWidthFor`. Competitors have **no edges** — they're peers, not a flow relationship.
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
| `--color-splc-high` / `-medium` / `-low` | `#00c853` / `#ff9900` / `#6c727f` | Exposure-tier badges, node fills, edge/arrowhead colors (see [Exposure tiering](#exposure-tiering)) |
| `--color-splc-risk-high` / `-medium` / `-low` | `#ff3d57` / `#ffb300` / `#00c853` | Disruption risk badges — a separate Low/Medium/High scale from exposure tiering, unaffected by the exposure-color spec |
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

The backend also accepts `minExposure` on `GET /v1/splc` and applies the same `>=` filter to suppliers/customers server-side (for non-SPA API consumers), but the dashboard itself never sends it — it always fetches the full map (`minExposure` omitted → server default `0`) and does the above filtering client-side, so dragging the slider is instant with no network round-trip. See `_exposure_of()` in `backend/app/api/v1/splc.py` for the server-side equivalent.

---

## Known limitations

- **Mock data, now served over HTTP** — `GET /v1/splc` is a real endpoint, but `splc_mock_data.py` still hardcodes the same 5 tickers as before. See [Backend integration path](#backend-integration-path).
- **Not yet manually browser-tested** — built and verified via production build (`vite build` succeeds), ESLint (clean), backend `py_compile` + a standalone script exercising `get_splc_dataset`/case-insensitive lookup/unknown-ticker `None`, and a Node script confirming `computeGraphLayout` produces finite positions for all 5 datasets. Interactive behavior (pan/zoom-toward-cursor feel, node-drag smoothness, tooltip positioning, the terminal-style loading/error states, actual round-trip through a running FastAPI server) has not been eyeballed in an actual browser — worth a manual pass via `npm run dev` + a running backend.
- **No physics/force simulation** — layout is deterministic (arcs/rows), per spec's structured-layout requirement; nodes don't repel/collide, so a very large counterparty count (well beyond the ~5–10 per category in the mock data) could visually crowd a column.
- **CSV export only** — spec's "data export button" is implemented as CSV; no PDF/PNG snapshot export.
- **No route in `docs/LIVE_APP_GUIDE.md`** — that user-facing guide is screenshot-driven and doesn't yet cover several other recent pages (Options Analytics, Command Center) either; adding this page there would need actual screenshots.

---

## Running / testing locally

Frontend only (mock path):

```bash
cd frontend
npm install                       # first time only
# set USE_MOCK_DATA = true in src/api/supplyChain.js first
npm run dev                        # http://localhost:5173/supply-chain
```

Full stack (live `/v1/splc` path, the default):

```bash
cd backend && uvicorn app.main:app --reload   # or however this repo's backend is normally started
cd frontend && npm run dev                     # http://localhost:5173/supply-chain
```

```bash
npm run build       # production build sanity check
npm run lint         # eslint
```

With `USE_MOCK_DATA = false` (the default), this page needs the backend running and, if `SERVER_AUTH_ENABLED` is set, an authenticated session (see [Auth](#auth)).
