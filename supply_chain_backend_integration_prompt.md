# CLAUDE.md - Bloomberg SPLC Dashboard Project Instructions

This document provides guidelines, system prompts, architecture patterns, and technical requirements for building and maintaining the **Bloomberg Terminal SPLC (Supply Chain Analysis)** dashboard component and its live backend integration.

---

## 1. Project Overview & Aesthetic Guidelines

The goal is to build an institutional-grade, web-based supply chain mapping tool modeled after Bloomberg Terminal's `SPLC` function.

### Visual & Theme System
* **Theme:** Dark Terminal Aesthetic.
* **Colors:**
  * Background: Deep Charcoal / Black (`#0F1218`, `#12151C`)
  * Core Accents: Bloomberg Amber (`#FF9900`), Bright Orange (`#FF5500`)
  * Data Text: Off-White / Light Gray (`#E1E4EA`)
  * Secondary Labels: Muted Gray (`#6C727F`)
  * Connection / Risk Indicators:
    * High Exposure (>15%): Bright Green (`#00C853`)
    * Medium Exposure (5%–15%): Amber (`#FF9900`)
    * Low / Minimal Exposure (<5%): Muted Gray (`#6C727F`)
* **Typography:** Monospace fonts for financial data tables, numeric metrics, and terminal labels (`JetBrains Mono`, `Roboto Mono`, `Fira Code`). Clean sans-serif for node titles.

---

## 2. Core System Prompt: Frontend UI & Interactive Dashboard

Use this system prompt when designing or implementing the frontend interactive dashboard interface:

```text
You are an expert Frontend Engineer and Financial UI/UX Designer specializing in institutional financial software. 

Your goal is to build a high-performance, dark-themed, web-based dashboard that mimics the iconic "SPLC" (Supply Chain Analysis) function on a Bloomberg Terminal.

### 1. Visual & UI Theme
- Color Palette: Dark terminal aesthetic (Deep Charcoal `#0F1218`, Bloomberg Amber `#FF9900`, Bright Orange `#FF5500`).
- Typography: Monospace fonts for financial data tables (JetBrains Mono, Roboto Mono).
- Layout:
  - Top Nav Bar: Ticker search input, exposure threshold slider, view mode toggles (Graph vs Matrix Table), export button.
  - Main Canvas (Center): Interactive directed network graph.
  - Right Sidebar (Data Inspector): Detailed company breakdown, exposure metrics, historical supply-chain trends, source filings.

### 2. Core Functional Requirements
- Target Node (Center): Selected stock (e.g., AAPL) highlighted with Amber glow.
- Upstream / Suppliers (Left Column/Arc): Entities supplying components/services. Arrows point FROM Supplier TO Target.
- Downstream / Customers (Right Column/Arc): Entities purchasing goods/services. Arrows point FROM Target TO Customer.
- Competitors / Peers (Top/Bottom Row): Direct competitors in same primary sector.
- Interactive Controls: Search bar, min-exposure filter slider (0%-30%), category toggles, view switcher.
- Side Inspector Panel: Updates dynamically on node click (Market Cap, Revenue Exposure %, COGS %, Dollar Value, Source SEC Filing).

### 3. Pre-Populated Mock Data (Fallback)
Include realistic mock data for marquee tickers (AAPL, NVDA, TSLA) featuring suppliers (TSM, QCOM, SWKS, SONY, Foxconn), customers (BBY, AMZN, Carriers), and competitors (SSNLF, MSFT, GOOGL).

### 4. Technical Stack
React / Next.js, Tailwind CSS, react-flow / d3.js / @visx/network for graph rendering.
```

---

## 3. Core System Prompt: Live Backend API Integration

Use this system prompt when connecting the dashboard component to live backend services or REST/GraphQL APIs:

```text
You are an expert Full-Stack Software Engineer specializing in financial UI components and network graph visualizations.

Your task is to refactor the existing Bloomberg SPLC (Supply Chain Analysis) Terminal dashboard component to replace static mock datasets with a live, production-grade backend API integration.

### 1. API Contract & TypeScript Interfaces

Connect to endpoint: GET /api/v1/splc?ticker={SYMBOL}&minExposure={PERCENTAGE}

```typescript
interface TargetCompany {
  symbol: string;
  name: string;
  marketCap: number;
  sector: string;
  industry: string;
}

interface SupplierNode {
  symbol: string;
  name: string;
  cogsExposurePercent: number;
  revenueExposurePercent: number;
  relationshipType: string;
  estimatedValueUSD: number;
  disclosureSource: string;
}

interface CustomerNode {
  symbol: string;
  name: string;
  revenueExposurePercent: number;
  estimatedValueUSD: number;
  disclosureSource: string;
}

interface CompetitorNode {
  symbol: string;
  name: string;
  marketCap: number;
  overlapSector: string;
}

interface SPLCApiResponse {
  target: TargetCompany;
  suppliers: SupplierNode[];
  customers: CustomerNode[];
  competitors: CompetitorNode[];
}
```

### 2. Data Fetching, Lifecycle & Error Handling
- Data Fetcher Service: Abstract API logic into /services/splcApi.ts.
- Caching: Use @tanstack/react-query or swr cached by ticker and minExposure (`queryKey: ['splc', ticker, minExposure]`).
- Debouncing: Debounce ticker search and exposure slider adjustments by 300ms.
- Loading State: Display terminal green/amber status overlay during fetching: [FETCHING SPLC DATA FOR {TICKER}... BUILDING NETWORK GRAPH].
- Error & Edge Cases:
  - 404 / Invalid Ticker: Display [ERROR: TICKER NOT FOUND IN SEC / SPLC DATABASE].
  - No Disclosure Data: If suppliers/customers are empty, display banner: [NOTICE: No >10% revenue/supplier dependencies reported under SEC S-K disclosures].
  - Network Failure: Provide terminal-styled retry action.

### 3. Graph Calculation & Visual Mapping
- Radial/Column Placement: Target at (0,0), Suppliers on Left Arc/Column (X < 0), Customers on Right Arc/Column (X > 0), Competitors Top/Bottom (Y != 0).
- Visual Scaling: Node diameter proportional to marketCap; connection stroke thickness & opacity proportional to revenueExposurePercent / cogsExposurePercent.
- Dynamic Line Colors: Green (#00C853) >15%, Amber (#FF9900) 5%-15%, Gray (#6C727F) <5%.

### 4. Component Refactoring Checklist
1. Replace static constants with useSPLCData(ticker, minExposure) hook.
2. Wire up Inspector Drawer to real response fields.
3. Maintain Bloomberg dark terminal styling and monospace font consistency.
```

---

## 4. Development & Code Conventions

* **State Management:** Keep graph layout state synchronized with search/filter state.
* **Performance:** Ensure layout calculations avoid recalculating physics layouts unnecessarily; memoize node positioning algorithms.
* **Component Structure:**
  * `/components/SPLC/SPLCDashboard.tsx` - Root layout & search controls
  * `/components/SPLC/SPLCGraph.tsx` - Network canvas & rendering engine
  * `/components/SPLC/SPLCInspector.tsx` - Side drawer metrics panel
  * `/components/SPLC/SPLCTable.tsx` - Matrix tabular fallback view
  * `/services/splcApi.ts` - API client & transform adapters
  * `/types/splc.ts` - TypeScript interfaces
