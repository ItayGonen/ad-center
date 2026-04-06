from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional
from app.schemas.order import OrderListResponse


class CampaignCreate(BaseModel):
    campaign_type: str
    schedule_template: Optional[dict] = None


class CampaignResponse(BaseModel):
    id: int
    name: str
    campaign_type: str
    status: str
    created_at: datetime
    updated_at: datetime
    schedule_template: Optional[dict] = None

    model_config = {"from_attributes": True}


class CampaignDetailResponse(CampaignResponse):
    orders: List[OrderListResponse] = []

    model_config = {"from_attributes": True}
