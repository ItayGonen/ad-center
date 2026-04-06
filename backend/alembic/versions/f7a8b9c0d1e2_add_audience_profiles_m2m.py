"""add audience profiles m2m

Revision ID: f7a8b9c0d1e2
Revises: e5f6a7b8c9d0
Create Date: 2026-02-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import table, column

# revision identifiers, used by Alembic.
revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create audience_profiles table
    # SQLAlchemy stores str enum member NAMES, so use: demographic, lifestyle, behavior
    op.create_table(
        'audience_profiles',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(255), nullable=False, unique=True),
        sa.Column('category', sa.Enum('demographic', 'lifestyle', 'behavior', name='audiencecategory'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    # Seed predefined audience profiles
    audience_profiles = table(
        'audience_profiles',
        column('name', sa.String),
        column('category', sa.String),
    )

    op.bulk_insert(audience_profiles, [
        # Demographic (8)
        {'name': 'Women', 'category': 'demographic'},
        {'name': 'Men', 'category': 'demographic'},
        {'name': 'Teens & Young Adults', 'category': 'demographic'},
        {'name': 'Students', 'category': 'demographic'},
        {'name': 'Families & Parents', 'category': 'demographic'},
        {'name': 'Seniors', 'category': 'demographic'},
        {'name': 'Business Professionals', 'category': 'demographic'},
        {'name': 'High-Tech Professionals', 'category': 'demographic'},
        # Lifestyle (6)
        {'name': 'Fitness & Sports', 'category': 'lifestyle'},
        {'name': 'Health & Lifestyle', 'category': 'lifestyle'},
        {'name': 'Luxury Audience', 'category': 'lifestyle'},
        {'name': 'Tech Enthusiasts', 'category': 'lifestyle'},
        {'name': 'Local Community', 'category': 'lifestyle'},
        {'name': 'Premium / Affluent Audience', 'category': 'lifestyle'},
        # Behavior / Context (7)
        {'name': 'Commuters', 'category': 'behavior'},
        {'name': 'Drivers', 'category': 'behavior'},
        {'name': 'Public Transport Users', 'category': 'behavior'},
        {'name': 'Pedestrians', 'category': 'behavior'},
        {'name': 'Tourists & Leisure Visitors', 'category': 'behavior'},
        {'name': 'Mall Shoppers', 'category': 'behavior'},
        {'name': 'Office Workers', 'category': 'behavior'},
    ])

    # Create junction table
    op.create_table(
        'space_audience_profiles',
        sa.Column('space_id', sa.Integer(), sa.ForeignKey('spaces.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('audience_profile_id', sa.Integer(), sa.ForeignKey('audience_profiles.id', ondelete='CASCADE'), primary_key=True),
    )

    # Drop old text column
    op.drop_column('spaces', 'audience_profile')


def downgrade() -> None:
    op.add_column('spaces', sa.Column('audience_profile', sa.Text(), nullable=True))
    op.drop_table('space_audience_profiles')
    op.drop_table('audience_profiles')
