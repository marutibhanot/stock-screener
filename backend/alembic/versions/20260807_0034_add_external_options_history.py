"""Add external_option_chain_history and external_volatility_history tables,
seeded from the post-no-preference/options public Dolt database (2019-02-09
onward, updated daily) -- backtesting fuel for options-derived predictive
signals, since our own options_metrics_snapshots only started accumulating
2026-08-06.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260807_0034"
down_revision = "20260806_0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "external_option_chain_history",
        sa.Column("trading_date", sa.Date(), nullable=False),
        sa.Column("symbol", sa.String(20), nullable=False),
        sa.Column("expiration", sa.Date(), nullable=False),
        sa.Column("strike", sa.Numeric(10, 2), nullable=False),
        sa.Column("call_put", sa.String(4), nullable=False),
        sa.Column("bid", sa.Numeric(10, 2), nullable=True),
        sa.Column("ask", sa.Numeric(10, 2), nullable=True),
        sa.Column("implied_vol", sa.Numeric(7, 4), nullable=True),
        sa.Column("delta", sa.Numeric(7, 4), nullable=True),
        sa.Column("gamma", sa.Numeric(7, 4), nullable=True),
        sa.Column("theta", sa.Numeric(7, 4), nullable=True),
        sa.Column("vega", sa.Numeric(7, 4), nullable=True),
        sa.Column("rho", sa.Numeric(7, 4), nullable=True),
        sa.PrimaryKeyConstraint(
            "trading_date", "symbol", "expiration", "strike", "call_put",
            name="pk_external_option_chain_history",
        ),
    )
    op.create_index(
        "ix_external_option_chain_history_symbol_date",
        "external_option_chain_history",
        ["symbol", "trading_date"],
        unique=False,
    )

    op.create_table(
        "external_volatility_history",
        sa.Column("trading_date", sa.Date(), nullable=False),
        sa.Column("symbol", sa.String(20), nullable=False),
        sa.Column("hv_current", sa.Numeric(7, 4), nullable=True),
        sa.Column("hv_week_ago", sa.Numeric(7, 4), nullable=True),
        sa.Column("hv_month_ago", sa.Numeric(7, 4), nullable=True),
        sa.Column("hv_year_high", sa.Numeric(7, 4), nullable=True),
        sa.Column("hv_year_high_date", sa.Date(), nullable=True),
        sa.Column("hv_year_low", sa.Numeric(7, 4), nullable=True),
        sa.Column("hv_year_low_date", sa.Date(), nullable=True),
        sa.Column("iv_current", sa.Numeric(7, 4), nullable=True),
        sa.Column("iv_week_ago", sa.Numeric(7, 4), nullable=True),
        sa.Column("iv_month_ago", sa.Numeric(7, 4), nullable=True),
        sa.Column("iv_year_high", sa.Numeric(7, 4), nullable=True),
        sa.Column("iv_year_high_date", sa.Date(), nullable=True),
        sa.Column("iv_year_low", sa.Numeric(7, 4), nullable=True),
        sa.Column("iv_year_low_date", sa.Date(), nullable=True),
        sa.PrimaryKeyConstraint(
            "trading_date", "symbol",
            name="pk_external_volatility_history",
        ),
    )
    op.create_index(
        "ix_external_volatility_history_symbol_date",
        "external_volatility_history",
        ["symbol", "trading_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_external_volatility_history_symbol_date", "external_volatility_history")
    op.drop_table("external_volatility_history")
    op.drop_index("ix_external_option_chain_history_symbol_date", "external_option_chain_history")
    op.drop_table("external_option_chain_history")
