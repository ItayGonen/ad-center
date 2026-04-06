import logging
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from app.models.user import User
from app.schemas.user import UserRegister, UserLogin, ChangePassword
from app.utils.security import hash_password, verify_password, create_access_token, validate_password
from app.config import settings

logger = logging.getLogger(__name__)


def register_user(db: Session, data: UserRegister) -> tuple[User, str]:
    pwd_error = validate_password(data.password)
    if pwd_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=pwd_error)
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        logger.warning("Registration failed: email already registered email=%s", data.email)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    user = User(
        email=data.email,
        password=hash_password(data.password),
        name=data.name,
        phone_number=data.phone_number,
        company_name=data.company_name,
        language=data.language,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    logger.info("User registered user_id=%d email=%s", user.id, user.email)
    return user, token


def login_user(db: Session, data: UserLogin) -> tuple[User, str]:
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not user.password or not verify_password(data.password, user.password):
        logger.warning("Login failed: invalid credentials email=%s", data.email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token({"sub": str(user.id)})
    logger.info("Login success user_id=%d email=%s", user.id, user.email)
    return user, token


def google_auth_user(db: Session, credential: str) -> tuple[User, str, bool, str | None]:
    try:
        idinfo = id_token.verify_oauth2_token(
            credential, google_requests.Request(), settings.GOOGLE_CLIENT_ID
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid Google token: {e}")

    email = idinfo["email"]
    name = idinfo.get("name", email)
    sub = idinfo["sub"]
    picture = idinfo.get("picture")

    is_new = False
    user = db.query(User).filter(User.email == email).first()
    if user:
        if not user.oauth_provider:
            user.oauth_provider = "google"
            user.oauth_id = sub
            db.commit()
            db.refresh(user)
    else:
        is_new = True
        user = User(
            email=email,
            password=None,
            name=name,
            oauth_provider="google",
            oauth_id=sub,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    token = create_access_token({"sub": str(user.id)})
    return user, token, is_new, picture


def change_password(db: Session, user: User, data: ChangePassword) -> None:
    if not user.password or not verify_password(data.current_password, user.password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    pwd_error = validate_password(data.new_password)
    if pwd_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=pwd_error)
    user.password = hash_password(data.new_password)
    db.commit()
    logger.info("Password changed user_id=%d", user.id)
