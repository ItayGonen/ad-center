import math
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.order import OrderCreate, OrderResponse, OrderListResponse, OrderUpdate, OrderEditRequest, ScheduleOverrideCreate, ScheduleOverrideResponse, SetCampaignRequest
from app.schemas.order_event import OrderEventResponse
from app.schemas.compatibility import CompatibilityResponse, CampaignCompatibilityTarget, ScheduleCompatibilityRequest
from app.schemas.pagination import PaginatedResponse
from app.services.orders import create_order, get_user_orders, get_order_detail, cancel_order, update_order_notes, edit_order, add_schedule_override, remove_schedule_override, duplicate_order_creatives, set_order_campaign
from app.services.compatibility import check_compatibility, check_schedule_compatibility
from app.services.order_events import get_order_timeline
from app.middleware.auth import get_current_user
from app.models.user import User
from app.models.order import Order

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("", response_model=OrderResponse, status_code=201)
def create(data: OrderCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return create_order(db, data, user)


@router.get("/my", response_model=PaginatedResponse[OrderListResponse])
def my_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    skip = (page - 1) * page_size
    result = get_user_orders(db, user, skip=skip, limit=page_size)
    total_pages = math.ceil(result["total"] / page_size) if result["total"] > 0 else 1
    return PaginatedResponse(
        items=result["items"],
        total=result["total"],
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.post("/check-schedule-compatibility", response_model=CompatibilityResponse)
def schedule_compatibility(data: ScheduleCompatibilityRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return check_schedule_compatibility(db, data, user)


@router.get("/{order_id}", response_model=OrderResponse)
def order_detail(order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_order_detail(db, order_id, user)


@router.put("/{order_id}/notes", response_model=OrderResponse)
def update_notes(order_id: int, data: OrderUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return update_order_notes(db, order_id, data.notes, user)


@router.put("/{order_id}/edit", response_model=OrderResponse)
def edit(order_id: int, data: OrderEditRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return edit_order(db, order_id, data, user)


@router.put("/{order_id}/cancel", response_model=OrderResponse)
def cancel(order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return cancel_order(db, order_id, user)


@router.get("/{order_id}/timeline", response_model=List[OrderEventResponse])
def timeline(order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Ensure the order belongs to the user
    order = db.query(Order).filter(Order.id == order_id, Order.user_id == user.id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return get_order_timeline(db, order_id)


@router.post("/{order_id}/overrides", response_model=ScheduleOverrideResponse, status_code=201)
def add_override(order_id: int, data: ScheduleOverrideCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return add_schedule_override(db, order_id, user, data)


@router.delete("/{order_id}/overrides/{override_id}", status_code=204)
def remove_override(order_id: int, override_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    remove_schedule_override(db, order_id, override_id, user)


@router.get("/{order_id}/compatibility/{target_space_id}", response_model=CompatibilityResponse)
def compatibility(order_id: int, target_space_id: int, exclude_order: int = Query(None), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return check_compatibility(db, order_id, target_space_id, user, exclude_order_id=exclude_order)


@router.post("/{order_id}/campaign-compatibility", response_model=List[CompatibilityResponse])
def campaign_compatibility(order_id: int, targets: List[CampaignCompatibilityTarget], db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    results = []
    for target in targets:
        result = check_compatibility(db, order_id, target.target_space_id, user, exclude_order_id=target.exclude_order_id)
        results.append(result)
    return results


@router.put("/{order_id}/set-campaign", response_model=OrderResponse)
def set_campaign(order_id: int, data: SetCampaignRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return set_order_campaign(db, order_id, data.campaign_id, user)


@router.post("/{order_id}/duplicate-creatives-from/{source_order_id}", status_code=200)
def duplicate_creatives(order_id: int, source_order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    duplicate_order_creatives(db, order_id, source_order_id, user)
    return {"status": "ok"}
