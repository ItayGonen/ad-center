from pydantic import BaseModel
from typing import List, Optional


class CompatibilitySlot(BaseModel):
    date: str
    start_time: str
    end_time: str


class CompatibilityConflict(BaseModel):
    date: str
    start_time: str
    end_time: str
    reason: str  # "outside_operating_hours" or "capacity_full"


class CompatibilityResponse(BaseModel):
    compatibility: str  # "full" | "partial" | "none"
    target_space_id: int
    target_space_name: str
    target_space_price_per_day: float
    available_slots: List[CompatibilitySlot]
    conflicts: List[CompatibilityConflict]
    available_count: int
    conflict_count: int
    total_source_slots: int
    estimated_cost: float


class CampaignCompatibilityTarget(BaseModel):
    target_space_id: int
    exclude_order_id: Optional[int] = None


class ScheduleSlot(BaseModel):
    date: str           # "2025-06-15"
    start_time: str     # "09:00:00"
    end_time: str       # "10:00:00"


class ScheduleCompatibilityRequest(BaseModel):
    target_space_id: int
    slots: List[ScheduleSlot]
