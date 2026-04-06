"""add app_settings table

Revision ID: m4n5o6p7q8r9
Revises: l3m4n5o6p7q8
Create Date: 2026-02-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'm4n5o6p7q8r9'
down_revision: Union[str, None] = 'l3m4n5o6p7q8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use raw SQL to handle the case where table already exists from a partial run
    op.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            `key` VARCHAR(100) NOT NULL,
            `value` VARCHAR(500) NOT NULL,
            PRIMARY KEY (`key`)
        )
    """)
    op.execute("INSERT IGNORE INTO app_settings (`key`, `value`) VALUES ('emails_enabled', 'true')")


def downgrade() -> None:
    op.drop_table('app_settings')
