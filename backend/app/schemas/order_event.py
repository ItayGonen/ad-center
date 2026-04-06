from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class OrderEventResponse(BaseModel):
    id: int
    order_id: int
    user_id: Optional[int] = None
    action_type: str
    actor_type: str
    description: str
    created_at: datetime

    model_config = {"from_attributes": True}
