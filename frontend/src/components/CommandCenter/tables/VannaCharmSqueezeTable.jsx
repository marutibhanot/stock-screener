import ScannerTable from '../ScannerTable';
import { SymbolCell, SignedCell } from '../Cells';
import { formatUsdCompact } from '../format';

function DominantBadge({ dominant }) {
  const isVanna = dominant === 'vanna';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
        isVanna ? 'bg-sky-500/10 text-sky-400' : 'bg-violet-500/10 text-violet-400'
      }`}
    >
      {isVanna ? 'Vanna' : 'Charm'}
    </span>
  );
}

const columns = [
  { key: 'symbol', label: 'Symbol', render: (r) => <SymbolCell symbol={r.symbol} /> },
  { key: 'dominant', label: '', render: (r) => <DominantBadge dominant={r.dominant} /> },
  {
    key: 'netVex',
    label: 'Net VEX',
    align: 'right',
    render: (r) => <SignedCell value={r.netVex}>{formatUsdCompact(r.netVex)}</SignedCell>,
  },
  {
    key: 'netCex',
    label: 'Net CEX',
    align: 'right',
    render: (r) => <SignedCell value={r.netCex}>{formatUsdCompact(r.netCex)}</SignedCell>,
  },
];

/** Tickers with the largest dealer Vanna (vol-move-driven) or Charm
 * (time-decay-driven) hedging flow -- exposure that forces dealer
 * delta-hedging independent of any price move itself. */
export default function VannaCharmSqueezeTable({ rows = [] }) {
  return (
    <ScannerTable
      title="Vanna / Charm Squeeze"
      subtitle="Largest dealer hedging flow from a vol move (Vanna) or time decay (Charm) alone"
      columns={columns}
      rows={rows}
    />
  );
}
