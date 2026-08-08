import { useMemo, useState } from 'react';

import { useSupplyChain } from '../../contexts/SupplyChainContext';
import { CategoryChip, ExposureBadge, PerformanceValue, RiskBadge } from './badges';

const COLUMNS = [
  { key: 'ticker', label: 'Ticker', align: 'left' },
  { key: 'name', label: 'Company', align: 'left' },
  { key: 'category', label: 'Type', align: 'left' },
  { key: 'relationshipType', label: 'Relationship', align: 'left' },
  { key: 'exposure', label: 'Exposure', align: 'right' },
  { key: 'annualValueUsdM', label: 'Est. Annual $M', align: 'right' },
  { key: 'marketCapUsdB', label: 'Mkt Cap $B', align: 'right' },
  { key: 'oneYearPerformancePct', label: '1Y Perf', align: 'right' },
  { key: 'riskScore', label: 'Risk', align: 'left' },
];

function exposureOf(row) {
  return row.revenueExposurePct ?? row.cogsExposurePct ?? null;
}

/** Structured Data Matrix Table -- the alternate view to the network graph,
 * same filtered relationship set, sortable by any column. Selecting a row
 * updates the shared selectedNodeId so the Inspector panel stays in sync
 * regardless of which view is active. */
export default function MatrixTableView() {
  const { filteredCounterparties, selectedNodeId, setSelectedNodeId } = useSupplyChain();
  const [sort, setSort] = useState({ key: 'exposure', direction: 'desc' });

  const rows = useMemo(() => {
    const withExposure = filteredCounterparties.map((row) => ({ ...row, exposure: exposureOf(row) }));
    const sorted = [...withExposure].sort((a, b) => {
      let av = a[sort.key];
      let bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') {
        av = av.toLowerCase();
        bv = bv.toLowerCase();
        return sort.direction === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sort.direction === 'asc' ? av - bv : bv - av;
    });
    return sorted;
  }, [filteredCounterparties, sort]);

  const toggleSort = (key) => {
    setSort((prev) => (prev.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'desc' }));
  };

  return (
    <div className="splc-scrollbar h-full w-full overflow-auto bg-splc-bg p-4">
      <table className="w-full min-w-[980px] border-collapse font-splc-mono text-xs">
        <thead className="sticky top-0 z-10 bg-splc-panel">
          <tr className="border-b border-splc-border text-[10px] uppercase tracking-wider text-splc-muted">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 font-medium hover:text-splc-amber ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                onClick={() => toggleSort(col.key)}
              >
                {col.label}
                {sort.key === col.key && <span className="ml-1 text-splc-amber">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => setSelectedNodeId(row.id)}
              className={`cursor-pointer border-b border-splc-border/60 transition-colors last:border-0 hover:bg-splc-panel-raised ${
                selectedNodeId === row.id ? 'bg-splc-amber/5 ring-1 ring-inset ring-splc-amber/40' : ''
              }`}
            >
              <td className="whitespace-nowrap px-3 py-2 font-bold text-splc-text">{row.ticker}</td>
              <td className="max-w-[220px] truncate px-3 py-2 text-splc-text" title={row.name}>
                {row.name}
              </td>
              <td className="px-3 py-2">
                <CategoryChip category={row.category} />
              </td>
              <td className="max-w-[260px] truncate px-3 py-2 text-splc-muted" title={row.relationshipType}>
                {row.relationshipType}
              </td>
              <td className="px-3 py-2 text-right">
                <ExposureBadge pct={row.exposure} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-splc-text">
                {row.annualValueUsdM != null ? `$${row.annualValueUsdM.toLocaleString()}` : '—'}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-splc-text">{row.marketCapUsdB?.toLocaleString() ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <PerformanceValue pct={row.oneYearPerformancePct} />
              </td>
              <td className="px-3 py-2">
                <RiskBadge score={row.riskScore} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-splc-muted">
                No relationships match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
