"""add title link and broadcast type to notifications

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-02-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('notifications', sa.Column('title', sa.String(255), nullable=True))
    op.add_column('notifications', sa.Column('link', sa.String(500), nullable=True))
    # Extend the enum to include admin_broadcast
    op.execute("ALTER TABLE notifications MODIFY COLUMN type ENUM('order_created','order_confirmed','order_cancelled','order_completed','admin_broadcast') NOT NULL")


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE type = 'admin_broadcast'")
    op.execute("ALTER TABLE notifications MODIFY COLUMN type ENUM('order_created','order_confirmed','order_cancelled','order_completed') NOT NULL")
    op.drop_column('notifications', 'link')
    op.drop_column('notifications', 'title')
