import ScannerTable from '../ScannerTable';
import { SymbolCell } from '../Cells';
import { formatPrice, formatPct } from '../format';

function DirectionBadge({ direction }) {
  const isSqueeze = direction === 'call_wall';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
        isSqueeze ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
      }`}
    >
      {isSqueeze ? 'Squeeze' : 'Liquidation'}
    </span>
  );
}

const columns = [
  { key: 'symbol', label: 'Symbol', render: (r) => <SymbolCell symbol={r.symbol} /> },
  { key: 'direction', label: '', render: (r) => <DirectionBadge direction={r.direction} /> },
  { key: 'price', label: 'Price', align: 'right', render: (r) => formatPrice(r.price) },
  { key: 'wall', label: 'Wall', align: 'right', render: (r) => formatPrice(r.wall) },
  {
    key: 'distancePct',
    label: 'Through Wall',
    align: 'right',
    render: (r) => (
      <span className={r.direction === 'call_wall' ? 'text-emerald-400' : 'text-rose-400'}>
        {formatPct(r.distancePct)}
      </span>
    ),
  },
];

/** Tickers trading through a structural wall right now -- above the call
 * wall (resistance no longer holding, a squeeze setup) or below the put
 * wall (support no longer holding, a liquidation setup). */
export default function WallBreakersTable({ rows = [] }) {
  return (
    <ScannerTable
      title="Wall Breakers"
      subtitle="Trading above Call Wall (squeeze) or below Put Wall (liquidation)"
      columns={columns}
      rows={rows}
    />
  );
}
