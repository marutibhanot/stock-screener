const UNIVERSE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'equities', label: 'Equities' },
  { value: 'etf', label: 'Indices / ETFs' },
];

const CAP_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'mega', label: 'Mega $100B+' },
  { value: 'large', label: 'Large $10B+' },
];

function ToggleGroup({ label, options, value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      <div className="flex overflow-hidden rounded border border-slate-700">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
              value === opt.value
                ? 'bg-sky-500/20 text-sky-300'
                : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Universe/Cap filters applied server-side to every ranking table before
 * its top-10 is selected (see the backend endpoint's docstring for why --
 * filtering an already-selected top 10 down to "mega cap only" would
 * usually leave almost nothing). No liquidity/volume filter yet -- that
 * needs a join this endpoint doesn't otherwise make; a follow-up, not
 * built speculatively. */
export default function UniversalFilterBar({ universe, cap, onUniverseChange, onCapChange }) {
  return (
    <div className="border-b border-slate-800 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
        <ToggleGroup label="Universe" options={UNIVERSE_OPTIONS} value={universe} onChange={onUniverseChange} />
        <ToggleGroup label="Cap" options={CAP_OPTIONS} value={cap} onChange={onCapChange} />
      </div>
    </div>
  );
}
