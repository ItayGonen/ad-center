import math
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.notification import NotificationListResponse, NotificationResponse
from app.services.notifications import get_user_notifications, mark_as_read, mark_all_as_read, clear_all_notifications

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    skip = (page - 1) * page_size
    result = get_user_notifications(db, user.id, skip=skip, limit=page_size)
    total_pages = math.ceil(result["total"] / page_size) if result["total"] > 0 else 1
    return {
        "items": result["items"],
        "unread_count": result["unread_count"],
        "total": result["total"],
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@router.put("/read-all", status_code=200)
def read_all_notifications(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    count = mark_all_as_read(db, user.id)
    return {"marked": count}


@router.delete("/clear-all", status_code=200)
def clear_notifications(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    count = clear_all_notifications(db, user.id)
    return {"deleted": count}


@router.put("/{notification_id}/read", response_model=NotificationResponse)
def read_notification(notification_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    notification = mark_as_read(db, notification_id, user.id)
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return notification
