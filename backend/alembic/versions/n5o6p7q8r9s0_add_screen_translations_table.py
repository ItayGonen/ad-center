"""add screen_translations table

Revision ID: n5o6p7q8r9s0
Revises: m4n5o6p7q8r9
Create Date: 2026-03-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'n5o6p7q8r9s0'
down_revision: Union[str, None] = 'm4n5o6p7q8r9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'screen_translations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('screen_id', sa.Integer(), nullable=False),
        sa.Column('language', sa.String(10), nullable=False),
        sa.Column('field', sa.String(50), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['screen_id'], ['screens.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('screen_id', 'language', 'field', name='uq_screen_translation'),
    )
    op.create_index(op.f('ix_screen_translations_id'), 'screen_translations', ['id'], unique=False)
    op.create_index('ix_screen_trans_lookup', 'screen_translations', ['screen_id', 'language'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_screen_trans_lookup', table_name='screen_translations')
    op.drop_index(op.f('ix_screen_translations_id'), table_name='screen_translations')
    op.drop_table('screen_translations')
