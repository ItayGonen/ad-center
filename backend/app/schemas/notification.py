from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class NotificationResponse(BaseModel):
    id: int
    type: str
    title: Optional[str] = None
    message: str
    link: Optional[str] = None
    related_order_id: Optional[int] = None
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    unread_count: int
    total: int = 0
    page: int = 1
    page_size: int = 20
    total_pages: int = 1


class BroadcastNotificationRequest(BaseModel):
    title: str
    message: str
    notification_type: str = "info"
