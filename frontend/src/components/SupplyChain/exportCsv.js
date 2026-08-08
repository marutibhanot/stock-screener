/** Client-side CSV export of the currently filtered relationship set --
 * matches the "data export button" in spec section 1's top nav. No backend
 * round-trip needed since the dashboard already holds the full filtered
 * dataset in memory. */
export function exportCounterpartiesToCsv(ticker, counterparties) {
  const headers = [
    'Ticker',
    'Company',
    'Category',
    'Relationship',
    'Revenue Exposure %',
    'COGS Exposure %',
    'Est. Annual $M',
    'Market Cap $B',
    '1Y Performance %',
    'Risk Score',
    'Data Source',
  ];

  const rows = counterparties.map((entry) => [
    entry.ticker,
    entry.name,
    entry.category,
    entry.relationshipType,
    entry.revenueExposurePct ?? '',
    entry.cogsExposurePct ?? '',
    entry.annualValueUsdM ?? '',
    entry.marketCapUsdB ?? '',
    entry.oneYearPerformancePct ?? '',
    entry.riskScore ?? '',
    entry.dataSource ?? '',
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${ticker}_supply_chain_map.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
