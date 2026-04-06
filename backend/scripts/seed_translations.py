"""
Seed UI translations from frontend locale JSON files into the database.

Usage:
    cd backend
    python -m scripts.seed_translations

This script reads the fallback JSON locale files from frontend/src/locales/
and inserts them into the ui_translations table.
"""

import json
import os
import sys
from datetime import datetime

# Add the backend directory to the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.translation import UITranslation


LOCALES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend", "src", "locales"
)

LANGUAGES = ["en", "he"]
NAMESPACES = ["common", "auth", "spaces", "orders", "settings", "admin"]


def flatten_json(data: dict, prefix: str = "") -> dict:
    """Flatten nested JSON into dot-separated keys."""
    result = {}
    for key, value in data.items():
        full_key = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            result.update(flatten_json(value, full_key))
        elif isinstance(value, list):
            result[full_key] = json.dumps(value, ensure_ascii=False)
        else:
            result[full_key] = str(value)
    return result


def seed():
    db = SessionLocal()
    count = 0

    try:
        for lang in LANGUAGES:
            for ns in NAMESPACES:
                filepath = os.path.join(LOCALES_DIR, lang, f"{ns}.json")
                if not os.path.exists(filepath):
                    print(f"  SKIP {filepath} (not found)")
                    continue

                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)

                flat = flatten_json(data)

                for key, value in flat.items():
                    existing = db.query(UITranslation).filter(
                        UITranslation.namespace == ns,
                        UITranslation.key == key,
                        UITranslation.language == lang,
                    ).first()

                    if existing:
                        existing.value = value
                        existing.updated_at = datetime.utcnow()
                    else:
                        db.add(UITranslation(
                            namespace=ns,
                            key=key,
                            language=lang,
                            value=value,
                            updated_at=datetime.utcnow(),
                        ))
                    count += 1

                print(f"  {lang}/{ns}.json -> {len(flat)} keys")

        db.commit()
        print(f"\nDone! Seeded {count} translation entries.")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
