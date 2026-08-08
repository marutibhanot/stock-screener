/**
 * Mock supply-chain relationship data for the Supply Chain Analysis (SPLC)
 * dashboard.
 *
 * ---------------------------------------------------------------------------
 * WIRING A LIVE BACKEND
 * ---------------------------------------------------------------------------
 * This file is the *only* thing that needs to disappear when a real data
 * source is wired up -- every component reads through
 * `src/api/supplyChain.js`, never straight from `SUPPLY_CHAIN_DATASETS`.
 *
 * Real sources that map cleanly onto this shape:
 *  - SEC EDGAR full-text search + 10-K Item 1 ("Business") / Item 1A ("Risk
 *    Factors") parsing for customer-concentration disclosures (e.g. "one
 *    customer accounted for X% of net sales") -- https://www.sec.gov/edgar
 *  - Financial Modeling Prep's "Company Notes"/"Executive"/"Revenue Segments"
 *    endpoints, or a supply-chain-specific provider (e.g. Bloomberg SPLC
 *    itself, FactSet Revere, or Sentieo) for supplier/customer graphs.
 *  - 8-K / investor-day disclosures for one-off dollar-value estimates.
 *
 * A backend endpoint (e.g. `GET /v1/supply-chain/{ticker}`) should return
 * exactly the shape below so `api/supplyChain.js` only needs its `USE_MOCK`
 * flag flipped -- see that file for the swap-over point.
 * ---------------------------------------------------------------------------
 */

// Exposure-tier thresholds drive both node color and matrix-table badge color.
// Kept here (not hardcoded per-record) so the whole dashboard's tiering can be
// retuned in one place.
export const EXPOSURE_TIERS = {
  HIGH: 20, // >= 20% exposure
  MEDIUM: 8, // >= 8% and < 20%
  // anything below MEDIUM is LOW
};

export function exposureTierFor(pct) {
  if (pct == null) return 'unknown';
  if (pct >= EXPOSURE_TIERS.HIGH) return 'high';
  if (pct >= EXPOSURE_TIERS.MEDIUM) return 'medium';
  return 'low';
}

/**
 * @typedef {Object} SupplyChainCounterparty
 * @property {string} id            Ticker, used as graph node id
 * @property {string} ticker
 * @property {string} name
 * @property {string} relationshipType   Human label, e.g. "Sole Foundry Partner"
 * @property {number} [revenueExposurePct]  % of *this company's* revenue tied to target (suppliers/customers)
 * @property {number} [cogsExposurePct]     % of *target's* COGS this vendor supplies (suppliers only)
 * @property {number} annualValueUsdM       Estimated annual $ value of the relationship
 * @property {string} dataSource            e.g. "SEC Form 10-K, Item 1"
 * @property {number} marketCapUsdB
 * @property {string} sector
 * @property {number} oneYearPerformancePct
 * @property {'Low'|'Medium'|'High'} riskScore   Supply-chain disruption risk
 */

