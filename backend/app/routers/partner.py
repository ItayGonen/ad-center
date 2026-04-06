import math
from datetime import datetime, timedelta, date, time as dt_time
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, case, literal_column
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app.middleware.auth import require_partner
from app.models.user import User
from app.models.space import Space, SpaceOperatingHours
from app.models.order import Order, OrderStatus, SpaceTimeSlot, SlotStatus
from app.models.translation import SpaceTranslation
from app.schemas.pagination import PaginatedResponse

TRANSLATABLE_SPACE_FIELDS = {"name", "general_description", "city", "full_address"}

router = APIRouter(prefix="/partner", tags=["partner"])


@router.get("/dashboard")
def partner_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_partner),
):
    partner_space_ids = [
        sid for (sid,) in db.query(Space.id).filter(Space.partner_owner == current_user.id).all()
    ]

    total_spaces = len(partner_space_ids)

    if not partner_space_ids:
        return {
            "total_spaces": 0,
            "total_orders": 0,
            "total_revenue": 0,
            "partner_revenue": 0,
            "pending_orders": 0,
            "confirmed_orders": 0,
            "recent_orders": [],
        }

    total_orders = db.query(Order).filter(Order.space_id.in_(partner_space_ids)).count()

    revenue_result = (
        db.query(func.coalesce(func.sum(Order.total_cost), 0))
        .filter(
            Order.space_id.in_(partner_space_ids),
            Order.status.in_([OrderStatus.approved, OrderStatus.confirmed, OrderStatus.completed]),
        )
        .scalar()
    )
    total_revenue = float(revenue_result)
    partner_revenue = round(total_revenue * 0.8, 2)

    pending_orders = (
        db.query(Order)
        .filter(
            Order.space_id.in_(partner_space_ids),
            Order.status == OrderStatus.pending,
        )
        .count()
    )

    confirmed_orders = (
        db.query(Order)
        .filter(
            Order.space_id.in_(partner_space_ids),
            Order.status == OrderStatus.confirmed,
        )
        .count()
    )

    recent_orders_query = (
        db.query(Order)
        .options(joinedload(Order.user), joinedload(Order.space))
        .filter(Order.space_id.in_(partner_space_ids))
        .order_by(Order.created_at.desc())
        .limit(5)
        .all()
    )

    recent_orders = [
        {
            "id": o.id,
            "reference_number": o.reference_number,
            "user_name": o.user.name if o.user else "Unknown",
            "user_email": o.user.email if o.user else "Unknown",
            "space_name": o.space.name if o.space else "Unknown",
            "start_date": o.start_date.isoformat(),
            "end_date": o.end_date.isoformat(),
            "total_cost": float(o.total_cost),
            "status": o.status.value,
            "created_at": o.created_at.isoformat(),
        }
        for o in recent_orders_query
    ]

    return {
        "total_spaces": total_spaces,
        "total_orders": total_orders,
        "total_revenue": total_revenue,
        "partner_revenue": partner_revenue,
        "pending_orders": pending_orders,
        "confirmed_orders": confirmed_orders,
        "recent_orders": recent_orders,
    }


