"""Tests for feature_percentiles.extraction: front-expiration selection and
the derived-feature math (premium_notional_imbalance, iv_hv_spread)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.services.feature_percentiles.extraction import (
    ALL_FEATURE_NAMES,
    FEATURE_HISTORY_TIER,
    extract_gex_features,
    extract_options_metrics_features,
    extract_volatility_history_features,
    select_front_expiration_row,
)


@dataclass
class _Row:
    expiration: date | None
    label: str = ""


class TestSelectFrontExpirationRow:
    def test_picks_nearest_expiration(self):
        rows = [
            _Row(expiration=date(2026, 9, 1), label="far"),
            _Row(expiration=date(2026, 8, 15), label="near"),
            _Row(expiration=date(2026, 10, 1), label="farthest"),
        ]
        assert select_front_expiration_row(rows).label == "near"

    def test_empty_list_returns_none(self):
        assert select_front_expiration_row([]) is None

    def test_rows_with_no_expiration_are_ignored(self):
        rows = [_Row(expiration=None, label="no-exp"), _Row(expiration=date(2026, 8, 15), label="only-real")]
        assert select_front_expiration_row(rows).label == "only-real"

    def test_all_none_expiration_returns_none(self):
        rows = [_Row(expiration=None), _Row(expiration=None)]
        assert select_front_expiration_row(rows) is None


@dataclass
class _OptionsMetricsRow:
    ivr: float | None = None
    skew: float | None = None
    volatility_risk_premium: float | None = None
    term_structure_ratio: float | None = None
    net_dex: float | None = None
    net_vex: float | None = None
    net_cex: float | None = None
    total_gex: float | None = None
    max_pain_distance_pct: float | None = None
    volume_put_call_ratio: float | None = None
    open_interest_put_call_ratio: float | None = None
    net_delta_dollar_flow: float | None = None
    call_premium_notional: float | None = None
    put_premium_notional: float | None = None


class TestExtractOptionsMetricsFeatures:
    def test_none_row_returns_all_none(self):
        result = extract_options_metrics_features(None)
        assert set(result.keys()) == {
            "ivr", "skew", "volatility_risk_premium", "term_structure_ratio",
            "net_dex", "net_vex", "net_cex", "total_gex",
            "max_pain_distance_pct", "volume_put_call_ratio",
            "open_interest_put_call_ratio", "net_delta_dollar_flow",
            "premium_notional_imbalance",
        }
        assert all(v is None for v in result.values())

    def test_premium_notional_imbalance_math(self):
        row = _OptionsMetricsRow(call_premium_notional=1500.0, put_premium_notional=500.0)
        result = extract_options_metrics_features(row)
        # (1500 - 500) / (1500 + 500) = 0.5
        assert result["premium_notional_imbalance"] == 0.5

    def test_premium_notional_imbalance_none_when_either_side_missing(self):
        row = _OptionsMetricsRow(call_premium_notional=1500.0, put_premium_notional=None)
        assert extract_options_metrics_features(row)["premium_notional_imbalance"] is None

    def test_premium_notional_imbalance_none_when_denominator_zero(self):
        row = _OptionsMetricsRow(call_premium_notional=0.0, put_premium_notional=0.0)
        assert extract_options_metrics_features(row)["premium_notional_imbalance"] is None

    def test_passthrough_fields(self):
        row = _OptionsMetricsRow(ivr=42.0, skew=0.15)
        result = extract_options_metrics_features(row)
        assert result["ivr"] == 42.0
        assert result["skew"] == 0.15


@dataclass
class _GexRow:
    distance_to_flip_pct: float | None = None


class TestExtractGexFeatures:
    def test_none_row(self):
        assert extract_gex_features(None) == {"distance_to_flip_pct": None}

    def test_passthrough(self):
        assert extract_gex_features(_GexRow(distance_to_flip_pct=3.2)) == {
            "distance_to_flip_pct": 3.2
        }


@dataclass
class _VolatilityRow:
    iv_current: float | None = None
    hv_current: float | None = None


class TestExtractVolatilityHistoryFeatures:
    def test_none_row(self):
        result = extract_volatility_history_features(None)
        assert result == {"iv_current": None, "hv_current": None, "iv_hv_spread": None}

    def test_iv_hv_spread_math(self):
        row = _VolatilityRow(iv_current=0.32, hv_current=0.27)
        result = extract_volatility_history_features(row)
        assert abs(result["iv_hv_spread"] - 0.05) < 1e-9

    def test_iv_hv_spread_none_when_either_missing(self):
        row = _VolatilityRow(iv_current=0.32, hv_current=None)
        assert extract_volatility_history_features(row)["iv_hv_spread"] is None


class TestHistoryTierMapping:
    def test_every_feature_has_a_tier(self):
        assert set(FEATURE_HISTORY_TIER.keys()) == set(ALL_FEATURE_NAMES)
        assert set(FEATURE_HISTORY_TIER.values()) == {"deep", "shallow"}

    def test_volatility_features_are_deep_tier(self):
        assert FEATURE_HISTORY_TIER["iv_current"] == "deep"
        assert FEATURE_HISTORY_TIER["hv_current"] == "deep"
        assert FEATURE_HISTORY_TIER["iv_hv_spread"] == "deep"

    def test_options_metrics_and_gex_features_are_shallow_tier(self):
        assert FEATURE_HISTORY_TIER["ivr"] == "shallow"
        assert FEATURE_HISTORY_TIER["distance_to_flip_pct"] == "shallow"
