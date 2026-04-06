"""add processed_url and original_url to user_creatives

Revision ID: q8r9s0t1u2v3
Revises: p7q8r9s0t1u2
Create Date: 2026-04-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'q8r9s0t1u2v3'
down_revision: Union[str, None] = 'p7q8r9s0t1u2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user_creatives', sa.Column('original_url', sa.String(500), nullable=True))
    op.add_column('user_creatives', sa.Column('processed_url', sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column('user_creatives', 'processed_url')
    op.drop_column('user_creatives', 'original_url')
