import enum
from datetime import datetime
from sqlalchemy import Column, Integer, Date, Time, DateTime, Enum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base


class OverrideType(str, enum.Enum):
    skip = "skip"
    replace = "replace"


class ScheduleOverride(Base):
    __tablename__ = "schedule_overrides"
    __table_args__ = (
        UniqueConstraint("order_id", "date", name="uq_schedule_override"),
    )

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    override_type = Column(Enum(OverrideType), nullable=False)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    order = relationship("Order", back_populates="schedule_overrides")
