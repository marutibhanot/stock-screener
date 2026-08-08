import apiClient from './client';
import { SUPPLY_CHAIN_DATASETS, MARQUEE_TICKERS } from '../data/mockSupplyChainData';

// Flip this to `false` (or delete the mock branch entirely) once a real
// backend endpoint exists. Nothing else in the SPLC dashboard needs to
// change -- every component calls `getSupplyChainMap()` below, never the
// mock dataset directly.
const USE_MOCK_DATA = true;

// Simulated network latency so loading states (skeletons/spinners) are
// exercised the same way they will be against a real endpoint.
const MOCK_LATENCY_MS = 220;

/**
 * Fetch the supply-chain relationship map for a ticker.
 *
 * Real backend wiring: implement `GET /v1/supply-chain/{ticker}` on the
 * FastAPI side (see backend/app/api/v1/ for the existing router pattern --
 * e.g. options.py or gex.py) returning the exact shape produced here:
 *
 *   {
 *     ticker, name, sector, marketCapUsdB, oneYearPerformancePct,
 *     suppliers: [{ id, ticker, name, relationshipType, revenueExposurePct,
 *                    cogsExposurePct, annualValueUsdM, dataSource,
 *                    marketCapUsdB, sector, oneYearPerformancePct, riskScore }],
 *     customers: [{ ...same shape, revenueExposurePct only, no cogsExposurePct }],
 *     competitors: [{ ...same shape, no exposure/annualValue fields }],
 *   }
 *
 * Suggested backend data sources for that endpoint (see
 * src/data/mockSupplyChainData.js's header comment for more detail):
 *   - SEC EDGAR full-text search + 10-K Item 1/1A parsing for customer
 *     concentration disclosures (https://www.sec.gov/edgar).
 *   - Financial Modeling Prep's company-notes / revenue-segmentation
 *     endpoints for supplier/customer graphs.
 *   - A dedicated supply-chain data vendor (FactSet Revere, Sentieo) for
 *     dollar-value estimates and disruption risk scoring.
 *
 * Once that endpoint exists, replace the body of this function with:
 *
 *   const response = await apiClient.get(`/v1/supply-chain/${encodeURIComponent(ticker)}`);
 *   return response.data;
 *
 * and set USE_MOCK_DATA = false above (or delete it).
 */
export async function getSupplyChainMap(ticker) {
  const normalized = String(ticker || '').toUpperCase().trim();

  if (USE_MOCK_DATA) {
    await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
    const dataset = SUPPLY_CHAIN_DATASETS[normalized];
    if (!dataset) {
      throw new Error(`No supply-chain data available for "${normalized}". Try one of: ${MARQUEE_TICKERS.join(', ')}`);
    }
    return dataset;
  }

  // Live path -- see the doc comment above for the expected response shape.
  const response = await apiClient.get(`/v1/supply-chain/${encodeURIComponent(normalized)}`);
  return response.data;
}

/** Tickers with pre-loaded data, for the search bar's autocomplete list. In
 * the live-backend future, this can instead call a lightweight
 * `/v1/supply-chain/coverage` endpoint or simply the existing ticker-search
 * endpoint used elsewhere in the app (src/api -- see TickerSearch component). */
export function getSupportedTickers() {
  return MARQUEE_TICKERS;
}
