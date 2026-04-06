import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum, Text
from sqlalchemy.orm import relationship
from app.database import Base


class ActionType(str, enum.Enum):
    created = "created"
    approved = "approved"
    confirmed = "confirmed"
    cancelled = "cancelled"
    completed = "completed"
    updated = "updated"


class ActorType(str, enum.Enum):
    user = "user"
    admin = "admin"
    system = "system"


class OrderEvent(Base):
    __tablename__ = "order_events"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action_type = Column(Enum(ActionType), nullable=False)
    actor_type = Column(Enum(ActorType), nullable=False, default=ActorType.system)
    description = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    order = relationship("Order")
    user = relationship("User")
