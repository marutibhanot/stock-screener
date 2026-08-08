import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getSupplyChainMap, getSupportedTickers } from '../api/supplyChain';

const SupplyChainContext = createContext(null);

export const DEFAULT_EXPOSURE_THRESHOLD = 5;

const DEFAULT_CATEGORY_VISIBILITY = {
  suppliers: true,
  customers: true,
  competitors: true,
};

/** Holds all cross-component SPLC dashboard state: which ticker is loaded,
 * which node is selected in the inspector, the active filters, and the
 * graph/matrix view toggle. Local React Context (no global store needed --
 * this state is scoped to a single page). */
export function SupplyChainProvider({ children, initialTicker = 'AAPL' }) {
  const [selectedTicker, setSelectedTicker] = useState(initialTicker);
  const [selectedNodeId, setSelectedNodeId] = useState('__target__');
  const [exposureThreshold, setExposureThreshold] = useState(DEFAULT_EXPOSURE_THRESHOLD);
  const [categoryVisibility, setCategoryVisibility] = useState(DEFAULT_CATEGORY_VISIBILITY);
  const [viewMode, setViewMode] = useState('graph'); // 'graph' | 'matrix'

  const {
    data: dataset,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['supplyChainMap', selectedTicker],
    queryFn: () => getSupplyChainMap(selectedTicker),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const selectTicker = useCallback((ticker) => {
    const normalized = String(ticker || '').toUpperCase().trim();
    if (!normalized) return;
    setSelectedTicker(normalized);
    setSelectedNodeId('__target__');
  }, []);

  const toggleCategory = useCallback((category) => {
    setCategoryVisibility((prev) => ({ ...prev, [category]: !prev[category] }));
  }, []);

  // Every counterparty across suppliers/customers/competitors, flattened
  // with a `category` tag -- the graph, matrix table, and CSV export all
  // derive their filtered node sets from this single list so filtering
  // logic (threshold + category toggles) only lives in one place.
  const allCounterparties = useMemo(() => {
    if (!dataset) return [];
    const withCategory = (list, category) => (list || []).map((item) => ({ ...item, category }));
    return [
      ...withCategory(dataset.suppliers, 'suppliers'),
      ...withCategory(dataset.customers, 'customers'),
      ...withCategory(dataset.competitors, 'competitors'),
    ];
  }, [dataset]);

  // Competitors carry no exposure % (they're peers, not counted in
  // revenue/COGS) -- they're only filtered by their category toggle, never
  // by the exposure threshold slider.
  const filteredCounterparties = useMemo(() => {
    return allCounterparties.filter((entry) => {
      if (!categoryVisibility[entry.category]) return false;
      if (entry.category === 'competitors') return true;
      const exposure = entry.revenueExposurePct ?? entry.cogsExposurePct ?? 0;
      return exposure >= exposureThreshold;
    });
  }, [allCounterparties, categoryVisibility, exposureThreshold]);

  const selectedNode = useMemo(() => {
    if (!dataset) return null;
    if (selectedNodeId === '__target__') {
      return { id: '__target__', category: 'target', ...dataset };
    }
    return allCounterparties.find((entry) => entry.id === selectedNodeId) ?? null;
  }, [dataset, selectedNodeId, allCounterparties]);

  const value = useMemo(
    () => ({
      selectedTicker,
      selectTicker,
      supportedTickers: getSupportedTickers(),
      dataset,
      isLoading,
      isError,
      error,
      refetch,
      selectedNodeId,
      setSelectedNodeId,
      selectedNode,
      exposureThreshold,
      setExposureThreshold,
      categoryVisibility,
      toggleCategory,
      viewMode,
      setViewMode,
      allCounterparties,
      filteredCounterparties,
    }),
    [
      selectedTicker,
      selectTicker,
      dataset,
      isLoading,
      isError,
      error,
      refetch,
      selectedNodeId,
      selectedNode,
      exposureThreshold,
      categoryVisibility,
      toggleCategory,
      viewMode,
      allCounterparties,
      filteredCounterparties,
    ]
  );

  return <SupplyChainContext.Provider value={value}>{children}</SupplyChainContext.Provider>;
}

export function useSupplyChain() {
  const ctx = useContext(SupplyChainContext);
  if (!ctx) {
    throw new Error('useSupplyChain must be used within a SupplyChainProvider');
  }
  return ctx;
}
