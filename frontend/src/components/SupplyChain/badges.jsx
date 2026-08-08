import { exposureTierFor } from '../../data/mockSupplyChainData';

const EXPOSURE_TIER_STYLE = {
  high: 'bg-splc-high/10 text-splc-high border-splc-high/30',
  medium: 'bg-splc-medium/10 text-splc-medium border-splc-medium/30',
  low: 'bg-splc-low/10 text-splc-low border-splc-low/30',
  unknown: 'bg-splc-muted/10 text-splc-muted border-splc-muted/30',
};

/** Colored pill for a revenue/COGS exposure percentage: green (high
 * reliance), amber (medium), muted (low) -- per spec section 1. */
export function ExposureBadge({ pct, label }) {
  if (pct == null) {
    return <span className="text-splc-muted">&mdash;</span>;
  }
  const tier = exposureTierFor(pct);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-splc-mono text-[11px] font-semibold ${EXPOSURE_TIER_STYLE[tier]}`}
      title={label}
    >
      {pct.toFixed(1)}%
    </span>
  );
}

const RISK_STYLE = {
  High: 'bg-splc-risk-high/10 text-splc-risk-high border-splc-risk-high/30',
  Medium: 'bg-splc-risk-medium/10 text-splc-risk-medium border-splc-risk-medium/30',
  Low: 'bg-splc-risk-low/10 text-splc-risk-low border-splc-risk-low/30',
};

/** Supply-chain disruption risk score pill (Low/Medium/High). */
export function RiskBadge({ score }) {
  if (!score) return <span className="text-splc-muted">&mdash;</span>;
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-splc-mono text-[11px] font-semibold uppercase ${RISK_STYLE[score] ?? RISK_STYLE.Low}`}
    >
      {score}
    </span>
  );
}

/** Category tag chip (Supplier / Customer / Competitor). */
export function CategoryChip({ category }) {
  const label = { suppliers: 'Supplier', customers: 'Customer', competitors: 'Competitor', target: 'Target' }[category] ?? category;
  const style = {
    suppliers: 'text-splc-amber border-splc-amber/40',
    customers: 'text-sky-400 border-sky-400/40',
    competitors: 'text-splc-muted border-splc-muted/40',
    target: 'text-splc-orange border-splc-orange/50',
  }[category];
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-splc-mono text-[10px] uppercase tracking-wider ${style}`}>
      {label}
    </span>
  );
}

/** Signed 1-year performance, colored green/red. */
export function PerformanceValue({ pct }) {
  if (pct == null) return <span className="text-splc-muted">&mdash;</span>;
  const positive = pct >= 0;
  return (
    <span className={`font-splc-mono font-semibold ${positive ? 'text-splc-high' : 'text-splc-risk-high'}`}>
      {positive ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  );
}
