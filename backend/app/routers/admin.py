from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload, selectinload
from typing import List, Dict
from datetime import date
from pydantic import BaseModel
import math
from app.database import get_db
from app.schemas.space import SpaceCreate, SpaceUpdate, SpaceDetailResponse, OperatingHoursCreate, OperatingHoursResponse, SpaceImageResponse, ScreenCreate, ScreenUpdate, ScreenResponse
from app.schemas.user import UserResponse, UserUpdate, AdminUserCreate, DEFAULT_NOTIFICATION_PREFERENCES
from app.utils.security import hash_password, validate_password
from app.schemas.order import AdminOrderListResponse, OrderStatusUpdate, TimeSlotResponse, RecurringScheduleResponse, ScheduleOverrideResponse, CreativeResponse, AdminCalendarResponse
from app.schemas.pagination import PaginatedResponse
from app.middleware.auth import require_admin
from app.models.user import User, UserRole
from app.models.space import Space, SpaceImage, SpaceOperatingHours, AudienceProfile, AudienceCategory, SpaceType, Screen
from app.models.translation import SpaceTranslation, SpaceTypeTranslation, AudienceProfileTranslation, ScreenTranslation
from app.models.order import Order, OrderStatus, SpaceTimeSlot, SlotStatus
from app.models.notification import Notification, NotificationType
from app.services.notifications import create_notification
from app.schemas.notification import BroadcastNotificationRequest
from app.models.order_event import ActionType, ActorType, OrderEvent
from app.models.campaign import Campaign, CampaignStatus
from app.services.order_events import create_order_event
from app.services.campaigns import delete_campaign_admin, approve_campaign_admin
from app.services.email import send_booking_confirmed_email
from app.utils.file_validation import validate_upload, read_validated_content
import os, uuid

