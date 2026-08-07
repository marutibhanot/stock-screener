"""Celery task for the feature_percentiles normalization layer.

Scheduled at a fixed beat time, not chained from the options pipeline: that
pipeline's last stage (options_tasks.schedule_daily_update ->
batch_analyze_options_exposure) fans out one analyze_options_exposure task
per symbol and returns as soon as they're queued, with no completion
signal to chain from (see batch_analyze_options_exposure in
options_analysis_tasks.py). A fixed time with a generous buffer after the
17:30 ET pipeline start is a best-effort heuristic, not a guarantee -- an
unusually slow day could still leave stragglers uncounted for that day (the
backfill CLI, backend/app/scripts/backfill_feature_percentiles.py, exists
for exactly that recovery case).
"""

from __future__ import annotations

import logging
from datetime import date

from ..celery_app import celery_app as app
from ..config.settings import settings
from ..database import SessionLocal
from ..services.market_calendar_service import MarketCalendarService
from ..services.feature_percentiles.compute import (
    ComputeFeaturePercentilesResult,
    ComputeFeaturePercentilesService,
)

logger = logging.getLogger(__name__)


def _build_service() -> ComputeFeaturePercentilesService:
    return ComputeFeaturePercentilesService(
        session_factory=SessionLocal,
        calendar_service=MarketCalendarService(),
        trailing_window_days=settings.feature_percentiles_trailing_window_days,
        min_sample_size=settings.feature_percentiles_min_sample_size,
    )


def _result_to_dict(result: ComputeFeaturePercentilesResult) -> dict:
    return {
        "status": result.status.value,
        "trading_date": result.trading_date.isoformat(),
        "tickers_processed": result.tickers_processed,
        "rows_written": result.rows_written,
        "reason": result.reason,
        "error": result.error,
    }


@app.task(name="app.tasks.feature_percentile_tasks.compute_daily", bind=True, max_retries=1)
def compute_daily(self, trading_date_iso: str | None = None) -> dict:
    """Compute feature_percentiles for one trading day (default: today,
    US/Eastern -- matches trading_date_for()'s convention used by
    gex_snapshots/max_pain_snapshots/options_metrics_snapshots)."""
    trading_date = (
        date.fromisoformat(trading_date_iso) if trading_date_iso else date.today()
    )
    service = _build_service()
    result = service.compute_for_date(trading_date)
    logger.info("feature_percentiles compute_daily: %s", _result_to_dict(result))
    if result.status.value == "errored":
        raise self.retry(exc=RuntimeError(result.error), countdown=300)
    return _result_to_dict(result)


__all__ = ["compute_daily"]
