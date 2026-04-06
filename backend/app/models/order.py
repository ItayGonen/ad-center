import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Numeric, Date, Time, Enum, DateTime, Text, Boolean, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from app.database import Base

MAX_SLOTS_PER_HOUR = 6


class OrderStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    confirmed = "confirmed"
    cancelled = "cancelled"
    completed = "completed"


class BookingType(str, enum.Enum):
    spotlight = "spotlight"
    long_term = "long_term"


class SlotStatus(str, enum.Enum):
    booked = "booked"
    cancelled = "cancelled"


class FileType(str, enum.Enum):
    image = "image"
    video = "video"
    pdf = "pdf"


class ApprovalStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    reference_number = Column(String(50), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    space_id = Column(Integer, ForeignKey("spaces.id"), nullable=False)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=True, index=True)
    is_campaign_primary = Column(Boolean, default=False, nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    total_cost = Column(Numeric(10, 2), nullable=False)
    booking_type = Column(Enum(BookingType), default=BookingType.long_term, nullable=False)
    status = Column(Enum(OrderStatus), default=OrderStatus.pending, nullable=False)
    notes = Column(Text, nullable=True)
    payment_proof_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User")
    space = relationship("Space")
    campaign = relationship("Campaign", back_populates="orders")
    time_slots = relationship("SpaceTimeSlot", back_populates="order", cascade="all, delete-orphan")
    creatives = relationship("OrderCreative", back_populates="order", cascade="all, delete-orphan")
    recurring_schedules = relationship("RecurringSchedule", back_populates="order", cascade="all, delete-orphan")
    schedule_overrides = relationship("ScheduleOverride", back_populates="order", cascade="all, delete-orphan")


class SpaceTimeSlot(Base):
    __tablename__ = "space_time_slots"
    __table_args__ = (
        UniqueConstraint("space_id", "date", "start_time", "slot_position", name="uq_space_time_slot_pos"),
        Index("ix_space_time_slot_lookup", "space_id", "date", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id"), nullable=False)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    date = Column(Date, nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    slot_position = Column(Integer, nullable=False, default=1)
    status = Column(Enum(SlotStatus), default=SlotStatus.booked, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    order = relationship("Order", back_populates="time_slots")
    space = relationship("Space")


class OrderCreative(Base):
    __tablename__ = "order_creatives"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    file_url = Column(String(500), nullable=False)
    file_type = Column(Enum(FileType), nullable=False)
    approval_status = Column(Enum(ApprovalStatus), default=ApprovalStatus.pending, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    order = relationship("Order", back_populates="creatives")
