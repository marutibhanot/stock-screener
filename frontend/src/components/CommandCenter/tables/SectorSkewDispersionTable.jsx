import ScannerTable from '../ScannerTable';
import { SymbolCell, SignedCell } from '../Cells';

const columns = [
  { key: 'symbol', label: 'Symbol', render: (r) => <SymbolCell symbol={r.symbol} /> },
  { key: 'sector', label: 'Sector', render: (r) => <span className="text-slate-400">{r.sector}</span> },
  { key: 'skew', label: 'Skew', align: 'right', render: (r) => r.skew.toFixed(3) },
  { key: 'sectorMeanSkew', label: 'Sector Mean', align: 'right', render: (r) => r.sectorMeanSkew.toFixed(3) },
  {
    key: 'deviation',
    label: 'Deviation',
    align: 'right',
    render: (r) => <SignedCell value={r.deviation}>{r.deviation > 0 ? '+' : ''}{r.deviation.toFixed(3)}</SignedCell>,
  },
];

/** Tickers whose 25-delta skew deviates most from their own sector's mean
 * -- unusually call-skewed or put-skewed relative to peers, not just in
 * absolute terms (see Extreme Skew for the absolute view). */
export default function SectorSkewDispersionTable({ rows = [] }) {
  return (
    <ScannerTable
      title="Sector Skew Dispersion"
      subtitle="25D skew vs. sector mean -- relative-value call/put panic vs. peers"
      columns={columns}
      rows={rows}
    />
  );
}
