"""Feature extraction from options source tables, plus the shared
front-expiration aggregation rule.

Feature list, exactly as scoped:
  - shallow tier, from options_metrics_snapshots: ivr, skew,
    volatility_risk_premium, term_structure_ratio, net_dex, net_vex,
    net_cex, total_gex, max_pain_distance_pct, volume_put_call_ratio,
    open_interest_put_call_ratio, net_delta_dollar_flow, and derived
    premium_notional_imbalance.
  - shallow tier, from gex_snapshots: distance_to_flip_pct.
  - deep tier, from external_volatility_history: iv_current, hv_current,
    and derived iv_hv_spread.

"Shallow"/"deep" here means the source table's own data-coverage history,
not anything about the feature's importance -- see app/models/feature_percentile.py.
"""

from __future__ import annotations

from typing import Any, Callable, Protocol, Sequence


class _HasExpiration(Protocol):
    expiration: Any  # date | None


def select_front_expiration_row(rows: Sequence[_HasExpiration]) -> Any | None:
    """Aggregation rule for tables with one row per (ticker, expiration):
    use the nearest expiration.

    Explicit and swappable -- call select_front_expiration_row_by directly
    with a different `key` to change the rule without touching call sites.
    Confirmed necessary against production data, not hypothetical: as of
    2026-08-07, SPY/QQQ each have 2 expiration rows on the same trading_date
    in options_metrics_snapshots.
    """
    return select_front_expiration_row_by(rows, key=lambda r: r.expiration)


def select_front_expiration_row_by(
    rows: Sequence[_HasExpiration],
    *,
    key: Callable[[Any], Any],
) -> Any | None:
    candidates = [r for r in rows if key(r) is not None]
    if not candidates:
        return None
    return min(candidates, key=key)


# ---------------------------------------------------------------------------
# options_metrics_snapshots (shallow tier)
# ---------------------------------------------------------------------------

OPTIONS_METRICS_FEATURES: tuple[str, ...] = (
    "ivr",
    "skew",
    "volatility_risk_premium",
    "term_structure_ratio",
    "net_dex",
    "net_vex",
    "net_cex",
    "total_gex",
    "max_pain_distance_pct",
    "volume_put_call_ratio",
    "open_interest_put_call_ratio",
    "net_delta_dollar_flow",
    "premium_notional_imbalance",
)


def extract_options_metrics_features(row: Any | None) -> dict[str, float | None]:
    """Raw feature values from a single, already front-expiration-selected
    options_metrics_snapshots row (pass the row through select_front_expiration_row
    first when a ticker has more than one expiration that day)."""
    if row is None:
        return {name: None for name in OPTIONS_METRICS_FEATURES}

    call_premium = row.call_premium_notional
    put_premium = row.put_premium_notional
    premium_notional_imbalance = None
    if call_premium is not None and put_premium is not None:
        denom = call_premium + put_premium
        if denom:
            premium_notional_imbalance = (call_premium - put_premium) / denom

    return {
        "ivr": row.ivr,
        "skew": row.skew,
        "volatility_risk_premium": row.volatility_risk_premium,
        "term_structure_ratio": row.term_structure_ratio,
        "net_dex": row.net_dex,
        "net_vex": row.net_vex,
        "net_cex": row.net_cex,
        "total_gex": row.total_gex,
        "max_pain_distance_pct": row.max_pain_distance_pct,
        "volume_put_call_ratio": row.volume_put_call_ratio,
        "open_interest_put_call_ratio": row.open_interest_put_call_ratio,
        "net_delta_dollar_flow": row.net_delta_dollar_flow,
        "premium_notional_imbalance": premium_notional_imbalance,
    }


# ---------------------------------------------------------------------------
# gex_snapshots (shallow tier)
# ---------------------------------------------------------------------------

GEX_FEATURES: tuple[str, ...] = ("distance_to_flip_pct",)


def extract_gex_features(row: Any | None) -> dict[str, float | None]:
    """`row` should already be front-expiration-selected (see
    select_front_expiration_row) when a ticker has more than one expiration
    that day."""
    if row is None:
        return {name: None for name in GEX_FEATURES}
    return {"distance_to_flip_pct": row.distance_to_flip_pct}


# ---------------------------------------------------------------------------
# external_volatility_history (deep tier)
# ---------------------------------------------------------------------------

VOLATILITY_HISTORY_FEATURES: tuple[str, ...] = ("iv_current", "hv_current", "iv_hv_spread")


def extract_volatility_history_features(row: Any | None) -> dict[str, float | None]:
    """`row` is the single external_volatility_history row for
    (symbol, trading_date) -- that table has no `expiration` column (one row
    per symbol per day already), so no front-expiration selection applies
    here."""
    if row is None:
        return {name: None for name in VOLATILITY_HISTORY_FEATURES}

    iv_current = None if row.iv_current is None else float(row.iv_current)
    hv_current = None if row.hv_current is None else float(row.hv_current)
    iv_hv_spread = None
    if iv_current is not None and hv_current is not None:
        iv_hv_spread = iv_current - hv_current

    return {
        "iv_current": iv_current,
        "hv_current": hv_current,
        "iv_hv_spread": iv_hv_spread,
    }


FEATURE_HISTORY_TIER: dict[str, str] = {
    **{name: "shallow" for name in OPTIONS_METRICS_FEATURES},
    **{name: "shallow" for name in GEX_FEATURES},
    **{name: "deep" for name in VOLATILITY_HISTORY_FEATURES},
}

ALL_FEATURE_NAMES: tuple[str, ...] = tuple(FEATURE_HISTORY_TIER.keys())
