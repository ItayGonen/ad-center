"""
Background task that auto-cancels pending orders whose start_date has passed
without being confirmed by the user.
"""
import asyncio
import logging
from datetime import date

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.order import Order, OrderStatus, SpaceTimeSlot
from app.models.order_event import ActionType, ActorType
from app.models.notification import NotificationType
from app.services.notifications import create_notification
from app.services.order_events import create_order_event

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 60 * 60  # run every hour


def cancel_expired_pending_orders(db: Session) -> int:
    """Cancel all pending orders whose start_date <= today."""
    today = date.today()
    expired_orders = (
        db.query(Order)
        .filter(
            Order.status == OrderStatus.pending,
            Order.start_date <= today,
        )
        .all()
    )

    cancelled_count = 0
    for order in expired_orders:
        order.status = OrderStatus.cancelled
        # Free time slots
        for slot in order.time_slots:
            db.delete(slot)
        cancelled_count += 1

        create_notification(
            db, order.user_id, NotificationType.order_cancelled,
            f"Your order {order.reference_number} was automatically cancelled — it was not confirmed before the start date",
            order.id,
        )
        create_order_event(
            db, order.id, ActionType.cancelled,
            "Order was automatically cancelled — not confirmed before start date",
            actor_type=ActorType.system,
        )

    if cancelled_count > 0:
        db.commit()
        logger.info("Auto-cancelled %d expired pending order(s)", cancelled_count)

    return cancelled_count


async def auto_cancel_loop() -> None:
    """Runs periodically to cancel expired pending orders."""
    while True:
        try:
            db = SessionLocal()
            try:
                cancel_expired_pending_orders(db)
            finally:
                db.close()
        except Exception:
            logger.exception("Error in auto-cancel loop")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
