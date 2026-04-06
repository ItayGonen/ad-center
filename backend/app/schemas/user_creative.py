from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


class UserCreativeResponse(BaseModel):
    id: int
    original_filename: str
    file_url: str
    thumbnail_url: Optional[str] = None
    file_type: str
    mime_type: Optional[str] = None
    file_size_bytes: int
    width: Optional[int] = None
    height: Optional[int] = None
    duration_seconds: Optional[float] = None
    aspect_ratio: Optional[str] = None
    original_url: Optional[str] = None
    processed_url: Optional[str] = None
    processing_status: str
    processing_step: Optional[str] = None
    processing_error: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UserCreativeListResponse(BaseModel):
    items: List[UserCreativeResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class ValidationIssue(BaseModel):
    type: str  # "warning" | "error"
    code: str  # "resolution_mismatch", "duration_long", "format_conversion", etc.
    message: str


class CampaignValidationRequest(BaseModel):
    creative_id: int
    space_id: int


class CampaignValidationResponse(BaseModel):
    valid: bool
    issues: List[ValidationIssue] = []


class CropRect(BaseModel):
    x: int
    y: int
    width: int
    height: int


class EditorRequest(BaseModel):
    rotation: Optional[int] = None  # 0, 90, 180, 270
    crop: Optional[CropRect] = None
