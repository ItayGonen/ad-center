from pydantic import BaseModel
from datetime import datetime, time, date
from typing import Optional, List, Dict
from app.models.space import EnvironmentType


class SpaceImageResponse(BaseModel):
    id: int
    image_url: str
    created_at: datetime

    model_config = {"from_attributes": True}


class OperatingHoursResponse(BaseModel):
    id: int
    day_of_week: int
    start_time: time
    end_time: time

    model_config = {"from_attributes": True}


class OperatingHoursCreate(BaseModel):
    day_of_week: int
    start_time: time
    end_time: time


class ScreenCreate(BaseModel):
    name: Optional[str] = None
    size_inches: str
    resolution_width: int
    resolution_height: int
    position_description: Optional[str] = None
    is_active: bool = True


class ScreenUpdate(BaseModel):
    name: Optional[str] = None
    size_inches: Optional[str] = None
    resolution_width: Optional[int] = None
    resolution_height: Optional[int] = None
    position_description: Optional[str] = None
    is_active: Optional[bool] = None


class ScreenResponse(BaseModel):
    id: int
    name: Optional[str] = None
    size_inches: str
    resolution_width: int
    resolution_height: int
    position_description: Optional[str] = None
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class SpaceTypeResponse(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class AudienceProfileResponse(BaseModel):
    id: int
    name: str
    category: str

    model_config = {"from_attributes": True}


class SpaceCreate(BaseModel):
    name: str
    full_address: Optional[str] = None
    city: str
    space_type_id: Optional[int] = None
    environment: Optional[EnvironmentType] = None
    estimated_daily_impressions: Optional[str] = None
    average_dwell_time: Optional[int] = None
    audience_profile_ids: Optional[List[int]] = None
    number_of_screens: Optional[int] = None
    screen_size: Optional[str] = None
    resolution: Optional[str] = None
    price_per_day: float
    general_description: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    partner_owner: Optional[int] = None
    translations: Optional[Dict[str, Dict[str, str]]] = None


class SpaceUpdate(BaseModel):
    name: Optional[str] = None
    full_address: Optional[str] = None
    city: Optional[str] = None
    space_type_id: Optional[int] = None
    environment: Optional[EnvironmentType] = None
    estimated_daily_impressions: Optional[str] = None
    average_dwell_time: Optional[int] = None
    audience_profile_ids: Optional[List[int]] = None
    number_of_screens: Optional[int] = None
    screen_size: Optional[str] = None
    resolution: Optional[str] = None
    price_per_day: Optional[float] = None
    general_description: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    partner_owner: Optional[int] = None
    translations: Optional[Dict[str, Dict[str, str]]] = None


class SpaceListResponse(BaseModel):
    id: int
    name: str
    city: Optional[str] = None
    space_type: Optional[SpaceTypeResponse] = None
    environment: Optional[EnvironmentType] = None
    estimated_daily_impressions: Optional[str] = None
    price_per_day: float
    first_image: Optional[str] = None
    partner_owner: Optional[int] = None
    partner_name: Optional[str] = None
    audience_profiles: List[AudienceProfileResponse] = []

    model_config = {"from_attributes": True}


class SpaceDetailResponse(BaseModel):
    id: int
    name: str
    full_address: Optional[str] = None
    city: Optional[str] = None
    space_type: Optional[SpaceTypeResponse] = None
    environment: Optional[EnvironmentType] = None
    estimated_daily_impressions: Optional[str] = None
    average_dwell_time: Optional[int] = None
    audience_profiles: List[AudienceProfileResponse] = []
    number_of_screens: Optional[int] = None
    screen_size: Optional[str] = None
    resolution: Optional[str] = None
    price_per_day: float
    general_description: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    images: List[SpaceImageResponse] = []
    operating_hours: List[OperatingHoursResponse] = []
    screens: List[ScreenResponse] = []
    created_at: datetime
    partner_owner: Optional[int] = None
    partner_name: Optional[str] = None
    partner_profile_picture: Optional[str] = None

    model_config = {"from_attributes": True}


class TimeWindow(BaseModel):
    start_time: time
    end_time: time


class HourSlotInfo(BaseModel):
    hour: str           # "09:00"
    booked_count: int   # 0–6
    max_slots: int = 6


class DayAvailability(BaseModel):
    date: date
    day_of_week: int
    available_windows: List[TimeWindow]
    operating_hours: Optional[TimeWindow] = None
    hour_slots: List[HourSlotInfo] = []
