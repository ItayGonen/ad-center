"""add space_types table and convert connection_type to FK

Revision ID: g8h9i0j1k2l3
Revises: f7a8b9c0d1e2
Create Date: 2026-02-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import table, column

# revision identifiers, used by Alembic.
revision: str = 'g8h9i0j1k2l3'
down_revision: Union[str, None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create space_types table
    op.create_table(
        'space_types',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(255), nullable=False, unique=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    # 2. Seed predefined space types
    space_types = table(
        'space_types',
        column('name', sa.String),
    )
    op.bulk_insert(space_types, [
        {'name': 'Gym'},
        {'name': 'Restaurant'},
        {'name': 'Cafe'},
        {'name': 'Hotel'},
        {'name': 'Mall'},
        {'name': 'Supermarket'},
        {'name': 'Office Building'},
        {'name': 'Coworking Space'},
        {'name': 'Street'},
        {'name': 'Highway'},
        {'name': 'Train Station'},
        {'name': 'Bus Station'},
        {'name': 'Airport'},
        {'name': 'University / Campus'},
        {'name': 'School'},
        {'name': 'Hospital'},
        {'name': 'Clinic'},
        {'name': 'Residential Building'},
        {'name': 'Sports Stadium'},
        {'name': 'Event Venue'},
        {'name': 'Beach'},
        {'name': 'Park'},
        {'name': 'Shopping Center'},
        {'name': 'Cinema'},
        {'name': 'Convention Center'},
    ])

    # 3. Add space_type_id FK column to spaces
    op.add_column('spaces', sa.Column('space_type_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_spaces_space_type_id',
        'spaces', 'space_types',
        ['space_type_id'], ['id'],
    )

    # 4. Drop old connection_type string column
    op.drop_column('spaces', 'connection_type')


def downgrade() -> None:
    op.add_column('spaces', sa.Column('connection_type', sa.String(100), nullable=True))
    op.drop_constraint('fk_spaces_space_type_id', 'spaces', type_='foreignkey')
    op.drop_column('spaces', 'space_type_id')
    op.drop_table('space_types')