router = APIRouter(prefix="/admin", tags=["admin"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
AVATARS_DIR = os.path.join(UPLOAD_DIR, "avatars")
PAYMENT_PROOFS_DIR = os.path.join(UPLOAD_DIR, "payment_proofs")
ALLOWED_AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_PROOF_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_AVATAR_SIZE = 5 * 1024 * 1024  # 5MB
MAX_PROOF_SIZE = 10 * 1024 * 1024  # 10MB


# ── Users ──────────────────────────────────────────────

@router.get("/users", response_model=PaginatedResponse[UserResponse])
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    base_query = db.query(User)
    total = base_query.count()
    skip = (page - 1) * page_size
    items = base_query.order_by(User.id).offset(skip).limit(page_size).all()
    total_pages = math.ceil(total / page_size) if total > 0 else 1
    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.post("/users", response_model=UserResponse, status_code=201)
def create_user(data: AdminUserCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    # Validate password policy
    pwd_error = validate_password(data.password)
    if pwd_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=pwd_error)

    # Check email uniqueness
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    # Check name uniqueness
    existing_name = db.query(User).filter(User.name == data.name).first()
    if existing_name:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this name already exists",
        )

    user = User(
        name=data.name,
        email=data.email,
        password=hash_password(data.password),
        role=data.role,
        phone_number=data.phone_number,
        company_name=data.company_name,
        notification_preferences=DEFAULT_NOTIFICATION_PREFERENCES,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/avatar", response_model=UserResponse)
async def upload_user_avatar(
    user_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if file.content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only JPEG, PNG, and WebP images are allowed")

    contents = await file.read()
    if len(contents) > MAX_AVATAR_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image must be under 5MB")

    # Delete old avatar if exists
    if user.profile_picture:
        old_path = os.path.join(UPLOAD_DIR, user.profile_picture.lstrip("/uploads/"))
        if os.path.exists(old_path):
            os.remove(old_path)

    os.makedirs(AVATARS_DIR, exist_ok=True)
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(AVATARS_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(contents)

    user.profile_picture = f"/uploads/avatars/{filename}"
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}", response_model=UserResponse)
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    updates = data.model_dump(exclude_unset=True)

    # Handle email change with uniqueness check
    if "email" in updates and updates["email"] is not None:
        existing = db.query(User).filter(User.email == updates["email"], User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")
        user.email = updates["email"]

    # Handle password reset
    if "password" in updates and updates["password"] is not None:
        pwd_error = validate_password(updates["password"])
        if pwd_error:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=pwd_error)
        user.password = hash_password(updates["password"])

    # Handle other allowed fields
    ALLOWED_FIELDS = {"name", "role", "phone_number", "company_name"}
    for key, value in updates.items():
        if key in ALLOWED_FIELDS:
            setattr(user, key, value)

    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if admin.id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    order_count = db.query(Order).filter(Order.user_id == user_id).count()
    if order_count > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete user with orders")
    campaign_count = db.query(Campaign).filter(Campaign.user_id == user_id).count()
    if campaign_count > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete user with campaigns")
    # Clean up related records that are safe to delete
    db.query(Notification).filter(Notification.user_id == user_id).delete()
    db.query(OrderEvent).filter(OrderEvent.user_id == user_id).update({"user_id": None})
    db.query(Space).filter(Space.partner_owner == user_id).update({"partner_owner": None})
    db.delete(user)
    db.commit()


# ── Partners ──────────────────────────────────────────

@router.get("/partners")
def list_partners(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    partners = db.query(User).filter(User.role == UserRole.partner).order_by(User.name).all()
    return [{"id": p.id, "name": p.name, "email": p.email} for p in partners]


# ── Spaces ─────────────────────────────────────────────

def _attach_partner_name(space: Space, db: Session) -> Space:
    if space.partner_owner:
        partner = db.query(User).filter(User.id == space.partner_owner).first()
        space.partner_name = partner.name if partner else None
    else:
        space.partner_name = None
    return space


@router.post("/spaces", response_model=SpaceDetailResponse, status_code=201)
def create_space(data: SpaceCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if data.space_type_id is not None:
        st = db.query(SpaceType).filter(SpaceType.id == data.space_type_id).first()
        if not st:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid space_type_id")
    space_data = data.model_dump(exclude={"audience_profile_ids", "translations"})
    space = Space(**space_data)
    if data.audience_profile_ids:
        profiles = db.query(AudienceProfile).filter(AudienceProfile.id.in_(data.audience_profile_ids)).all()
        space.audience_profiles = profiles
    db.add(space)
    db.flush()
    # Save translations
    if data.translations:
        for lang, fields in data.translations.items():
            for field_name, value in fields.items():
                db.add(SpaceTranslation(space_id=space.id, language=lang, field=field_name, value=value))
    db.commit()
    db.refresh(space)
    return _attach_partner_name(space, db)


TRANSLATABLE_SCREEN_FIELDS = {"name", "position_description"}


class ScreenTranslationsPayload(BaseModel):
    translations: Dict[int, Dict[str, Dict[str, str]]]  # {screen_id: {lang: {field: value}}}


@router.put("/spaces/screen-translations")
def set_screen_translations(data: ScreenTranslationsPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Upsert screen translations. Empty values delete the translation row."""
    for screen_id, lang_map in data.translations.items():
        sid = int(screen_id)
        for lang, fields in lang_map.items():
            for field, value in fields.items():
                if field not in TRANSLATABLE_SCREEN_FIELDS:
                    continue
                existing = db.query(ScreenTranslation).filter(
                    ScreenTranslation.screen_id == sid,
                    ScreenTranslation.language == lang,
                    ScreenTranslation.field == field,
                ).first()
                if value.strip():
                    if existing:
                        existing.value = value
                    else:
                        db.add(ScreenTranslation(screen_id=sid, language=lang, field=field, value=value))
                elif existing:
                    db.delete(existing)
    db.commit()
    return {"ok": True}


@router.put("/spaces/{space_id}", response_model=SpaceDetailResponse)
def update_space(space_id: int, data: SpaceUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    space = db.query(Space).filter(Space.id == space_id).first()
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    update_data = data.model_dump(exclude_unset=True)
    audience_profile_ids = update_data.pop("audience_profile_ids", None)
    translations_data = update_data.pop("translations", None)
    if "space_type_id" in update_data and update_data["space_type_id"] is not None:
        st = db.query(SpaceType).filter(SpaceType.id == update_data["space_type_id"]).first()
        if not st:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid space_type_id")
    for key, value in update_data.items():
        setattr(space, key, value)
    if audience_profile_ids is not None:
        profiles = db.query(AudienceProfile).filter(AudienceProfile.id.in_(audience_profile_ids)).all() if audience_profile_ids else []
        space.audience_profiles = profiles
    # Upsert translations
    if translations_data:
        for lang, fields in translations_data.items():
            for field_name, value in fields.items():
                existing = db.query(SpaceTranslation).filter(
                    SpaceTranslation.space_id == space_id,
                    SpaceTranslation.language == lang,
                    SpaceTranslation.field == field_name,
                ).first()
                if existing:
                    existing.value = value
                else:
                    db.add(SpaceTranslation(space_id=space_id, language=lang, field=field_name, value=value))
    db.commit()
    db.refresh(space)
    return _attach_partner_name(space, db)


@router.get("/spaces/{space_id}/translations")
def get_space_translations(space_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    space = db.query(Space).filter(Space.id == space_id).first()
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    rows = db.query(SpaceTranslation).filter(SpaceTranslation.space_id == space_id).all()
    result: dict = {}
    for row in rows:
        result.setdefault(row.language, {})[row.field] = row.value
    return result


@router.delete("/spaces/{space_id}", status_code=204)
def delete_space(space_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    space = db.query(Space).filter(Space.id == space_id).first()
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    active_orders = db.query(Order).filter(
        Order.space_id == space_id,
        Order.status.in_([OrderStatus.pending, OrderStatus.approved, OrderStatus.confirmed])
    ).count()
    if active_orders > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete space with active orders")
    db.delete(space)
    db.commit()


@router.post("/spaces/{space_id}/images", response_model=SpaceImageResponse, status_code=201)
async def add_image(space_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    validate_upload(file.filename)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    saved_name = f"{uuid.uuid4().hex}.{ext}"
    file_path = os.path.join(UPLOAD_DIR, saved_name)
    content = await read_validated_content(file)
    with open(file_path, "wb") as f:
        f.write(content)
    image = SpaceImage(space_id=space_id, image_url=f"/uploads/{saved_name}")
    db.add(image)
    db.commit()
    db.refresh(image)
    return image


@router.delete("/spaces/images/{image_id}", status_code=204)
def delete_image(image_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    image = db.query(SpaceImage).filter(SpaceImage.id == image_id).first()
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    file_path = os.path.join(UPLOAD_DIR, os.path.basename(image.image_url))
    if os.path.exists(file_path):
        os.remove(file_path)
    db.delete(image)
    db.commit()


@router.post("/spaces/{space_id}/operating-hours", response_model=OperatingHoursResponse, status_code=201)
def set_hours(space_id: int, data: OperatingHoursCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    oh = SpaceOperatingHours(space_id=space_id, **data.model_dump())
    db.add(oh)
    db.commit()
    db.refresh(oh)
    return oh


@router.delete("/spaces/operating-hours/{oh_id}", status_code=204)
def delete_hours(oh_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    oh = db.query(SpaceOperatingHours).filter(SpaceOperatingHours.id == oh_id).first()
    if not oh:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operating hours not found")
    db.delete(oh)
    db.commit()


@router.post("/spaces/{space_id}/screens", response_model=ScreenResponse, status_code=201)
def add_screen(space_id: int, data: ScreenCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    space = db.query(Space).filter(Space.id == space_id).first()
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    screen = Screen(space_id=space_id, **data.model_dump())
    db.add(screen)
    db.commit()
    db.refresh(screen)
    return screen


@router.put("/spaces/screens/{screen_id}", response_model=ScreenResponse)
def update_screen(screen_id: int, data: ScreenUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    screen = db.query(Screen).filter(Screen.id == screen_id).first()
    if not screen:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screen not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(screen, key, value)
    db.commit()
    db.refresh(screen)
    return screen


@router.delete("/spaces/screens/{screen_id}", status_code=204)
def delete_screen(screen_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    screen = db.query(Screen).filter(Screen.id == screen_id).first()
    if not screen:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screen not found")
    db.delete(screen)
    db.commit()


# ── Screen Translations ───────────────────────────────

@router.get("/spaces/{space_id}/screen-translations")
def get_screen_translations(space_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Return all screen translations for a space, keyed by screen_id -> language -> field -> value."""
    screen_ids = [sid for (sid,) in db.query(Screen.id).filter(Screen.space_id == space_id).all()]
    if not screen_ids:
        return {}
    rows = db.query(ScreenTranslation).filter(ScreenTranslation.screen_id.in_(screen_ids)).all()
    result: dict = {}
    for row in rows:
        result.setdefault(row.screen_id, {}).setdefault(row.language, {})[row.field] = row.value
    return result



# ── Space Type & Audience Profile Translations ────────

class BulkTranslationsPayload(BaseModel):
    translations: Dict[int, Dict[str, str]]  # {id: {lang: value, ...}}


class CreateSpaceTypePayload(BaseModel):
    name: str
    name_he: str


class CreateAudienceProfilePayload(BaseModel):
    name: str
    name_he: str
    category: str  # validated against AudienceCategory enum


@router.post("/space-types", status_code=201)
def create_space_type(data: CreateSpaceTypePayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    existing = db.query(SpaceType).filter(SpaceType.name == data.name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A space type with this name already exists")
    space_type = SpaceType(name=data.name)
    db.add(space_type)
    db.flush()
    if data.name_he.strip():
        db.add(SpaceTypeTranslation(space_type_id=space_type.id, language="he", field="name", value=data.name_he))
    db.commit()
    db.refresh(space_type)
    return {"id": space_type.id, "name": space_type.name}


@router.delete("/space-types/{space_type_id}", status_code=204)
def delete_space_type(space_type_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    space_type = db.query(SpaceType).filter(SpaceType.id == space_type_id).first()
    if not space_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space type not found")
    db.delete(space_type)
    db.commit()


@router.post("/audience-profiles", status_code=201)
def create_audience_profile(data: CreateAudienceProfilePayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    try:
        category = AudienceCategory(data.category)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid category. Must be one of: {', '.join(c.value for c in AudienceCategory)}")
    existing = db.query(AudienceProfile).filter(AudienceProfile.name == data.name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An audience profile with this name already exists")
    profile = AudienceProfile(name=data.name, category=category)
    db.add(profile)
    db.flush()
    if data.name_he.strip():
        db.add(AudienceProfileTranslation(audience_profile_id=profile.id, language="he", field="name", value=data.name_he))
    db.commit()
    db.refresh(profile)
    return {"id": profile.id, "name": profile.name, "category": profile.category.value}


@router.delete("/audience-profiles/{profile_id}", status_code=204)
def delete_audience_profile(profile_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    profile = db.query(AudienceProfile).filter(AudienceProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audience profile not found")
    db.delete(profile)
    db.commit()


@router.get("/space-types/translations")
def get_space_type_translations(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    rows = db.query(SpaceTypeTranslation).all()
    result: dict = {}
    for row in rows:
        result.setdefault(row.space_type_id, {}).setdefault(row.language, {})[row.field] = row.value
    return result


@router.put("/space-types/translations")
def set_space_type_translations(data: BulkTranslationsPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    for type_id, lang_map in data.translations.items():
        for lang, value in lang_map.items():
            existing = db.query(SpaceTypeTranslation).filter(
                SpaceTypeTranslation.space_type_id == int(type_id),
                SpaceTypeTranslation.language == lang,
                SpaceTypeTranslation.field == "name",
            ).first()
            if value.strip():
                if existing:
                    existing.value = value
                else:
                    db.add(SpaceTypeTranslation(space_type_id=int(type_id), language=lang, field="name", value=value))
            elif existing:
                db.delete(existing)
    db.commit()
    return {"ok": True}


@router.get("/audience-profiles/translations")
def get_audience_profile_translations(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    rows = db.query(AudienceProfileTranslation).all()
    result: dict = {}
    for row in rows:
        result.setdefault(row.audience_profile_id, {}).setdefault(row.language, {})[row.field] = row.value
    return result


@router.put("/audience-profiles/translations")
def set_audience_profile_translations(data: BulkTranslationsPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    for profile_id, lang_map in data.translations.items():
        for lang, value in lang_map.items():
            existing = db.query(AudienceProfileTranslation).filter(
                AudienceProfileTranslation.audience_profile_id == int(profile_id),
                AudienceProfileTranslation.language == lang,
                AudienceProfileTranslation.field == "name",
            ).first()
            if value.strip():
                if existing:
                    existing.value = value
                else:
                    db.add(AudienceProfileTranslation(audience_profile_id=int(profile_id), language=lang, field="name", value=value))
            elif existing:
                db.delete(existing)
    db.commit()
    return {"ok": True}


def _build_admin_order(order: Order) -> AdminOrderListResponse:
    return AdminOrderListResponse(
        id=order.id,
        reference_number=order.reference_number,
        user_id=order.user_id,
        user_name=order.user.name if order.user else "Unknown",
        user_email=order.user.email if order.user else "Unknown",
        space_id=order.space_id,
        space_name=order.space.name if order.space else None,
        booking_type=order.booking_type.value if order.booking_type else "long_term",
        start_date=order.start_date,
        end_date=order.end_date,
        total_cost=order.total_cost,
        status=order.status,
        notes=order.notes,
        payment_proof_url=order.payment_proof_url,
        created_at=order.created_at,
        campaign_id=order.campaign_id,
        time_slots=[TimeSlotResponse.model_validate(s) for s in order.time_slots],
        recurring_schedules=[RecurringScheduleResponse.model_validate(s) for s in order.recurring_schedules],
        schedule_overrides=[ScheduleOverrideResponse.model_validate(s) for s in order.schedule_overrides],
        creatives=[CreativeResponse.model_validate(c) for c in order.creatives],
    )


# ── Calendar ───────────────────────────────────────────

@router.get("/calendar", response_model=AdminCalendarResponse)
def get_calendar(
    start_date: date = Query(...),
    end_date: date = Query(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    from app.services.spaces import get_admin_calendar
    if (end_date - start_date).days > 31:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Date range cannot exceed 31 days")
    return get_admin_calendar(db, start_date, end_date)


# ── Orders ─────────────────────────────────────────────

@router.get("/orders", response_model=PaginatedResponse[AdminOrderListResponse])
def list_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    base_query = db.query(Order)
    total = base_query.count()
    skip = (page - 1) * page_size
    orders = (
        base_query
        .options(
            joinedload(Order.user),
            joinedload(Order.space),
            selectinload(Order.time_slots),
            selectinload(Order.recurring_schedules),
            selectinload(Order.schedule_overrides),
        )
        .order_by(Order.created_at.desc())
        .offset(skip)
        .limit(page_size)
        .all()
    )
    result = [_build_admin_order(order) for order in orders]
    total_pages = math.ceil(total / page_size) if total > 0 else 1
    return PaginatedResponse(
        items=result,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.put("/orders/{order_id}", response_model=AdminOrderListResponse)
def update_order_status(order_id: int, data: OrderStatusUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    order = (
        db.query(Order)
        .options(
            joinedload(Order.user),
            joinedload(Order.space),
            selectinload(Order.time_slots),
            selectinload(Order.recurring_schedules),
            selectinload(Order.schedule_overrides),
        )
        .filter(Order.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    order.status = data.status

    # When cancelling, delete the time slots so they become available again
    if data.status == OrderStatus.cancelled:
        for slot in order.time_slots:
            db.delete(slot)

    db.commit()
    db.refresh(order)

    # Create notification for user
    status_to_type = {
        OrderStatus.approved: NotificationType.order_approved,
        OrderStatus.confirmed: NotificationType.order_confirmed,
        OrderStatus.cancelled: NotificationType.order_cancelled,
        OrderStatus.completed: NotificationType.order_completed,
    }
    notif_type = status_to_type.get(data.status)
    if notif_type:
        status_label = data.status.value
        msg = f"Your order {order.reference_number} has been {status_label}"
        create_notification(db, order.user_id, notif_type, msg, order.id)

    # Create timeline event
    status_to_action = {
        OrderStatus.approved: ActionType.approved,
        OrderStatus.confirmed: ActionType.confirmed,
        OrderStatus.cancelled: ActionType.cancelled,
        OrderStatus.completed: ActionType.completed,
    }
    action = status_to_action.get(data.status)
    if action:
        status_label = data.status.value
        create_order_event(
            db, order.id, action,
            f"Order was {status_label} by admin",
            user_id=admin.id, actor_type=ActorType.admin,
        )

    return _build_admin_order(order)


@router.put("/orders/{order_id}/confirm-with-proof", response_model=AdminOrderListResponse)
async def confirm_order_with_proof(
    order_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    order = (
        db.query(Order)
        .options(
            joinedload(Order.user),
            joinedload(Order.space),
            selectinload(Order.time_slots),
            selectinload(Order.recurring_schedules),
            selectinload(Order.schedule_overrides),
        )
        .filter(Order.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if file.content_type not in ALLOWED_PROOF_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only JPEG, PNG, and WebP images are allowed")

    contents = await file.read()
    if len(contents) > MAX_PROOF_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must be under 10MB")

    os.makedirs(PAYMENT_PROOFS_DIR, exist_ok=True)
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(PAYMENT_PROOFS_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(contents)

    order.payment_proof_url = f"/uploads/payment_proofs/{filename}"
    order.status = OrderStatus.confirmed
    db.commit()
    db.refresh(order)

    # Create notification
    msg = f"Your order {order.reference_number} has been confirmed"
    create_notification(db, order.user_id, NotificationType.order_confirmed, msg, order.id)

    # Create timeline event
    create_order_event(
        db, order.id, ActionType.confirmed,
        "Order was confirmed by admin with payment proof",
        user_id=admin.id, actor_type=ActorType.admin,
    )

    # Send confirmation email in background
    try:
        send_booking_confirmed_email(order, order.user, order.space, db=db)
    except Exception:
        pass  # Email failure should not affect the response

    return _build_admin_order(order)


@router.delete("/orders/{order_id}", status_code=204)
def delete_order(order_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    db.delete(order)
    db.commit()


@router.delete("/campaigns/{campaign_id}", status_code=204)
def delete_campaign(campaign_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    delete_campaign_admin(db, campaign_id)


@router.put("/campaigns/{campaign_id}/approve")
def approve_campaign(campaign_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    campaign, approved_count = approve_campaign_admin(db, campaign_id, admin.id)
    return {"campaign_id": campaign.id, "approved_count": approved_count}


@router.put("/campaigns/{campaign_id}/approve-with-proof")
async def approve_campaign_with_proof(
    campaign_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")

    if file.content_type not in ALLOWED_PROOF_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only JPEG, PNG, and WebP images are allowed")

    contents = await file.read()
    if len(contents) > MAX_PROOF_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must be under 10MB")

    os.makedirs(PAYMENT_PROOFS_DIR, exist_ok=True)
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(PAYMENT_PROOFS_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(contents)

    proof_url = f"/uploads/payment_proofs/{filename}"

    orders = (
        db.query(Order)
        .options(joinedload(Order.user), joinedload(Order.space))
        .filter(Order.campaign_id == campaign_id)
        .all()
    )
    confirmed_count = 0
    for order in orders:
        if order.status in (OrderStatus.pending, OrderStatus.approved):
            order.status = OrderStatus.confirmed
            order.payment_proof_url = proof_url
            confirmed_count += 1
            create_notification(
                db, order.user_id, NotificationType.order_confirmed,
                f"Your order {order.reference_number} has been confirmed",
                order.id,
            )
            create_order_event(
                db, order.id, ActionType.confirmed,
                "Order was confirmed by admin with payment proof (campaign)",
                user_id=admin.id, actor_type=ActorType.admin,
            )

    campaign.status = CampaignStatus.approved
    db.commit()

    # Send confirmation email for first order as representative
    for order in orders:
        if order.payment_proof_url == proof_url:
            try:
                send_booking_confirmed_email(order, order.user, order.space, db=db)
            except Exception:
                pass
            break

    return {"campaign_id": campaign.id, "confirmed_count": confirmed_count}


# ── Broadcast Notifications ──────────────────────────

@router.post("/broadcast-notification")
def broadcast_notification(
    data: BroadcastNotificationRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user_ids = [uid for (uid,) in db.query(User.id).all()]
    total = len(user_ids)
    if total == 0:
        return {"sent": 0, "total": 0}

    label = f"[{data.notification_type.upper()}] {data.title}"

    BATCH_SIZE = 500
    for i in range(0, total, BATCH_SIZE):
        batch = user_ids[i : i + BATCH_SIZE]
        db.bulk_save_objects([
            Notification(
                user_id=uid,
                type=NotificationType.admin_broadcast,
                title=label,
                message=data.message,
            )
            for uid in batch
        ])
        db.commit()

    return {"sent": total, "total": total}


# ── Settings ──────────────────────────────────────────

class EmailSettingPayload(BaseModel):
    enabled: bool


class AccentColorPayload(BaseModel):
    color: str


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    from app.models.app_settings import AppSetting
    row = db.query(AppSetting).filter(AppSetting.key == "emails_enabled").first()
    emails_enabled = True if row is None else row.value.lower() == "true"
    accent_row = db.query(AppSetting).filter(AppSetting.key == "accent_color").first()
    accent_color = accent_row.value if accent_row else "#e61e4d"
    return {"emails_enabled": emails_enabled, "accent_color": accent_color}


@router.put("/settings/emails")
def update_email_setting(data: EmailSettingPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    from app.models.app_settings import AppSetting
    row = db.query(AppSetting).filter(AppSetting.key == "emails_enabled").first()
    if row:
        row.value = "true" if data.enabled else "false"
    else:
        db.add(AppSetting(key="emails_enabled", value="true" if data.enabled else "false"))
    db.commit()
    return {"emails_enabled": data.enabled}


@router.put("/settings/accent-color")
def update_accent_color(data: AccentColorPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    from app.models.app_settings import AppSetting
    import re
    if not re.match(r'^#[0-9a-fA-F]{6}$', data.color):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid hex color")
    row = db.query(AppSetting).filter(AppSetting.key == "accent_color").first()
    if row:
        row.value = data.color
    else:
        db.add(AppSetting(key="accent_color", value=data.color))
    db.commit()
    return {"accent_color": data.color}
