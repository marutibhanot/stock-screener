// Tailwind is scoped to this page only -- see src/styles/supplyChain.css
// (and commandCenter.css's header comment) for why preflight is deliberately
// excluded so it can't leak into the MUI-based pages elsewhere in the app.
import '../styles/supplyChain.css';

import { SupplyChainProvider, useSupplyChain } from '../contexts/SupplyChainContext';
import TopControlBar from '../components/SupplyChain/TopControlBar';
import SupplyChainGraph from '../components/SupplyChain/SupplyChainGraph';
import MatrixTableView from '../components/SupplyChain/MatrixTableView';
import InspectorPanel from '../components/SupplyChain/InspectorPanel';

/**
 * Supply Chain Analysis (SPLC) -- a Bloomberg-terminal-style dashboard
 * mapping a target company's suppliers, customers, and competitors, with
 * quantified revenue/COGS exposure for each relationship.
 *
 * Currently backed entirely by mock data (src/data/mockSupplyChainData.js)
 * routed through src/api/supplyChain.js -- see that file's header comment
 * for exactly how to swap in a live backend (SEC EDGAR / Financial Modeling
 * Prep / a dedicated supply-chain data vendor) without touching any
 * component below this one.
 */
export default function SupplyChainAnalysisPage() {
  return (
    <SupplyChainProvider initialTicker="AAPL">
      <SupplyChainPageContent />
    </SupplyChainProvider>
  );
}

function SupplyChainPageContent() {
  const { isLoading, isError, error, viewMode } = useSupplyChain();

  return (
    <div className="flex h-[calc(100vh-48px)] w-full flex-col bg-splc-bg font-splc-sans text-splc-text">
      <TopControlBar />

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 border-r border-splc-border">
          {isLoading && (
            <div className="flex h-full items-center justify-center font-splc-mono text-sm text-splc-muted">
              Loading supply-chain map&hellip;
            </div>
          )}

          {isError && (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <p className="max-w-md text-sm text-splc-risk-high">
                {error?.message ?? 'Failed to load supply-chain data.'}
              </p>
            </div>
          )}

          {!isLoading && !isError && (viewMode === 'graph' ? <SupplyChainGraph /> : <MatrixTableView />)}
        </main>

        <div className="w-[340px] shrink-0">
          <InspectorPanel />
        </div>
      </div>
    </div>
  );
}
