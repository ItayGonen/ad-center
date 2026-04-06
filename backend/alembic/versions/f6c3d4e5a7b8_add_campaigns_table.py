"""add campaigns table and replace parent_order_id

Revision ID: f6c3d4e5a7b8
Revises: e5b2c3d4f6a7
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f6c3d4e5a7b8'
down_revision: Union[str, None] = 'e5b2c3d4f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _get_fk_constraint_name(conn, table, column):
    """Look up the FK constraint name for a given column on MySQL."""
    rows = conn.execute(sa.text(
        "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table "
        "AND COLUMN_NAME = :column AND REFERENCED_TABLE_NAME IS NOT NULL"
    ), {"table": table, "column": column}).fetchall()
    if rows:
        return rows[0][0]
    return None


def upgrade() -> None:
    # 1. Create campaigns table
    op.create_table(
        'campaigns',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('campaign_type', sa.Enum('spotlight', 'long_term', name='bookingtype', create_type=False), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('status', sa.Enum('active', 'cancelled', 'completed', name='campaignstatus'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_campaigns_id', 'campaigns', ['id'])

    # 2. Add campaign_id and is_campaign_primary to orders
    op.add_column('orders', sa.Column('campaign_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_orders_campaign_id', 'orders', 'campaigns', ['campaign_id'], ['id'])
    op.add_column('orders', sa.Column('is_campaign_primary', sa.Boolean(), server_default=sa.text('0'), nullable=False))
    op.create_index('ix_orders_campaign_id', 'orders', ['campaign_id'])

    # 3. Data migration: convert parent_order_id relationships to campaigns
    conn = op.get_bind()

    # Find all distinct parent_order_ids (orders that are parents)
    parent_ids = conn.execute(
        sa.text("SELECT DISTINCT parent_order_id FROM orders WHERE parent_order_id IS NOT NULL")
    ).fetchall()

    for (parent_id,) in parent_ids:
        # Get parent order details
        parent = conn.execute(
            sa.text("SELECT id, user_id, booking_type FROM orders WHERE id = :pid"),
            {"pid": parent_id}
        ).fetchone()
        if not parent:
            continue

        user_id = parent[1]
        booking_type = parent[2]

        # Count existing campaigns for this user to generate name
        count = conn.execute(
            sa.text("SELECT COUNT(*) FROM campaigns WHERE user_id = :uid"),
            {"uid": user_id}
        ).scalar()

        campaign_name = f"Campaign #{count + 1}"

        # Create campaign
        conn.execute(
            sa.text(
                "INSERT INTO campaigns (name, campaign_type, user_id, status, created_at, updated_at) "
                "VALUES (:name, :ctype, :uid, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"name": campaign_name, "ctype": booking_type, "uid": user_id}
        )

        # Get the campaign id we just created (MySQL)
        campaign_id = conn.execute(sa.text("SELECT LAST_INSERT_ID()")).scalar()

        # Set campaign_id on parent order and mark as primary
        conn.execute(
            sa.text("UPDATE orders SET campaign_id = :cid, is_campaign_primary = 1 WHERE id = :oid"),
            {"cid": campaign_id, "oid": parent_id}
        )

        # Set campaign_id on all child orders
        conn.execute(
            sa.text("UPDATE orders SET campaign_id = :cid WHERE parent_order_id = :pid"),
            {"cid": campaign_id, "pid": parent_id}
        )

    # 4. Drop parent_order_id: must drop FK constraint first (MySQL), then index, then column
    fk_name = _get_fk_constraint_name(conn, 'orders', 'parent_order_id')
    if fk_name:
        op.drop_constraint(fk_name, 'orders', type_='foreignkey')
    op.drop_index('ix_orders_parent_order_id', 'orders')
    op.drop_column('orders', 'parent_order_id')


def downgrade() -> None:
    # Re-add parent_order_id
    op.add_column('orders', sa.Column('parent_order_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_orders_parent_order_id', 'orders', 'orders', ['parent_order_id'], ['id'])
    op.create_index('ix_orders_parent_order_id', 'orders', ['parent_order_id'])

    # Migrate data back: for each campaign, set parent_order_id on non-primary orders
    conn = op.get_bind()
    campaigns = conn.execute(sa.text("SELECT id FROM campaigns")).fetchall()
    for (campaign_id,) in campaigns:
        primary = conn.execute(
            sa.text("SELECT id FROM orders WHERE campaign_id = :cid AND is_campaign_primary = 1 LIMIT 1"),
            {"cid": campaign_id}
        ).fetchone()
        if primary:
            conn.execute(
                sa.text("UPDATE orders SET parent_order_id = :pid WHERE campaign_id = :cid AND is_campaign_primary = 0"),
                {"pid": primary[0], "cid": campaign_id}
            )

    # Drop campaign FK, index, columns, and table
    fk_name = _get_fk_constraint_name(conn, 'orders', 'campaign_id')
    if fk_name:
        op.drop_constraint(fk_name, 'orders', type_='foreignkey')
    op.drop_index('ix_orders_campaign_id', 'orders')
    op.drop_column('orders', 'is_campaign_primary')
    op.drop_column('orders', 'campaign_id')
    op.drop_index('ix_campaigns_id', 'campaigns')
    op.drop_table('campaigns')
