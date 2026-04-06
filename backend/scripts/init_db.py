"""Create all tables from SQLAlchemy models and stamp Alembic to head.

Usage (inside container):
    python -m scripts.init_db
"""
from app.database import Base, engine
from app.models import *  # noqa: F401, F403 — register all models

print("Creating all tables from models...")
Base.metadata.create_all(bind=engine)
print("Done. Tables created.")
