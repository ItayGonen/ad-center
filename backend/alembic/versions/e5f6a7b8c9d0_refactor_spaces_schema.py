"""refactor spaces schema: rename fields, add new fields, remove deprecated

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-02-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename existing columns
    op.alter_column('spaces', 'price_per_hour', new_column_name='price_per_day', existing_type=sa.Numeric(10, 2), existing_nullable=False)
    op.alter_column('spaces', 'space_type', new_column_name='connection_type', existing_type=sa.String(100), existing_nullable=True)
    op.alter_column('spaces', 'monthly_exposure', new_column_name='estimated_daily_impressions', existing_type=sa.Integer(), existing_nullable=True)
    op.alter_column('spaces', 'target_audience', new_column_name='audience_profile', existing_type=sa.String(255), existing_nullable=True)
    op.alter_column('spaces', 'description', new_column_name='general_description', existing_type=sa.Text(), existing_nullable=True)
    op.alter_column('spaces', 'partner_id', new_column_name='partner_owner', existing_type=sa.Integer(), existing_nullable=True)

    # Rename location to full_address (and widen)
    op.alter_column('spaces', 'location', new_column_name='full_address', existing_type=sa.String(255), type_=sa.String(500), existing_nullable=True)

    # Update environment enum: remove 'mixed'
    op.execute("UPDATE spaces SET environment = 'indoor' WHERE environment = 'mixed'")
    op.execute("ALTER TABLE spaces MODIFY COLUMN environment ENUM('indoor','outdoor') NULL")

    # Add new columns
    op.add_column('spaces', sa.Column('average_dwell_time', sa.Integer(), nullable=True))
    op.add_column('spaces', sa.Column('number_of_screens', sa.Integer(), nullable=True))
    op.add_column('spaces', sa.Column('screen_size', sa.String(100), nullable=True))
    op.add_column('spaces', sa.Column('resolution', sa.String(100), nullable=True))

    # Drop deprecated columns
    op.drop_column('spaces', 'title')
    op.drop_column('spaces', 'location_description')
    op.drop_column('spaces', 'age_range')
    op.drop_column('spaces', 'sign_height')


def downgrade() -> None:
    # Re-add dropped columns
    op.add_column('spaces', sa.Column('title', sa.String(255), nullable=True))
    op.add_column('spaces', sa.Column('location_description', sa.Text(), nullable=True))
    op.add_column('spaces', sa.Column('age_range', sa.String(100), nullable=True))
    op.add_column('spaces', sa.Column('sign_height', sa.String(100), nullable=True))

    # Copy name to title
    op.execute("UPDATE spaces SET title = name WHERE title IS NULL")
    op.alter_column('spaces', 'title', existing_type=sa.String(255), nullable=False)

    # Drop new columns
    op.drop_column('spaces', 'resolution')
    op.drop_column('spaces', 'screen_size')
    op.drop_column('spaces', 'number_of_screens')
    op.drop_column('spaces', 'average_dwell_time')

    # Restore environment enum with mixed
    op.execute("ALTER TABLE spaces MODIFY COLUMN environment ENUM('indoor','outdoor','mixed') NULL")

    # Reverse renames
    op.alter_column('spaces', 'full_address', new_column_name='location', existing_type=sa.String(500), type_=sa.String(255), existing_nullable=True)
    op.alter_column('spaces', 'partner_owner', new_column_name='partner_id', existing_type=sa.Integer(), existing_nullable=True)
    op.alter_column('spaces', 'general_description', new_column_name='description', existing_type=sa.Text(), existing_nullable=True)
    op.alter_column('spaces', 'audience_profile', new_column_name='target_audience', existing_type=sa.String(255), existing_nullable=True)
    op.alter_column('spaces', 'estimated_daily_impressions', new_column_name='monthly_exposure', existing_type=sa.Integer(), existing_nullable=True)
    op.alter_column('spaces', 'connection_type', new_column_name='space_type', existing_type=sa.String(100), existing_nullable=True)
    op.alter_column('spaces', 'price_per_day', new_column_name='price_per_hour', existing_type=sa.Numeric(10, 2), existing_nullable=False)
