"""add screens table

Revision ID: j1k2l3m4n5o6
Revises: i0j1k2l3m4n5
Create Date: 2026-02-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'j1k2l3m4n5o6'
down_revision: Union[str, None] = 'i0j1k2l3m4n5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'screens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('space_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(255), nullable=True),
        sa.Column('size_inches', sa.String(50), nullable=False),
        sa.Column('resolution_width', sa.Integer(), nullable=False),
        sa.Column('resolution_height', sa.Integer(), nullable=False),
        sa.Column('position_description', sa.String(500), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['space_id'], ['spaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_screens_id'), 'screens', ['id'], unique=False)
    op.create_index(op.f('ix_screens_space_id'), 'screens', ['space_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_screens_space_id'), table_name='screens')
    op.drop_index(op.f('ix_screens_id'), table_name='screens')
    op.drop_table('screens')
