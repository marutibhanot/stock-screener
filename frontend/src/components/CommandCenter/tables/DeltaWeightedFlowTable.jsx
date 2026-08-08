import ScannerTable from '../ScannerTable';
import { SymbolCell, SignedCell } from '../Cells';
import { formatPrice, formatUsdCompact } from '../format';

function BiasBadge({ bias }) {
  const isBullish = bias === 'bullish';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
        isBullish ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
      }`}
    >
      {bias}
    </span>
  );
}

const columns = [
  { key: 'symbol', label: 'Symbol', render: (r) => <SymbolCell symbol={r.symbol} /> },
  { key: 'price', label: 'Price', align: 'right', render: (r) => formatPrice(r.price) },
  {
    key: 'netDeltaDollarFlow',
    label: 'Net Delta $',
    align: 'right',
    render: (r) => <SignedCell value={r.netDeltaDollarFlow}>{formatUsdCompact(r.netDeltaDollarFlow)}</SignedCell>,
  },
  { key: 'bias', label: '', render: (r) => <BiasBadge bias={r.bias} /> },
];

/** Tickers with the largest net delta-weighted dollar flow (spot * delta *
 * volume * 100, signed by option type) -- a directional-bias view distinct
 * from raw premium traded: a ticker can have huge call premium but still
 * net bearish here if that volume sits in low-delta, far-OTM contracts. */
export default function DeltaWeightedFlowTable({ rows = [] }) {
  return (
    <ScannerTable
      title="Delta-Weighted Premium Flow"
      subtitle="Net directional bias from today's volume, weighted by option delta"
      columns={columns}
      rows={rows}
    />
  );
}
