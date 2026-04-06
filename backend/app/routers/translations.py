from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from app.database import get_db
from app.middleware.auth import require_admin
from app.models.user import User
from app.models.translation import UITranslation

router = APIRouter(prefix="/translations", tags=["translations"])


# ── Schemas ──

class LanguageInfo(BaseModel):
    code: str
    name: str
    native_name: str
    direction: str


class UITranslationUpsert(BaseModel):
    namespace: str
    key: str
    language: str
    value: str


class UITranslationBulkItem(BaseModel):
    namespace: str
    key: str
    language: str
    value: str


class UITranslationBulk(BaseModel):
    items: List[UITranslationBulkItem]


# ── Supported languages ──

SUPPORTED_LANGUAGES = [
    LanguageInfo(code="en", name="English", native_name="English", direction="ltr"),
    LanguageInfo(code="he", name="Hebrew", native_name="עברית", direction="rtl"),
]


@router.get("/languages", response_model=List[LanguageInfo])
def get_languages():
    return SUPPORTED_LANGUAGES


@router.get("/ui/{language}")
def get_ui_translations(
    language: str,
    namespace: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(UITranslation).filter(UITranslation.language == language)
    if namespace:
        query = query.filter(UITranslation.namespace == namespace)
    rows = query.all()

    result = {}
    for row in rows:
        key = f"{row.namespace}.{row.key}" if not namespace else row.key
        result[key] = row.value
    return result


@router.get("/ui")
def get_all_ui_translations(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    rows = db.query(UITranslation).all()
    result: dict = {}
    for row in rows:
        ns = row.namespace
        if ns not in result:
            result[ns] = {}
        if row.key not in result[ns]:
            result[ns][row.key] = {}
        result[ns][row.key][row.language] = row.value
    return result


@router.put("/ui")
def upsert_ui_translation(
    data: UITranslationUpsert,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    existing = db.query(UITranslation).filter(
        UITranslation.namespace == data.namespace,
        UITranslation.key == data.key,
        UITranslation.language == data.language,
    ).first()

    if existing:
        existing.value = data.value
        existing.updated_at = datetime.utcnow()
    else:
        row = UITranslation(
            namespace=data.namespace,
            key=data.key,
            language=data.language,
            value=data.value,
            updated_at=datetime.utcnow(),
        )
        db.add(row)

    db.commit()
    return {"status": "ok"}


@router.post("/ui/bulk")
def bulk_upsert_ui_translations(
    data: UITranslationBulk,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    count = 0
    for item in data.items:
        existing = db.query(UITranslation).filter(
            UITranslation.namespace == item.namespace,
            UITranslation.key == item.key,
            UITranslation.language == item.language,
        ).first()

        if existing:
            existing.value = item.value
            existing.updated_at = datetime.utcnow()
        else:
            row = UITranslation(
                namespace=item.namespace,
                key=item.key,
                language=item.language,
                value=item.value,
                updated_at=datetime.utcnow(),
            )
            db.add(row)
        count += 1

    db.commit()
    return {"status": "ok", "count": count}
