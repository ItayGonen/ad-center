import logging
from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app.schemas.campaign import CampaignCreate, CampaignResponse, CampaignDetailResponse
from app.services.campaigns import create_campaign, get_user_campaigns, get_campaign_detail, cancel_campaign
from app.services.email import send_campaign_created_emails
from app.middleware.auth import get_current_user
from app.models.user import User
from app.models.order import Order
from app.models.campaign import Campaign

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


@router.post("", response_model=CampaignResponse, status_code=201)
def create(data: CampaignCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return create_campaign(db, data, user)


@router.get("/my", response_model=List[CampaignResponse])
def my_campaigns(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_user_campaigns(db, user)


@router.get("/{campaign_id}", response_model=CampaignDetailResponse)
def campaign_detail(campaign_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_campaign_detail(db, campaign_id, user)


@router.post("/{campaign_id}/finalize")
def finalize(campaign_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id, Campaign.user_id == user.id).first()
    if not campaign:
        return {"ok": True}  # Fail silently — email is non-critical

    orders = (
        db.query(Order)
        .filter(Order.campaign_id == campaign_id)
        .options(joinedload(Order.space))
        .order_by(Order.created_at.asc())
        .all()
    )
    if not orders:
        return {"ok": True}

    orders_with_spaces = [(o, o.space) for o in orders]
    try:
        send_campaign_created_emails(orders_with_spaces, user, db=db)
    except Exception as e:
        logger.error("Failed to send campaign emails for campaign %d: %s", campaign_id, e)

    return {"ok": True}


@router.put("/{campaign_id}/cancel", response_model=CampaignResponse)
def cancel(campaign_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return cancel_campaign(db, campaign_id, user)
