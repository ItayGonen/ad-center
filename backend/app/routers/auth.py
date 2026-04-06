import os
import uuid
import ipaddress
import socket
from urllib.parse import urlparse
import httpx
from fastapi import APIRouter, Depends, Request, Response, UploadFile, File, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from slowapi import Limiter
from slowapi.util import get_remote_address
from app.database import get_db
from app.schemas.user import UserRegister, UserLogin, UserResponse, TokenResponse, ProfileUpdate, GoogleAuth, ChangePassword, NotificationPreferences, DEFAULT_NOTIFICATION_PREFERENCES
from app.services.auth import register_user, login_user, google_auth_user, change_password
from app.middleware.auth import get_current_user
from app.models.user import User
from app.config import settings

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/auth", tags=["auth"])

UPLOADS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
AVATARS_DIR = os.path.join(UPLOADS_DIR, "avatars")
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_AVATAR_SIZE = 5 * 1024 * 1024  # 5MB

COOKIE_MAX_AGE = settings.JWT_EXPIRATION_MINUTES * 60  # seconds


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,  # Set to True in production with HTTPS
        max_age=COOKIE_MAX_AGE,
        path="/",
    )


@router.post("/register", response_model=TokenResponse)
@limiter.limit("5/minute")
def register(request: Request, response: Response, data: UserRegister, db: Session = Depends(get_db)):
    user, token = register_user(db, data)
    _set_auth_cookie(response, token)
    return TokenResponse(access_token=token, user=UserResponse.model_validate(user))


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(request: Request, response: Response, data: UserLogin, db: Session = Depends(get_db)):
    user, token = login_user(db, data)
    _set_auth_cookie(response, token)
    return TokenResponse(access_token=token, user=UserResponse.model_validate(user))


@router.post("/google", response_model=TokenResponse)
@limiter.limit("10/minute")
def google_login(request: Request, response: Response, data: GoogleAuth, db: Session = Depends(get_db)):
    user, token, is_new, google_picture_url = google_auth_user(db, data.credential)
    _set_auth_cookie(response, token)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
        is_new=is_new,
        google_picture_url=google_picture_url,
    )


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"message": "Logged out"}


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


@router.put("/me", response_model=UserResponse)
def update_profile(data: ProfileUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if data.name is not None:
        current_user.name = data.name
    if data.phone_number is not None:
        current_user.phone_number = data.phone_number
    if data.company_name is not None:
        current_user.company_name = data.company_name
    if data.language is not None:
        current_user.language = data.language
    if data.email is not None and data.email != current_user.email:
        existing = db.query(User).filter(User.email == data.email, User.id != current_user.id).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already in use")
        current_user.email = data.email
    db.commit()
    db.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.put("/me/password")
def update_password(data: ChangePassword, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    change_password(db, current_user, data)
    return {"message": "Password updated successfully"}


@router.post("/me/avatar", response_model=UserResponse)
async def upload_avatar(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only JPEG, PNG, and WebP images are allowed")

    contents = await file.read()
    if len(contents) > MAX_AVATAR_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image must be under 5MB")

    # Delete old avatar if exists
    if current_user.profile_picture:
        old_path = os.path.join(UPLOADS_DIR, current_user.profile_picture.lstrip("/uploads/"))
        if os.path.exists(old_path):
            os.remove(old_path)

    os.makedirs(AVATARS_DIR, exist_ok=True)

    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(AVATARS_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(contents)

    current_user.profile_picture = f"/uploads/avatars/{filename}"
    db.commit()
    db.refresh(current_user)
    return UserResponse.model_validate(current_user)


class AvatarFromUrlRequest(BaseModel):
    url: str


ALLOWED_AVATAR_HOSTS = {"lh3.googleusercontent.com", "googleusercontent.com"}


def _validate_avatar_url(url: str) -> str:
    """Validate URL to prevent SSRF: HTTPS only, no private/internal IPs."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="Only HTTPS URLs are allowed")
    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="Invalid URL")
    # Allow only known avatar hosts (Google profile pictures)
    if not any(hostname == h or hostname.endswith("." + h) for h in ALLOWED_AVATAR_HOSTS):
        raise HTTPException(status_code=400, detail="URL host not allowed")
    # Resolve hostname and block private/internal IPs
    try:
        resolved = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve URL hostname")
    for _, _, _, _, addr in resolved:
        ip = ipaddress.ip_address(addr[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise HTTPException(status_code=400, detail="URL points to a restricted address")
    return url


@router.post("/me/avatar/from-url", response_model=UserResponse)
async def avatar_from_url(
    data: AvatarFromUrlRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _validate_avatar_url(data.url)
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=10.0) as client:
            resp = await client.get(data.url)
            resp.raise_for_status()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to download image from URL")

    content_type = resp.headers.get("content-type", "")
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="URL does not point to a valid image")

    contents = resp.content
    if len(contents) > MAX_AVATAR_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image must be under 5MB")

    # Delete old avatar if exists
    if current_user.profile_picture:
        old_path = os.path.join(UPLOADS_DIR, current_user.profile_picture.lstrip("/uploads/"))
        if os.path.exists(old_path):
            os.remove(old_path)

    os.makedirs(AVATARS_DIR, exist_ok=True)

    ext_map = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
    ext = ext_map.get(content_type.split(";")[0].strip(), "jpg")
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(AVATARS_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(contents)

    current_user.profile_picture = f"/uploads/avatars/{filename}"
    db.commit()
    db.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.delete("/me/avatar", response_model=UserResponse)
def delete_avatar(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.profile_picture:
        old_path = os.path.join(UPLOADS_DIR, current_user.profile_picture.lstrip("/uploads/"))
        if os.path.exists(old_path):
            os.remove(old_path)
        current_user.profile_picture = None
        db.commit()
        db.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.get("/me/notification-preferences", response_model=NotificationPreferences)
def get_notification_preferences(current_user: User = Depends(get_current_user)):
    prefs = current_user.notification_preferences
    if prefs is None:
        return NotificationPreferences(**DEFAULT_NOTIFICATION_PREFERENCES)
    return NotificationPreferences(**prefs)


@router.put("/me/notification-preferences", response_model=NotificationPreferences)
def update_notification_preferences(
    data: NotificationPreferences,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.notification_preferences = data.model_dump()
    db.commit()
    db.refresh(current_user)
    return NotificationPreferences(**current_user.notification_preferences)
