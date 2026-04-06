from pydantic import BaseModel, field_validator
from datetime import datetime, date, time
from typing import Optional, List
from app.models.order import OrderStatus, FileType, ApprovalStatus


class TimeRange(BaseModel):
    start_time: time
    end_time: time

    @field_validator("start_time", "end_time")
    @classmethod
    def must_be_10min_aligned(cls, v: time) -> time:
        if v.minute % 10 != 0 or v.second != 0:
            raise ValueError("Time must be aligned to 10-minute boundaries (e.g. 09:00, 09:10, 09:20)")
        return v


class SelectedDay(BaseModel):
    date: date
    time_ranges: List[TimeRange]


class RecurringScheduleEntry(BaseModel):
    day_of_week: int  # 0=Sun, 6=Sat
    start_time: time
    end_time: time

    @field_validator("start_time", "end_time")
    @classmethod
    def must_be_10min_aligned(cls, v: time) -> time:
        if v.minute % 10 != 0 or v.second != 0:
            raise ValueError("Time must be aligned to 10-minute boundaries")
        return v


class ScheduleOverrideCreate(BaseModel):
    date: date
    override_type: str  # "skip" or "replace"
    start_time: Optional[time] = None
    end_time: Optional[time] = None


class ScheduleOverrideResponse(BaseModel):
    id: int
    date: date
    override_type: str
    start_time: Optional[time] = None
    end_time: Optional[time] = None

    model_config = {"from_attributes": True}


class RecurringScheduleResponse(BaseModel):
    id: int
    day_of_week: int
    start_time: time
    end_time: time

    model_config = {"from_attributes": True}


class OrderCreate(BaseModel):
    space_id: int
    booking_type: str = "long_term"
    start_date: date
    end_date: date
    selected_days: Optional[List[SelectedDay]] = None
    recurring_schedule: Optional[List[RecurringScheduleEntry]] = None  # required for long_term
    notes: Optional[str] = None
    campaign_id: Optional[int] = None


class TimeSlotResponse(BaseModel):
    id: int
    date: date
    start_time: time
    end_time: time
    status: str
    slot_position: int = 1

    model_config = {"from_attributes": True}


class CreativeResponse(BaseModel):
    id: int
    file_url: str
    file_type: FileType
    approval_status: ApprovalStatus
    created_at: datetime

    model_config = {"from_attributes": True}


class OrderResponse(BaseModel):
    id: int
    reference_number: str
    space_id: int
    booking_type: str
    start_date: date
    end_date: date
    total_cost: float
    status: OrderStatus
    notes: Optional[str] = None
    created_at: datetime
    campaign_id: Optional[int] = None
    time_slots: List[TimeSlotResponse] = []
    recurring_schedules: List[RecurringScheduleResponse] = []
    schedule_overrides: List[ScheduleOverrideResponse] = []

    model_config = {"from_attributes": True}


class ChildOrderItem(BaseModel):
    id: int
    reference_number: str
    space_id: int
    space_name: Optional[str] = None
    space_image: Optional[str] = None
    booking_type: str = "long_term"
    start_date: date
    end_date: date
    total_cost: float
    status: OrderStatus
    created_at: Optional[datetime] = None
    notes: Optional[str] = None
    campaign_id: Optional[int] = None
    time_slots: List[TimeSlotResponse] = []

    model_config = {"from_attributes": True}


class OrderListResponse(BaseModel):
    id: int
    reference_number: str
    space_id: int
    booking_type: str
    start_date: date
    end_date: date
    total_cost: float
    status: OrderStatus
    notes: Optional[str] = None
    created_at: datetime
    space_name: Optional[str] = None
    space_image: Optional[str] = None
    campaign_id: Optional[int] = None
    child_orders: List[ChildOrderItem] = []
    time_slots: List[TimeSlotResponse] = []
    recurring_schedules: List[RecurringScheduleResponse] = []
    schedule_overrides: List[ScheduleOverrideResponse] = []

    model_config = {"from_attributes": True}


class SetCampaignRequest(BaseModel):
    campaign_id: int


class OrderUpdate(BaseModel):
    notes: Optional[str] = None


class OrderEditRequest(BaseModel):
    start_date: date
    end_date: date
    booking_type: Optional[str] = None
    selected_days: Optional[List[SelectedDay]] = None
    recurring_schedule: Optional[List[RecurringScheduleEntry]] = None
    notes: Optional[str] = None


class CalendarSlotOrder(BaseModel):
    order_id: int
    reference_number: str
    user_id: int
    user_name: str
    user_email: str
    space_id: int
    space_name: str
    booking_type: str
    campaign_id: Optional[int] = None
    status: str
    total_cost: float
    slot_position: int


class CalendarHourSlot(BaseModel):
    space_id: int
    space_name: str
    hour: str
    booked_count: int
    max_slots: int
    orders: List[CalendarSlotOrder]


class CalendarDayEntry(BaseModel):
    date: date
    day_of_week: int
    hours: List[CalendarHourSlot]


class CalendarSpaceSummary(BaseModel):
    id: int
    name: str


class AdminCalendarResponse(BaseModel):
    days: List[CalendarDayEntry]
    spaces: List[CalendarSpaceSummary]


class OrderStatusUpdate(BaseModel):
    status: OrderStatus


class AdminOrderListResponse(BaseModel):
    id: int
    reference_number: str
    user_id: int
    user_name: str
    user_email: str
    space_id: int
    space_name: Optional[str] = None
    booking_type: str
    start_date: date
    end_date: date
    total_cost: float
    status: OrderStatus
    notes: Optional[str] = None
    payment_proof_url: Optional[str] = None
    created_at: datetime
    campaign_id: Optional[int] = None
    time_slots: List[TimeSlotResponse] = []
    recurring_schedules: List[RecurringScheduleResponse] = []
    schedule_overrides: List[ScheduleOverrideResponse] = []
    creatives: List[CreativeResponse] = []

    model_config = {"from_attributes": True}
