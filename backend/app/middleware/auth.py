import logging
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.utils.security import decode_access_token

logger = logging.getLogger(__name__)


def _extract_token(request: Request) -> str | None:
    """Extract JWT from Authorization header or httpOnly cookie."""
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        return auth_header[7:]
    return request.cookies.get("access_token")


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_access_token(token)
    if payload is None:
        logger.warning("Auth failure: invalid token")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user_id = payload.get("sub")
    if user_id is None:
        logger.warning("Auth failure: token missing sub claim")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        logger.warning("Auth failure: user not found user_id=%s", user_id)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role.value != "admin":
        logger.warning("Auth failure: admin required user_id=%d", current_user.id)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def require_partner(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role.value != "partner":
        logger.warning("Auth failure: partner required user_id=%d", current_user.id)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Partner access required")
    return current_user


def require_partner_or_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role.value not in ("partner", "admin"):
        logger.warning("Auth failure: partner or admin required user_id=%d", current_user.id)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Partner or admin access required")
    return current_user
