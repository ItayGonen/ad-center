"""add approved status

Revision ID: k2l3m4n5o6p7
Revises: j1k2l3m4n5o6
Create Date: 2026-02-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'k2l3m4n5o6p7'
down_revision: Union[str, None] = 'j1k2l3m4n5o6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add 'approved' to orders.status enum
    op.execute(
        "ALTER TABLE orders MODIFY COLUMN status "
        "ENUM('pending','approved','confirmed','cancelled','completed') "
        "NOT NULL DEFAULT 'pending'"
    )

    # Add 'approved' to order_events.action_type enum
    op.execute(
        "ALTER TABLE order_events MODIFY COLUMN action_type "
        "ENUM('created','approved','confirmed','cancelled','completed','updated') "
        "NOT NULL"
    )

    # Add 'approved' to campaigns.status enum
    op.execute(
        "ALTER TABLE campaigns MODIFY COLUMN status "
        "ENUM('active','approved','cancelled','completed') "
        "DEFAULT 'active'"
    )

    # Add 'order_approved' to notifications.type enum
    op.execute(
        "ALTER TABLE notifications MODIFY COLUMN type "
        "ENUM('order_created','order_approved','order_confirmed','order_cancelled','order_completed','admin_broadcast') "
        "NOT NULL"
    )


def downgrade() -> None:
    # Remove 'approved' from orders.status enum
    op.execute(
        "ALTER TABLE orders MODIFY COLUMN status "
        "ENUM('pending','confirmed','cancelled','completed') "
        "NOT NULL DEFAULT 'pending'"
    )

    # Remove 'approved' from order_events.action_type enum
    op.execute(
        "ALTER TABLE order_events MODIFY COLUMN action_type "
        "ENUM('created','confirmed','cancelled','completed','updated') "
        "NOT NULL"
    )

    # Remove 'approved' from campaigns.status enum
    op.execute(
        "ALTER TABLE campaigns MODIFY COLUMN status "
        "ENUM('active','cancelled','completed') "
        "DEFAULT 'active'"
    )

    # Remove 'order_approved' from notifications.type enum
    op.execute(
        "ALTER TABLE notifications MODIFY COLUMN type "
        "ENUM('order_created','order_confirmed','order_cancelled','order_completed','admin_broadcast') "
        "NOT NULL"
    )