const AAPL = {
  ticker: 'AAPL',
  name: 'Apple Inc.',
  sector: 'Technology Hardware',
  marketCapUsdB: 3450,
  oneYearPerformancePct: 24.8,
  suppliers: [
    {
      id: 'TSM',
      ticker: 'TSM',
      name: 'Taiwan Semiconductor Mfg.',
      relationshipType: 'Sole-Source Chip Foundry (A-series / M-series SoCs)',
      revenueExposurePct: 22,
      cogsExposurePct: 18,
      annualValueUsdM: 19500,
      dataSource: 'SEC Form 10-K, Item 1 (Customer Concentration)',
      marketCapUsdB: 720,
      sector: 'Semiconductors',
      oneYearPerformancePct: 61.2,
      riskScore: 'High',
    },
    {
      id: '2317.TW',
      ticker: '2317.TW',
      name: 'Foxconn / Hon Hai Precision',
      relationshipType: 'Primary Final-Assembly (iPhone/iPad/Mac EMS)',
      revenueExposurePct: 52,
      cogsExposurePct: 45,
      annualValueUsdM: 68000,
      dataSource: 'Trade Shipment Manifest (Import Genius) + 10-K',
      marketCapUsdB: 68,
      sector: 'Electronics Manufacturing Services',
      oneYearPerformancePct: 38.4,
      riskScore: 'High',
    },
    {
      id: 'QCOM',
      ticker: 'QCOM',
      name: 'Qualcomm Inc.',
      relationshipType: 'Cellular Modem / RF Supplier (Snapdragon X)',
      revenueExposurePct: 8,
      cogsExposurePct: 6,
      annualValueUsdM: 3200,
      dataSource: 'SEC Form 10-K, Item 1',
      marketCapUsdB: 195,
      sector: 'Semiconductors',
      oneYearPerformancePct: 12.1,
      riskScore: 'Medium',
    },
    {
      id: 'SWKS',
      ticker: 'SWKS',
      name: 'Skyworks Solutions',
      relationshipType: 'RF Front-End Module Supplier',
      revenueExposurePct: 65,
      cogsExposurePct: 4,
      annualValueUsdM: 1750,
      dataSource: 'SEC Form 10-K, Item 1 (Customer Concentration)',
      marketCapUsdB: 12,
      sector: 'Semiconductors',
      oneYearPerformancePct: -9.7,
      riskScore: 'Medium',
    },
    {
      id: 'SONY',
      ticker: 'SONY',
      name: 'Sony Group Corp.',
      relationshipType: 'CMOS Image Sensor Supplier (Camera Modules)',
      revenueExposurePct: 13,
      cogsExposurePct: 5,
      annualValueUsdM: 2100,
      dataSource: 'Analyst Estimate (Nikkei supply-chain survey)',
      marketCapUsdB: 135,
      sector: 'Consumer Electronics',
      oneYearPerformancePct: 29.6,
      riskScore: 'Low',
    },
  ],
  customers: [
    {
      id: 'BBY',
      ticker: 'BBY',
      name: 'Best Buy Co.',
      relationshipType: 'Retail Distribution Channel',
      revenueExposurePct: 5,
      annualValueUsdM: 19000,
      dataSource: 'Analyst Estimate (channel-checks)',
      marketCapUsdB: 18,
      sector: 'Specialty Retail',
      oneYearPerformancePct: 4.3,
      riskScore: 'Low',
    },
    {
      id: 'AMZN',
      ticker: 'AMZN',
      name: 'Amazon.com Inc.',
      relationshipType: 'Retail Distribution Channel (Marketplace + 1P)',
      revenueExposurePct: 7,
      annualValueUsdM: 26500,
      dataSource: 'Analyst Estimate',
      marketCapUsdB: 1980,
      sector: 'Internet Retail',
      oneYearPerformancePct: 44.1,
      riskScore: 'Low',
    },
    {
      id: 'VZ',
      ticker: 'VZ',
      name: 'Verizon Communications',
      relationshipType: 'Carrier Channel / Device Financing Partner',
      revenueExposurePct: 6,
      annualValueUsdM: 22700,
      dataSource: 'Analyst Estimate (carrier sell-through data)',
      marketCapUsdB: 175,
      sector: 'Telecom Services',
      oneYearPerformancePct: 15.8,
      riskScore: 'Low',
    },
    {
      id: 'T',
      ticker: 'T',
      name: 'AT&T Inc.',
      relationshipType: 'Carrier Channel / Device Financing Partner',
      revenueExposurePct: 5,
      annualValueUsdM: 18900,
      dataSource: 'Analyst Estimate (carrier sell-through data)',
      marketCapUsdB: 162,
      sector: 'Telecom Services',
      oneYearPerformancePct: 9.2,
      riskScore: 'Low',
    },
  ],
  competitors: [
    {
      id: 'SSNLF',
      ticker: 'SSNLF',
      name: 'Samsung Electronics',
      relationshipType: 'Direct Competitor (Smartphones, Wearables)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 385,
      sector: 'Technology Hardware',
      oneYearPerformancePct: 11.4,
      riskScore: 'Low',
    },
    {
      id: 'MSFT',
      ticker: 'MSFT',
      name: 'Microsoft Corp.',
      relationshipType: 'Direct Competitor (PC/Tablet OS, Services)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 3120,
      sector: 'Software & Services',
      oneYearPerformancePct: 21.9,
      riskScore: 'Low',
    },
    {
      id: 'GOOGL',
      ticker: 'GOOGL',
      name: 'Alphabet Inc.',
      relationshipType: 'Direct Competitor (Mobile OS, Services)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 2240,
      sector: 'Interactive Media',
      oneYearPerformancePct: 33.5,
      riskScore: 'Low',
    },
  ],
};

