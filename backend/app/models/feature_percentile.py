"""Percentile-normalized options analytics features.

Raw metric values (IVR, skew, net GEX, distance-to-flip, IV-HV spread, ...)
are not comparable across tickers or across time -- a skew of 0.15 might be
extreme for one ticker and routine for another. Downstream modules (regime
classifier, setup generator -- not built yet) must read percentiles from this
table, never raw values, for exactly that reason.

One row per (ticker, trading_date, feature_name). Two independent
normalizations are computed per row:

  - pct_self_252d / z_self_252d: this ticker's own trailing 252 *trading*
    days (not calendar days), excluding today -- "is this reading unusual
    for this specific ticker." NULL (with the real sample_size_self
    preserved) whenever fewer than settings.feature_percentiles_min_sample_size
    observations exist; never silently computed over a shorter window.
  - pct_xsec: rank against every other ticker with a value for that same
    feature on that same trading_date -- "is this reading unusual today,
    across the universe."

history_tier records which source table raw_value came from, because those
tables have wildly different coverage as of this table's creation
(2026-08-07): external_volatility_history ('deep') goes back to 2019-02-09,
while options_metrics_snapshots/gex_snapshots ('shallow') only started
accumulating 2026-08-06/2026-08-03 respectively. A 'shallow' row's
pct_self_252d will be NULL for months until enough history accumulates --
that's expected, not a bug, and downstream consumers must branch on
history_tier rather than assume uniform coverage.

See backend/alembic/versions/20260807_0035_add_feature_percentiles.py for
the migration, and app/services/feature_percentiles/ for the job that
populates this table.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, Column, Date, DateTime, Index, Integer, Numeric, String

from ..database import Base


class FeaturePercentile(Base):
    """One row per (ticker, trading_date, feature_name): that feature's
    normalized reading for that ticker on that trading day.

    Natural key IS the primary key here (ticker, trading_date, feature_name)
    -- unlike gex_snapshots/max_pain_snapshots (integer id PK, app-level
    check-then-write upsert only, see options_snapshot_upsert.py), this table
    has no legacy-duplicate baggage, so the composite key is enforced at the
    DB level from day one and populated via a real
    ``INSERT ... ON CONFLICT DO UPDATE`` (see compute.py).
    """

    __tablename__ = "feature_percentiles"

    ticker = Column(String(20), primary_key=True, nullable=False)
    trading_date = Column(Date, primary_key=True, nullable=False)
    feature_name = Column(String(50), primary_key=True, nullable=False)

    raw_value = Column(Numeric(18, 6), nullable=True)
    pct_self_252d = Column(Numeric(6, 3), nullable=True)
    z_self_252d = Column(Numeric(10, 4), nullable=True)
    pct_xsec = Column(Numeric(6, 3), nullable=True)
    # Real trailing-window observation count, even when it's below the
    # minimum-sample threshold and the percentile/z-score columns are NULL.
    sample_size_self = Column(Integer, nullable=False)
    history_tier = Column(String(10), nullable=False)  # 'deep' | 'shallow'

    computed_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "history_tier IN ('deep', 'shallow')",
            name="ck_feature_percentiles_history_tier",
        ),
        # (ticker, trading_date) lookups are already served by the composite
        # PK's own leftmost-prefix btree; only (feature_name, trading_date)
        # needs a dedicated index.
        Index("ix_feature_percentiles_feature_date", "feature_name", "trading_date"),
    )
