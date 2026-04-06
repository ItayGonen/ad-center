import math
from datetime import date
from fastapi import APIRouter, Depends, Query, Header, HTTPException, status
from sqlalchemy.orm import Session, selectinload
from app.database import get_db
from typing import Optional
from app.schemas.space import SpaceListResponse, SpaceDetailResponse, DayAvailability, AudienceProfileResponse, SpaceTypeResponse
from app.schemas.pagination import PaginatedResponse
from app.services.spaces import get_all_spaces, get_space_detail, get_availability, get_all_audience_profiles, get_all_space_types
from app.models.user import User, UserRole
from app.models.space import Space, Screen
from app.models.translation import SpaceTranslation, SpaceTypeTranslation, AudienceProfileTranslation, ScreenTranslation

router = APIRouter(prefix="/spaces", tags=["spaces"])

TRANSLATABLE_SPACE_FIELDS = {"name", "general_description", "city", "full_address"}


def _overlay_translations(items: list, db: Session, lang: str) -> list:
    """Overlay translated field values onto space list items."""
    if lang == "en" or not items:
        return items
    space_ids = [item.id if hasattr(item, 'id') else item['id'] for item in items]
    translations = db.query(SpaceTranslation).filter(
        SpaceTranslation.space_id.in_(space_ids),
        SpaceTranslation.language == lang,
    ).all()
    trans_map: dict = {}
    for t in translations:
        if t.space_id not in trans_map:
            trans_map[t.space_id] = {}
        trans_map[t.space_id][t.field] = t.value
    for item in items:
        sid = item.id if hasattr(item, 'id') else item['id']
        if sid in trans_map:
            for field, value in trans_map[sid].items():
                if field in TRANSLATABLE_SPACE_FIELDS:
                    if hasattr(item, field):
                        setattr(item, field, value)
                    elif isinstance(item, dict):
                        item[field] = value
    return items


