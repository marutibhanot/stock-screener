"""Add (feature_name, pct_xsec) index on feature_percentiles.

horizon.py's _find_candidates() does one filtered scan per fingerprint
feature (WHERE feature_name = ... AND pct_xsec BETWEEN ... AND trading_date
< ...), previously left unindexed because the table was tiny. The
2019-2026 backfill has since grown it past 28 million rows, so this scan
now needs its own index rather than falling back to ix_feature_percentiles_
feature_date (feature_name, trading_date), which doesn't help filter on
pct_xsec at all.

CONCURRENTLY so the index build doesn't take a lock that blocks writes on
a table this size -- costs more total build time and can't run inside the
surrounding migration transaction (hence autocommit_block), but the
backend keeps serving reads/writes throughout.
"""

from __future__ import annotations

from alembic import op

revision = "20260808_0036"
down_revision = "20260807_0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.create_index(
            "ix_feature_percentiles_feature_pct_xsec",
            "feature_percentiles",
            ["feature_name", "pct_xsec"],
            unique=False,
            postgresql_concurrently=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(
            "ix_feature_percentiles_feature_pct_xsec",
            "feature_percentiles",
            postgresql_concurrently=True,
        )
