from sqlalchemy.orm import Session
from app.models.order_event import OrderEvent, ActionType, ActorType


def create_order_event(
    db: Session,
    order_id: int,
    action_type: ActionType,
    description: str,
    user_id: int | None = None,
    actor_type: ActorType = ActorType.system,
) -> OrderEvent:
    event = OrderEvent(
        order_id=order_id,
        user_id=user_id,
        action_type=action_type,
        actor_type=actor_type,
        description=description,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def get_order_timeline(db: Session, order_id: int) -> list[OrderEvent]:
    return (
        db.query(OrderEvent)
        .filter(OrderEvent.order_id == order_id)
        .order_by(OrderEvent.created_at.asc())
        .all()
    )
