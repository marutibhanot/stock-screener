import { ExposureBadge, RiskBadge } from './badges';

/** Floating hover tooltip, positioned at the last mouse coordinates. Shown
 * for both nodes and edges -- content differs by category per spec section
 * 2A: suppliers show revenue-exposure + COGS-supplied%, customers show
 * revenue-exposure only, competitors show just the relationship label. */
export default function GraphTooltip({ entry, clientX, clientY }) {
  if (!entry) return null;

  // Keep the tooltip on-screen near the cursor without needing a
  // measurement pass -- offset up-left once past the right/bottom thirds.
  const style = {
    left: clientX + 16,
    top: clientY + 16,
  };

  return (
    <div
      className="pointer-events-none fixed z-50 w-64 rounded-md border border-splc-border bg-splc-panel-raised/95 p-3 shadow-2xl backdrop-blur"
      style={style}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-splc-mono text-sm font-bold text-splc-text">{entry.ticker}</span>
        {entry.riskScore && <RiskBadge score={entry.riskScore} />}
      </div>
      <div className="mb-2 text-xs text-splc-muted">{entry.name}</div>
      <div className="mb-2 text-[11px] text-splc-amber">{entry.relationshipType}</div>

      <div className="space-y-1 border-t border-splc-border pt-2 text-[11px]">
        {entry.category === 'suppliers' && (
          <>
            <Row label="% of Supplier's Revenue from Target">
              <ExposureBadge pct={entry.revenueExposurePct} />
            </Row>
            <Row label="% of Target's COGS Supplied">
              <ExposureBadge pct={entry.cogsExposurePct} />
            </Row>
          </>
        )}
        {entry.category === 'customers' && (
          <Row label="% of Target's Revenue from Customer">
            <ExposureBadge pct={entry.revenueExposurePct} />
          </Row>
        )}
        {entry.category === 'competitors' && (
          <Row label="Relationship">
            <span className="text-splc-text">Direct Peer</span>
          </Row>
        )}
        {entry.annualValueUsdM != null && (
          <Row label="Est. Annual Value">
            <span className="font-splc-mono text-splc-text">${formatMillions(entry.annualValueUsdM)}</span>
          </Row>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-splc-muted">{label}</span>
      {children}
    </div>
  );
}

function formatMillions(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}B`;
  return `${value.toFixed(0)}M`;
}
