from datetime import datetime
from sqlalchemy import Column, Integer, Time, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base


class RecurringSchedule(Base):
    __tablename__ = "recurring_schedules"
    __table_args__ = (
        UniqueConstraint("order_id", "day_of_week", "start_time", "end_time", name="uq_recurring_schedule"),
    )

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    day_of_week = Column(Integer, nullable=False)  # 0=Sunday, 6=Saturday
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    order = relationship("Order", back_populates="recurring_schedules")
