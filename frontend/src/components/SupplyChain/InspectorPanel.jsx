import { useSupplyChain } from '../../contexts/SupplyChainContext';
import { CategoryChip, ExposureBadge, PerformanceValue, RiskBadge } from './badges';

/** Right sidebar "Data Inspector" -- updates instantly on node click/select,
 * per spec section 2C. Shows the target's own aggregate overview when no
 * counterparty is selected (selectedNodeId === '__target__'). */
export default function InspectorPanel() {
  const { selectedNode, dataset, allCounterparties } = useSupplyChain();

  if (!selectedNode || !dataset) {
    return (
      <aside className="flex h-full w-full flex-col border-l border-splc-border bg-splc-panel p-4 text-splc-muted">
        <p className="text-xs">Select a node to inspect.</p>
      </aside>
    );
  }

  if (selectedNode.category === 'target') {
    return <TargetOverview dataset={dataset} counterparties={allCounterparties} />;
  }

  const isSupplier = selectedNode.category === 'suppliers';
  const isCustomer = selectedNode.category === 'customers';
  const isCompetitor = selectedNode.category === 'competitors';

  return (
    <aside className="splc-scrollbar flex h-full w-full flex-col overflow-y-auto border-l border-splc-border bg-splc-panel">
      <div className="border-b border-splc-border p-4">
        <div className="mb-1 flex items-center gap-2">
          <CategoryChip category={selectedNode.category} />
          <RiskBadge score={selectedNode.riskScore} />
        </div>
        <h2 className="font-splc-mono text-xl font-bold text-splc-text">{selectedNode.ticker}</h2>
        <p className="text-sm text-splc-muted">{selectedNode.name}</p>
      </div>

      <Section title="Relationship">
        <p className="text-sm text-splc-amber">{selectedNode.relationshipType}</p>
      </Section>

      {!isCompetitor && (
        <Section title="Quantified Dependency">
          <FieldRow label="% Exposure to Target">
            <ExposureBadge pct={selectedNode.revenueExposurePct ?? selectedNode.cogsExposurePct} />
          </FieldRow>
          {isSupplier && (
            <FieldRow label="% of Target's COGS Supplied">
              <ExposureBadge pct={selectedNode.cogsExposurePct} />
            </FieldRow>
          )}
          {isSupplier && (
            <FieldRow label="% of Supplier's Own Revenue">
              <ExposureBadge pct={selectedNode.revenueExposurePct} />
            </FieldRow>
          )}
          {isCustomer && (
            <FieldRow label="% of Target's Revenue">
              <ExposureBadge pct={selectedNode.revenueExposurePct} />
            </FieldRow>
          )}
          <FieldRow label="Est. Annual Dollar Value">
            <span className="font-splc-mono text-splc-text">
              {selectedNode.annualValueUsdM != null ? `$${selectedNode.annualValueUsdM.toLocaleString()}M` : '—'}
            </span>
          </FieldRow>
          <FieldRow label="Data Source & Verification">
            <span className="text-right text-[11px] text-splc-text">{selectedNode.dataSource}</span>
          </FieldRow>
        </Section>
      )}

      {isCompetitor && (
        <Section title="Peer Comparison">
          <FieldRow label="Data Source">
            <span className="text-right text-[11px] text-splc-text">{selectedNode.dataSource}</span>
          </FieldRow>
        </Section>
      )}

      <Section title="Key Financial Summary">
        <FieldRow label="Market Cap">
          <span className="font-splc-mono text-splc-text">${selectedNode.marketCapUsdB?.toLocaleString()}B</span>
        </FieldRow>
        <FieldRow label="Sector">
          <span className="text-right text-splc-text">{selectedNode.sector}</span>
        </FieldRow>
        <FieldRow label="1-Year Performance">
          <PerformanceValue pct={selectedNode.oneYearPerformancePct} />
        </FieldRow>
        <FieldRow label="Disruption Risk">
          <RiskBadge score={selectedNode.riskScore} />
        </FieldRow>
      </Section>
    </aside>
  );
}

function TargetOverview({ dataset, counterparties }) {
  const suppliers = counterparties.filter((c) => c.category === 'suppliers');
  const customers = counterparties.filter((c) => c.category === 'customers');
  const competitors = counterparties.filter((c) => c.category === 'competitors');
  const totalAnnualValue = [...suppliers, ...customers].reduce((sum, c) => sum + (c.annualValueUsdM || 0), 0);
  const highRiskCount = [...suppliers, ...customers].filter((c) => c.riskScore === 'High').length;

  return (
    <aside className="splc-scrollbar flex h-full w-full flex-col overflow-y-auto border-l border-splc-border bg-splc-panel">
      <div className="border-b border-splc-border p-4">
        <div className="mb-1">
          <CategoryChip category="target" />
        </div>
        <h2 className="font-splc-mono text-xl font-bold text-splc-orange">{dataset.ticker}</h2>
        <p className="text-sm text-splc-muted">{dataset.name}</p>
      </div>

      <Section title="Key Financial Summary">
        <FieldRow label="Market Cap">
          <span className="font-splc-mono text-splc-text">${dataset.marketCapUsdB?.toLocaleString()}B</span>
        </FieldRow>
        <FieldRow label="Sector">
          <span className="text-right text-splc-text">{dataset.sector}</span>
        </FieldRow>
        <FieldRow label="1-Year Performance">
          <PerformanceValue pct={dataset.oneYearPerformancePct} />
        </FieldRow>
      </Section>

      <Section title="Supply Chain Map Summary">
        <FieldRow label="Suppliers Tracked">
          <span className="font-splc-mono text-splc-text">{suppliers.length}</span>
        </FieldRow>
        <FieldRow label="Customers Tracked">
          <span className="font-splc-mono text-splc-text">{customers.length}</span>
        </FieldRow>
        <FieldRow label="Competitors Tracked">
          <span className="font-splc-mono text-splc-text">{competitors.length}</span>
        </FieldRow>
        <FieldRow label="Total Est. Flow ($M)">
          <span className="font-splc-mono text-splc-text">${totalAnnualValue.toLocaleString()}</span>
        </FieldRow>
        <FieldRow label="High-Risk Dependencies">
          <span className={`font-splc-mono font-semibold ${highRiskCount > 0 ? 'text-splc-risk-high' : 'text-splc-text'}`}>
            {highRiskCount}
          </span>
        </FieldRow>
      </Section>

      <div className="p-4 text-[11px] leading-relaxed text-splc-muted">
        Click any node on the graph, or any row in the matrix table, to inspect its individual
        dependency profile.
      </div>
    </aside>
  );
}

function Section({ title, children }) {
  return (
    <div className="border-b border-splc-border p-4">
      <h3 className="mb-2 font-splc-mono text-[10px] font-semibold uppercase tracking-widest text-splc-muted">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function FieldRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-splc-muted">{label}</span>
      {children}
    </div>
  );
}
