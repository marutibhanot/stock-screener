import ScannerTable from '../ScannerTable';
import { SymbolCell } from '../Cells';
import { formatIv } from '../format';

const columns = [
  { key: 'symbol', label: 'Symbol', render: (r) => <SymbolCell symbol={r.symbol} /> },
  { key: 'nearIv', label: 'Near IV', align: 'right', render: (r) => formatIv(r.nearIv) },
  { key: 'nextIv', label: 'Next IV', align: 'right', render: (r) => formatIv(r.nextIv) },
  {
    key: 'ratio',
    label: 'Ratio',
    align: 'right',
    render: (r) => <span className="font-bold text-amber-400">{r.ratio.toFixed(2)}x</span>,
  },
  {
    key: 'status',
    label: 'Status',
    render: () => <span className="text-[10px] uppercase text-rose-400">Event Risk</span>,
  },
];

/** Tickers whose nearest listed expiration is pricing more vol than the
 * next one (backwardation) -- usually near-term event risk (earnings,
 * binary catalyst) priced into the front contract. "Near"/"Next" are
 * whichever expirations yfinance actually lists for that ticker, not a
 * fixed 7D/30D constant-maturity point -- those vary by ticker and aren't
 * claimed here. */
export default function TermStructureInversionTable({ rows = [] }) {
  return (
    <ScannerTable
      title="Term Structure Inversions"
      subtitle="Near expiration IV > next expiration IV -- backwardation, event risk priced in"
      columns={columns}
      rows={rows}
    />
  );
}
