import apiClient from './client';
import { SUPPLY_CHAIN_DATASETS, MARQUEE_TICKERS } from '../data/mockSupplyChainData';

// The live GET /v1/splc endpoint (backend/app/api/v1/splc.py) now backs this
// page by default. Flip back to `true` for offline frontend work against
// src/data/mockSupplyChainData.js without a backend running -- every
// component still only ever calls getSupplyChainMap()/getSupportedTickers()
// below, so flipping this is the only change either path needs.
const USE_MOCK_DATA = false;

// Simulated network latency on the mock path so loading states are
// exercised the same way they are against the real endpoint.
const MOCK_LATENCY_MS = 220;

/** Thrown when the backend has no coverage for a ticker (HTTP 404) --
 * distinguished from a generic network/server error so the page can show
 * "[ERROR: TICKER NOT FOUND IN SEC / SPLC DATABASE]" instead of a retry
 * prompt (retrying a 404 for the same ticker will just 404 again). */
export class SplcTickerNotFoundError extends Error {
  constructor(ticker) {
    super(`No SPLC data for "${ticker}"`);
    this.name = 'SplcTickerNotFoundError';
    this.ticker = ticker;
  }
}

/** Maps one SupplierNode/CustomerNode/CompetitorNode (the wire contract --
 * `symbol`, `marketCap` in raw USD, `revenueExposurePercent`, etc.) onto the
 * shape every SupplyChain component already renders (`ticker`,
 * `marketCapUsdB`, `revenueExposurePct`, ...). Keeping this adapter at the
 * API boundary means the contract can evolve independently of the
 * components, and the mock-data path (already in the app's internal shape)
 * never needs to run through it. */
function transformCounterparty(node) {
  return {
    id: node.symbol,
    ticker: node.symbol,
    name: node.name,
    relationshipType: node.relationshipType,
    revenueExposurePct: node.revenueExposurePercent ?? null,
    cogsExposurePct: node.cogsExposurePercent ?? null,
    annualValueUsdM: node.estimatedValueUSD != null ? node.estimatedValueUSD / 1_000_000 : null,
    dataSource: node.disclosureSource ?? null,
    marketCapUsdB: node.marketCap != null ? node.marketCap / 1_000_000_000 : null,
    // CompetitorNode carries `overlapSector` instead of `sector` per the contract.
    sector: node.sector ?? node.overlapSector ?? null,
    oneYearPerformancePct: node.oneYearPerformancePct ?? null,
    riskScore: node.riskScore ?? null,
  };
}

function transformSplcResponse(apiResponse) {
  const { target, suppliers = [], customers = [], competitors = [] } = apiResponse;
  return {
    ticker: target.symbol,
    name: target.name,
    sector: target.sector,
    marketCapUsdB: target.marketCap != null ? target.marketCap / 1_000_000_000 : null,
    oneYearPerformancePct: target.oneYearPerformancePct ?? null,
    suppliers: suppliers.map(transformCounterparty),
    customers: customers.map(transformCounterparty),
    competitors: competitors.map(transformCounterparty),
  };
}

/**
 * Fetch the supply-chain relationship map for a ticker from
 * `GET /v1/splc?ticker={SYMBOL}` (backend/app/api/v1/splc.py), currently
 * backed by an in-memory mock dataset covering AAPL/NVDA/TSLA/MSFT/AMD --
 * see that router's docstring for how to point it at a real data source
 * (SEC EDGAR / Financial Modeling Prep / a supply-chain vendor) without any
 * frontend changes.
 *
 * `minExposure` is intentionally NOT sent here -- the dashboard fetches the
 * full unfiltered map once per ticker and filters client-side
 * (SupplyChainContext.jsx's filteredCounterparties), so dragging the
 * exposure slider is instant with zero network round-trips. The backend
 * still accepts and honors `minExposure` for other API consumers.
 */
export async function getSupplyChainMap(ticker) {
  const normalized = String(ticker || '').toUpperCase().trim();

  if (USE_MOCK_DATA) {
    await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
    const dataset = SUPPLY_CHAIN_DATASETS[normalized];
    if (!dataset) {
      throw new SplcTickerNotFoundError(normalized);
    }
    return dataset;
  }

  try {
    const response = await apiClient.get('/v1/splc', { params: { ticker: normalized } });
    return transformSplcResponse(response.data);
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new SplcTickerNotFoundError(normalized);
    }
    throw err;
  }
}

/** Tickers with pre-loaded data, for the search bar's autocomplete list.
 * Hardcoded rather than fetched from the backend since the mock dataset
 * only covers these 5 -- once a live data source covers an open-ended
 * ticker universe, replace this with a real coverage/search endpoint (see
 * the existing TickerSearch component's API for a pattern already used
 * elsewhere in the app). */
export function getSupportedTickers() {
  return MARQUEE_TICKERS;
}
