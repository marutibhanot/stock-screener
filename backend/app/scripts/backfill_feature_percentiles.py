"""Operator CLI for backfilling feature_percentiles over a date range.

Recovery path for the daily beat job (app.tasks.feature_percentile_tasks.compute_daily)
missing a day -- e.g. the options pipeline ran unusually slowly that day and
hadn't finished writing options_metrics_snapshots by the 19:30 ET buffer.
Also the only way to populate history before the beat job's first run.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date

from app.config.settings import settings
from app.database import SessionLocal
from app.services.feature_percentiles.compute import ComputeFeaturePercentilesService
from app.services.market_calendar_service import MarketCalendarService


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"Invalid ISO date: {value}") from exc


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Backfill feature_percentiles over a date range",
    )
    parser.add_argument("--market", default="US")
    parser.add_argument("--through-date", required=True, type=_parse_date)
    parser.add_argument("--start-date", required=True, type=_parse_date)
    return parser


def execute_backfill(options: argparse.Namespace) -> dict:
    service = ComputeFeaturePercentilesService(
        session_factory=SessionLocal,
        calendar_service=MarketCalendarService(),
        trailing_window_days=settings.feature_percentiles_trailing_window_days,
        min_sample_size=settings.feature_percentiles_min_sample_size,
    )
    results = service.backfill(
        start_date=options.start_date,
        through_date=options.through_date,
        market=options.market,
    )
    return {
        "market": options.market,
        "start_date": options.start_date.isoformat(),
        "through_date": options.through_date.isoformat(),
        "results": [
            {
                "status": r.status.value,
                "trading_date": r.trading_date.isoformat(),
                "tickers_processed": r.tickers_processed,
                "rows_written": r.rows_written,
                "reason": r.reason,
                "error": r.error,
            }
            for r in results
        ],
        "errored_count": sum(1 for r in results if r.status.value == "errored"),
    }


def main(argv: list[str] | None = None) -> int:
    options = _build_parser().parse_args(argv)
    payload = execute_backfill(options)
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 1 if payload["errored_count"] > 0 else 0


if __name__ == "__main__":  # pragma: no cover - CLI entrypoint
    sys.exit(main())
