"""Orchestrates feature_percentiles computation for one trading day, or a
backfill over a date range.

Universe for a given trading_date is every distinct ticker present in
options_metrics_snapshots that day (the smallest/richest of the three source
tables, and the one most of the feature set is actually derived from --
confirmed against production data to be a strict subset of gex_snapshots'
own ticker set). gex_snapshots and external_volatility_history are looked up
for that same ticker set, not unioned in.

The trailing-window percentile/z-score for (ticker, feature_name) on a given
day is computed from feature_percentiles' OWN prior rows -- this table is
self-referential for its own history. That's why the upsert must be a real
idempotent ON CONFLICT DO UPDATE: recomputing a day (e.g. re-running after a
bug fix) must not duplicate or corrupt other days' rows.

Note on backfilling into the middle of existing history: within one
backfill() call, dates are processed oldest-first, so later dates in the
SAME call see the earlier ones. But this does NOT retroactively recompute
days that were already populated by a separate, prior run once an earlier
gap is filled later -- call compute_for_date again for those later dates if
they need to reflect newly backfilled history before them.
"""

from __future__ import annotations

from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from enum import StrEnum
from typing import Callable, Protocol

import numpy as np
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.feature_percentile import FeaturePercentile
from app.models.gex import GexSnapshot
from app.models.options_metrics_snapshot import OptionsMetricsSnapshot
from app.services.feature_percentiles.extraction import (
    ALL_FEATURE_NAMES,
    FEATURE_HISTORY_TIER,
    extract_gex_features,
    extract_options_metrics_features,
    extract_volatility_history_features,
    select_front_expiration_row,
)
from app.services.feature_percentiles.stats import (
    cross_sectional_percentile,
    trailing_exclusive_percentile_rank,
    trailing_exclusive_zscore,
)


class TradingDayRange(Protocol):
    def trading_days(self, market: str, start: date, end: date) -> list[date]: ...


SessionFactory = Callable[[], AbstractContextManager[Session]]


class ComputeFeaturePercentilesStatus(StrEnum):
    COMPLETED = "completed"
    SKIPPED = "skipped"
    ERRORED = "errored"


@dataclass(frozen=True)
class ComputeFeaturePercentilesResult:
    status: ComputeFeaturePercentilesStatus
    trading_date: date
    tickers_processed: int = 0
    rows_written: int = 0
    reason: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class _VolatilityHistoryRow:
    symbol: str
    iv_current: float | None
    hv_current: float | None


def _none_if_nan(value: float) -> float | None:
    return None if np.isnan(value) else float(value)