const NVDA = {
  ticker: 'NVDA',
  name: 'NVIDIA Corp.',
  sector: 'Semiconductors',
  marketCapUsdB: 3280,
  oneYearPerformancePct: 178.3,
  suppliers: [
    {
      id: 'TSM',
      ticker: 'TSM',
      name: 'Taiwan Semiconductor Mfg.',
      relationshipType: 'Sole-Source Foundry (CoWoS / 4N Process)',
      revenueExposurePct: 11,
      cogsExposurePct: 55,
      annualValueUsdM: 14200,
      dataSource: 'SEC Form 10-K, Item 1',
      marketCapUsdB: 720,
      sector: 'Semiconductors',
      oneYearPerformancePct: 61.2,
      riskScore: 'High',
    },
    {
      id: 'SK',
      ticker: '000660.KS',
      name: 'SK Hynix Inc.',
      relationshipType: 'HBM3E Memory Supplier',
      revenueExposurePct: 18,
      cogsExposurePct: 20,
      annualValueUsdM: 8600,
      dataSource: 'Analyst Estimate (supply-chain checks)',
      marketCapUsdB: 92,
      sector: 'Semiconductors',
      oneYearPerformancePct: 68.9,
      riskScore: 'High',
    },
    {
      id: 'FXCONN',
      ticker: '2317.TW',
      name: 'Foxconn / Hon Hai Precision',
      relationshipType: 'GPU Server Rack Assembly (GB200 NVL72)',
      revenueExposurePct: 6,
      cogsExposurePct: 9,
      annualValueUsdM: 5100,
      dataSource: 'Trade Shipment Manifest',
      marketCapUsdB: 68,
      sector: 'Electronics Manufacturing Services',
      oneYearPerformancePct: 38.4,
      riskScore: 'Medium',
    },
  ],
  customers: [
    {
      id: 'MSFT',
      ticker: 'MSFT',
      name: 'Microsoft Corp.',
      relationshipType: 'Hyperscaler / AI Infrastructure Buyer',
      revenueExposurePct: 19,
      annualValueUsdM: 24500,
      dataSource: 'SEC Form 10-K, Item 1 (Customer Concentration)',
      marketCapUsdB: 3120,
      sector: 'Software & Services',
      oneYearPerformancePct: 21.9,
      riskScore: 'Medium',
    },
    {
      id: 'META',
      ticker: 'META',
      name: 'Meta Platforms Inc.',
      relationshipType: 'Hyperscaler / AI Infrastructure Buyer',
      revenueExposurePct: 14,
      annualValueUsdM: 18100,
      dataSource: 'SEC Form 10-K, Item 1 (Customer Concentration)',
      marketCapUsdB: 1450,
      sector: 'Interactive Media',
      oneYearPerformancePct: 41.2,
      riskScore: 'Medium',
    },
    {
      id: 'AMZN',
      ticker: 'AMZN',
      name: 'Amazon.com Inc. (AWS)',
      relationshipType: 'Hyperscaler / AI Infrastructure Buyer',
      revenueExposurePct: 12,
      annualValueUsdM: 15600,
      dataSource: 'SEC Form 10-K, Item 1 (Customer Concentration)',
      marketCapUsdB: 1980,
      sector: 'Internet Retail',
      oneYearPerformancePct: 44.1,
      riskScore: 'Medium',
    },
  ],
  competitors: [
    {
      id: 'AMD',
      ticker: 'AMD',
      name: 'Advanced Micro Devices',
      relationshipType: 'Direct Competitor (GPU / Data Center Accelerators)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 225,
      sector: 'Semiconductors',
      oneYearPerformancePct: -6.8,
      riskScore: 'Low',
    },
    {
      id: 'INTC',
      ticker: 'INTC',
      name: 'Intel Corp.',
      relationshipType: 'Direct Competitor (Data Center Accelerators)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 98,
      sector: 'Semiconductors',
      oneYearPerformancePct: -22.4,
      riskScore: 'Low',
    },
  ],
};