@router.get("", response_model=PaginatedResponse[SpaceListResponse])
def list_spaces(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    audience_profile_ids: Optional[str] = Query(None),
    lang: str = Query("en"),
    db: Session = Depends(get_db),
):
    parsed_ids = None
    if audience_profile_ids:
        try:
            parsed_ids = [int(x.strip()) for x in audience_profile_ids.split(",") if x.strip()]
        except ValueError:
            parsed_ids = None
    skip = (page - 1) * page_size
    result = get_all_spaces(db, skip=skip, limit=page_size, audience_profile_ids=parsed_ids)
    if lang != "en":
        _overlay_translations(result["items"], db, lang)
        # Also translate nested space_type and audience_profile names
        space_types = [item["space_type"] for item in result["items"] if item.get("space_type")]
        _overlay_space_type_translations(space_types, db, lang)
        all_profiles = []
        for item in result["items"]:
            all_profiles.extend(item.get("audience_profiles", []))
        _overlay_audience_profile_translations(all_profiles, db, lang)
    total_pages = math.ceil(result["total"] / page_size) if result["total"] > 0 else 1
    return PaginatedResponse(
        items=result["items"],
        total=result["total"],
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


def _overlay_space_type_translations(items: list, db: Session, lang: str) -> list:
    """Overlay translated names onto space type items (works with dicts or ORM objects)."""
    if lang == "en" or not items:
        return items
    type_ids = [item["id"] if isinstance(item, dict) else item.id for item in items]
    translations = db.query(SpaceTypeTranslation).filter(
        SpaceTypeTranslation.space_type_id.in_(type_ids),
        SpaceTypeTranslation.language == lang,
        SpaceTypeTranslation.field == "name",
    ).all()
    trans_map = {t.space_type_id: t.value for t in translations}
    for item in items:
        item_id = item["id"] if isinstance(item, dict) else item.id
        if item_id in trans_map:
            if isinstance(item, dict):
                item["name"] = trans_map[item_id]
            else:
                item.name = trans_map[item_id]
    return items


def _overlay_audience_profile_translations(items: list, db: Session, lang: str) -> list:
    """Overlay translated names onto audience profile items (works with dicts or ORM objects)."""
    if lang == "en" or not items:
        return items
    profile_ids = [item["id"] if isinstance(item, dict) else item.id for item in items]
    translations = db.query(AudienceProfileTranslation).filter(
        AudienceProfileTranslation.audience_profile_id.in_(profile_ids),
        AudienceProfileTranslation.language == lang,
        AudienceProfileTranslation.field == "name",
    ).all()
    trans_map = {t.audience_profile_id: t.value for t in translations}
    for item in items:
        item_id = item["id"] if isinstance(item, dict) else item.id
        if item_id in trans_map:
            if isinstance(item, dict):
                item["name"] = trans_map[item_id]
            else:
                item.name = trans_map[item_id]
    return items


@router.get("/space-types", response_model=list[SpaceTypeResponse])
def list_space_types(lang: str = Query("en"), db: Session = Depends(get_db)):
    types = get_all_space_types(db)
    if lang != "en":
        with db.no_autoflush:
            _overlay_space_type_translations(types, db, lang)
            db.expunge_all()
    return types


@router.get("/audience-profiles", response_model=list[AudienceProfileResponse])
def list_audience_profiles(lang: str = Query("en"), db: Session = Depends(get_db)):
    profiles = get_all_audience_profiles(db)
    if lang != "en":
        with db.no_autoflush:
            _overlay_audience_profile_translations(profiles, db, lang)
            db.expunge_all()
    return profiles


@router.get("/partner/{partner_id}")
def public_partner_profile(partner_id: int, db: Session = Depends(get_db)):
    partner = db.query(User).filter(User.id == partner_id, User.role == UserRole.partner).first()
    if not partner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Partner not found")

    spaces = (
        db.query(Space)
        .options(selectinload(Space.images), selectinload(Space.space_type))
        .filter(Space.partner_owner == partner_id)
        .all()
    )
    space_list = []
    for space in spaces:
        first_image = space.images[0].image_url if space.images else None
        space_list.append({
            "id": space.id,
            "name": space.name,
            "city": space.city,
            "price_per_day": float(space.price_per_day),
            "first_image": first_image,
            "estimated_daily_impressions": space.estimated_daily_impressions,
            "space_type": {"id": space.space_type.id, "name": space.space_type.name} if space.space_type else None,
        })

    return {
        "id": partner.id,
        "name": partner.name,
        "company_name": partner.company_name,
        "profile_picture": partner.profile_picture,
        "spaces": space_list,
    }


@router.get("/{space_id}", response_model=SpaceDetailResponse)
def space_detail(space_id: int, lang: str = Query("en"), db: Session = Depends(get_db)):
    detail = get_space_detail(db, space_id)
    if lang != "en":
        # Disable auto-flush so Hebrew setattr won't be persisted to DB
        with db.no_autoflush:
            translations = db.query(SpaceTranslation).filter(
                SpaceTranslation.space_id == space_id,
                SpaceTranslation.language == lang,
            ).all()
            for t in translations:
                if t.field in TRANSLATABLE_SPACE_FIELDS and hasattr(detail, t.field):
                    setattr(detail, t.field, t.value)
            # Translate space_type name
            if detail.space_type:
                _overlay_space_type_translations([detail.space_type], db, lang)
            # Translate audience_profile names
            if detail.audience_profiles:
                _overlay_audience_profile_translations(list(detail.audience_profiles), db, lang)
            # Translate screen names and position descriptions
            if detail.screens:
                screen_ids = [s.id for s in detail.screens]
                screen_trans = db.query(ScreenTranslation).filter(
                    ScreenTranslation.screen_id.in_(screen_ids),
                    ScreenTranslation.language == lang,
                ).all()
                trans_map: dict = {}
                for st in screen_trans:
                    trans_map.setdefault(st.screen_id, {})[st.field] = st.value
                for scr in detail.screens:
                    if scr.id in trans_map:
                        for field in ("name", "position_description"):
                            if field in trans_map[scr.id]:
                                setattr(scr, field, trans_map[scr.id][field])
            # Detach all objects from session so dirty Hebrew state is never flushed to DB
            db.expunge_all()
    return detail


@router.get("/{space_id}/availability", response_model=list[DayAvailability])
def space_availability(
    space_id: int,
    start_date: date = Query(...),
    end_date: date = Query(...),
    exclude_order: int | None = Query(None),
    db: Session = Depends(get_db),
):
    return get_availability(db, space_id, start_date, end_date, exclude_order_id=exclude_order)
