"""Add flip_is_crossing to gex_snapshots to distinguish a real zero-gamma crossing from the nearest-strike fallback."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260806_0032"
down_revision = "20260806_0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("gex_snapshots", sa.Column("flip_is_crossing", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("gex_snapshots", "flip_is_crossing")