const TSLA = {
  ticker: 'TSLA',
  name: 'Tesla Inc.',
  sector: 'Automobiles',
  marketCapUsdB: 1080,
  oneYearPerformancePct: 8.6,
  suppliers: [
    {
      id: 'PANW-BATT',
      ticker: '6752.T',
      name: 'Panasonic Holdings',
      relationshipType: 'Battery Cell Supplier (2170/4680 co-production)',
      revenueExposurePct: 9,
      cogsExposurePct: 15,
      annualValueUsdM: 4300,
      dataSource: 'SEC Form 10-K, Item 1',
      marketCapUsdB: 38,
      sector: 'Consumer Electronics',
      oneYearPerformancePct: 6.1,
      riskScore: 'Medium',
    },
    {
      id: 'CATL',
      ticker: '300750.SZ',
      name: 'Contemporary Amperex (CATL)',
      relationshipType: 'LFP Battery Cell Supplier',
      revenueExposurePct: 7,
      cogsExposurePct: 12,
      annualValueUsdM: 3600,
      dataSource: 'Analyst Estimate (supply-chain checks)',
      marketCapUsdB: 145,
      sector: 'Battery Manufacturing',
      oneYearPerformancePct: 19.3,
      riskScore: 'Medium',
    },
    {
      id: 'ALB',
      ticker: 'ALB',
      name: 'Albemarle Corp.',
      relationshipType: 'Lithium / Raw Materials Supplier',
      revenueExposurePct: 4,
      cogsExposurePct: 5,
      annualValueUsdM: 900,
      dataSource: 'Analyst Estimate',
      marketCapUsdB: 11,
      sector: 'Specialty Chemicals',
      oneYearPerformancePct: -18.7,
      riskScore: 'Low',
    },
  ],
  customers: [
    {
      id: 'HERTZ',
      ticker: 'HTZ',
      name: 'Hertz Global Holdings',
      relationshipType: 'Fleet Buyer',
      revenueExposurePct: 2,
      annualValueUsdM: 700,
      dataSource: 'Analyst Estimate',
      marketCapUsdB: 3,
      sector: 'Rental & Leasing',
      oneYearPerformancePct: -12.9,
      riskScore: 'Low',
    },
  ],
  competitors: [
    {
      id: 'BYDDY',
      ticker: 'BYDDY',
      name: 'BYD Company Ltd.',
      relationshipType: 'Direct Competitor (BEV/PHEV)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 105,
      sector: 'Automobiles',
      oneYearPerformancePct: 52.7,
      riskScore: 'Low',
    },
    {
      id: 'RIVN',
      ticker: 'RIVN',
      name: 'Rivian Automotive',
      relationshipType: 'Direct Competitor (BEV)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 14,
      sector: 'Automobiles',
      oneYearPerformancePct: -4.2,
      riskScore: 'Low',
    },
    {
      id: 'F',
      ticker: 'F',
      name: 'Ford Motor Co.',
      relationshipType: 'Direct Competitor (BEV segment)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 42,
      sector: 'Automobiles',
      oneYearPerformancePct: -7.5,
      riskScore: 'Low',
    },
  ],
};

const MSFT = {
  ticker: 'MSFT',
  name: 'Microsoft Corp.',
  sector: 'Software & Services',
  marketCapUsdB: 3120,
  oneYearPerformancePct: 21.9,
  suppliers: [
    {
      id: 'NVDA',
      ticker: 'NVDA',
      name: 'NVIDIA Corp.',
      relationshipType: 'AI Accelerator / GPU Supplier (Azure)',
      revenueExposurePct: 19,
      cogsExposurePct: 10,
      annualValueUsdM: 24500,
      dataSource: 'Analyst Estimate (capex disclosures)',
      marketCapUsdB: 3280,
      sector: 'Semiconductors',
      oneYearPerformancePct: 178.3,
      riskScore: 'High',
    },
    {
      id: 'AMD',
      ticker: 'AMD',
      name: 'Advanced Micro Devices',
      relationshipType: 'Secondary AI Accelerator Supplier (Azure)',
      revenueExposurePct: 6,
      cogsExposurePct: 3,
      annualValueUsdM: 3100,
      dataSource: 'Analyst Estimate',
      marketCapUsdB: 225,
      sector: 'Semiconductors',
      oneYearPerformancePct: -6.8,
      riskScore: 'Medium',
    },
  ],
  customers: [
    {
      id: 'ACN',
      ticker: 'ACN',
      name: 'Accenture plc',
      relationshipType: 'Enterprise Reseller / Systems Integrator',
      revenueExposurePct: 4,
      annualValueUsdM: 9800,
      dataSource: 'Analyst Estimate',
      marketCapUsdB: 190,
      sector: 'IT Services',
      oneYearPerformancePct: -2.3,
      riskScore: 'Low',
    },
  ],
  competitors: [
    {
      id: 'AAPL',
      ticker: 'AAPL',
      name: 'Apple Inc.',
      relationshipType: 'Direct Competitor (OS, Devices, Services)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 3450,
      sector: 'Technology Hardware',
      oneYearPerformancePct: 24.8,
      riskScore: 'Low',
    },
    {
      id: 'GOOGL',
      ticker: 'GOOGL',
      name: 'Alphabet Inc.',
      relationshipType: 'Direct Competitor (Cloud, Productivity, AI)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 2240,
      sector: 'Interactive Media',
      oneYearPerformancePct: 33.5,
      riskScore: 'Low',
    },
    {
      id: 'AMZN',
      ticker: 'AMZN',
      name: 'Amazon.com Inc. (AWS)',
      relationshipType: 'Direct Competitor (Cloud Infrastructure)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 1980,
      sector: 'Internet Retail',
      oneYearPerformancePct: 44.1,
      riskScore: 'Low',
    },
  ],
};

