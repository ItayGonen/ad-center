"""add i18n support

Revision ID: h9i0j1k2l3m4
Revises: g8h9i0j1k2l3
Create Date: 2026-02-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'h9i0j1k2l3m4'
down_revision: Union[str, None] = 'g8h9i0j1k2l3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add language column to users
    op.add_column('users', sa.Column('language', sa.String(10), nullable=False, server_default='en'))

    # Create space_translations table
    op.create_table(
        'space_translations',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('space_id', sa.Integer(), sa.ForeignKey('spaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('language', sa.String(10), nullable=False),
        sa.Column('field', sa.String(50), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.UniqueConstraint('space_id', 'language', 'field', name='uq_space_translation'),
    )
    op.create_index('ix_space_trans_lookup', 'space_translations', ['space_id', 'language'])

    # Create space_type_translations table
    op.create_table(
        'space_type_translations',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('space_type_id', sa.Integer(), sa.ForeignKey('space_types.id', ondelete='CASCADE'), nullable=False),
        sa.Column('language', sa.String(10), nullable=False),
        sa.Column('field', sa.String(50), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.UniqueConstraint('space_type_id', 'language', 'field', name='uq_space_type_translation'),
    )

    # Create audience_profile_translations table
    op.create_table(
        'audience_profile_translations',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('audience_profile_id', sa.Integer(), sa.ForeignKey('audience_profiles.id', ondelete='CASCADE'), nullable=False),
        sa.Column('language', sa.String(10), nullable=False),
        sa.Column('field', sa.String(50), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.UniqueConstraint('audience_profile_id', 'language', 'field', name='uq_audience_profile_translation'),
    )

    # Create ui_translations table
    op.create_table(
        'ui_translations',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('namespace', sa.String(50), nullable=False),
        sa.Column('key', sa.String(255), nullable=False),
        sa.Column('language', sa.String(10), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('namespace', 'key', 'language', name='uq_ui_translation'),
    )
    op.create_index('ix_ui_trans_lookup', 'ui_translations', ['namespace', 'language'])


def downgrade() -> None:
    op.drop_index('ix_ui_trans_lookup', table_name='ui_translations')
    op.drop_table('ui_translations')
    op.drop_table('audience_profile_translations')
    op.drop_table('space_type_translations')
    op.drop_index('ix_space_trans_lookup', table_name='space_translations')
    op.drop_table('space_translations')
    op.drop_column('users', 'language')
