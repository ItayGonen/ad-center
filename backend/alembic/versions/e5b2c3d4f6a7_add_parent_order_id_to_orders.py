"""add parent_order_id to orders

Revision ID: e5b2c3d4f6a7
Revises: d4a1b2c3e5f6
Create Date: 2026-02-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e5b2c3d4f6a7'
down_revision: Union[str, None] = 'd4a1b2c3e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('orders', sa.Column('parent_order_id', sa.Integer(), sa.ForeignKey('orders.id'), nullable=True))
    op.create_index('ix_orders_parent_order_id', 'orders', ['parent_order_id'])


def downgrade() -> None:
    op.drop_index('ix_orders_parent_order_id', 'orders')
    op.drop_column('orders', 'parent_order_id')
