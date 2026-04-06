from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional
from app.models.user import UserRole


DEFAULT_NOTIFICATION_PREFERENCES = {
    "email_notifications": True,
    "notify_order_created": True,
    "notify_order_confirmed": True,
    "notify_order_cancelled": True,
    "notify_order_completed": True,
}


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: str
    phone_number: Optional[str] = None
    company_name: Optional[str] = None
    language: str = "en"


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class NotificationPreferences(BaseModel):
    email_notifications: bool = True
    notify_order_created: bool = True
    notify_order_confirmed: bool = True
    notify_order_cancelled: bool = True
    notify_order_completed: bool = True


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    phone_number: Optional[str] = None
    company_name: Optional[str] = None
    profile_picture: Optional[str] = None
    notification_preferences: Optional[NotificationPreferences] = None
    language: str = "en"
    role: UserRole
    created_at: datetime

    model_config = {"from_attributes": True}


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone_number: Optional[str] = None
    company_name: Optional[str] = None
    language: Optional[str] = None


class ChangePassword(BaseModel):
    current_password: str
    new_password: str


class AdminUserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: UserRole
    phone_number: Optional[str] = None
    company_name: Optional[str] = None
    language: str = "en"


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[UserRole] = None
    phone_number: Optional[str] = None
    company_name: Optional[str] = None
    password: Optional[str] = None


class GoogleAuth(BaseModel):
    credential: str  # Google ID token from frontend


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
    is_new: bool = False
    google_picture_url: Optional[str] = None
