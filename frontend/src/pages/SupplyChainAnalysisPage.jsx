// Tailwind is scoped to this page only -- see src/styles/supplyChain.css
// (and commandCenter.css's header comment) for why preflight is deliberately
// excluded so it can't leak into the MUI-based pages elsewhere in the app.
import '../styles/supplyChain.css';

import { SupplyChainProvider, useSupplyChain } from '../contexts/SupplyChainContext';
import { SplcTickerNotFoundError } from '../api/supplyChain';
import TopControlBar from '../components/SupplyChain/TopControlBar';
import SupplyChainGraph from '../components/SupplyChain/SupplyChainGraph';
import MatrixTableView from '../components/SupplyChain/MatrixTableView';
import InspectorPanel from '../components/SupplyChain/InspectorPanel';

/**
 * Supply Chain Analysis (SPLC) -- a Bloomberg-terminal-style dashboard
 * mapping a target company's suppliers, customers, and competitors, with
 * quantified revenue/COGS exposure for each relationship.
 *
 * Backed by GET /v1/splc (backend/app/api/v1/splc.py), currently serving an
 * in-memory mock dataset -- see src/api/supplyChain.js's header comment for
 * exactly how that endpoint swaps in a live data source (SEC EDGAR /
 * Financial Modeling Prep / a dedicated supply-chain data vendor) without
 * touching any component below this one.
 */
export default function SupplyChainAnalysisPage() {
  return (
    <SupplyChainProvider initialTicker="AAPL">
      <SupplyChainPageContent />
    </SupplyChainProvider>
  );
}

function SupplyChainPageContent() {
  const { selectedTicker, dataset, isLoading, isError, error, refetch, viewMode } = useSupplyChain();
  const noDisclosureData = dataset && dataset.suppliers.length === 0 && dataset.customers.length === 0;

  return (
    <div className="flex h-[calc(100vh-48px)] w-full flex-col bg-splc-bg font-splc-sans text-splc-text">
      <TopControlBar />

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col border-r border-splc-border">
          {isLoading && (
            <div className="flex h-full items-center justify-center font-splc-mono text-sm text-splc-amber">
              [FETCHING SPLC DATA FOR {selectedTicker}&hellip; BUILDING NETWORK GRAPH]
            </div>
          )}

          {isError && error instanceof SplcTickerNotFoundError && (
            <div className="flex h-full items-center justify-center px-8 text-center font-splc-mono text-sm text-splc-risk-high">
              [ERROR: TICKER NOT FOUND IN SEC / SPLC DATABASE]
            </div>
          )}

          {isError && !(error instanceof SplcTickerNotFoundError) && (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center font-splc-mono text-sm">
              <p className="text-splc-risk-high">[ERROR: NETWORK FAILURE FETCHING SPLC DATA]</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded border border-splc-amber/50 bg-splc-amber/10 px-3 py-1.5 text-[11px] uppercase text-splc-amber hover:bg-splc-amber/20"
              >
                Retry
              </button>
            </div>
          )}

          {!isLoading && !isError && (
            <>
              {noDisclosureData && (
                <div className="border-b border-splc-border bg-splc-medium/10 px-4 py-2 font-splc-mono text-[11px] text-splc-medium">
                  [NOTICE: No &gt;10% revenue/supplier dependencies reported under SEC S-K disclosures]
                </div>
              )}
              <div className="min-h-0 flex-1">{viewMode === 'graph' ? <SupplyChainGraph /> : <MatrixTableView />}</div>
            </>
          )}
        </main>

        <div className="w-[340px] shrink-0">
          <InspectorPanel />
        </div>
      </div>
    </div>
  );
}
