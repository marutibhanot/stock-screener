"""Add feature_percentiles table -- the normalization layer for options
analytics features. Raw values from options_metrics_snapshots, gex_snapshots,
and external_volatility_history are not comparable across tickers or across
time; downstream modules (regime classifier, setup generator -- not built
yet) read percentiles from this table instead of raw values.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260807_0035"
down_revision = "20260807_0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "feature_percentiles",
        sa.Column("ticker", sa.String(20), nullable=False),
        sa.Column("trading_date", sa.Date(), nullable=False),
        sa.Column("feature_name", sa.String(50), nullable=False),
        sa.Column("raw_value", sa.Numeric(18, 6), nullable=True),
        sa.Column("pct_self_252d", sa.Numeric(6, 3), nullable=True),
        sa.Column("z_self_252d", sa.Numeric(10, 4), nullable=True),
        sa.Column("pct_xsec", sa.Numeric(6, 3), nullable=True),
        sa.Column("sample_size_self", sa.Integer(), nullable=False),
        sa.Column("history_tier", sa.String(10), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint(
            "ticker", "trading_date", "feature_name",
            name="pk_feature_percentiles",
        ),
        sa.CheckConstraint(
            "history_tier IN ('deep', 'shallow')",
            name="ck_feature_percentiles_history_tier",
        ),
    )
    # (ticker, trading_date) lookups are already served by the composite PK's
    # own leftmost-prefix btree -- only (feature_name, trading_date) needs a
    # dedicated index here.
    op.create_index(
        "ix_feature_percentiles_feature_date",
        "feature_percentiles",
        ["feature_name", "trading_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_feature_percentiles_feature_date", "feature_percentiles")
    op.drop_table("feature_percentiles")
