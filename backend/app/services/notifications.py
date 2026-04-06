from sqlalchemy.orm import Session
from app.models.notification import Notification, NotificationType
from app.models.user import User

# Maps NotificationType to the corresponding preference key
_TYPE_TO_PREF_KEY = {
    NotificationType.order_created: "notify_order_created",
    NotificationType.order_confirmed: "notify_order_confirmed",
    NotificationType.order_cancelled: "notify_order_cancelled",
    NotificationType.order_completed: "notify_order_completed",
}


def create_notification(
    db: Session,
    user_id: int,
    type: NotificationType,
    message: str,
    related_order_id: int | None = None,
) -> Notification | None:
    # Check user's notification preferences
    pref_key = _TYPE_TO_PREF_KEY.get(type)
    if pref_key:
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.notification_preferences:
            if not user.notification_preferences.get(pref_key, True):
                return None

    notification = Notification(
        user_id=user_id,
        type=type,
        message=message,
        related_order_id=related_order_id,
    )
    db.add(notification)
    db.commit()
    db.refresh(notification)
    return notification


def get_user_notifications(db: Session, user_id: int, skip: int = 0, limit: int = 20) -> dict:
    base_query = db.query(Notification).filter(Notification.user_id == user_id)
    total = base_query.count()
    items = (
        base_query
        .order_by(Notification.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    unread_count = (
        db.query(Notification)
        .filter(Notification.user_id == user_id, Notification.is_read == False)  # noqa: E712
        .count()
    )
    return {"items": items, "unread_count": unread_count, "total": total}


def mark_as_read(db: Session, notification_id: int, user_id: int) -> Notification | None:
    notification = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == user_id)
        .first()
    )
    if not notification:
        return None
    notification.is_read = True
    db.commit()
    db.refresh(notification)
    return notification


def mark_all_as_read(db: Session, user_id: int) -> int:
    count = (
        db.query(Notification)
        .filter(Notification.user_id == user_id, Notification.is_read == False)  # noqa: E712
        .update({"is_read": True})
    )
    db.commit()
    return count


def clear_all_notifications(db: Session, user_id: int) -> int:
    count = (
        db.query(Notification)
        .filter(Notification.user_id == user_id)
        .delete()
    )
    db.commit()
    return count