@dataclass(frozen=True)
class ComputeFeaturePercentilesService:
    """Compute + upsert feature_percentiles for one trading day, or a range."""

    session_factory: SessionFactory
    calendar_service: TradingDayRange
    trailing_window_days: int
    min_sample_size: int

    def compute_for_date(self, trading_date: date) -> ComputeFeaturePercentilesResult:
        with self.session_factory() as db:
            try:
                result = self._compute_for_date(db, trading_date)
            except Exception as exc:
                db.rollback()
                return ComputeFeaturePercentilesResult(
                    status=ComputeFeaturePercentilesStatus.ERRORED,
                    trading_date=trading_date,
                    error=str(exc),
                )
            else:
                db.commit()
                return result

    def backfill(
        self,
        *,
        start_date: date,
        through_date: date,
        market: str = "US",
    ) -> list[ComputeFeaturePercentilesResult]:
        trading_dates = self.calendar_service.trading_days(market, start_date, through_date)
        return [self.compute_for_date(trading_date) for trading_date in trading_dates]

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _compute_for_date(
        self, db: Session, trading_date: date
    ) -> ComputeFeaturePercentilesResult:
        tickers = self._resolve_universe(db, trading_date)
        if not tickers:
            return ComputeFeaturePercentilesResult(
                status=ComputeFeaturePercentilesStatus.SKIPPED,
                trading_date=trading_date,
                reason="no_options_metrics_snapshots_for_date",
            )

        options_metrics_by_ticker = self._load_options_metrics(db, trading_date, tickers)
        gex_by_ticker = self._load_gex(db, trading_date, tickers)
        volatility_by_ticker = self._load_volatility_history(db, trading_date, tickers)

        raw_values_by_ticker: dict[str, dict[str, float | None]] = {}
        for ticker in tickers:
            values: dict[str, float | None] = {}
            values.update(
                extract_options_metrics_features(options_metrics_by_ticker.get(ticker))
            )
            values.update(extract_gex_features(gex_by_ticker.get(ticker)))
            values.update(
                extract_volatility_history_features(volatility_by_ticker.get(ticker))
            )
            raw_values_by_ticker[ticker] = values

        history_by_ticker_feature = self._load_trailing_history(db, tickers, trading_date)

        computed_at = datetime.now(timezone.utc)
        rows: list[dict[str, object]] = []
        for feature_name in ALL_FEATURE_NAMES:
            xsec = cross_sectional_percentile(
                {
                    ticker: raw_values_by_ticker[ticker].get(feature_name)
                    for ticker in tickers
                }
            )
            for ticker in tickers:
                raw_value = raw_values_by_ticker[ticker].get(feature_name)
                history = history_by_ticker_feature.get((ticker, feature_name), [])
                series = np.array(
                    [*history, np.nan if raw_value is None else float(raw_value)],
                    dtype=float,
                )
                pct_arr, sample_size_arr = trailing_exclusive_percentile_rank(
                    series,
                    window=self.trailing_window_days,
                    min_sample=self.min_sample_size,
                )
                z_arr = trailing_exclusive_zscore(
                    series,
                    window=self.trailing_window_days,
                    min_sample=self.min_sample_size,
                )
                rows.append(
                    {
                        "ticker": ticker,
                        "trading_date": trading_date,
                        "feature_name": feature_name,
                        "raw_value": raw_value,
                        "pct_self_252d": _none_if_nan(pct_arr[-1]),
                        "z_self_252d": _none_if_nan(z_arr[-1]),
                        "pct_xsec": xsec.get(ticker),
                        "sample_size_self": int(sample_size_arr[-1]),
                        "history_tier": FEATURE_HISTORY_TIER[feature_name],
                        "computed_at": computed_at,
                    }
                )

        self._upsert(db, rows)

        return ComputeFeaturePercentilesResult(
            status=ComputeFeaturePercentilesStatus.COMPLETED,
            trading_date=trading_date,
            tickers_processed=len(tickers),
            rows_written=len(rows),
        )

    def _resolve_universe(self, db: Session, trading_date: date) -> list[str]:
        """Union of every ticker with ANY source data on this date -- not
        just options_metrics_snapshots. external_volatility_history has
        real coverage back to 2019-02-09 (2,321 symbols) that predates
        options_metrics_snapshots/gex_snapshots by years (both started
        2026); restricting the universe to the shallow tables would make
        that history permanently unreachable regardless of backfill range.
        A ticker only present in one source simply gets None for every
        feature from the others -- extract_*_features(None) already
        handles that, and cross_sectional_percentile already drops None
        entries, so no per-tier universe split is needed here.
        """
        shallow_rows = (
            db.query(OptionsMetricsSnapshot.ticker)
            .filter(OptionsMetricsSnapshot.trading_date == trading_date)
            .distinct()
            .all()
        )
        deep_rows = db.execute(
            text(
                "SELECT DISTINCT symbol FROM external_volatility_history WHERE trading_date = :trading_date"
            ),
            {"trading_date": trading_date},
        )
        tickers = {ticker for (ticker,) in shallow_rows} | {row[0] for row in deep_rows}
        return sorted(tickers)

    def _load_options_metrics(
        self, db: Session, trading_date: date, tickers: list[str]
    ) -> dict[str, OptionsMetricsSnapshot]:
        rows = (
            db.query(OptionsMetricsSnapshot)
            .filter(
                OptionsMetricsSnapshot.trading_date == trading_date,
                OptionsMetricsSnapshot.ticker.in_(tickers),
            )
            .all()
        )
        by_ticker: dict[str, list[OptionsMetricsSnapshot]] = {}
        for row in rows:
            by_ticker.setdefault(row.ticker, []).append(row)
        return {
            ticker: select_front_expiration_row(ticker_rows)
            for ticker, ticker_rows in by_ticker.items()
        }

    def _load_gex(
        self, db: Session, trading_date: date, tickers: list[str]
    ) -> dict[str, GexSnapshot]:
        rows = (
            db.query(GexSnapshot)
            .filter(
                GexSnapshot.trading_date == trading_date,
                GexSnapshot.ticker.in_(tickers),
            )
            .all()
        )
        by_ticker: dict[str, list[GexSnapshot]] = {}
        for row in rows:
            by_ticker.setdefault(row.ticker, []).append(row)
        return {
            ticker: select_front_expiration_row(ticker_rows)
            for ticker, ticker_rows in by_ticker.items()
        }

    def _load_volatility_history(
        self, db: Session, trading_date: date, tickers: list[str]
    ) -> dict[str, _VolatilityHistoryRow]:
        # No ORM model exists for external_volatility_history yet -- raw SQL,
        # matching this codebase's existing convention for un-modeled tables
        # (see app/services/options_history_service.py).
        result = db.execute(
            text(
                """
                SELECT symbol, iv_current, hv_current
                FROM external_volatility_history
                WHERE trading_date = :trading_date AND symbol = ANY(:tickers)
                """
            ),
            {"trading_date": trading_date, "tickers": tickers},
        )
        return {
            row.symbol: _VolatilityHistoryRow(
                symbol=row.symbol,
                iv_current=row.iv_current,
                hv_current=row.hv_current,
            )
            for row in result
        }

    def _load_trailing_history(
        self, db: Session, tickers: list[str], trading_date: date
    ) -> dict[tuple[str, str], list[float]]:
        # Trading days are always a subset of calendar days, so a 2x calendar
        # buffer comfortably covers `trailing_window_days` trading rows
        # (accounts for weekends/holidays) without scanning this table's
        # entire multi-year history as it grows.
        window_start = trading_date - timedelta(days=self.trailing_window_days * 2)
        rows = (
            db.query(
                FeaturePercentile.ticker,
                FeaturePercentile.feature_name,
                FeaturePercentile.trading_date,
                FeaturePercentile.raw_value,
            )
            .filter(
                FeaturePercentile.ticker.in_(tickers),
                FeaturePercentile.trading_date >= window_start,
                FeaturePercentile.trading_date < trading_date,
            )
            .order_by(
                FeaturePercentile.ticker,
                FeaturePercentile.feature_name,
                FeaturePercentile.trading_date,
            )
            .all()
        )
        history: dict[tuple[str, str], list[float]] = {}
        for ticker, feature_name, _row_date, raw_value in rows:
            key = (ticker, feature_name)
            history.setdefault(key, []).append(
                np.nan if raw_value is None else float(raw_value)
            )
        return history

    def _upsert(self, db: Session, rows: list[dict[str, object]]) -> None:
        if not rows:
            return
        stmt = pg_insert(FeaturePercentile).values(rows)
        update_columns = {
            column: getattr(stmt.excluded, column)
            for column in (
                "raw_value",
                "pct_self_252d",
                "z_self_252d",
                "pct_xsec",
                "sample_size_self",
                "history_tier",
                "computed_at",
            )
        }
        stmt = stmt.on_conflict_do_update(
            index_elements=["ticker", "trading_date", "feature_name"],
            set_=update_columns,
        )
        db.execute(stmt)


__all__ = [
    "ComputeFeaturePercentilesResult",
    "ComputeFeaturePercentilesService",
    "ComputeFeaturePercentilesStatus",
    "TradingDayRange",
]
