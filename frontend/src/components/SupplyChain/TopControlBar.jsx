import { useRef, useState } from 'react';

import { useSupplyChain, DEFAULT_EXPOSURE_THRESHOLD } from '../../contexts/SupplyChainContext';
import { exportCounterpartiesToCsv } from './exportCsv';

const CATEGORY_TOGGLES = [
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'customers', label: 'Customers' },
  { key: 'competitors', label: 'Competitors' },
];

/** Top control bar: ticker search, exposure threshold slider, category
 * toggles, Graph/Matrix view switch, and CSV export -- spec section 2B. */
export default function TopControlBar() {
  const {
    selectedTicker,
    selectTicker,
    supportedTickers,
    dataset,
    exposureThreshold,
    setExposureThreshold,
    categoryVisibility,
    toggleCategory,
    viewMode,
    setViewMode,
    filteredCounterparties,
  } = useSupplyChain();

  const [query, setQuery] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const inputRef = useRef(null);

  const suggestions = supportedTickers.filter(
    (t) => query.trim() === '' || t.toLowerCase().startsWith(query.trim().toLowerCase())
  );

  const commitSearch = (ticker) => {
    selectTicker(ticker);
    setQuery('');
    setSuggestionsOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && suggestions.length > 0) {
      commitSearch(suggestions[0]);
    } else if (e.key === 'Escape') {
      setSuggestionsOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-splc-border bg-splc-panel px-4 py-3">
      {/* Ticker search */}
      <div className="relative">
        <label className="mb-1 block font-splc-mono text-[10px] uppercase tracking-wider text-splc-muted">
          SPLC &middot; Ticker
        </label>
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={selectedTicker}
          onChange={(e) => {
            setQuery(e.target.value);
            setSuggestionsOpen(true);
          }}
          onFocus={() => setSuggestionsOpen(true)}
          onBlur={() => setTimeout(() => setSuggestionsOpen(false), 120)}
          onKeyDown={handleKeyDown}
          className="w-40 rounded border border-splc-border bg-splc-panel-raised px-2.5 py-1.5 font-splc-mono text-sm font-bold uppercase text-splc-amber placeholder:text-splc-muted focus:border-splc-amber focus:outline-none"
        />
        {suggestionsOpen && suggestions.length > 0 && (
          <ul className="absolute z-20 mt-1 w-40 overflow-hidden rounded border border-splc-border bg-splc-panel-raised shadow-xl">
            {suggestions.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commitSearch(t)}
                  className={`block w-full px-2.5 py-1.5 text-left font-splc-mono text-sm hover:bg-splc-amber/10 hover:text-splc-amber ${
                    t === selectedTicker ? 'text-splc-amber' : 'text-splc-text'
                  }`}
                >
                  {t}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Marquee quick-select chips */}
      <div className="flex items-center gap-1.5">
        {supportedTickers.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => commitSearch(t)}
            className={`rounded border px-2 py-1 font-splc-mono text-[11px] font-semibold transition-colors ${
              t === selectedTicker
                ? 'border-splc-amber bg-splc-amber/10 text-splc-amber'
                : 'border-splc-border text-splc-muted hover:border-splc-amber/40 hover:text-splc-text'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="h-8 w-px bg-splc-border" />

      {/* Exposure threshold slider */}
      <div className="min-w-[220px]">
        <label className="mb-1 flex items-center justify-between font-splc-mono text-[10px] uppercase tracking-wider text-splc-muted">
          <span>Min. Exposure</span>
          <span className="text-splc-amber">{exposureThreshold}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={60}
          step={1}
          value={exposureThreshold}
          onChange={(e) => setExposureThreshold(Number(e.target.value))}
          className="splc-slider h-1.5 w-full cursor-pointer appearance-none rounded-full bg-splc-border accent-[#ff9900]"
        />
      </div>
      {exposureThreshold !== DEFAULT_EXPOSURE_THRESHOLD && (
        <button
          type="button"
          onClick={() => setExposureThreshold(DEFAULT_EXPOSURE_THRESHOLD)}
          className="font-splc-mono text-[10px] uppercase text-splc-muted underline hover:text-splc-amber"
        >
          Reset
        </button>
      )}

      <div className="h-8 w-px bg-splc-border" />

      {/* Category toggles */}
      <div className="flex items-center gap-3">
        {CATEGORY_TOGGLES.map(({ key, label }) => (
          <label key={key} className="flex cursor-pointer items-center gap-1.5 font-splc-mono text-xs text-splc-text">
            <input
              type="checkbox"
              checked={categoryVisibility[key]}
              onChange={() => toggleCategory(key)}
              className="h-3.5 w-3.5 accent-[#ff9900]"
            />
            {label}
          </label>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* View mode toggle */}
        <div className="flex overflow-hidden rounded border border-splc-border font-splc-mono text-[11px] font-semibold uppercase">
          <button
            type="button"
            onClick={() => setViewMode('graph')}
            className={`px-3 py-1.5 transition-colors ${viewMode === 'graph' ? 'bg-splc-amber text-splc-bg' : 'text-splc-muted hover:text-splc-text'}`}
          >
            Graph
          </button>
          <button
            type="button"
            onClick={() => setViewMode('matrix')}
            className={`border-l border-splc-border px-3 py-1.5 transition-colors ${viewMode === 'matrix' ? 'bg-splc-amber text-splc-bg' : 'text-splc-muted hover:text-splc-text'}`}
          >
            Matrix
          </button>
        </div>

        {/* Export */}
        <button
          type="button"
          disabled={!dataset}
          onClick={() => dataset && exportCounterpartiesToCsv(dataset.ticker, filteredCounterparties)}
          className="rounded border border-splc-orange/50 bg-splc-orange/10 px-3 py-1.5 font-splc-mono text-[11px] font-semibold uppercase text-splc-orange transition-colors hover:bg-splc-orange/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Export CSV
        </button>
      </div>
    </div>
  );
}
