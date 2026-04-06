"""add profile_picture to users

Revision ID: a1b2c3d4e5f6
Revises: f6c3d4e5a7b8
Create Date: 2026-02-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f6c3d4e5a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('profile_picture', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'profile_picture')
