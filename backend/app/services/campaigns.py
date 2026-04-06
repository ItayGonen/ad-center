import logging
from sqlalchemy.orm import Session, joinedload, selectinload
from fastapi import HTTPException, status
from app.models.campaign import Campaign, CampaignStatus
from app.models.order import BookingType, Order, OrderStatus
from app.models.space import Space
from app.models.user import User
from app.models.notification import NotificationType
from app.models.order_event import ActionType, ActorType
from app.services.notifications import create_notification
from app.services.order_events import create_order_event
from app.schemas.campaign import CampaignCreate

logger = logging.getLogger(__name__)


def create_campaign(db: Session, data: CampaignCreate, user: User) -> Campaign:
    count = db.query(Campaign).filter(Campaign.user_id == user.id).count()
    name = f"Campaign #{count + 1}"

    campaign = Campaign(
        name=name,
        campaign_type=BookingType(data.campaign_type),
        user_id=user.id,
        status=CampaignStatus.active,
        schedule_template=data.schedule_template,
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign


def get_user_campaigns(db: Session, user: User) -> list[Campaign]:
    return (
        db.query(Campaign)
        .filter(Campaign.user_id == user.id)
        .order_by(Campaign.created_at.desc())
        .all()
    )


def delete_campaign(db: Session, campaign_id: int, user: User) -> None:
    """Delete a campaign and all its orders (cascade)."""
    campaign = (
        db.query(Campaign)
        .filter(Campaign.id == campaign_id, Campaign.user_id == user.id)
        .first()
    )
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    db.delete(campaign)
    db.commit()


def cancel_campaign(db: Session, campaign_id: int, user: User) -> Campaign:
    """Cancel a campaign and all its pending orders."""
    campaign = (
        db.query(Campaign)
        .filter(Campaign.id == campaign_id, Campaign.user_id == user.id)
        .first()
    )
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    if campaign.status == CampaignStatus.cancelled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Campaign is already cancelled")

    campaign.status = CampaignStatus.cancelled

    # Cancel all pending orders in this campaign
    orders = db.query(Order).filter(Order.campaign_id == campaign_id).all()
    for order in orders:
        if order.status in (OrderStatus.pending, OrderStatus.approved):
            order.status = OrderStatus.cancelled
            # Free up time slots
            for slot in order.time_slots:
                db.delete(slot)
            create_notification(
                db, user.id, NotificationType.order_cancelled,
                f"Your order {order.reference_number} has been cancelled (campaign cancelled)",
                order.id,
            )
            create_order_event(
                db, order.id, ActionType.cancelled,
                "Order was cancelled as part of campaign cancellation",
                user_id=user.id, actor_type=ActorType.user,
            )

    db.commit()
    db.refresh(campaign)
    logger.info("Campaign cancelled campaign_id=%d user_id=%d", campaign.id, user.id)
    return campaign


def approve_campaign_admin(db: Session, campaign_id: int, admin_user_id: int) -> tuple[Campaign, int]:
    """Admin: approve all pending orders in a campaign."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")

    orders = db.query(Order).filter(Order.campaign_id == campaign_id).all()
    approved_count = 0
    for order in orders:
        if order.status == OrderStatus.pending:
            order.status = OrderStatus.approved
            approved_count += 1
            create_notification(
                db, order.user_id, NotificationType.order_approved,
                f"Your order {order.reference_number} has been approved",
                order.id,
            )
            create_order_event(
                db, order.id, ActionType.approved,
                "Order was approved as part of campaign approval",
                user_id=admin_user_id, actor_type=ActorType.admin,
            )

    campaign.status = CampaignStatus.approved
    db.commit()
    db.refresh(campaign)
    return campaign, approved_count


def delete_campaign_admin(db: Session, campaign_id: int) -> None:
    """Admin: delete any campaign and all its orders (cascade)."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    db.delete(campaign)
    db.commit()


def get_campaign_detail(db: Session, campaign_id: int, user: User) -> dict:
    campaign = (
        db.query(Campaign)
        .filter(Campaign.id == campaign_id, Campaign.user_id == user.id)
        .first()
    )
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")

    orders = (
        db.query(Order)
        .filter(Order.campaign_id == campaign_id)
        .options(
            joinedload(Order.space).selectinload(Space.images),
            selectinload(Order.time_slots),
            selectinload(Order.recurring_schedules),
            selectinload(Order.schedule_overrides),
        )
        .order_by(Order.created_at.asc())
        .all()
    )

    order_list = []
    for o in orders:
        order_list.append({
            "id": o.id,
            "reference_number": o.reference_number,
            "space_id": o.space_id,
            "booking_type": o.booking_type.value if o.booking_type else "long_term",
            "start_date": o.start_date,
            "end_date": o.end_date,
            "total_cost": o.total_cost,
            "status": o.status,
            "notes": o.notes,
            "created_at": o.created_at,
            "space_name": o.space.name if o.space else None,
            "space_image": o.space.images[0].image_url if o.space and o.space.images else None,
            "campaign_id": o.campaign_id,
            "child_orders": [],
            "time_slots": o.time_slots,
            "recurring_schedules": o.recurring_schedules,
            "schedule_overrides": o.schedule_overrides,
        })

    return {
        "id": campaign.id,
        "name": campaign.name,
        "campaign_type": campaign.campaign_type.value if campaign.campaign_type else "long_term",
        "status": campaign.status.value if campaign.status else "active",
        "created_at": campaign.created_at,
        "updated_at": campaign.updated_at,
        "schedule_template": campaign.schedule_template,
        "orders": order_list,
    }
