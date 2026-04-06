import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from app.database import Base


class NotificationType(str, enum.Enum):
    order_created = "order_created"
    order_approved = "order_approved"
    order_confirmed = "order_confirmed"
    order_cancelled = "order_cancelled"
    order_completed = "order_completed"
    admin_broadcast = "admin_broadcast"


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    type = Column(Enum(NotificationType), nullable=False)
    title = Column(String(255), nullable=True)
    message = Column(String(500), nullable=False)
    link = Column(String(500), nullable=True)
    related_order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User")
