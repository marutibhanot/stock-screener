"""Supply Chain Analysis (SPLC) dashboard API.

Backs the frontend's /supply-chain page (see
docs/SUPPLY_CHAIN_DASHBOARD.md and frontend/src/api/supplyChain.js).
Currently served from an in-memory mock dataset (splc_mock_data.py) covering
five marquee tickers -- swapping in a real data source (SEC EDGAR filing
parsing, Financial Modeling Prep, or a dedicated supply-chain vendor) only
requires changing get_splc_dataset() there; this router's contract shape
stays the same.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from .splc_mock_data import get_splc_dataset, supported_symbols

router = APIRouter()


def _exposure_of(entry: dict) -> float:
    """Same "whichever exposure field is present" convention used by the
    frontend's filtering logic (revenue exposure first, COGS exposure as a
    fallback for suppliers that only carry that field)."""
    return entry.get("revenueExposurePercent") or entry.get("cogsExposurePercent") or 0


@router.get("/")
async def get_splc_map(
    ticker: str = Query(..., min_length=1, max_length=15, description="Target ticker symbol, e.g. AAPL"),
    min_exposure: float = Query(
        0,
        alias="minExposure",
        ge=0,
        le=100,
        description="Drop suppliers/customers below this exposure %% (competitors are never filtered by exposure)",
    ),
) -> dict:
    """GET /v1/splc?ticker={SYMBOL}&minExposure={PERCENTAGE}

    Returns { target, suppliers[], customers[], competitors[] } per the
    SPLCApiResponse contract. 404s for tickers outside the current mock
    coverage (see splc_mock_data.SPLC_DATASETS) -- the frontend surfaces this
    as "[ERROR: TICKER NOT FOUND IN SEC / SPLC DATABASE]".

    minExposure is honored server-side for API consumers that want
    pre-filtered results, but the dashboard's own slider filters
    client-side against the full (minExposure=0) response instead, so
    dragging it doesn't cost a network round-trip -- see
    SupplyChainContext.jsx's filteredCounterparties.
    """
    normalized = ticker.strip().upper()
    dataset = get_splc_dataset(normalized)
    if dataset is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No SPLC data for {normalized!r}. Currently covered: {', '.join(supported_symbols())}."
            ),
        )

    target = {
        "symbol": dataset["symbol"],
        "name": dataset["name"],
        "marketCap": dataset["marketCap"],
        "sector": dataset["sector"],
        "industry": dataset["industry"],
        # Not part of the strict TargetCompany interface, but the Inspector
        # panel's target overview displays it -- see docs/SUPPLY_CHAIN_DASHBOARD.md.
        "oneYearPerformancePct": dataset.get("oneYearPerformancePct"),
    }

    suppliers = [e for e in dataset["suppliers"] if _exposure_of(e) >= min_exposure]
    customers = [e for e in dataset["customers"] if _exposure_of(e) >= min_exposure]
    competitors = dataset["competitors"]  # never exposure-filtered -- no exposure field

    return {
        "target": target,
        "suppliers": suppliers,
        "customers": customers,
        "competitors": competitors,
    }