@router.get("/spaces")
def partner_spaces(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    lang: str = Query("en"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_partner),
):
    base_query = db.query(Space).filter(Space.partner_owner == current_user.id)
    total = base_query.count()
    skip = (page - 1) * page_size
    spaces = base_query.options(
        joinedload(Space.images)
    ).offset(skip).limit(page_size).all()

    items = []
    for space in spaces:
        first_image = space.images[0].image_url if space.images else None
        items.append({
            "id": space.id,
            "name": space.name,
            "city": space.city,
            "space_type": {"id": space.space_type.id, "name": space.space_type.name} if space.space_type else None,
            "environment": space.environment.value if space.environment else None,
            "estimated_daily_impressions": space.estimated_daily_impressions,
            "price_per_day": float(space.price_per_day),
            "first_image": first_image,
            "lat": space.lat,
            "lng": space.lng,
        })

    # Overlay translations for non-English languages
    if lang != "en" and items:
        space_ids = [item["id"] for item in items]
        translations = db.query(SpaceTranslation).filter(
            SpaceTranslation.space_id.in_(space_ids),
            SpaceTranslation.language == lang,
        ).all()
        trans_map: dict = {}
        for t in translations:
            trans_map.setdefault(t.space_id, {})[t.field] = t.value
        for item in items:
            if item["id"] in trans_map:
                for field, value in trans_map[item["id"]].items():
                    if field in TRANSLATABLE_SPACE_FIELDS:
                        item[field] = value

    total_pages = math.ceil(total / page_size) if total > 0 else 1
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@router.get("/orders")
def partner_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_partner),
):
    partner_space_ids = [
        sid for (sid,) in db.query(Space.id).filter(Space.partner_owner == current_user.id).all()
    ]

    if not partner_space_ids:
        return {
            "items": [],
            "total": 0,
            "page": page,
            "page_size": page_size,
            "total_pages": 1,
        }

    base_query = db.query(Order).filter(Order.space_id.in_(partner_space_ids))
    total = base_query.count()
    skip = (page - 1) * page_size
    orders = (
        base_query
        .options(
            joinedload(Order.user),
            joinedload(Order.space).selectinload(Space.images),
        )
        .order_by(Order.created_at.desc())
        .offset(skip)
        .limit(page_size)
        .all()
    )

    items = [
        {
            "id": o.id,
            "reference_number": o.reference_number,
            "user_name": o.user.name if o.user else "Unknown",
            "user_email": o.user.email if o.user else "Unknown",
            "space_id": o.space_id,
            "space_name": o.space.name if o.space else "Unknown",
            "space_image": o.space.images[0].image_url if o.space and o.space.images else None,
            "start_date": o.start_date.isoformat(),
            "end_date": o.end_date.isoformat(),
            "total_cost": float(o.total_cost),
            "status": o.status.value,
            "created_at": o.created_at.isoformat(),
        }
        for o in orders
    ]

    total_pages = math.ceil(total / page_size) if total > 0 else 1
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@router.get("/revenue")
def partner_revenue(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_partner),
):
    partner_space_ids = [
        sid for (sid,) in db.query(Space.id).filter(Space.partner_owner == current_user.id).all()
    ]

    if not partner_space_ids:
        return {"total_revenue": 0, "partner_total": 0, "monthly_revenue": []}

    revenue_result = (
        db.query(func.coalesce(func.sum(Order.total_cost), 0))
        .filter(
            Order.space_id.in_(partner_space_ids),
            Order.status.in_([OrderStatus.approved, OrderStatus.confirmed, OrderStatus.completed]),
        )
        .scalar()
    )
    total_revenue = float(revenue_result)

    # Monthly revenue for last 12 months
    now = datetime.utcnow()
    twelve_months_ago = now - timedelta(days=365)

    monthly_rows = (
        db.query(
            func.date_format(Order.created_at, '%Y-%m').label('month'),
            func.sum(Order.total_cost).label('revenue'),
        )
        .filter(
            Order.space_id.in_(partner_space_ids),
            Order.status.in_([OrderStatus.approved, OrderStatus.confirmed, OrderStatus.completed]),
            Order.created_at >= twelve_months_ago,
        )
        .group_by(func.date_format(Order.created_at, '%Y-%m'))
        .order_by(func.date_format(Order.created_at, '%Y-%m'))
        .all()
    )

    partner_total = round(total_revenue * 0.8, 2)

    monthly_revenue = [
        {"month": row.month, "revenue": float(row.revenue), "partner_share": round(float(row.revenue) * 0.8, 2)}
        for row in monthly_rows
    ]

    # Daily revenue for last 30 days (used when monthly data has < 3 points)
    thirty_days_ago = now - timedelta(days=30)
    daily_rows = (
        db.query(
            func.date_format(Order.created_at, '%Y-%m-%d').label('day'),
            func.sum(Order.total_cost).label('revenue'),
        )
        .filter(
            Order.space_id.in_(partner_space_ids),
            Order.status.in_([OrderStatus.approved, OrderStatus.confirmed, OrderStatus.completed]),
            Order.created_at >= thirty_days_ago,
        )
        .group_by(func.date_format(Order.created_at, '%Y-%m-%d'))
        .order_by(func.date_format(Order.created_at, '%Y-%m-%d'))
        .all()
    )

    daily_revenue = [
        {"day": row.day, "revenue": float(row.revenue), "partner_share": round(float(row.revenue) * 0.8, 2)}
        for row in daily_rows
    ]

    return {
        "total_revenue": total_revenue,
        "partner_total": partner_total,
        "monthly_revenue": monthly_revenue,
        "daily_revenue": daily_revenue,
    }

def calculate_hours_range(data, days_ahead):
    total_hours = 0
    now = datetime.now()

    for i in range(days_ahead):
        current_day = now + timedelta(days=i)
        dow = current_day.weekday()

        for space_id, days in data.items():
            if dow in days:
                hours = days[dow]

                start = datetime.strptime(hours["start"], "%H:%M:%S")
                end = datetime.strptime(hours["end"], "%H:%M:%S")

                diff = (end - start).total_seconds() / 3600
                total_hours += diff

    return total_hours * 6


def get_booked_hours(db, space_ids, start_date, end_date):
    total_booked_hours = (
        db.query(
            func.sum(
                (func.time_to_sec(SpaceTimeSlot.end_time) - 
                 func.time_to_sec(SpaceTimeSlot.start_time)) / 3600
            )
        )
        .join(Order, SpaceTimeSlot.order_id == Order.id)
        .filter(SpaceTimeSlot.space_id.in_(space_ids))
        .filter(SpaceTimeSlot.date >= start_date)
        .filter(SpaceTimeSlot.date < end_date)
        .filter(SpaceTimeSlot.status == "booked")
        .filter(Order.status == "confirmed")
        .scalar()
    )

    return float(total_booked_hours or 0)

@router.get("/occupancy")
def partner_occupancy(
    period: str = Query("week", regex="^(week|month|year)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_partner),
):
    PERIOD_DAYS = {
        "week": 7,
        "month": 30,
        "year": 365
    }
    days = PERIOD_DAYS[period]

    partner_space_ids = [
        sid for (sid,) in db.query(Space.id)
        .filter(Space.partner_owner == current_user.id)
        .all()
    ]

    # build operating hours map
    result = {}
    for sid in partner_space_ids:
        rows = (
            db.query(SpaceOperatingHours)
            .filter(SpaceOperatingHours.space_id == sid)
            .all()
        )

        result[sid] = {
            row.day_of_week: {
                "start": str(row.start_time),
                "end": str(row.end_time)
            }
            for row in rows
        }

    # date range
    start_date = datetime.now().date()
    end_date = (datetime.now() + timedelta(days=days)).date()

    # calculations
    available_hours = calculate_hours_range(result, days)
    booked_hours = get_booked_hours(db, partner_space_ids, start_date, end_date)

    occupancy_rate = 0
    if available_hours > 0:
        occupancy_rate = (booked_hours / available_hours) * 100

    return {
        "period": period,
        "available_hours": available_hours,
        "booked_hours": booked_hours,
        "occupancy_rate": round(occupancy_rate, 2)
    }