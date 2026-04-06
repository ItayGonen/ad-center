"""add slot_position to space_time_slots

Revision ID: d4a1b2c3e5f6
Revises: c3670951b806
Create Date: 2026-02-20

"""
from typing import Sequence, Union
from datetime import timedelta

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd4a1b2c3e5f6'
down_revision: Union[str, None] = 'c3670951b806'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _td_to_hour(val) -> int:
    """Convert a MySQL TIME value (returned as timedelta or time) to an integer hour."""
    if isinstance(val, timedelta):
        return int(val.total_seconds()) // 3600
    # datetime.time object
    return val.hour


def upgrade() -> None:
    # 1. Add slot_position column with server default
    op.add_column('space_time_slots', sa.Column('slot_position', sa.Integer(), nullable=False, server_default='1'))

    # 2. Data migration: break multi-hour slots into per-hour rows
    conn = op.get_bind()

    # Find all slots spanning more than 1 hour
    rows = conn.execute(
        sa.text(
            "SELECT id, space_id, order_id, date, start_time, end_time, status, created_at "
            "FROM space_time_slots "
            "WHERE HOUR(end_time) - HOUR(start_time) > 1"
        )
    ).fetchall()

    for row in rows:
        start_h = _td_to_hour(row.start_time)
        end_h = _td_to_hour(row.end_time)
        if end_h <= start_h:
            continue
        # Delete the original multi-hour row
        conn.execute(sa.text("DELETE FROM space_time_slots WHERE id = :id"), {"id": row.id})
        # Insert per-hour rows
        for h in range(start_h, end_h):
            h_start = f"{h:02d}:00:00"
            h_end = f"{h + 1:02d}:00:00"
            conn.execute(
                sa.text(
                    "INSERT INTO space_time_slots (space_id, order_id, date, start_time, end_time, slot_position, status, created_at) "
                    "VALUES (:space_id, :order_id, :date, :start_time, :end_time, 1, :status, :created_at)"
                ),
                {
                    "space_id": row.space_id,
                    "order_id": row.order_id,
                    "date": row.date,
                    "start_time": h_start,
                    "end_time": h_end,
                    "status": row.status if isinstance(row.status, str) else row.status.value if hasattr(row.status, 'value') else str(row.status),
                    "created_at": row.created_at,
                },
            )

    # 3. Drop old unique constraint, add new one
    op.drop_constraint('uq_space_time_slot', 'space_time_slots', type_='unique')
    op.create_unique_constraint('uq_space_time_slot_pos', 'space_time_slots', ['space_id', 'date', 'start_time', 'slot_position'])


def downgrade() -> None:
    op.drop_constraint('uq_space_time_slot_pos', 'space_time_slots', type_='unique')
    op.create_unique_constraint('uq_space_time_slot', 'space_time_slots', ['space_id', 'date', 'start_time', 'end_time'])
    op.drop_column('space_time_slots', 'slot_position')
