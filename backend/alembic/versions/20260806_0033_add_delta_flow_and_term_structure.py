"""Add net_delta_dollar_flow and term-structure fields to options_metrics_snapshots."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260806_0033"
down_revision = "20260806_0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("options_metrics_snapshots", sa.Column("net_delta_dollar_flow", sa.Float(), nullable=True))
    op.add_column("options_metrics_snapshots", sa.Column("next_expiration", sa.Date(), nullable=True))
    op.add_column("options_metrics_snapshots", sa.Column("next_expiration_atm_iv", sa.Float(), nullable=True))
    op.add_column("options_metrics_snapshots", sa.Column("term_structure_ratio", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("options_metrics_snapshots", "term_structure_ratio")
    op.drop_column("options_metrics_snapshots", "next_expiration_atm_iv")
    op.drop_column("options_metrics_snapshots", "next_expiration")
    op.drop_column("options_metrics_snapshots", "net_delta_dollar_flow")
