"""change estimated_daily_impressions from integer to string

Revision ID: i0j1k2l3m4n5
Revises: h9i0j1k2l3m4
Create Date: 2026-02-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'i0j1k2l3m4n5'
down_revision: Union[str, None] = 'h9i0j1k2l3m4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Convert integer column to string, casting existing values
    op.alter_column(
        'spaces',
        'estimated_daily_impressions',
        existing_type=sa.Integer(),
        type_=sa.String(100),
        existing_nullable=True,
        postgresql_using='estimated_daily_impressions::varchar',
    )


def downgrade() -> None:
    # Convert string column back to integer (ranges like "200-250" will fail)
    op.alter_column(
        'spaces',
        'estimated_daily_impressions',
        existing_type=sa.String(100),
        type_=sa.Integer(),
        existing_nullable=True,
        postgresql_using='estimated_daily_impressions::integer',
    )
