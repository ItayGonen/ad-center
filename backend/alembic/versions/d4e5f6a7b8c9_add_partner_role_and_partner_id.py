"""add partner role and partner_id to spaces

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-02-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Extend the user role enum to include partner
    op.execute("ALTER TABLE users MODIFY COLUMN role ENUM('admin','user','partner') NOT NULL DEFAULT 'user'")
    # Add partner_id column to spaces
    op.add_column('spaces', sa.Column('partner_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_spaces_partner_id', 'spaces', 'users', ['partner_id'], ['id'])
    op.create_index('ix_spaces_partner_id', 'spaces', ['partner_id'])


def downgrade() -> None:
    op.drop_index('ix_spaces_partner_id', table_name='spaces')
    op.drop_constraint('fk_spaces_partner_id', 'spaces', type_='foreignkey')
    op.drop_column('spaces', 'partner_id')
    # Revert partner role - first update any partner users to user
    op.execute("UPDATE users SET role = 'user' WHERE role = 'partner'")
    op.execute("ALTER TABLE users MODIFY COLUMN role ENUM('admin','user') NOT NULL DEFAULT 'user'")