const AMD = {
  ticker: 'AMD',
  name: 'Advanced Micro Devices',
  sector: 'Semiconductors',
  marketCapUsdB: 225,
  oneYearPerformancePct: -6.8,
  suppliers: [
    {
      id: 'TSM',
      ticker: 'TSM',
      name: 'Taiwan Semiconductor Mfg.',
      relationshipType: 'Sole-Source Foundry (CPU/GPU Dies)',
      revenueExposurePct: 4,
      cogsExposurePct: 62,
      annualValueUsdM: 6100,
      dataSource: 'SEC Form 10-K, Item 1',
      marketCapUsdB: 720,
      sector: 'Semiconductors',
      oneYearPerformancePct: 61.2,
      riskScore: 'High',
    },
    {
      id: 'ASE',
      ticker: 'ASX',
      name: 'ASE Technology Holding',
      relationshipType: 'Chip Packaging & Test (OSAT)',
      revenueExposurePct: 5,
      cogsExposurePct: 8,
      annualValueUsdM: 850,
      dataSource: 'Analyst Estimate',
      marketCapUsdB: 22,
      sector: 'Semiconductors',
      oneYearPerformancePct: 4.9,
      riskScore: 'Medium',
    },
  ],
  customers: [
    {
      id: 'MSFT',
      ticker: 'MSFT',
      name: 'Microsoft Corp.',
      relationshipType: 'Secondary AI Accelerator Buyer (Azure)',
      revenueExposurePct: 9,
      annualValueUsdM: 3100,
      dataSource: 'Analyst Estimate',
      marketCapUsdB: 3120,
      sector: 'Software & Services',
      oneYearPerformancePct: 21.9,
      riskScore: 'Medium',
    },
    {
      id: 'DELL',
      ticker: 'DELL',
      name: 'Dell Technologies',
      relationshipType: 'OEM / Server & PC Integrator',
      revenueExposurePct: 7,
      annualValueUsdM: 2400,
      dataSource: 'Analyst Estimate',
      marketCapUsdB: 78,
      sector: 'Technology Hardware',
      oneYearPerformancePct: 3.4,
      riskScore: 'Low',
    },
  ],
  competitors: [
    {
      id: 'NVDA',
      ticker: 'NVDA',
      name: 'NVIDIA Corp.',
      relationshipType: 'Direct Competitor (GPU / Data Center Accelerators)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 3280,
      sector: 'Semiconductors',
      oneYearPerformancePct: 178.3,
      riskScore: 'Low',
    },
    {
      id: 'INTC',
      ticker: 'INTC',
      name: 'Intel Corp.',
      relationshipType: 'Direct Competitor (CPU / Data Center)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 98,
      sector: 'Semiconductors',
      oneYearPerformancePct: -22.4,
      riskScore: 'Low',
    },
    {
      id: 'QCOM',
      ticker: 'QCOM',
      name: 'Qualcomm Inc.',
      relationshipType: 'Direct Competitor (Client/Mobile Compute)',
      annualValueUsdM: null,
      dataSource: 'GICS Sub-Industry Classification',
      marketCapUsdB: 195,
      sector: 'Semiconductors',
      oneYearPerformancePct: 12.1,
      riskScore: 'Low',
    },
  ],
};

export const SUPPLY_CHAIN_DATASETS = {
  AAPL,
  NVDA,
  TSLA,
  MSFT,
  AMD,
};

export const MARQUEE_TICKERS = Object.keys(SUPPLY_CHAIN_DATASETS);
