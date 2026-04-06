import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Enum, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.order import BookingType


class CampaignStatus(str, enum.Enum):
    active = "active"
    approved = "approved"
    cancelled = "cancelled"
    completed = "completed"


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    campaign_type = Column(Enum(BookingType), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(Enum(CampaignStatus), default=CampaignStatus.active)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    schedule_template = Column(JSON, nullable=True)

    user = relationship("User")
    orders = relationship("Order", back_populates="campaign", cascade="all, delete-orphan")
